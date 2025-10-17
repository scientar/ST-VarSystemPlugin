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

export function createValueContext(db: SqliteDatabase): ValueContext {
  return {
    selectValue: db.prepare("SELECT id FROM value_pool WHERE value_hash = ?"),
    insertValue: db.prepare(
      "INSERT INTO value_pool (value_hash, value_type, value_data, ref_count, created_at) VALUES (?, ?, ?, ?, ?)",
    ),
    incrementRef: db.prepare(
      "UPDATE value_pool SET ref_count = ref_count + 1 WHERE id = ?",
    ),
    valueCache: new Map<string, CacheEntry>(),
    now: Date.now(),
  };
}

export function transformLeafValue(value: unknown, ctx: ValueContext): unknown {
  if (shouldInline(value)) {
    return value;
  }

  const serialized = stableStringify(value);
  const hash = hashString(serialized);

  const cached = ctx.valueCache.get(hash);
  if (cached) {
    ctx.incrementRef.run(cached.id);
    return { $ref: cached.id };
  }

  const existing = ctx.selectValue.get(hash) as { id: number } | undefined;
  if (existing) {
    ctx.incrementRef.run(existing.id);
    ctx.valueCache.set(hash, { id: existing.id });
    return { $ref: existing.id };
  }

  const valueType = detectValueType(value);
  const insertResult = ctx.insertValue.run(
    hash,
    valueType,
    serialized,
    1,
    ctx.now,
  );
  const id = Number(insertResult.lastInsertRowid);
  ctx.valueCache.set(hash, { id });
  return { $ref: id };
}
