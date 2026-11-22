import { useRef, useState, type FormEvent } from "react";
import { useAuthStore, type AuthMode } from "../store/useAuthStore";

export function AuthScreen() {
  const authMode = useAuthStore((s) => s.authMode);
  const authenticating = useAuthStore((s) => s.authenticating);
  const setAuthMode = useAuthStore((s) => s.setAuthMode);
  const authenticate = useAuthStore((s) => s.authenticate);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const confirmRef = useRef<HTMLInputElement>(null);

  const registering = authMode === "register";
  const label = authenticating ? (registering ? "正在注册…" : "正在登录…") : registering ? "注册账号" : "登录";
  const passwordPattern = registering ? "[A-Za-z0-9]{10,128}" : undefined;

  const switchMode = (next: AuthMode) => {
    setAuthMode(next);
    setError("");
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authenticating) return;
    const cleanUsername = username.trim();
    if (registering && password !== confirmPassword) {
      setError("两次输入的密码不一致");
      confirmRef.current?.focus();
      return;
    }
    setError("");
    try {
      await authenticate(authMode, cleanUsername, password);
    } catch (err) {
      setError((err as Error)?.message || "请求失败，请重试");
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
            <li>饮食热量 · 体重均线与负荷科学</li>
            <li>5,650+ 动作库 · 无需手环即开即用</li>
          </ul>
        </div>
      </div>

      <form id="login-form" className="panel login-form" onSubmit={(e) => void handleSubmit(e)}>
        <div className="auth-mode" role="group" aria-label="账号入口">
          <div className="segments">
            <button
              type="button"
              aria-pressed={registering}
              onClick={() => switchMode("register")}
            >
              注册
            </button>
            <button
              type="button"
              aria-pressed={!registering}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
          </div>
        </div>

        <h2>{registering ? "创建铁记账号" : "登录铁记"}</h2>

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
          <span>密码</span>
          <input
            name="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            maxLength={128}
            minLength={registering ? 10 : undefined}
            pattern={passwordPattern}
            title={registering ? "请输入至少 10 个英文字母或数字" : undefined}
            placeholder={registering ? "至少 10 个字母或数字" : undefined}
            autoComplete={registering ? "new-password" : "current-password"}
          />
        </label>

        {registering ? (
          <label className="field">
            <span>确认密码</span>
            <input
              ref={confirmRef}
              name="confirm"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              maxLength={128}
              minLength={10}
              pattern="[A-Za-z0-9]{10,128}"
              title="请输入至少 10 个英文字母或数字"
              autoComplete="new-password"
            />
          </label>
        ) : null}

        <p className="form-error" role="alert" hidden={!error}>
          {error}
        </p>

        <button className="primary-button" type="submit" disabled={authenticating}>
          {label}
        </button>
      </form>
    </section>
  );
}
