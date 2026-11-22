import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Auth } from "./auth.js";
import { openDatabase } from "./db.js";
import { WebAuth, webCredentialsInput } from "./web-auth.js";

const args = process.argv.slice(2);
const [command, userId, username] = args;
const list = command === "--list" && args.length === 1;
const validId = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId ?? "");
const existing = command === "--existing" && args.length === 2 && validId;
const bind = command === "--bind" && args.length === 3 && validId;
const named = args.length === 1 && !!command && !command.startsWith("--") && /^[a-zA-Z0-9_-]{1,48}$/.test(command);
if ((!list && !existing && !bind && !named) || process.env.IRONLOG_WEB_DEMO === "true") {
  console.error("用法：npm run web:account -- --list | --bind <用户 ID> <用户名> | --existing <用户 ID> | <账号标识>");
  process.exit(1);
}
const root = fileURLToPath(new URL("../../../", import.meta.url));
const path = resolve(root, process.env.DATABASE_PATH ?? "data/gym.db");
if ((list || existing || bind) && !existsSync(path)) {
  console.error("找不到数据库。请使用铁记服务的 DATABASE_PATH。");
  process.exit(1);
}
if (bind && process.stdin.isTTY) {
  console.error("请将密码从标准输入传入。参见 README 中的旧账号绑定命令。");
  process.exit(1);
}
const db = openDatabase(path);
try {
  if (list) {
    const users = db.prepare(`SELECT u.id AS userId, u.created_at AS createdAt,
      (SELECT count(*) FROM records WHERE user_id=u.id AND kind='workout' AND deleted=0) AS workouts
      FROM users u ORDER BY u.created_at,u.id`).all();
    console.log(JSON.stringify(users, null, 2));
  } else if (bind) {
    const supplied = readFileSync(0, "utf8").replace(/\r?\n$/, "");
    const credentials = webCredentialsInput.safeParse({ username, password: supplied });
    if (!credentials.success) throw new Error(credentials.error.issues[0]?.message ?? "用户名或密码格式不正确");
    await new WebAuth(db).register(credentials.data, userId!.toLowerCase());
    console.log("网页登录已绑定。");
  } else if (existing && !db.prepare("SELECT 1 FROM users WHERE id=?").get(userId!.toLowerCase())) {
    console.error("找不到该用户 ID。");
    process.exitCode = 1;
  } else {
    const auth = new Auth(db);
    const token = existing ? auth.issueSession(userId!.toLowerCase()) : auth.login(`web:${command}`, "网页会话").token;
    process.stdout.write(token + "\n");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "操作失败");
  process.exitCode = 1;
} finally {
  db.close();
}
