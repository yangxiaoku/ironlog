import { apiFetch } from "./api";

export function isPasskeySupportedInBrowser(): boolean {
  return (
    typeof window !== "undefined" &&
    Boolean(window.isSecureContext) &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.credentials?.create) &&
    Boolean(navigator.credentials?.get)
  );
}

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function registerPasskeyCredential(label: string): Promise<{ credentialId: string; label: string }> {
  if (!isPasskeySupportedInBrowser()) {
    throw new Error("当前页面非 HTTPS 安全上下文或浏览器不支持通行密钥，请使用 HTTPS 域名访问或改用一次性配对码");
  }
  const opts = await apiFetch<{
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout: number;
    attestation: AttestationConveyancePreference;
    authenticatorSelection: AuthenticatorSelectionCriteria;
    excludeCredentials?: Array<{ id: string; type: "public-key" }>;
  }>("/api/web/auth/passkey/register/options", { method: "POST" });

  const cred = (await navigator.credentials.create({
    publicKey: {
      ...opts,
      challenge: base64UrlToUint8Array(opts.challenge) as BufferSource,
      user: {
        ...opts.user,
        id: base64UrlToUint8Array(opts.user.id) as BufferSource,
      },
      excludeCredentials: (opts.excludeCredentials ?? []).map((c) => ({
        id: base64UrlToUint8Array(c.id) as BufferSource,
        type: "public-key",
      })),
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("已取消绑定通行密钥");
  const response = cred.response as AuthenticatorAttestationResponse;
  if (typeof response.getPublicKey !== "function") {
    throw new Error("当前浏览器版本不支持导出通行密钥公钥，请升级浏览器或使用设备配对码");
  }
  const spki = response.getPublicKey();
  if (!spki) throw new Error("未能从认证器读取公钥");
  const transports = typeof response.getTransports === "function" ? response.getTransports() : [];

  return apiFetch<{ credentialId: string; label: string }>("/api/web/auth/passkey/register/verify", {
    method: "POST",
    body: {
      credentialId: cred.id,
      publicKeySpki: bufferToBase64Url(spki),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      ...(response.attestationObject ? { attestationObject: bufferToBase64Url(response.attestationObject) } : {}),
      transports,
      label: label.trim() || "本机通行密钥",
    },
  });
}

export async function loginWithPasskey(usernameHint?: string): Promise<{ userId: string }> {
  if (!isPasskeySupportedInBrowser()) {
    throw new Error("通行密钥需要 HTTPS 域名或本机 localhost 环境，当前请使用一次性配对码或账号密码登录");
  }
  const opts = await apiFetch<{
    challenge: string;
    rpId: string;
    timeout: number;
    userVerification: UserVerificationRequirement;
    allowCredentials?: Array<{ id: string; type: "public-key" }>;
  }>("/auth/web/passkey/login/options", {
    method: "POST",
    body: usernameHint?.trim() ? { username: usernameHint.trim() } : {},
  });

  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: base64UrlToUint8Array(opts.challenge) as BufferSource,
      rpId: opts.rpId,
      timeout: opts.timeout,
      userVerification: opts.userVerification,
      ...(opts.allowCredentials?.length
        ? {
            allowCredentials: opts.allowCredentials.map((c) => ({
              id: base64UrlToUint8Array(c.id) as BufferSource,
              type: "public-key",
            })),
          }
        : {}),
    },
  })) as PublicKeyCredential | null;

  if (!cred) throw new Error("已取消通行密钥登录");
  const response = cred.response as AuthenticatorAssertionResponse;
  return apiFetch<{ userId: string }>("/auth/web/passkey/login/verify", {
    method: "POST",
    body: {
      credentialId: cred.id,
      authenticatorData: bufferToBase64Url(response.authenticatorData),
      clientDataJSON: bufferToBase64Url(response.clientDataJSON),
      signature: bufferToBase64Url(response.signature),
    },
  });
}
