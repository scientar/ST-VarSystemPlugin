import { generateIdentifier } from "../util/identifier";
import { isPlainObject } from "../util/serialization";
import type { SqliteDatabase, SqliteStatement } from "./connection";
import { createStructureContext, persistStructure } from "./structure-store";
import { createValueContext, transformLeafValue } from "./value-store";

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

function buildStructure(
  value: unknown,
  ctx: ReturnType<typeof createValueContext>,
): unknown {
  if (value === null || typeof value !== "object") {
    return transformLeafValue(value, ctx);
  }

  if (Array.isArray(value)) {
    return value.map((item) => buildStructure(item, ctx));
  }

  if (!isPlainObject(value)) {
    return transformLeafValue(value, ctx);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    result[key] = buildStructure(child, ctx);
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

function hydrateStructure(value: unknown, stmt: SqliteStatement): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => hydrateStructure(item, stmt));
  }

  if ("$ref" in (value as Record<string, unknown>)) {
    const refId = (value as { $ref?: unknown }).$ref;
    if (typeof refId !== "number") {
      return null;
    }

    const row = stmt.get(refId) as { value_data: string } | undefined;
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
    result[key] = hydrateStructure(child, stmt);
  }

  return result;
}

export function saveSnapshot(
  db: SqliteDatabase,
  params: SnapshotParams,
): SaveSnapshotResult {
  const { chatFile, payload, identifier, messageId } = params;

  if (payload === undefined) {
    throw new Error("payload 字段不能为空");
  }

  const valueContext = createValueContext(db);

  const structureContext = createStructureContext(db);

  const selectIdentifierStmt = db.prepare(
    "SELECT structure_id FROM message_variables WHERE identifier = ?",
  );
  const upsertMessageStmt = db.prepare(
    `INSERT INTO message_variables (identifier, chat_file, message_id, structure_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(identifier) DO UPDATE SET
       chat_file = excluded.chat_file,
       message_id = excluded.message_id,
       structure_id = excluded.structure_id,
       created_at = excluded.created_at`,
  );

  const transaction = db.transaction(() => {
    const now = Date.now();
    valueContext.now = now;
    structureContext.now = now;

    const structure = buildStructure(payload, valueContext);
    const { structureId, structureHash } = persistStructure(
      structure,
      structureContext,
    );
    const resolvedIdentifier = identifier ?? generateIdentifier();

    const existing = selectIdentifierStmt.get(resolvedIdentifier) as
      | { structure_id: number }
      | undefined;

    upsertMessageStmt.run(
      resolvedIdentifier,
      chatFile,
      messageId ?? null,
      structureId,
      now,
    );

    return {
      identifier: resolvedIdentifier,
      chatFile,
      messageId: messageId ?? null,
      structureId,
      structureHash,
      createdAt: now,
      replaced: Boolean(existing),
    } satisfies SaveSnapshotResult;
  });

  return transaction();
}

export function getSnapshot(
  db: SqliteDatabase,
  identifier: string,
): SnapshotRecord | null {
  const selectSnapshotStmt = db.prepare(
    `SELECT mv.identifier AS identifier,
            mv.chat_file AS chatFile,
            mv.message_id AS messageId,
            mv.created_at AS createdAt,
            vs.structure AS structure
       FROM message_variables mv
       JOIN variable_structures vs ON vs.id = mv.structure_id
      WHERE mv.identifier = ?`,
  );

  const row = selectSnapshotStmt.get(identifier) as
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
  const selectValueByIdStmt = db.prepare(
    "SELECT value_data FROM value_pool WHERE id = ?",
  );
  const payload = hydrateStructure(structure, selectValueByIdStmt);

  return {
    identifier: row.identifier,
    chatFile: row.chatFile,
    messageId: row.messageId,
    createdAt: row.createdAt,
    payload,
  };
}
