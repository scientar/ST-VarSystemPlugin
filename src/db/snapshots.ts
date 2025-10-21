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

// 防止深层嵌套对象导致栈溢出
const MAX_RECURSION_DEPTH = 100;

async function buildStructure(
  value: unknown,
  ctx: Awaited<ReturnType<typeof createValueContext>>,
  depth: number = 0,
): Promise<unknown> {
  // 深度限制检查
  if (depth > MAX_RECURSION_DEPTH) {
    throw new Error(`快照对象嵌套深度超过 ${MAX_RECURSION_DEPTH} 层，可能存在循环引用或异常数据`);
  }

  if (value === null || typeof value !== "object") {
    return transformLeafValue(value, ctx);
  }

  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (const item of value) {
      result.push(await buildStructure(item, ctx, depth + 1));
    }
    return result;
  }

  if (!isPlainObject(value)) {
    return transformLeafValue(value, ctx);
  }

  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    result[key] = await buildStructure(child, ctx, depth + 1);
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

/**
 * 删除单个消息快照（按 identifier）
 */
export async function deleteSnapshot(
  db: SqliteDatabase,
  identifier: string,
): Promise<void> {
  const deleteStmt = await db.prepare(
    "DELETE FROM message_variables WHERE identifier = ?",
  );

  await deleteStmt.run(identifier);
  // 注意：不删除 value_pool 和 variable_structures 中的记录，
  // 因为可能被其他快照共享。清理由定期维护任务处理。
}

/**
 * 删除指定聊天文件的所有消息快照
 */
export async function deleteSnapshotsByChatFile(
  db: SqliteDatabase,
  chatFile: string,
): Promise<number> {
  const deleteStmt = await db.prepare(
    "DELETE FROM message_variables WHERE chat_file = ?",
  );

  const result = await deleteStmt.run(chatFile);
  // result.changes 包含删除的行数 (可能是 number 或 bigint)
  const changes = result.changes ?? 0;
  return typeof changes === "bigint" ? Number(changes) : changes;
}

/**
 * 清理孤立快照（不对应任何现存聊天记录的快照）
 * @param db 数据库连接
 * @param activeChatFiles 活跃的聊天文件名列表
 * @returns 清理结果统计
 */
export async function cleanupOrphanedSnapshots(
  db: SqliteDatabase,
  activeChatFiles: string[],
): Promise<{
  deletedCount: number;
  totalScanned: number;
  deletedChatFiles: string[];
}> {
  // 1. 查询所有快照的 chat_file
  const allSnapshotsStmt = await db.prepare(
    "SELECT DISTINCT chat_file FROM message_variables",
  );
  const allSnapshots = (await allSnapshotsStmt.all()) as Array<{
    chat_file: string;
  }>;

  // 2. 找出孤立的 chat_file（不在 activeChatFiles 中）
  const activeChatFileSet = new Set(activeChatFiles);
  const orphanedChatFiles: string[] = [];

  for (const row of allSnapshots) {
    const chatFile = row.chat_file;
    if (chatFile && !activeChatFileSet.has(chatFile)) {
      orphanedChatFiles.push(chatFile);
    }
  }

  // 3. 批量删除孤立的快照（优化：单条 SQL 替代 N+1 循环）
  let totalDeleted = 0;

  if (orphanedChatFiles.length === 0) {
    return {
      deletedCount: 0,
      totalScanned: allSnapshots.length,
      deletedChatFiles: [],
    };
  }

  // 使用 NOT IN 子句批量删除（如果 activeChatFiles 不为空）
  if (activeChatFiles.length > 0) {
    const placeholders = activeChatFiles.map(() => '?').join(',');
    const deleteStmt = await db.prepare(
      `DELETE FROM message_variables WHERE chat_file NOT IN (${placeholders})`
    );
    const result = await deleteStmt.run(...activeChatFiles);
    totalDeleted = Number(result.changes ?? 0);
  } else {
    // 如果没有活跃聊天，删除所有快照
    const deleteStmt = await db.prepare('DELETE FROM message_variables');
    const result = await deleteStmt.run();
    totalDeleted = Number(result.changes ?? 0);
  }

  return {
    deletedCount: totalDeleted,
    totalScanned: allSnapshots.length,
    deletedChatFiles: orphanedChatFiles,
  };
}
