import { DatabaseSync } from "node:sqlite";
import { resolveDatabasePath } from "../config";
import { log } from "../logger";

type DatabaseInstance = DatabaseSync;

async function createDatabaseInstance(): Promise<DatabaseInstance> {
  const dbPath = resolveDatabasePath();
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  log(`SQLite 数据库已打开: ${dbPath}`);
  return db;
}

let instancePromise: Promise<DatabaseInstance> | null = null;

export async function getDatabase(): Promise<DatabaseInstance> {
  if (!instancePromise) {
    instancePromise = createDatabaseInstance();
  }

  return instancePromise;
}

export async function closeDatabase(): Promise<void> {
  if (instancePromise) {
    const db = await instancePromise;
    db.close();
    instancePromise = null;
    log("SQLite 数据库已关闭");
  }
}

export type SqliteDatabase = DatabaseInstance;
export type SqliteStatement = ReturnType<DatabaseInstance["prepare"]>;
