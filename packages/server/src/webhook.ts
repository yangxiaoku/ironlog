import { createHmac } from "node:crypto";
import type { WebhookConfig } from "@ironlog/shared";

const PRIVATE_IP_RE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^0\./,
];

/**
 * Checks whether a URL targets localhost or an RFC1918/link-local private network address.
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
  if (
    host === "localhost" ||
    host === "::1" ||
    host === "::" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.startsWith("fc") ||
    host.startsWith("fd") ||
    host.startsWith("fe80:")
  ) {
    return true;
  }
  return PRIVATE_IP_RE.some((re) => re.test(host));
}

export function validateWebhookTarget(config: Pick<WebhookConfig, "url" | "allowPrivateNetwork">): { ok: true; url: string } | { ok: false; reason: string } {
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
  if (!config.allowPrivateNetwork && isPrivateWebhookUrl(clean)) {
    return { ok: false, reason: "默认禁止推送到内网/本机地址；如需推送至局域网 n8n/Home Assistant，请勾选允许局域网回调" };
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
): Promise<{ delivered: boolean; status?: number; error?: string }> {
  const check = validateWebhookTarget(config);
  if (!check.ok) return { delivered: false, error: check.reason };

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
      signal: controller.signal,
    });
    return { delivered: res.ok, status: res.status, ...(res.ok ? {} : { error: `目标返回 HTTP ${res.status}` }) };
  } catch (err) {
    return { delivered: false, error: (err as Error)?.message || "推送超时或连接失败" };
  } finally {
    clearTimeout(timeout);
  }
}
