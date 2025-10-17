import Database from "better-sqlite3";
import { resolveDatabasePath } from "../config";
import { log } from "../logger";

type DatabaseInstance = ReturnType<typeof Database>;

function createDatabaseInstance(): DatabaseInstance {
  const dbPath = resolveDatabasePath();
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  log(`SQLite 数据库已打开: ${dbPath}`);
  return db;
}

let instance: DatabaseInstance | null = null;

export function getDatabase(): DatabaseInstance {
  if (!instance) {
    instance = createDatabaseInstance();
  }

  return instance;
}

export function closeDatabase(): void {
  if (instance) {
    instance.close();
    instance = null;
    log("SQLite 数据库已关闭");
  }
}

export type SqliteDatabase = DatabaseInstance;
export type SqliteStatement = ReturnType<SqliteDatabase["prepare"]>;
