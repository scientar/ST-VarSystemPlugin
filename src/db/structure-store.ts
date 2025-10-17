import { hashString, stableStringify } from "../util/serialization";
import type { SqliteDatabase, SqliteStatement } from "./connection";

interface StructureContext {
  selectStructure: SqliteStatement;
  insertStructure: SqliteStatement;
  now: number;
}

export async function createStructureContext(
  db: SqliteDatabase,
): Promise<StructureContext> {
  return {
    selectStructure: await db.prepare(
      "SELECT id FROM variable_structures WHERE structure_hash = ?",
    ),
    insertStructure: await db.prepare(
      "INSERT INTO variable_structures (structure_hash, structure, created_at) VALUES (?, ?, ?)",
    ),
    now: Date.now(),
  };
}

export async function releaseStructureContext(
  _ctx: StructureContext,
): Promise<void> {
  // node:sqlite StatementSync instances do not expose a finalize API.
}

export async function persistStructure(
  structure: unknown,
  ctx: StructureContext,
): Promise<{
  structureId: number;
  structureHash: string;
  created: boolean;
}> {
  const serialized = stableStringify(structure);
  const hash = hashString(serialized);

  const existing = (await ctx.selectStructure.get(hash)) as
    | { id: number }
    | undefined;
  if (existing) {
    return { structureId: existing.id, structureHash: hash, created: false };
  }

  const result = await ctx.insertStructure.run(hash, serialized, ctx.now);
  const insertId =
    typeof result?.lastInsertRowid === "number"
      ? result.lastInsertRowid
      : typeof result?.lastInsertRowid === "bigint"
        ? Number(result.lastInsertRowid)
        : null;
  const structureId =
    insertId !== null
      ? Number(insertId)
      : Number(
          ((await ctx.selectStructure.get(hash)) as { id: number } | undefined)
            ?.id ?? 0,
        );
  if (!structureId) {
    throw new Error("无法获取结构 ID");
  }
  return { structureId, structureHash: hash, created: true };
}
