import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { WebhookConfig } from "@ironlog/shared";

export interface WebhookPolicy {
  allowPrivateNetwork?: boolean;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv6(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().split("%")[0] ?? "";
  if (ip === "::" || ip === "::1") return true;
  if (ip.startsWith("::ffff:")) {
    const rest = ip.slice(7);
    if (rest.includes(".")) return isPrivateIpv4(rest);
    const hexParts = rest.split(":");
    if (hexParts.length === 2) {
      const hi = Number.parseInt(hexParts[0] || "0", 16);
      const lo = Number.parseInt(hexParts[1] || "0", 16);
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`);
      }
    }
    return true;
  }
  const firstSegment = ip.split(":")[0] || "0";
  const firstHextet = Number.parseInt(firstSegment, 16);
  if (Number.isNaN(firstHextet)) return true;
  // fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast)
  if ((firstHextet & 0xfe00) === 0xfc00) return true;
  if ((firstHextet & 0xffc0) === 0xfe80) return true;
  if ((firstHextet & 0xff00) === 0xff00) return true;
  return false;
}

export function isPrivateIpAddress(ip: string): boolean {
  const clean = ip.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  const kind = isIP(clean);
  if (kind === 4) return isPrivateIpv4(clean);
  if (kind === 6) return isPrivateIpv6(clean);
  return true;
}

/**
 * Checks whether a URL targets localhost, single-label internal hostnames, or a private/reserved IP address.
 */
export function isPrivateWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  const ipKind = isIP(host.split("%")[0] ?? host);
  if (ipKind === 4 || ipKind === 6) return isPrivateIpAddress(host);
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  ) {
    return true;
  }
  return false;
}

export function validateWebhookTarget(
  config: Pick<WebhookConfig, "url" | "allowPrivateNetwork">,
  policy?: WebhookPolicy,
): { ok: true; url: string } | { ok: false; reason: string } {
  const clean = (config.url ?? "").trim();
  if (!clean) return { ok: false, reason: "请填写 Webhook 回调地址" };
  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    return { ok: false, reason: "Webhook URL 格式不正确" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Webhook 仅支持 http:// 或 https:// 协议" };
  }
  if (isPrivateWebhookUrl(clean)) {
    if (policy && !policy.allowPrivateNetwork) {
      return {
        ok: false,
        reason: "当前服务端部署策略禁止推送到内网或本机地址（需部署管理员启用 ALLOW_PRIVATE_WEBHOOKS）",
      };
    }
    if (!config.allowPrivateNetwork) {
      return { ok: false, reason: "默认禁止推送到内网/本机地址；如需推送至局域网 n8n/Home Assistant，请勾选允许局域网回调" };
    }
  }
  return { ok: true, url: parsed.toString() };
}

export function signWebhookPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export async function deliverWebhookEvent(
  config: WebhookConfig,
  eventName: "workout.completed" | "webhook.test",
  payload: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
  policy?: WebhookPolicy,
  resolveHost?: (hostname: string) => Promise<Array<{ address: string }>>,
): Promise<{ delivered: boolean; status?: number; error?: string }> {
  const check = validateWebhookTarget(config, policy);
  if (!check.ok) return { delivered: false, error: check.reason };

  const allowPrivate =
    policy === undefined
      ? Boolean(config.allowPrivateNetwork)
      : Boolean(policy.allowPrivateNetwork && config.allowPrivateNetwork);
  const host = new URL(check.url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host.split("%")[0] ?? host) === 0 && (resolveHost || fetcher === fetch)) {
    try {
      const resolver = resolveHost ?? ((h: string) => lookup(h, { all: true }));
      const resolved = await resolver(host);
      if (!resolved.length) {
        return { delivered: false, error: "Webhook 目标域名解析失败" };
      }
      if (resolved.some((entry) => isPrivateIpAddress(entry.address))) {
        return { delivered: false, error: "Webhook 目标域名解析到内网或保留 IP，已拦截" };
      }
    } catch {
      return { delivered: false, error: "Webhook 目标域名解析失败" };
    }
  }

  const body = JSON.stringify({
    event: eventName,
    source: "ironlog",
    sentAt: new Date().toISOString(),
    data: payload,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Ironlog-Webhook/1.0",
    "X-Ironlog-Event": eventName,
  };
  if (config.secret.trim()) {
    headers["X-Ironlog-Signature"] = signWebhookPayload(body, config.secret.trim());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetcher(check.url, {
      method: "POST",
      headers,
      body,
      redirect: "error",
      signal: controller.signal,
    });
    return { delivered: res.ok, status: res.status, ...(res.ok ? {} : { error: `目标返回 HTTP ${res.status}` }) };
  } catch (err) {
    return { delivered: false, error: (err as Error)?.message || "推送超时或连接失败" };
  } finally {
    clearTimeout(timeout);
  }
}
