import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import { createApp } from "../packages/server/src/app.js";
import { openDatabase } from "../packages/server/src/db.js";

const credentials = { username: "Training_A", password: "0123456789" };
function cookie(response: Response) {
  const value = response.headers.get("Set-Cookie");
  assert.ok(value);
  return value.split(";", 1)[0]!;
}

test("注册后使用独立网页会话，退出撤销会话，已有 API 令牌仍可使用", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app, auth } = createApp(db);
    const send = (url: string, data: unknown, headers?: Record<string, string>) => app.request(url, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(data),
    });
    const registered = await send("/auth/web/register", credentials);
    assert.equal(registered.status, 201);
    assert.equal(registered.headers.get("Cache-Control"), "no-store");
    assert.match(registered.headers.get("Set-Cookie") ?? "", /HttpOnly;.*SameSite=Strict/i);
    const header = cookie(registered);
    const { userId } = await registered.json() as { userId: string };
    assert.ok(userId);
    const session = await app.request("/api/me", { headers: { Cookie: header } });
    assert.deepEqual(await session.json(), {
      userId,
      username: "training_a",
      aiReady: false,
      appleHealthConnected: false,
      isNewUser: true,
    });
    const saved = db.prepare("SELECT salt, password_hash AS hash FROM web_credentials").get() as { salt: Buffer; hash: Buffer };
    assert.equal(saved.salt.length, 16);
    assert.equal(saved.hash.length, 64);
    assert.equal(db.prepare("SELECT 1 FROM web_sessions WHERE hash=?").get(header.split("=")[1]!), undefined);
    const asBearer = await app.request("/api/me", { headers: { Authorization: "Bearer " + header.split("=")[1] } });
    assert.equal(asBearer.status, 401);
    assert.equal((await send("/auth/web/register", { ...credentials, username: " ＴＲＡＩＮＩＮＧ＿Ａ " })).status, 409);
    assert.equal((await send("/auth/web/login", { ...credentials, password: "incorrect" })).status, 401);
    const login = await send("/auth/web/login", credentials, { Cookie: header });
    assert.equal(login.status, 200);
    const next = cookie(login);
    assert.notEqual(next, header);
    assert.equal((await app.request("/api/me", { headers: { Cookie: header } })).status, 401);
    assert.equal((await app.request("/api/me", { headers: { Cookie: next } })).status, 200);
    const apiToken = auth.issue(userId, "MCP");
    const logout = await send("/auth/web/logout", {}, { Cookie: next });
    assert.equal(logout.status, 200);
    assert.match(logout.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
    assert.equal((await app.request("/api/me", { headers: { Cookie: next } })).status, 401);
    assert.equal((await app.request("/api/me", { headers: { Authorization: "Bearer " + apiToken } })).status, 200);
  } finally { db.close(); }
});

test("HTTPS 会话带 Secure，跨源请求和旧账号页不能更改当前账号数据", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app } = createApp(db);
    const origin = "https://ironlog.example";
    const path = "http://ironlog.example";
    const base = { "X-Forwarded-Proto": "https", "Content-Type": "application/json" };
    const send = (url: string, method: string, body: unknown, headers?: Record<string, string>) => app.request(path + url, {
      method, headers: { ...base, ...headers }, body: JSON.stringify(body),
    });
    const sameSite = { Origin: origin, "Sec-Fetch-Site": "same-origin" };
    assert.equal((await send("/auth/web/register", "POST", credentials, { Origin: "https://other.example" })).status, 403);
    assert.equal((await app.request(path + "/auth/web/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(credentials),
    })).status, 403);
    for (const password of ["123456789", "0123456789!", "0123456789\n", "1".repeat(129)]) {
      assert.equal((await send("/auth/web/register", "POST", { ...credentials, password }, sameSite)).status, 400);
    }
    const first = await send("/auth/web/register", "POST", credentials, sameSite);
    assert.equal(first.status, 201);
    assert.match(first.headers.get("Set-Cookie") ?? "", /^__Host-ironlog_session=.*; Secure;/);
    const { userId } = await first.json() as { userId: string };
    const headers = { ...sameSite, Cookie: cookie(first) };
    const record = { id: "weight_2026-11-19", kind: "weight", opId: "cookie-weight", baseVersion: 0,
      data: { date: "2026-11-19", weight: 73 } };
    assert.equal((await send("/api/records", "POST", record, headers)).status, 403);
    const save = await send("/api/records", "POST", record, { ...headers, "X-Ironlog-Account": userId });
    assert.equal(save.status, 200);
    assert.equal((await send("/api/records", "POST", record, {
      ...headers, Origin: "https://other.example", "X-Ironlog-Account": userId,
    })).status, 403);
    const second = await send("/auth/web/register", "POST", { username: "训练者二", password: "Training42" }, sameSite);
    assert.equal(second.status, 201);
    const stale = { ...sameSite, Cookie: cookie(second), "X-Ironlog-Account": userId };
    assert.equal((await send("/api/records", "POST", record, stale)).status, 401);
    const read = await app.request(path + "/api/records/weight", { headers: { ...base, Cookie: cookie(second) } });
    assert.deepEqual(await read.json(), []);
    db.prepare("UPDATE web_sessions SET expires_at=?").run("2000-01-01T00:00:00.000Z");
    assert.equal((await app.request(path + "/api/me", { headers: { ...base, Cookie: cookie(second) } })).status, 401);
  } finally { db.close(); }
});

test("已注册账号仍可用旧的含符号密码登录", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app, auth } = createApp(db);
    const { userId } = auth.login("existing-web-account");
    const password = "old-password-with-letters";
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 64, { N: 2 ** 15, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
    db.prepare("INSERT INTO web_credentials VALUES (?, ?, ?, ?)").run("existing", userId, salt, hash);
    const response = await app.request("/auth/web/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "existing", password }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { userId });
  } finally { db.close(); }
});

test("重复的无效注册请求受限且不会创建账号", async () => {
  const db = openDatabase(":memory:");
  try {
    const { app } = createApp(db);
    const attempt = () => app.request("/auth/web/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
    });
    for (let i = 0; i < 12; i++) assert.equal((await attempt()).status, 400);
    assert.equal((await attempt()).status, 429);
    assert.equal(db.prepare("SELECT 1 FROM users").get(), undefined);
  } finally { db.close(); }
});
