import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { shortDate } from "../../lib/date";
import type { HiddenModuleKey, WebhookConfig } from "../../lib/domain";
import { isPasskeySupportedInBrowser, registerPasskeyCredential } from "../../lib/webauthn";
import {
  MODULAR_UI_OPTIONS,
  readWorkoutPreferences,
  writeWorkoutPreference,
} from "../../lib/workout-helpers";
import { useUiStore } from "../../store/useUiStore";
import { Icon } from "../Icon";

interface PasskeySummary {
  credentialId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export function AccountSecurityAndEcosystemCards({
  initialWebhook,
  demo,
}: {
  initialWebhook?: WebhookConfig | null;
  demo: boolean;
}) {
  const notify = useUiStore((s) => s.notify);
  const openConfirm = useUiStore((s) => s.openConfirm);

  // Pairing code state
  const [pairingCode, setPairingCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [pairingBusy, setPairingBusy] = useState(false);

  // Passkey state
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyLabel, setPasskeyLabel] = useState("");
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeySupported = isPasskeySupportedInBrowser();

  // Webhook state
  const [whEnabled, setWhEnabled] = useState(Boolean(initialWebhook?.enabled));
  const [whUrl, setWhUrl] = useState(initialWebhook?.url ?? "");
  const [whSecret, setWhSecret] = useState(initialWebhook?.secret ?? "");
  const [whPrivate, setWhPrivate] = useState(Boolean(initialWebhook?.allowPrivateNetwork));
  const [whDirty, setWhDirty] = useState(false);
  const [whBusy, setWhBusy] = useState(false);

  // Modular UI toggles
  const [hiddenModules, setHiddenModules] = useState<HiddenModuleKey[]>(
    () => readWorkoutPreferences().hiddenModules ?? [],
  );

  useEffect(() => {
    if (whDirty) return;
    setWhEnabled(Boolean(initialWebhook?.enabled));
    setWhUrl(initialWebhook?.url ?? "");
    setWhSecret(initialWebhook?.secret ?? "");
    setWhPrivate(Boolean(initialWebhook?.allowPrivateNetwork));
  }, [initialWebhook, whDirty]);

  useEffect(() => {
    if (demo) return;
    void apiFetch<PasskeySummary[]>("/api/web/auth/passkeys")
      .then((list) => setPasskeys(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, [demo]);

  const handleGeneratePairing = async () => {
    setPairingBusy(true);
    try {
      const res = await apiFetch<{ code: string; expiresAt: string }>("/api/web/auth/pairing-code", {
        method: "POST",
        skipMutateHook: true,
      });
      setPairingCode(res);
      notify("已生成 6 位一次性配对码（5 分钟有效）");
    } catch (err) {
      notify((err as Error)?.message || "生成配对码失败");
    } finally {
      setPairingBusy(false);
    }
  };

  const handleRegisterPasskey = async () => {
    setPasskeyBusy(true);
    try {
      await registerPasskeyCredential(passkeyLabel);
      setPasskeyLabel("");
      const list = await apiFetch<PasskeySummary[]>("/api/web/auth/passkeys");
      setPasskeys(Array.isArray(list) ? list : []);
      notify("已绑定通行密钥（Face ID / Touch ID）");
    } catch (err) {
      notify((err as Error)?.message || "绑定通行密钥失败");
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleDeletePasskey = (item: PasskeySummary) => {
    openConfirm({
      title: "解绑通行密钥",
      message: `确定删除通行密钥「${item.label}」吗？删除后该设备仍可通过密码或配对码登录。`,
      confirmLabel: "删除",
      onConfirm: async () => {
        await apiFetch(`/api/web/auth/passkeys/${encodeURIComponent(item.credentialId)}`, { method: "DELETE" });
        setPasskeys((prev) => prev.filter((k) => k.credentialId !== item.credentialId));
        notify("已删除通行密钥");
      },
    });
  };

  const handleSaveWebhook = async () => {
    setWhBusy(true);
    try {
      await apiFetch("/api/web/profile/webhook", {
        method: "PUT",
        body: {
          enabled: whEnabled,
          url: whUrl.trim(),
          secret: whSecret.trim(),
          allowPrivateNetwork: whPrivate,
        },
      });
      setWhDirty(false);
      notify("Webhook 配置已保存");
    } catch (err) {
      notify((err as Error)?.message || "保存 Webhook 失败");
    } finally {
      setWhBusy(false);
    }
  };

  const handleTestWebhook = async () => {
    setWhBusy(true);
    try {
      const res = await apiFetch<{ delivered: boolean; status?: number; error?: string }>("/api/web/webhook/test", {
        method: "POST",
        skipMutateHook: true,
        body: {
          enabled: true,
          url: whUrl.trim(),
          secret: whSecret.trim(),
          allowPrivateNetwork: whPrivate,
        },
      });
      notify(res.delivered ? `Webhook 测试推送成功（HTTP ${res.status ?? 200}）` : res.error || "推送失败");
    } catch (err) {
      notify((err as Error)?.message || "测试推送失败");
    } finally {
      setWhBusy(false);
    }
  };

  const toggleModuleVisibility = (id: HiddenModuleKey) => {
    const isHidden = hiddenModules.includes(id);
    const next = isHidden ? hiddenModules.filter((m) => m !== id) : [...hiddenModules, id];
    setHiddenModules(next);
    writeWorkoutPreference("hiddenModules", next);
    if (id === "plateMath") writeWorkoutPreference("showPlateMath", isHidden);
    if (id === "rir") writeWorkoutPreference("showRir", isHidden);
    notify(isHidden ? "已重新显示该模块" : "已隐藏该模块（历史数据完整保留）");
  };

  return (
    <>
      {!demo ? (
        <details className="settings-accordion">
          <summary>
            <span>一次性设备配对码 & 通行密钥（Passkey）</span>
            <span className="settings-accordion-meta">
              {passkeys.length} 个密钥
              <Icon name="chevron" size={14} />
            </span>
          </summary>
          <div className="settings-accordion-body">
            <div className="form-section">
              <h4 className="form-section-title">新设备一次性 6 位配对码（HTTP / HTTPS 通用）</h4>
              <p className="muted">
                在手机或平板登录页选择「配对码登录」并输入下方 6 位数字即可免输密码一键登录，5 分钟有效、用后即焚。
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={pairingBusy}
                  onClick={() => void handleGeneratePairing()}
                >
                  {pairingBusy ? "生成中…" : "生成新设备配对码"}
                </button>
                {pairingCode ? (
                  <div className="pairing-code-badge">
                    <strong>{pairingCode.code.slice(0, 3)} {pairingCode.code.slice(3)}</strong>
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => {
                        void copyText(pairingCode.code).then(() => notify("已复制 6 位配对码"));
                      }}
                    >
                      复制
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="form-section" style={{ marginTop: 14 }}>
              <h4 className="form-section-title">通行密钥（Face ID / Touch ID / Windows Hello）</h4>
              {!passkeySupported ? (
                <p className="muted">
                  当前通过非 HTTPS 地址访问，浏览器策略要求 HTTPS 域名或 localhost 才可调用通行密钥；你可随时使用上方「一次性配对码」快捷登录新设备。
                </p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input
                    type="text"
                    maxLength={40}
                    placeholder="备注设备名（如 iPhone 16 Pro）"
                    value={passkeyLabel}
                    onChange={(e) => setPasskeyLabel(e.target.value)}
                    style={{ flex: "1 1 180px" }}
                  />
                  <button
                    type="button"
                    className="primary-button"
                    disabled={passkeyBusy}
                    onClick={() => void handleRegisterPasskey()}
                  >
                    {passkeyBusy ? "验证中…" : "绑定本机通行密钥"}
                  </button>
                </div>
              )}
              {passkeys.length ? (
                <ul className="passkey-list">
                  {passkeys.map((k) => (
                    <li key={k.credentialId}>
                      <div>
                        <strong>{k.label}</strong>
                        <small className="muted">
                          绑定于 {shortDate(k.createdAt.slice(0, 10))}
                          {k.lastUsedAt ? ` · 最近使用 ${shortDate(k.lastUsedAt.slice(0, 10))}` : ""}
                        </small>
                      </div>
                      <button type="button" className="danger" onClick={() => handleDeletePasskey(k)}>
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}

      <details className="settings-accordion">
        <summary>
          <span>界面模块精简开关</span>
          <span className="settings-accordion-meta">
            已隐藏 {hiddenModules.length} 项
            <Icon name="chevron" size={14} />
          </span>
        </summary>
        <div className="settings-accordion-body">
          <p className="muted">按个人习惯开关可选模块，隐藏仅收起界面入口，不会删除任何历史记录。</p>
          <div className="session-options">
            {MODULAR_UI_OPTIONS.map((mod) => {
              const visible = !hiddenModules.includes(mod.id);
              return (
                <label key={mod.id} className="switch-chip" title={mod.desc}>
                  <span>{mod.label}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={visible}
                    onChange={() => toggleModuleVisibility(mod.id)}
                  />
                </label>
              );
            })}
          </div>
        </div>
      </details>

      {!demo ? (
        <details className="settings-accordion">
          <summary>
            <span>训练完成 Webhook 自动化推送</span>
            <span className="settings-accordion-meta">
              {whEnabled ? "已开启" : "未开启"}
              <Icon name="chevron" size={14} />
            </span>
          </summary>
          <div className="settings-accordion-body">
            <p className="muted">
              每次保存完练时异步 POST 标准 JSON（附带 <code>X-Ironlog-Signature</code> HMAC-SHA256 签名），可直接联动 n8n、Home Assistant 或 ntfy。
            </p>
            <div className="settings-form">
              <label className="toggle-row">
                <span>启用完练 Webhook 推送</span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={whEnabled}
                  onChange={(e) => {
                    setWhDirty(true);
                    setWhEnabled(e.target.checked);
                  }}
                />
              </label>
              <label className="field">
                <span>回调 URL</span>
                <input
                  type="url"
                  maxLength={500}
                  placeholder="https://hooks.example.com/ironlog"
                  value={whUrl}
                  onChange={(e) => {
                    setWhDirty(true);
                    setWhUrl(e.target.value);
                  }}
                />
              </label>
              <label className="field">
                <span>签名密钥（Secret，选填）</span>
                <input
                  type="password"
                  maxLength={128}
                  placeholder="用于校验 X-Ironlog-Signature"
                  value={whSecret}
                  onChange={(e) => {
                    setWhDirty(true);
                    setWhSecret(e.target.value);
                  }}
                />
              </label>
              <label className="toggle-row">
                <span>
                  允许推送至局域网 / 内网地址
                  <small className="muted">自托管联动局域网 Home Assistant / n8n 时开启</small>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={whPrivate}
                  onChange={(e) => {
                    setWhDirty(true);
                    setWhPrivate(e.target.checked);
                  }}
                />
              </label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="primary-button" disabled={whBusy} onClick={() => void handleSaveWebhook()}>
                  {whBusy ? "处理中…" : "保存 Webhook"}
                </button>
                <button type="button" className="secondary-button" disabled={whBusy || !whUrl.trim()} onClick={() => void handleTestWebhook()}>
                  发送测试推送
                </button>
              </div>
            </div>
          </div>
        </details>
      ) : null}
    </>
  );
}
