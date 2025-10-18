import type { SqliteDatabase } from "./connection";

const CREATE_TABLES_SQL = `
BEGIN;
CREATE TABLE IF NOT EXISTS value_pool (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    value_hash TEXT UNIQUE NOT NULL,
    value_type TEXT NOT NULL,
    value_data TEXT NOT NULL,
    ref_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS variable_structures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    structure_hash TEXT UNIQUE NOT NULL,
    structure TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS message_variables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id TEXT,
    chat_file TEXT NOT NULL,
    structure_id INTEGER NOT NULL,
    identifier TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (structure_id) REFERENCES variable_structures(id)
);
CREATE TABLE IF NOT EXISTS variable_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    character_name TEXT UNIQUE,
    template_content TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS global_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    structure_id INTEGER NOT NULL,
    tags TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (structure_id) REFERENCES variable_structures(id)
);
CREATE INDEX IF NOT EXISTS idx_value_hash ON value_pool(value_hash);
CREATE INDEX IF NOT EXISTS idx_structure_hash ON variable_structures(structure_hash);
CREATE INDEX IF NOT EXISTS idx_msg_chat ON message_variables(chat_file);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_identifier ON message_variables(identifier);
CREATE INDEX IF NOT EXISTS idx_snapshot_id ON global_snapshots(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_snapshot_name ON global_snapshots(name);
COMMIT;
`;

export async function applyMigrations(db: SqliteDatabase): Promise<void> {
  await db.exec(CREATE_TABLES_SQL);
}
