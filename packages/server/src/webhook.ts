import { createHmac } from "node:crypto";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import type { WebhookConfig } from "@ironlog/shared";

export interface WebhookPolicy {
  allowPrivateNetwork?: boolean;
}

function isPrivateIpv4Bytes(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18.0.0/15
  if (a >= 224) return true;
  return false;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return isPrivateIpv4Bytes(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
}

/**
 * Parses an IPv6 address (with optional embedded IPv4 suffix) into 16 raw bytes.
 * Returns null if the string is not a valid IPv6 literal.
 */
function parseIpv6Bytes(rawIp: string): Uint8Array | null {
  const clean = rawIp.trim().toLowerCase().replace(/^\[|\]$/g, "").split("%")[0] ?? "";
  if (!clean || isIP(clean) !== 6) return null;

  // Replace trailing dotted-quad IPv4 with two 16-bit hex hextets
  let normalized = clean;
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon >= 0 && normalized.slice(lastColon + 1).includes(".")) {
    const ipv4Part = normalized.slice(lastColon + 1);
    const octets = ipv4Part.split(".").map(Number);
    if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const hi = ((octets[0]! << 8) | octets[1]!).toString(16);
    const lo = ((octets[2]! << 8) | octets[3]!).toString(16);
    normalized = `${normalized.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;

  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    const val = Number.parseInt(groups[i]!, 16);
    if (!Number.isInteger(val) || val < 0 || val > 0xffff) return null;
    out[i * 2] = (val >> 8) & 0xff;
    out[i * 2 + 1] = val & 0xff;
  }
  return out;
}

function isPrivateIpv6(rawIp: string): boolean {
  const bytes = parseIpv6Bytes(rawIp);
  if (!bytes) return true;

  const isZeroPrefix = (count: number) => {
    for (let i = 0; i < count; i++) if (bytes[i] !== 0) return false;
    return true;
  };

  // ::/96 — unspecified (::), loopback (::1), and deprecated IPv4-compatible IPv6 (::127.0.0.1 etc.)
  if (isZeroPrefix(12)) return true;

  // ::ffff:0:0/96 (IPv4-mapped) and ::ffff:0:0:0/96 (IPv4-translated)
  if (isZeroPrefix(10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4Bytes(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  }
  if (isZeroPrefix(8) && bytes[8] === 0xff && bytes[9] === 0xff && bytes[10] === 0 && bytes[11] === 0) {
    return isPrivateIpv4Bytes(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
  }

  // 64:ff9b::/96 (NAT64 well-known prefix) & 64:ff9b:1::/48 (NAT64 local-use)
  if (bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b) {
    if (bytes[4] === 0x00 && bytes[5] === 0x01) return true;
    if (bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0 && bytes[8] === 0 && bytes[9] === 0 && bytes[10] === 0 && bytes[11] === 0) {
      return isPrivateIpv4Bytes(bytes[12]!, bytes[13]!, bytes[14]!, bytes[15]!);
    }
  }

  // 100::/64 (discard-only)
  if (bytes[0] === 0x01 && bytes[1] === 0x00 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 0 && bytes[5] === 0 && bytes[6] === 0 && bytes[7] === 0) {
    return true;
  }

  // 2001::/32 (Teredo) and 2001:db8::/32 (documentation)
  if (bytes[0] === 0x20 && bytes[1] === 0x01) {
    if (bytes[2] === 0x00 && bytes[3] === 0x00) return true;
    if (bytes[2] === 0x0d && bytes[3] === 0xb8) return true;
  }

  // 2002::/16 (6to4 — embeds IPv4 in bytes 2..5, deprecated)
  if (bytes[0] === 0x20 && bytes[1] === 0x02) return true;

  // fc00::/7 (ULA), fe80::/10 (link-local), fec0::/10 (deprecated site-local), ff00::/8 (multicast)
  if ((bytes[0]! & 0xfe) === 0xfc) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true;
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return true;
  if (bytes[0] === 0xff) return true;

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
  // #97: Strip trailing FQDN dots before hostname & IP checks so `localhost.`, `redis.`, `*.internal.` cannot bypass.
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
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

/**
 * Dispatches a POST request pinned to an already-validated IP address to close DNS-rebinding windows (#97).
 */
function postPinnedWebhook(
  targetUrl: string,
  pinnedAddress: string,
  headers: Record<string, string>,
  body: string,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(targetUrl);
    const family = isIP(pinnedAddress.split("%")[0] ?? pinnedAddress);
    const isHttps = parsed.protocol === "https:";
    const mod = isHttps ? https : http;
    const rawHost = parsed.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    let settled = false;
    let wallTimer: ReturnType<typeof setTimeout> | null = null;
    const finishResolve = (result: { ok: boolean; status: number }) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      resolve(result);
    };
    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      if (wallTimer) clearTimeout(wallTimer);
      reject(err);
    };
    const req = mod.request(
      {
        protocol: parsed.protocol,
        hostname: rawHost,
        port: parsed.port ? Number(parsed.port) : isHttps ? 443 : 80,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        agent: false,
        headers: {
          ...headers,
          Host: parsed.host,
          "Content-Length": String(Buffer.byteLength(body)),
        },
        ...(isHttps ? { servername: rawHost } : {}),
        lookup: (_hostname, options, cb) => {
          const all = typeof options === "object" && options?.all;
          if (all) {
            cb(null, [{ address: pinnedAddress, family: family === 6 ? 6 : 4 }]);
          } else {
            cb(null, pinnedAddress, family === 6 ? 6 : 4);
          }
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        // #174 (P1): Destroy response stream immediately after reading status to prevent streaming connection leaks.
        res.destroy();
        if (status >= 300 && status < 400) {
          finishReject(new Error("Webhook 禁止重定向"));
          return;
        }
        finishResolve({ ok: status >= 200 && status < 300, status });
      },
    );
    // #174 (P1): Enforce a strict wall-clock timeout in addition to socket idle timeout.
    wallTimer = setTimeout(() => {
      req.destroy(new Error("推送超时"));
      finishReject(new Error("推送超时"));
    }, timeoutMs);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error("推送超时"));
    });
    req.on("error", (err) => finishReject(err instanceof Error ? err : new Error(String(err))));
    req.write(body);
    req.end();
  });
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
  const host = new URL(check.url).hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  let pinnedAddress: string | null = null;
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
      pinnedAddress = resolved[0]!.address;
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

  // #97: When using live network transport with a validated hostname, pin connection to the resolved IP to avoid DNS rebinding.
  if (fetcher === fetch && pinnedAddress) {
    try {
      const res = await postPinnedWebhook(check.url, pinnedAddress, headers, body, 5000);
      return { delivered: res.ok, status: res.status, ...(res.ok ? {} : { error: `目标返回 HTTP ${res.status}` }) };
    } catch (err) {
      return { delivered: false, error: (err as Error)?.message || "推送超时或连接失败" };
    }
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
