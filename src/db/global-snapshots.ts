import { generateIdentifier } from "../util/identifier";
import { isPlainObject } from "../util/serialization";
import type { SqliteDatabase, SqliteStatement } from "./connection";
import {
  createStructureContext,
  persistStructure,
  releaseStructureContext,
} from "./structure-store";
import {
  createValueContext,
  LEGACY_VALUE_REFERENCE_KEY,
  releaseValueContext,
  transformLeafValue,
  VALUE_REFERENCE_KEY,
} from "./value-store";

export interface GlobalSnapshotParams {
  snapshotId?: string;
  name: string;
  description?: string;
  snapshotBody: unknown;
  tags?: string[];
}

export interface SaveGlobalSnapshotResult {
  snapshotId: string;
  structureId: number;
  structureHash: string;
  createdAt: number;
  updatedAt: number;
  replaced: boolean;
}

export interface GlobalSnapshotRecord {
  snapshotId: string;
  name: string;
  description: string | null;
  snapshotBody: unknown;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface GlobalSnapshotMetadata {
  snapshotId: string;
  name: string;
  description: string | null;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface ListGlobalSnapshotsOptions {
  tag?: string;
  limit?: number;
  offset?: number;
}

export interface ListGlobalSnapshotsResult {
  snapshots: GlobalSnapshotMetadata[];
  total: number;
}

async function buildStructure(
  value: unknown,
  ctx: Awaited<ReturnType<typeof createValueContext>>,
): Promise<unknown> {
  if (value === null || typeof value !== "object") {
    return transformLeafValue(value, ctx);
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await buildStructure(item, ctx));
    }
    return result;
  }

  if (!isPlainObject(value)) {
    return transformLeafValue(value, ctx);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = await buildStructure(child, ctx);
  }

  return result;
}

function parseStructure(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

async function hydrateStructure(
  value: unknown,
  stmt: SqliteStatement,
): Promise<unknown> {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await hydrateStructure(item, stmt));
    }
    return result;
  }

  const refId = extractReferenceId(value);
  if (refId !== null) {
    const row = (await stmt.get(refId)) as { value_data: string } | undefined;
    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.value_data);
    } catch (_err) {
      return null;
    }
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = await hydrateStructure(child, stmt);
  }

  return result;
}

function extractReferenceId(value: unknown): number | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);

  if (keys.length === 1 && keys[0] === VALUE_REFERENCE_KEY) {
    const candidate = record[VALUE_REFERENCE_KEY];
    return typeof candidate === "number" ? candidate : null;
  }

  if (keys.length === 1 && keys[0] === LEGACY_VALUE_REFERENCE_KEY) {
    const candidate = record[LEGACY_VALUE_REFERENCE_KEY];
    return typeof candidate === "number" ? candidate : null;
  }

  return null;
}

function parseTags(tagsJson: string | null): string[] {
  if (!tagsJson) {
    return [];
  }
  try {
    const parsed = JSON.parse(tagsJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((item) => typeof item === "string");
    }
    return [];
  } catch (_err) {
    return [];
  }
}

export async function saveGlobalSnapshot(
  db: SqliteDatabase,
  params: GlobalSnapshotParams,
): Promise<SaveGlobalSnapshotResult> {
  const { snapshotId, name, description, snapshotBody, tags } = params;

  if (snapshotBody === undefined) {
    throw new Error("snapshotBody 字段不能为空");
  }

  let valueContext: Awaited<ReturnType<typeof createValueContext>> | null =
    null;
  let structureContext: Awaited<
    ReturnType<typeof createStructureContext>
  > | null = null;
  let selectSnapshotStmt: SqliteStatement | null = null;
  let upsertSnapshotStmt: SqliteStatement | null = null;

  try {
    valueContext = await createValueContext(db);
    structureContext = await createStructureContext(db);
    selectSnapshotStmt = await db.prepare(
      "SELECT id, created_at FROM global_snapshots WHERE snapshot_id = ?",
    );
    upsertSnapshotStmt = await db.prepare(
      `INSERT INTO global_snapshots (snapshot_id, name, description, structure_id, tags, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(snapshot_id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         structure_id = excluded.structure_id,
         tags = excluded.tags,
         updated_at = excluded.updated_at`,
    );

    await db.exec("BEGIN IMMEDIATE");

    const now = Date.now();
    valueContext.now = now;
    structureContext.now = now;

    const structure = await buildStructure(snapshotBody, valueContext);
    const { structureId, structureHash } = await persistStructure(
      structure,
      structureContext,
    );
    const resolvedSnapshotId = snapshotId ?? generateIdentifier();

    const existing = (await selectSnapshotStmt.get(resolvedSnapshotId)) as
      | { id: number; created_at: number }
      | undefined;

    const tagsJson = tags && tags.length > 0 ? JSON.stringify(tags) : null;
    const createdAt = existing ? existing.created_at : now;

    await upsertSnapshotStmt.run(
      resolvedSnapshotId,
      name,
      description ?? null,
      structureId,
      tagsJson,
      createdAt,
      now,
    );

    await db.exec("COMMIT");

    return {
      snapshotId: resolvedSnapshotId,
      structureId,
      structureHash,
      createdAt,
      updatedAt: now,
      replaced: Boolean(existing),
    } satisfies SaveGlobalSnapshotResult;
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch (_rollbackErr) {
      // ignore rollback errors to surface original failure
    }
    throw error;
  } finally {
    if (valueContext) {
      await releaseValueContext(valueContext);
    }
    if (structureContext) {
      await releaseStructureContext(structureContext);
    }
  }
}

export async function getGlobalSnapshot(
  db: SqliteDatabase,
  snapshotId: string,
): Promise<GlobalSnapshotRecord | null> {
  const selectSnapshotStmt = await db.prepare(
    `SELECT gs.snapshot_id AS snapshotId,
            gs.name AS name,
            gs.description AS description,
            gs.tags AS tags,
            gs.created_at AS createdAt,
            gs.updated_at AS updatedAt,
            vs.structure AS structure
       FROM global_snapshots gs
       JOIN variable_structures vs ON vs.id = gs.structure_id
      WHERE gs.snapshot_id = ?`,
  );

  const selectValueByIdStmt = await db.prepare(
    "SELECT value_data FROM value_pool WHERE id = ?",
  );

  try {
    const row = (await selectSnapshotStmt.get(snapshotId)) as
      | {
          snapshotId: string;
          name: string;
          description: string | null;
          tags: string | null;
          createdAt: number;
          updatedAt: number;
          structure: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const structure = parseStructure(row.structure);
    const snapshotBody = await hydrateStructure(structure, selectValueByIdStmt);

    return {
      snapshotId: row.snapshotId,
      name: row.name,
      description: row.description,
      snapshotBody,
      tags: parseTags(row.tags),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  } finally {
    // node:sqlite 的 StatementSync 无需显式释放。
  }
}

export async function listGlobalSnapshots(
  db: SqliteDatabase,
  options: ListGlobalSnapshotsOptions = {},
): Promise<ListGlobalSnapshotsResult> {
  const { tag, limit = 100, offset = 0 } = options;

  let countQuery = "SELECT COUNT(*) as total FROM global_snapshots";
  let selectQuery = `SELECT snapshot_id AS snapshotId,
                            name,
                            description,
                            tags,
                            created_at AS createdAt,
                            updated_at AS updatedAt
                       FROM global_snapshots`;

  const params: unknown[] = [];

  if (tag) {
    const tagFilter = " WHERE tags LIKE ?";
    countQuery += tagFilter;
    selectQuery += tagFilter;
    params.push(`%"${tag}"%`);
  }

  selectQuery += " ORDER BY updated_at DESC LIMIT ? OFFSET ?";

  const countStmt = await db.prepare(countQuery);
  const selectStmt = await db.prepare(selectQuery);

  try {
    const countRow = (await (tag
      ? countStmt.get(params[0] as string)
      : countStmt.get())) as { total: number };
    const total = countRow.total;

    const rows = (await (tag
      ? selectStmt.all(params[0] as string, limit, offset)
      : selectStmt.all(limit, offset))) as Array<{
      snapshotId: string;
      name: string;
      description: string | null;
      tags: string | null;
      createdAt: number;
      updatedAt: number;
    }>;

    const snapshots: GlobalSnapshotMetadata[] = rows.map((row) => ({
      snapshotId: row.snapshotId,
      name: row.name,
      description: row.description,
      tags: parseTags(row.tags),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));

    return { snapshots, total };
  } finally {
    // node:sqlite 的 StatementSync 无需显式释放。
  }
}

export async function deleteGlobalSnapshot(
  db: SqliteDatabase,
  snapshotId: string,
): Promise<void> {
  const deleteStmt = await db.prepare(
    "DELETE FROM global_snapshots WHERE snapshot_id = ?",
  );

  try {
    await db.exec("BEGIN IMMEDIATE");
    await deleteStmt.run(snapshotId);
    await db.exec("COMMIT");
  } catch (error) {
    try {
      await db.exec("ROLLBACK");
    } catch (_rollbackErr) {
      // ignore rollback errors
    }
    throw error;
  }
}
