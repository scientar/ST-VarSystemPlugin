import { hashString, stableStringify } from "../util/serialization";
import type { SqliteDatabase, SqliteStatement } from "./connection";

interface StructureContext {
  selectStructure: SqliteStatement;
  insertStructure: SqliteStatement;
  now: number;
}

export function createStructureContext(db: SqliteDatabase): StructureContext {
  return {
    selectStructure: db.prepare(
      "SELECT id FROM variable_structures WHERE structure_hash = ?",
    ),
    insertStructure: db.prepare(
      "INSERT INTO variable_structures (structure_hash, structure, created_at) VALUES (?, ?, ?)",
    ),
    now: Date.now(),
  };
}

export function persistStructure(
  structure: unknown,
  ctx: StructureContext,
): {
  structureId: number;
  structureHash: string;
  created: boolean;
} {
  const serialized = stableStringify(structure);
  const hash = hashString(serialized);

  const existing = ctx.selectStructure.get(hash) as { id: number } | undefined;
  if (existing) {
    return { structureId: existing.id, structureHash: hash, created: false };
  }

  const result = ctx.insertStructure.run(hash, serialized, ctx.now);
  const structureId = Number(result.lastInsertRowid);
  return { structureId, structureHash: hash, created: true };
}
