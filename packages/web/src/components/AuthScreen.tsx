import { useRef, useState, type FormEvent } from "react";
import { apiFetch } from "../lib/api";
import { isPasskeySupportedInBrowser, loginWithPasskey } from "../lib/webauthn";
import { useAuthStore, type AuthMode } from "../store/useAuthStore";

export function AuthScreen() {
  const authMode = useAuthStore((s) => s.authMode);
  const authenticating = useAuthStore((s) => s.authenticating);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const authenticate = useAuthStore((s) => s.authenticate);
  const verifySessionAfterLogin = useAuthStore((s) => s.verifySessionAfterLogin);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pairingTab, setPairingTab] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [altBusy, setAltBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLInputElement>(null);

  const passkeySupported = isPasskeySupportedInBrowser();
  const registering = !pairingTab && authMode === "register";
  const label = authenticating || altBusy
    ? pairingTab
      ? "正在配对登录…"
      : registering
        ? "正在注册…"
        : "正在登录…"
    : pairingTab
      ? "使用配对码登录"
      : registering
        ? "注册账号"
        : "登录";
  const passwordPattern = registering ? "[!-~]{10,128}" : undefined;

  const switchMode = (next: AuthMode) => {
    setPairingTab(false);
    setAuthMode(next);
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authenticating || altBusy) return;
    setError("");
    if (pairingTab) {
      const cleanCode = pairingCode.replace(/\s+/g, "");
      if (!/^\d{6}$/.test(cleanCode)) {
        setError("请输入已登录设备生成的 6 位数字配对码");
        return;
      }
      setAltBusy(true);
      try {
        await apiFetch("/auth/web/pairing-login", { method: "POST", body: { code: cleanCode } });
        await verifySessionAfterLogin();
      } catch (err) {
        setError((err as Error)?.message || "配对登录失败，请检查配对码是否过期");
      } finally {
        setAltBusy(false);
      }
      return;
    }
    const cleanUsername = username.trim();
    if (registering && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      confirmRef.current?.focus();
      return;
    }
    try {
      await authenticate(authMode, cleanUsername, password);
    } catch (err) {
      setError((err as Error)?.message || "请求失败，请重试");
    }
  };

  const handlePasskeyLogin = async () => {
    if (authenticating || altBusy) return;
    setError("");
    setAltBusy(true);
    try {
      await loginWithPasskey(username);
      await verifySessionAfterLogin();
    } catch (err) {
      setError((err as Error)?.message || "通行密钥登录失败");
    } finally {
      setAltBusy(false);
    }
  };

  return (
    <section className="login-layout">
      <div className="login-hero">
        <div>
          <img src="/app/icon-192.png" width={62} height={62} alt="" />
          <h1>铁记</h1>
          <p>记训练，记饮食，记体重。</p>
          <ul className="login-hero-list">
            <li>训练计划 · 实时计时与杠铃配片</li>
            <li>饮食热量与体重均线</li>
            <li>5,650 个动作，中英文检索</li>
          </ul>
        </div>
      </div>

      <form id="login-form" className="panel login-form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="auth-mode" role="group" aria-label="账号入口">
          <div className="segments">
            <button
              type="button"
              aria-pressed={!pairingTab && !registering}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              aria-pressed={pairingTab}
              onClick={() => {
                setPairingTab(true);
                setError("");
              }}
            >
              配对码
            </button>
            <button
              type="button"
              aria-pressed={registering}
              onClick={() => switchMode("register")}
            >
              注册
            </button>
          </div>
        </div>

        <h2>{pairingTab ? "设备配对码快捷登录" : registering ? "创建铁记账号" : "登录铁记"}</h2>

        {pairingTab ? (
          <label className="field">
            <span>8 位一次性配对码</span>
            <input
              name="pairingCode"
              inputMode="text"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={12}
              required
              placeholder="例如：A7K9 M2P4"
              value={pairingCode}
              onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
            />
            <small>在已登录设备的「设置 → 账号与数据 → 一次性设备配对码」中生成，5 分钟内有效。</small>
          </label>
        ) : (
          <>
            <label className="field">
              <span>用户名</span>
              <input
                name="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                maxLength={100}
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
              />
              {registering ? <small>3–32 位中文、字母、数字、下划线或短横线</small> : null}
            </label>

            <label className="field">
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span>密码</span>
                <button
                  type="button"
                  className="quiet"
                  style={{ padding: "0 4px", minHeight: 22, fontSize: 12 }}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? "隐藏" : "显示"}
                </button>
              </span>
              <input
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={128}
                minLength={registering ? 10 : undefined}
                pattern={passwordPattern}
                title={registering ? "请输入 10–128 位英文字母、数字或常见符号（不含空格）" : undefined}
                placeholder={registering ? "至少 10 位，支持字母、数字及符号" : undefined}
                autoComplete={registering ? "new-password" : "current-password"}
              />
            </label>

            {registering ? (
              <label className="field">
                <span>确认密码</span>
                <input
                  ref={confirmRef}
                  name="confirm"
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  maxLength={128}
                  minLength={10}
                  pattern="[!-~]{10,128}"
                  title="请输入 10–128 位英文字母、数字或常见符号（不含空格）"
                  autoComplete="new-password"
                />
              </label>
            ) : null}
          </>
        )}

        <p className="form-error" role="alert" hidden={!error}>
          {error}
        </p>

        <button className="primary-button" type="submit" disabled={authenticating || altBusy}>
          {label}
        </button>

        {!registering && !pairingTab ? (
          <div className="auth-passkey-row">
            {passkeySupported ? (
              <button
                type="button"
                className="secondary-button"
                disabled={authenticating || altBusy}
                onClick={() => void handlePasskeyLogin()}
              >
                使用通行密钥（Face ID / Touch ID）登录
              </button>
            ) : (
              <small className="muted">
                通行密钥需 HTTPS 域名支持；当前环境可直接使用上方「配对码」快捷登录新设备。
              </small>
            )}
          </div>
        ) : null}
      </form>
    </section>
  );
}
