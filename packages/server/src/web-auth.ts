import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
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
  .refine((value) => !/[^A-Za-z0-9]/.test(value), "密码只能包含英文字母和数字");
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
}
