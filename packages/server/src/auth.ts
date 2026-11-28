import { createHash, randomBytes, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { Db } from "./db.js";
import { DomainError } from "./store.js";

type Stmt = Database.Statement<unknown[], unknown>;

const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");
export type TokenScope = "session" | "api";

const DEFAULT_API_TOKEN_TTL_MS = 180 * 86400000;

export class Auth {
  private readonly stmtUserByOpenid: Stmt;
  private readonly stmtInsertUser: Stmt;
  private readonly stmtInsertToken: Stmt;
  private readonly stmtIdentify: Stmt;
  private readonly stmtRevoke: Stmt;
  private readonly stmtRevokeAll: Stmt;
  private readonly stmtList: Stmt;

  constructor(private db: Db) {
    this.stmtUserByOpenid = db.prepare("SELECT id FROM users WHERE openid=?");
    this.stmtInsertUser = db.prepare("INSERT INTO users VALUES (?,?,?)");
    this.stmtInsertToken = db.prepare("INSERT INTO tokens (hash, user_id, label, expires_at, created_at, scope) VALUES (?,?,?,?,?,?)");
    this.stmtIdentify = db.prepare("SELECT user_id,expires_at,scope FROM tokens WHERE hash=?");
    this.stmtRevoke = db.prepare("DELETE FROM tokens WHERE user_id=? AND hash=?");
    this.stmtRevokeAll = db.prepare("DELETE FROM tokens WHERE user_id=?");
    this.stmtList = db.prepare("SELECT hash AS id,label,created_at AS createdAt,expires_at AS expiresAt,scope FROM tokens WHERE user_id=? ORDER BY created_at DESC");
  }

  login(openid: string, label = "铁记会话") {
    return this.db.transaction(() => {
      let user = this.stmtUserByOpenid.get(openid) as { id: string } | undefined;
      if (!user) {
        user = { id: randomUUID() };
        this.stmtInsertUser.run(user.id, openid, new Date().toISOString());
      }
      return {
        userId: user.id,
        token: this.issueSession(user.id, label),
      };
    })();
  }

  issueSession(userId: string, label = "网页会话") {
    return this.issue(userId, label, new Date(Date.now() + 30 * 86400000).toISOString(), "session");
  }

  issue(userId: string, label: string, expiresAt?: string | null, scope: TokenScope = "api") {
    const token = `tj_${randomBytes(32).toString("base64url")}`;
    // #124 (P1): API tokens default to a finite 180-day expiry instead of never expiring.
    const effectiveExpiry = expiresAt === undefined
      ? new Date(Date.now() + DEFAULT_API_TOKEN_TTL_MS).toISOString()
      : expiresAt;
    this.stmtInsertToken.run(
      hashToken(token),
      userId,
      label,
      effectiveExpiry,
      new Date().toISOString(),
      scope,
    );
    return token;
  }

  identifyWithScope(token: string): { userId: string; scope: TokenScope } {
    const row = this.stmtIdentify.get(hashToken(token)) as
      { user_id: string; expires_at: string | null; scope?: string } | undefined;
    if (!row || (row.expires_at && row.expires_at <= new Date().toISOString()))
      throw new DomainError("登录已失效，请重新登录", 401);
    // #171 (P1): Fail-closed — only explicit 'session' scope grants interactive session privileges.
    return { userId: row.user_id, scope: row.scope === "session" ? "session" : "api" };
  }

  identify(token: string) {
    return this.identifyWithScope(token).userId;
  }

  revoke(userId: string, tokenHash: string) {
    this.stmtRevoke.run(userId, tokenHash);
  }

  revokeAll(userId: string) {
    this.stmtRevokeAll.run(userId);
  }

  list(userId: string) {
    return this.stmtList.all(userId);
  }
}
