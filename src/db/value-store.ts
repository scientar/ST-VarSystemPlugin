import {
  detectValueType,
  hashString,
  shouldInline,
  stableStringify,
} from "../util/serialization";
import type { SqliteDatabase, SqliteStatement } from "./connection";

type CacheEntry = {
  id: number;
};

export interface ValueContext {
  selectValue: SqliteStatement;
  insertValue: SqliteStatement;
  incrementRef: SqliteStatement;
  valueCache: Map<string, CacheEntry>;
  now: number;
}

export async function createValueContext(
  db: SqliteDatabase,
): Promise<ValueContext> {
  return {
    selectValue: await db.prepare(
      "SELECT id FROM value_pool WHERE value_hash = ?",
    ),
    insertValue: await db.prepare(
      "INSERT INTO value_pool (value_hash, value_type, value_data, ref_count, created_at) VALUES (?, ?, ?, ?, ?)",
    ),
    incrementRef: await db.prepare(
      "UPDATE value_pool SET ref_count = ref_count + 1 WHERE id = ?",
    ),
    valueCache: new Map<string, CacheEntry>(),
    now: Date.now(),
  };
}

export async function releaseValueContext(_ctx: ValueContext): Promise<void> {
  // node:sqlite 的同步 Statement 不需要额外的 finalize 调用。
}

export async function transformLeafValue(
  value: unknown,
  ctx: ValueContext,
): Promise<unknown> {
  if (shouldInline(value)) {
    return value;
  }

  const serialized = stableStringify(value);
  const hash = hashString(serialized);

  const cached = ctx.valueCache.get(hash);
  if (cached) {
    await ctx.incrementRef.run(cached.id);
    return { $ref: cached.id };
  }

  const existing = (await ctx.selectValue.get(hash)) as
    | { id: number }
    | undefined;
  if (existing) {
    await ctx.incrementRef.run(existing.id);
    ctx.valueCache.set(hash, { id: existing.id });
    return { $ref: existing.id };
  }

  const valueType = detectValueType(value);
  const insertResult = await ctx.insertValue.run(
    hash,
    valueType,
    serialized,
    1,
    ctx.now,
  );
  const insertId =
    typeof insertResult?.lastInsertRowid === "number"
      ? insertResult.lastInsertRowid
      : typeof insertResult?.lastInsertRowid === "bigint"
        ? Number(insertResult.lastInsertRowid)
        : null;
  if (insertId === null) {
    const inserted = (await ctx.selectValue.get(hash)) as { id: number };
    ctx.valueCache.set(hash, { id: inserted.id });
    return { $ref: inserted.id };
  }
  const id = Number(insertId);
  ctx.valueCache.set(hash, { id });
  return { $ref: id };
}
