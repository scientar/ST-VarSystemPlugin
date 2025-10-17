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

export interface SnapshotParams {
  chatFile: string;
  payload: unknown;
  identifier?: string;
  messageId?: string;
}

export interface SaveSnapshotResult {
  identifier: string;
  chatFile: string;
  messageId: string | null;
  structureId: number;
  structureHash: string;
  createdAt: number;
  replaced: boolean;
}

export interface SnapshotRecord {
  identifier: string;
  chatFile: string;
  messageId: string | null;
  createdAt: number;
  payload: unknown;
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

export async function saveSnapshot(
  db: SqliteDatabase,
  params: SnapshotParams,
): Promise<SaveSnapshotResult> {
  const { chatFile, payload, identifier, messageId } = params;

  if (payload === undefined) {
    throw new Error("payload 字段不能为空");
  }

  let valueContext: Awaited<ReturnType<typeof createValueContext>> | null =
    null;
  let structureContext: Awaited<
    ReturnType<typeof createStructureContext>
  > | null = null;
  let selectIdentifierStmt: SqliteStatement | null = null;
  let upsertMessageStmt: SqliteStatement | null = null;

  try {
    valueContext = await createValueContext(db);
    structureContext = await createStructureContext(db);
    selectIdentifierStmt = await db.prepare(
      "SELECT structure_id FROM message_variables WHERE identifier = ?",
    );
    upsertMessageStmt = await db.prepare(
      `INSERT INTO message_variables (identifier, chat_file, message_id, structure_id, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET
         chat_file = excluded.chat_file,
         message_id = excluded.message_id,
         structure_id = excluded.structure_id,
         created_at = excluded.created_at`,
    );

    await db.exec("BEGIN IMMEDIATE");

    const now = Date.now();
    valueContext.now = now;
    structureContext.now = now;

    const structure = await buildStructure(payload, valueContext);
    const { structureId, structureHash } = await persistStructure(
      structure,
      structureContext,
    );
    const resolvedIdentifier = identifier ?? generateIdentifier();

    const existing = (await selectIdentifierStmt.get(resolvedIdentifier)) as
      | { structure_id: number }
      | undefined;

    await upsertMessageStmt.run(
      resolvedIdentifier,
      chatFile,
      messageId ?? null,
      structureId,
      now,
    );

    await db.exec("COMMIT");

    return {
      identifier: resolvedIdentifier,
      chatFile,
      messageId: messageId ?? null,
      structureId,
      structureHash,
      createdAt: now,
      replaced: Boolean(existing),
    } satisfies SaveSnapshotResult;
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

export async function getSnapshot(
  db: SqliteDatabase,
  identifier: string,
): Promise<SnapshotRecord | null> {
  const selectSnapshotStmt = await db.prepare(
    `SELECT mv.identifier AS identifier,
            mv.chat_file AS chatFile,
            mv.message_id AS messageId,
            mv.created_at AS createdAt,
            vs.structure AS structure
       FROM message_variables mv
       JOIN variable_structures vs ON vs.id = mv.structure_id
      WHERE mv.identifier = ?`,
  );

  const selectValueByIdStmt = await db.prepare(
    "SELECT value_data FROM value_pool WHERE id = ?",
  );

  try {
    const row = (await selectSnapshotStmt.get(identifier)) as
      | {
          identifier: string;
          chatFile: string;
          messageId: string | null;
          createdAt: number;
          structure: string;
        }
      | undefined;

    if (!row) {
      return null;
    }

    const structure = parseStructure(row.structure);
    const payload = await hydrateStructure(structure, selectValueByIdStmt);

    return {
      identifier: row.identifier,
      chatFile: row.chatFile,
      messageId: row.messageId,
      createdAt: row.createdAt,
      payload,
    };
  } finally {
    // node:sqlite 的 StatementSync 无需显式释放。
  }
}
