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
CREATE INDEX IF NOT EXISTS idx_value_hash ON value_pool(value_hash);
CREATE INDEX IF NOT EXISTS idx_structure_hash ON variable_structures(structure_hash);
CREATE INDEX IF NOT EXISTS idx_msg_chat ON message_variables(chat_file);
CREATE UNIQUE INDEX IF NOT EXISTS idx_msg_identifier ON message_variables(identifier);
COMMIT;
`;

export function applyMigrations(db: SqliteDatabase): void {
  db.exec(CREATE_TABLES_SQL);
}
