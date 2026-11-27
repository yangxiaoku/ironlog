import { createHash, createPublicKey, randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual, verify as verifySignature } from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { Db } from "./db.js";
import { DomainError } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;

const username = z.string().max(100)
  .transform((value) => value.trim().normalize("NFKC").toLowerCase())
  .pipe(z.string().regex(/^[a-z0-9_\-\p{Script=Han}]{3,32}$/u, "用户名需为 3–32 位中文、字母、数字、下划线或短横线"));
const password = z.string()
  .min(10, "密码至少 10 个字符")
  .max(128, "密码最多 128 个字符")
  .refine((value) => /^[\x21-\x7E]+$/.test(value), "密码只能包含英文字母、数字及常见符号（不含空格）");
export const webCredentialsInput = z.object({ username, password });
export const webLoginInput = webCredentialsInput.extend({ password: z.string().min(1).max(128) });
export const webPasswordChangeInput = z.object({
  currentPassword: z.string().min(1, "请输入当前密码").max(128),
  newPassword: password,
});
export const webSessionSeconds = 30 * 86400;
const sessionPattern = /^ws_[A-Za-z0-9_-]{43}$/;
const sessionDigest = (session: string) => createHash("sha256").update(session).digest("hex");
const dummySalt = randomBytes(16);
const dummyHash = Buffer.alloc(64);
type Credentials = z.infer<typeof webCredentialsInput>;
type CredentialRow = { userId: string; salt: Buffer; passwordHash: Buffer };

function parseClientDataJson(b64url: string): { type?: string; challenge?: string; origin?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(b64url, "base64url").toString("utf8"));
  } catch {
    throw new DomainError("无效的通行密钥客户端数据", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new DomainError("无效的通行密钥客户端数据", 400);
  }
  return parsed as { type?: string; challenge?: string; origin?: string };
}

function decodeCborValue(buf: Buffer, offset: number): { value: unknown; next: number } {
  if (offset >= buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
  const initial = buf[offset]!;
  const major = initial >> 5;
  const addl = initial & 0x1f;
  let pos = offset + 1;
  const readLen = (): number => {
    if (addl < 24) return addl;
    if (addl === 24) {
      if (pos + 1 > buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
      const n = buf[pos]!;
      pos += 1;
      return n;
    }
    if (addl === 25) {
      if (pos + 2 > buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
      const n = buf.readUInt16BE(pos);
      pos += 2;
      return n;
    }
    if (addl === 26) {
      if (pos + 4 > buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
      const n = buf.readUInt32BE(pos);
      pos += 4;
      return n;
    }
    throw new DomainError("不支持的通行密钥证明数据编码", 400);
  };
  if (major === 0) return { value: readLen(), next: pos };
  if (major === 1) return { value: -1 - readLen(), next: pos };
  if (major === 2) {
    const len = readLen();
    if (pos + len > buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
    return { value: buf.subarray(pos, pos + len), next: pos + len };
  }
  if (major === 3) {
    const len = readLen();
    if (pos + len > buf.length) throw new DomainError("无效的通行密钥证明数据", 400);
    return { value: buf.subarray(pos, pos + len).toString("utf8"), next: pos + len };
  }
  if (major === 4) {
    const len = readLen();
    const arr: unknown[] = [];
    for (let i = 0; i < len; i++) {
      const item = decodeCborValue(buf, pos);
      arr.push(item.value);
      pos = item.next;
    }
    return { value: arr, next: pos };
  }
  if (major === 5) {
    const len = readLen();
    const map: Record<string, unknown> = {};
    for (let i = 0; i < len; i++) {
      const k = decodeCborValue(buf, pos);
      const v = decodeCborValue(buf, k.next);
      map[String(k.value)] = v.value;
      pos = v.next;
    }
    return { value: map, next: pos };
  }
  if (major === 7) {
    if (addl === 20) return { value: false, next: pos };
    if (addl === 21) return { value: true, next: pos };
    if (addl === 22 || addl === 23) return { value: null, next: pos };
    throw new DomainError("不支持的通行密钥证明数据编码", 400);
  }
  throw new DomainError("不支持的通行密钥证明数据编码", 400);
}

function verifyAttestationObject(attestationB64Url: string, expectedRpId: string, expectedCredentialId: string) {
  const buf = Buffer.from(attestationB64Url, "base64url");
  const decoded = decodeCborValue(buf, 0).value;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new DomainError("无效的通行密钥证明对象", 400);
  }
  const authData = (decoded as Record<string, unknown>).authData;
  if (!Buffer.isBuffer(authData) || authData.length < 55) {
    throw new DomainError("通行密钥证明中缺少有效认证器数据", 400);
  }
  const rpIdHash = authData.subarray(0, 32);
  const expectedRpHash = createHash("sha256").update(expectedRpId).digest();
  if (!timingSafeEqual(rpIdHash, expectedRpHash)) {
    throw new DomainError("通行密钥注册域名摘要校验失败", 400);
  }
  const flags = authData[32]!;
  if ((flags & 0x01) === 0 || (flags & 0x40) === 0) {
    throw new DomainError("通行密钥注册未包含有效的认证凭据数据", 400);
  }
  // Attested credential data starts at offset 37: 16 bytes AAGUID + 2 bytes credIdLen + credId
  const credIdLen = authData.readUInt16BE(53);
  if (credIdLen <= 0 || 55 + credIdLen > authData.length) {
    throw new DomainError("通行密钥凭据 ID 长度无效", 400);
  }
  const attestedCredId = authData.subarray(55, 55 + credIdLen).toString("base64url");
  if (attestedCredId !== expectedCredentialId) {
    throw new DomainError("通行密钥凭据 ID 与证明对象不一致", 400);
  }
}

export class WebAuth {
  private hashing = 0;
  private nextCleanup = 0;
  private readonly limits = new Map<string, { count: number; until: number }>();
  private readonly stmtHasUsername: Stmt;
  private readonly stmtHasUser: Stmt;
  private readonly stmtHasCredUser: Stmt;
  private readonly stmtInsertUser: Stmt;
  private readonly stmtInsertCred: Stmt;
  private readonly stmtLogin: Stmt;
  private readonly stmtCredByUser: Stmt;
  private readonly stmtUpdateCred: Stmt;
  private readonly stmtUsername: Stmt;
  private readonly stmtPurgeExpired: Stmt;
  private readonly stmtInsertSession: Stmt;
  private readonly stmtIdentify: Stmt;
  private readonly stmtRevokeSession: Stmt;
  private readonly stmtRevokeUserSessions: Stmt;

  constructor(private readonly db: Db) {
    this.stmtHasUsername = db.prepare("SELECT 1 FROM web_credentials WHERE username=?");
    this.stmtHasUser = db.prepare("SELECT 1 FROM users WHERE id=?");
    this.stmtHasCredUser = db.prepare("SELECT 1 FROM web_credentials WHERE user_id=?");
    this.stmtInsertUser = db.prepare("INSERT INTO users VALUES (?, ?, ?)");
    this.stmtInsertCred = db.prepare("INSERT INTO web_credentials VALUES (?, ?, ?, ?)");
    this.stmtLogin = db.prepare("SELECT user_id AS userId, salt, password_hash AS passwordHash FROM web_credentials WHERE username=?");
    this.stmtCredByUser = db.prepare("SELECT user_id AS userId, salt, password_hash AS passwordHash FROM web_credentials WHERE user_id=?");
    this.stmtUpdateCred = db.prepare("UPDATE web_credentials SET salt=?, password_hash=? WHERE user_id=?");
    this.stmtUsername = db.prepare("SELECT username FROM web_credentials WHERE user_id=?");
    this.stmtPurgeExpired = db.prepare("DELETE FROM web_sessions WHERE expires_at<=?");
    this.stmtInsertSession = db.prepare("INSERT INTO web_sessions VALUES (?, ?, ?)");
    this.stmtIdentify = db.prepare("SELECT user_id AS userId FROM web_sessions WHERE hash=? AND expires_at>?");
    this.stmtRevokeSession = db.prepare("DELETE FROM web_sessions WHERE hash=?");
    this.stmtRevokeUserSessions = db.prepare("DELETE FROM web_sessions WHERE user_id=?");
  }

  limit(key: string, max: number, windowMs = 15 * 60_000) {
    const now = Date.now();
    if (this.nextCleanup <= now) {
      for (const [entry, { until }] of this.limits) if (until <= now) this.limits.delete(entry);
      this.nextCleanup = now + 60_000;
    }
    const previous = this.limits.get(key);
    const state = previous && previous.until > now ? previous : { count: 0, until: now + windowMs };
    if (state.count >= max) throw new DomainError("尝试次数过多，请稍后重试", 429);
    state.count++;
    this.limits.set(key, state);
  }

  private async hashPassword(password: string, salt: Buffer) {
    if (this.hashing >= 2) throw new DomainError("登录服务繁忙，请稍后重试", 429);
    this.hashing++;
    try {
      return await new Promise<Buffer>((resolve, reject) => {
        scrypt(password, salt, 64, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 },
          (error, result) => error ? reject(error) : resolve(result));
      });
    } finally {
      this.hashing--;
    }
  }

  async register(input: Credentials, existingUserId?: string) {
    const salt = randomBytes(16);
    const passwordHash = await this.hashPassword(input.password, salt);
    return this.db.transaction(() => {
      const userId = existingUserId ?? randomUUID();
      if (this.stmtHasUsername.get(input.username))
        throw new DomainError("这个用户名已被使用", 409);
      if (existingUserId) {
        if (!this.stmtHasUser.get(userId))
          throw new DomainError("找不到该用户 ID", 404);
        if (this.stmtHasCredUser.get(userId))
          throw new DomainError("该账号已绑定网页登录", 409);
      } else {
        this.stmtInsertUser.run(userId, "registered:" + userId, new Date().toISOString());
      }
      this.stmtInsertCred.run(input.username, userId, salt, passwordHash);
      return { userId };
    }).immediate();
  }

  async login(input: Credentials) {
    const row = this.stmtLogin.get(input.username) as CredentialRow | undefined;
    const hash = await this.hashPassword(input.password, row?.salt ?? dummySalt);
    const allowed = timingSafeEqual(hash, row?.passwordHash ?? dummyHash);
    if (!row || !allowed) throw new DomainError("用户名或密码不正确", 401);
    return { userId: row.userId };
  }

  async changePassword(userId: string, input: z.infer<typeof webPasswordChangeInput>) {
    const row = this.stmtCredByUser.get(userId) as CredentialRow | undefined;
    const currentHash = await this.hashPassword(input.currentPassword, row?.salt ?? dummySalt);
    const allowed = timingSafeEqual(currentHash, row?.passwordHash ?? dummyHash);
    if (!row) throw new DomainError("当前账号未设置网页密码", 400);
    if (!allowed) throw new DomainError("当前密码不正确", 401);
    if (input.currentPassword === input.newPassword)
      throw new DomainError("新密码不能与当前密码相同", 400);
    const newSalt = randomBytes(16);
    const newHash = await this.hashPassword(input.newPassword, newSalt);
    this.db.transaction(() => {
      this.stmtUpdateCred.run(newSalt, newHash, userId);
      this.stmtRevokeUserSessions.run(userId);
    }).immediate();
    return { userId };
  }

  username(userId: string) {
    const row = this.stmtUsername.get(userId) as { username: string } | undefined;
    return row?.username ?? null;
  }

  issueSession(userId: string, previous?: string) {
    const session = "ws_" + randomBytes(32).toString("base64url");
    const now = Date.now();
    this.db.transaction(() => {
      this.stmtPurgeExpired.run(new Date(now).toISOString());
      this.revokeSession(previous);
      this.stmtInsertSession.run(sessionDigest(session), userId, new Date(now + webSessionSeconds * 1000).toISOString());
    }).immediate();
    return session;
  }

  identify(session?: string) {
    if (!session || !sessionPattern.test(session)) throw new DomainError("请先登录", 401);
    const row = this.stmtIdentify.get(sessionDigest(session), new Date().toISOString()) as { userId: string } | undefined;
    if (!row) throw new DomainError("登录已失效，请重新登录", 401);
    return row.userId;
  }

  revokeSession(session?: string) {
    if (session && sessionPattern.test(session))
      this.stmtRevokeSession.run(sessionDigest(session));
  }

  // ===== 3.4 One-Time 6-Digit Device Pairing Codes (works over HTTP & HTTPS) =====
  private readonly pairingTtlMs = 5 * 60_000;

  issuePairingCode(userId: string): { code: string; expiresAt: string } {
    const now = Date.now();
    const expiresAt = new Date(now + this.pairingTtlMs).toISOString();
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const hash = sessionDigest(`pair:${code}`);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM web_pairing_codes WHERE expires_at <= ? OR used_at IS NOT NULL").run(new Date(now).toISOString());
      this.db.prepare("DELETE FROM web_pairing_codes WHERE user_id = ?").run(userId);
      this.db
        .prepare("INSERT INTO web_pairing_codes (code_hash, user_id, expires_at, used_at, created_at) VALUES (?, ?, ?, NULL, ?)")
        .run(hash, userId, expiresAt, new Date(now).toISOString());
    }).immediate();
    return { code, expiresAt };
  }

  redeemPairingCode(rawCode: string): { userId: string } {
    const code = rawCode.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) throw new DomainError("请输入 6 位数字配对码", 400);
    const hash = sessionDigest(`pair:${code}`);
    const nowIso = new Date().toISOString();
    return this.db.transaction(() => {
      const row = this.db
        .prepare("SELECT user_id AS userId, expires_at AS expiresAt, used_at AS usedAt FROM web_pairing_codes WHERE code_hash = ?")
        .get(hash) as { userId: string; expiresAt: string; usedAt: string | null } | undefined;
      if (!row || row.usedAt || row.expiresAt <= nowIso) {
        throw new DomainError("配对码无效或已过期，请重新生成", 401);
      }
      this.db.prepare("UPDATE web_pairing_codes SET used_at = ? WHERE code_hash = ?").run(nowIso, hash);
      return { userId: row.userId };
    }).immediate();
  }

  // ===== 3.4 WebAuthn / Passkeys =====
  private readonly challenges = new Map<string, { challenge: string; userId?: string; kind: "register" | "login"; expiresAt: number }>();

  private purgeChallenges() {
    const now = Date.now();
    for (const [k, v] of this.challenges) {
      if (v.expiresAt <= now) this.challenges.delete(k);
    }
  }

  listPasskeys(userId: string) {
    return this.db
      .prepare(
        "SELECT credential_id AS credentialId, label, transports, created_at AS createdAt, last_used_at AS lastUsedAt FROM web_passkeys WHERE user_id = ? ORDER BY created_at DESC",
      )
      .all(userId)
      .map((r: unknown) => {
        const row = r as { credentialId: string; label: string; transports: string; createdAt: string; lastUsedAt: string | null };
        return {
          credentialId: row.credentialId,
          label: row.label || "通行密钥",
          transports: (() => {
            try { return JSON.parse(row.transports) as string[]; } catch { return []; }
          })(),
          createdAt: row.createdAt,
          lastUsedAt: row.lastUsedAt,
        };
      });
  }

  deletePasskey(userId: string, credentialId: string) {
    const res = this.db.prepare("DELETE FROM web_passkeys WHERE user_id = ? AND credential_id = ?").run(userId, credentialId);
    if (!res.changes) throw new DomainError("找不到该通行密钥", 404);
    return { ok: true };
  }

  createPasskeyRegisterOptions(userId: string, rpId: string, rpName = "铁记 Ironlog") {
    this.purgeChallenges();
    const challenge = randomBytes(32).toString("base64url");
    const name = this.username(userId) ?? userId;
    const existing = this.listPasskeys(userId);
    this.challenges.set(`reg:${challenge}`, { challenge, userId, kind: "register", expiresAt: Date.now() + 5 * 60_000 });
    return {
      challenge,
      rp: { id: rpId, name: rpName },
      user: {
        id: Buffer.from(userId, "utf8").toString("base64url"),
        name,
        displayName: name,
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 }, // ES256 (P-256)
        { type: "public-key", alg: -257 }, // RS256
      ],
      timeout: 120_000,
      attestation: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "preferred",
      },
      excludeCredentials: existing.map((k) => ({ id: k.credentialId, type: "public-key" })),
    };
  }

  verifyPasskeyRegistration(
    userId: string,
    input: {
      credentialId: string;
      publicKeySpki: string;
      clientDataJSON: string;
      attestationObject?: string;
      transports?: string[];
      label?: string;
    },
    expectedOrigin: string,
    expectedRpId?: string,
  ) {
    this.purgeChallenges();
    const clientData = parseClientDataJson(input.clientDataJSON);
    if (clientData.type !== "webauthn.create" || !clientData.challenge) {
      throw new DomainError("通行密钥注册响应类型不正确", 400);
    }
    const chKey = `reg:${clientData.challenge}`;
    const stored = this.challenges.get(chKey);
    if (!stored || stored.userId !== userId || stored.expiresAt <= Date.now()) {
      throw new DomainError("通行密钥注册挑战已过期，请重试", 400);
    }
    this.challenges.delete(chKey);
    if (clientData.origin !== expectedOrigin) {
      throw new DomainError("通行密钥来源域名不匹配", 400);
    }
    if (input.attestationObject) {
      const rpId = expectedRpId ?? new URL(expectedOrigin).hostname;
      verifyAttestationObject(input.attestationObject, rpId, input.credentialId);
    }
    // Validate that publicKeySpki parses cleanly as a SPKI DER public key
    const spkiBuf = Buffer.from(input.publicKeySpki, "base64url");
    try {
      createPublicKey({ key: spkiBuf, format: "der", type: "spki" });
    } catch {
      throw new DomainError("无效的通行密钥公钥格式", 400);
    }
    const nowIso = new Date().toISOString();
    const cleanLabel = (input.label ?? "").trim().slice(0, 60) || "本机通行密钥";
    const transportsJson = JSON.stringify((input.transports ?? []).slice(0, 6));
    // #96 (P0): Never overwrite an existing credential_id on conflict; reject with 409 to prevent cross-account takeover.
    this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT user_id AS userId FROM web_passkeys WHERE credential_id = ?")
        .get(input.credentialId) as { userId: string } | undefined;
      if (existing) {
        throw new DomainError("该通行密钥凭据已被注册，无法重复绑定", 409);
      }
      this.db
        .prepare(
          `INSERT INTO web_passkeys (credential_id, user_id, public_key, counter, transports, label, created_at, last_used_at)
           VALUES (?, ?, ?, 0, ?, ?, ?, NULL)`,
        )
        .run(input.credentialId, userId, input.publicKeySpki, transportsJson, cleanLabel, nowIso);
    }).immediate();
    return { ok: true, credentialId: input.credentialId, label: cleanLabel };
  }

  createPasskeyLoginOptions(rpId: string, _usernameHint?: string) {
    this.purgeChallenges();
    const challenge = randomBytes(32).toString("base64url");
    // #96 (P0): Never expose another account's allowCredentials to unauthenticated requests.
    // Rely on discoverable credentials (residentKey) without leaking credential IDs.
    this.challenges.set(`login:${challenge}`, {
      challenge,
      kind: "login",
      expiresAt: Date.now() + 5 * 60_000,
    });
    return {
      challenge,
      rpId,
      timeout: 120_000,
      userVerification: "preferred",
    };
  }

  verifyPasskeyLogin(
    input: {
      credentialId: string;
      authenticatorData: string;
      clientDataJSON: string;
      signature: string;
    },
    expectedOrigin: string,
    expectedRpId: string,
  ): { userId: string } {
    this.purgeChallenges();
    const clientDataBuf = Buffer.from(input.clientDataJSON, "base64url");
    const clientData = parseClientDataJson(input.clientDataJSON);
    if (clientData.type !== "webauthn.get" || !clientData.challenge) {
      throw new DomainError("通行密钥登录响应类型不正确", 400);
    }
    const chKey = `login:${clientData.challenge}`;
    const stored = this.challenges.get(chKey);
    if (!stored || stored.expiresAt <= Date.now()) {
      throw new DomainError("通行密钥登录挑战已过期，请重试", 401);
    }
    this.challenges.delete(chKey);
    if (clientData.origin !== expectedOrigin) {
      throw new DomainError("通行密钥来源域名不匹配", 401);
    }
    const keyRow = this.db
      .prepare("SELECT user_id AS userId, public_key AS publicKey, counter FROM web_passkeys WHERE credential_id = ?")
      .get(input.credentialId) as { userId: string; publicKey: string; counter: number } | undefined;
    if (!keyRow) throw new DomainError("未找到匹配的通行密钥", 401);

    const authData = Buffer.from(input.authenticatorData, "base64url");
    if (authData.length < 37) throw new DomainError("无效的认证器数据", 400);
    const rpIdHash = authData.subarray(0, 32);
    const expectedRpHash = createHash("sha256").update(expectedRpId).digest();
    if (!timingSafeEqual(rpIdHash, expectedRpHash)) {
      throw new DomainError("通行密钥域名摘要校验失败", 401);
    }
    const flags = authData[32]!;
    if ((flags & 0x01) === 0) throw new DomainError("认证器未确认用户在场", 401);
    const signCount = authData.readUInt32BE(33);
    // #98: Reject cloned/rolled-back counters including signCount === 0 whenever stored counter > 0.
    if ((keyRow.counter > 0 || signCount > 0) && signCount <= keyRow.counter) {
      throw new DomainError("通行密钥计数器异常，可能存在克隆风险", 401);
    }

    const clientDataHash = createHash("sha256").update(clientDataBuf).digest();
    const signedData = Buffer.concat([authData, clientDataHash]);
    const sigBuf = Buffer.from(input.signature, "base64url");
    const pubKey = createPublicKey({ key: Buffer.from(keyRow.publicKey, "base64url"), format: "der", type: "spki" });
    const valid = verifySignature("sha256", signedData, pubKey, sigBuf);
    if (!valid) throw new DomainError("通行密钥签名校验失败", 401);

    this.db
      .prepare("UPDATE web_passkeys SET counter = ?, last_used_at = ? WHERE credential_id = ?")
      .run(Math.max(keyRow.counter, signCount), new Date().toISOString(), input.credentialId);
    return { userId: keyRow.userId };
  }
}
