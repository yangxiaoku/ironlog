import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openDatabase(path: string): Database.Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  db.pragma("cache_size = -16000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, openid TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      label TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tokens_user ON tokens(user_id);
    CREATE TABLE IF NOT EXISTS web_credentials (
      username TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      salt BLOB NOT NULL, password_hash BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS web_sessions (
      hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS web_sessions_expiration ON web_sessions(expires_at);
    CREATE TABLE IF NOT EXISTS records (
      user_id TEXT NOT NULL REFERENCES users(id), kind TEXT NOT NULL, id TEXT NOT NULL,
      version INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, kind, id)
    );
    CREATE INDEX IF NOT EXISTS records_user_kind_order ON records(user_id, kind, deleted, updated_at, id);
    CREATE TABLE IF NOT EXISTS changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
      kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL,
      deleted INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS changes_user_seq ON changes(user_id, seq);
    CREATE TABLE IF NOT EXISTS operations (
      user_id TEXT NOT NULL REFERENCES users(id), op_id TEXT NOT NULL, request TEXT NOT NULL,
      result TEXT NOT NULL, PRIMARY KEY(user_id, op_id)
    );
    CREATE TABLE IF NOT EXISTS plan_versions (
      user_id TEXT NOT NULL REFERENCES users(id), id TEXT NOT NULL, version INTEGER NOT NULL,
      data TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, id, version)
    );
    CREATE TABLE IF NOT EXISTS active_plans (
      user_id TEXT PRIMARY KEY REFERENCES users(id), plan_id TEXT NOT NULL, version INTEGER NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS plan_activations (
      user_id TEXT NOT NULL REFERENCES users(id), plan_id TEXT NOT NULL, version INTEGER NOT NULL,
      revision INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, revision)
    );
    INSERT OR IGNORE INTO plan_activations SELECT user_id, plan_id, version, revision, updated_at FROM active_plans;
    CREATE TABLE IF NOT EXISTS plan_revision_floor (
      user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS apple_health_devices (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS apple_health_devices_user ON apple_health_devices(user_id, created_at);
    CREATE TABLE IF NOT EXISTS apple_health_workouts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
      identity_key TEXT NOT NULL, ended_at TEXT NOT NULL, received_at TEXT NOT NULL, data TEXT NOT NULL,
      UNIQUE(user_id, identity_key)
    );
    CREATE INDEX IF NOT EXISTS apple_health_workouts_user_time ON apple_health_workouts(user_id, ended_at DESC, id);
    CREATE TABLE IF NOT EXISTS apple_health_receipts (
      user_id TEXT NOT NULL REFERENCES users(id), request_key TEXT NOT NULL, digest TEXT NOT NULL,
      workout_id TEXT NOT NULL REFERENCES apple_health_workouts(id), PRIMARY KEY(user_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS apple_health_events (
      device_id TEXT NOT NULL REFERENCES apple_health_devices(id), activity_type TEXT NOT NULL,
      started_at TEXT NOT NULL, started_environment TEXT NOT NULL, ended_at TEXT, workout_id TEXT REFERENCES apple_health_workouts(id),
      PRIMARY KEY(device_id, activity_type)
    );
    CREATE TABLE IF NOT EXISTS apple_health_daily (
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY(user_id, date)
    );
    CREATE TABLE IF NOT EXISTS catalogue_releases (version TEXT PRIMARY KEY, published_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS web_statistics_preferences (
      user_id TEXT PRIMARY KEY REFERENCES users(id), revision INTEGER NOT NULL, data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS catalogue_exercises (
      id TEXT PRIMARY KEY, version TEXT NOT NULL REFERENCES catalogue_releases(version), ordinal INTEGER NOT NULL,
      category TEXT NOT NULL, equipment TEXT NOT NULL, muscle TEXT NOT NULL, search_names TEXT NOT NULL, data TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS catalogue_version_order ON catalogue_exercises(version, ordinal, id);
    CREATE INDEX IF NOT EXISTS catalogue_category_order ON catalogue_exercises(version, category, ordinal);
    CREATE INDEX IF NOT EXISTS catalogue_muscle_order ON catalogue_exercises(version, muscle, ordinal);
    CREATE INDEX IF NOT EXISTS catalogue_equipment_order ON catalogue_exercises(version, equipment, ordinal);
    CREATE TABLE IF NOT EXISTS exercise_notes (
      user_id TEXT NOT NULL REFERENCES users(id),
      exercise_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, exercise_id)
    );
    CREATE TABLE IF NOT EXISTS body_measurements (
      user_id TEXT NOT NULL REFERENCES users(id),
      date TEXT NOT NULL,
      waist_cm REAL,
      chest_cm REAL,
      arm_cm REAL,
      thigh_cm REAL,
      hip_cm REAL,
      notes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id, date)
    );
    CREATE INDEX IF NOT EXISTS body_measurements_user_date ON body_measurements(user_id, date DESC);
    PRAGMA user_version = 5;
  `);
  return db;
}
export type Db = ReturnType<typeof openDatabase>;
