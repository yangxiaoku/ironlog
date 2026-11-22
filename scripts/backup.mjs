import Database from "better-sqlite3";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const source = resolve(process.env.DATABASE_PATH ?? "data/gym.db");
const target = resolve(
  process.argv[2] ??
    `data/backups/gym-${new Date().toISOString().replaceAll(":", "-")}.db`,
);
if (source === target) throw new Error("备份目标需要与源数据库不同");
await mkdir(dirname(target), { recursive: true });
const db = new Database(source, { readonly: true, fileMustExist: true });
try {
  await db.backup(target);
  console.log(`数据库备份完成 ${target}`);
} finally {
  db.close();
}
