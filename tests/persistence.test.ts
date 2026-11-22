import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { openDatabase } from "../packages/server/src/db.js";
import { createApp } from "../packages/server/src/app.js";

test("磁盘持久化、数据库备份与备份恢复", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ironlog-persistence-"));
  const databasePath = join(directory, "gym.db");
  const backupPath = join(directory, "backup.db");
  try {
    let db = openDatabase(databasePath);
    const first = createApp(db);
    const session = first.auth.login("persisted-user");
    first.store.mutate(session.userId, {
      opId: "persist",
      id: "weight_2026-11-14",
      kind: "weight",
      baseVersion: 0,
      deleted: false,
      data: { date: "2026-11-14", weight: 72.4, bodyFat: null },
    });
    await db.backup(backupPath);
    db.close();
    db = openDatabase(databasePath);
    const restarted = createApp(db);
    assert.equal(restarted.auth.identify(session.token), session.userId);
    assert.equal(restarted.store.list(session.userId, "weight").length, 1);
    db.close();
    const backup = openDatabase(backupPath);
    const restored = createApp(backup);
    assert.equal(restored.store.list(session.userId, "weight").length, 1);
    backup.close();
  } finally {
    const checked = resolve(directory);
    assert.ok(
      checked.startsWith(resolve(tmpdir())) &&
        checked.includes("ironlog-persistence-"),
    );
    await rm(checked, { recursive: true, force: true });
  }
});

test("服务器可为已有账号签发网页令牌，并使用该账号原有数据", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ironlog-account-"));
  const databasePath = join(directory, "gym.db");
  const db = openDatabase(databasePath);
  try {
    const { app, auth, store } = createApp(db);
    const owner = auth.login("existing-provider-identity");
    store.mutate(owner.userId, {
      id: "weight_2026-11-14", kind: "weight", opId: "existing-weight", baseVersion: 0, deleted: false,
      data: { date: "2026-11-14", weight: 72.4 },
    });
    const account = (args: string[], input?: string) => execFileSync(process.execPath, ["packages/server/dist/web-account.js", ...args], {
      encoding: "utf8", input, env: { ...process.env, DATABASE_PATH: databasePath, IRONLOG_WEB_DEMO: "false" },
    }).trim();
    const accounts = JSON.parse(account(["--list"])) as { userId: string }[];
    assert.deepEqual(accounts.map(({ userId }) => userId), [owner.userId]);
    const token = account(["--existing", owner.userId]);
    assert.equal(auth.identify(token), owner.userId);
    assert.equal(auth.identify(owner.token), owner.userId);
    const response = await app.request("/api/records/weight", { headers: { Authorization: "Bearer " + token } });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { data: { weight: number } }[])[0]?.data.weight, 72.4);
    assert.throws(() => account(["--existing", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]));
    const password = "01234567890";
    assert.equal(account(["--bind", owner.userId, "训练日志"], password + "\n"), "网页登录已绑定。");
    const login = await app.request("/auth/web/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "训练日志", password }),
    });
    assert.equal(login.status, 200);
    assert.deepEqual(await login.json(), { userId: owner.userId });
    assert.equal((JSON.parse(account(["--list"])) as unknown[]).length, 1);
  } finally {
    db.close();
    const checked = resolve(directory);
    assert.equal(resolve(checked, ".."), resolve(tmpdir()));
    await rm(checked, { recursive: true, force: true });
  }
});
