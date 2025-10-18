import bodyParser from "body-parser";
import type { Request, Response, Router } from "express";
import { z } from "zod";
import { closeDatabase, getDatabase } from "./db/connection";
import {
  deleteGlobalSnapshot,
  type GlobalSnapshotParams,
  getGlobalSnapshot,
  listGlobalSnapshots,
  saveGlobalSnapshot,
} from "./db/global-snapshots";
import { applyMigrations } from "./db/schema";
import { getSnapshot, type SnapshotParams, saveSnapshot } from "./db/snapshots";
import { getTemplate, upsertTemplate } from "./db/templates";
import { error, log, warn } from "./logger";

interface PluginInfo {
  id: string;
  name: string;
  description: string;
}

interface Plugin {
  init: (router: Router) => Promise<void>;
  exit: () => Promise<void>;
  info: PluginInfo;
}

const JSON_LIMIT = "2mb";

const snapshotRequestSchema = z.object({
  identifier: z.string().min(1).optional(),
  messageId: z.string().min(1).optional(),
  chatFile: z.string().min(1, "chatFile 字段不能为空"),
  payload: z.unknown().refine((value: unknown) => value !== undefined, {
    message: "payload 字段不能为空",
  }),
});

const templateRequestSchema = z.object({
  characterName: z.string().min(1),
  template: z.any(),
});

const globalSnapshotRequestSchema = z.object({
  snapshotId: z.string().min(1).optional(),
  name: z.string().min(1, "name 字段不能为空"),
  description: z.string().optional(),
  snapshotBody: z.unknown().refine((value: unknown) => value !== undefined, {
    message: "snapshotBody 字段不能为空",
  }),
  tags: z.array(z.string()).optional(),
});

export async function init(router: Router): Promise<void> {
  const db = await getDatabase();
  try {
    await applyMigrations(db);
  } catch (err) {
    error("数据库迁移失败", err);
    throw err;
  }

  const jsonParser = bodyParser.json({ limit: JSON_LIMIT });

  router.post("/var-manager/probe", (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  router.post(
    "/var-manager/snapshots",
    jsonParser,
    async (req: Request, res: Response) => {
      const parsed = snapshotRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        warn("快照请求数据校验失败", parsed.error.format());
        return res.status(400).json({
          error: "Invalid snapshot request payload",
          details: parsed.error.format(),
        });
      }

      try {
        const db = await getDatabase();
        if (
          parsed.data.payload === null ||
          (typeof parsed.data.payload !== "object" &&
            !Array.isArray(parsed.data.payload))
        ) {
          return res.status(400).json({
            error: "payload 必须是对象或数组",
          });
        }

        const snapshotParams: SnapshotParams = {
          identifier: parsed.data.identifier,
          messageId: parsed.data.messageId,
          chatFile: parsed.data.chatFile,
          payload: parsed.data.payload,
        };
        const result = await saveSnapshot(db, snapshotParams);
        const status = result.replaced ? 200 : 201;
        return res.status(status).json(result);
      } catch (err) {
        error("保存快照失败", err);
        return res.status(500).json({ error: "Failed to save snapshot" });
      }
    },
  );

  router.get(
    "/var-manager/snapshots/:identifier",
    async (req: Request, res: Response) => {
      const { identifier } = req.params;
      if (!identifier) {
        return res.status(400).json({ error: "identifier 参数缺失" });
      }

      try {
        const db = await getDatabase();
        const record = await getSnapshot(db, identifier);
        if (!record) {
          return res.status(404).json({ error: "Snapshot not found" });
        }

        return res.json(record);
      } catch (err) {
        error("读取快照失败", err);
        return res.status(500).json({ error: "Failed to read snapshot" });
      }
    },
  );

  router.post(
    "/var-manager/templates",
    jsonParser,
    async (req: Request, res: Response) => {
      const parsed = templateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        warn("模板保存请求校验失败", parsed.error.format());
        return res.status(400).json({
          error: "Invalid template payload",
          details: parsed.error.format(),
        });
      }

      try {
        const db = await getDatabase();
        const record = await upsertTemplate(db, {
          characterName: parsed.data.characterName,
          template: parsed.data.template,
        });
        return res.json(record);
      } catch (err) {
        error("保存模板失败", err);
        return res.status(500).json({ error: "Failed to store template" });
      }
    },
  );

  router.get(
    "/var-manager/templates/:characterName",
    async (req: Request, res: Response) => {
      const { characterName } = req.params;
      if (!characterName) {
        return res.status(400).json({ error: "characterName 参数缺失" });
      }

      try {
        const db = await getDatabase();
        const record = await getTemplate(db, characterName);
        if (!record) {
          return res.status(404).json({ error: "Template not found" });
        }

        return res.json(record);
      } catch (err) {
        error("读取模板失败", err);
        return res.status(500).json({ error: "Failed to read template" });
      }
    },
  );

  router.post("/var-manager/reprocess", (_req: Request, res: Response) => {
    return res
      .status(501)
      .json({ error: "Reprocess command not implemented yet" });
  });

  // 全局快照接口
  router.post(
    "/var-manager/global-snapshots",
    jsonParser,
    async (req: Request, res: Response) => {
      const parsed = globalSnapshotRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        warn("全局快照请求数据校验失败", parsed.error.format());
        return res.status(400).json({
          error: "Invalid global snapshot request payload",
          details: parsed.error.format(),
        });
      }

      try {
        const db = await getDatabase();
        const snapshotParams: GlobalSnapshotParams = {
          snapshotId: parsed.data.snapshotId,
          name: parsed.data.name,
          description: parsed.data.description,
          snapshotBody: parsed.data.snapshotBody,
          tags: parsed.data.tags,
        };
        const result = await saveGlobalSnapshot(db, snapshotParams);
        const status = result.replaced ? 200 : 201;
        return res.status(status).json(result);
      } catch (err) {
        error("保存全局快照失败", err);
        return res
          .status(500)
          .json({ error: "Failed to save global snapshot" });
      }
    },
  );

  router.get(
    "/var-manager/global-snapshots",
    async (req: Request, res: Response) => {
      try {
        const tag = req.query.tag as string | undefined;
        const limit = req.query.limit
          ? parseInt(req.query.limit as string, 10)
          : undefined;
        const offset = req.query.offset
          ? parseInt(req.query.offset as string, 10)
          : undefined;

        const db = await getDatabase();
        const result = await listGlobalSnapshots(db, { tag, limit, offset });
        return res.json(result);
      } catch (err) {
        error("列出全局快照失败", err);
        return res
          .status(500)
          .json({ error: "Failed to list global snapshots" });
      }
    },
  );

  router.get(
    "/var-manager/global-snapshots/:snapshotId",
    async (req: Request, res: Response) => {
      const { snapshotId } = req.params;
      if (!snapshotId) {
        return res.status(400).json({ error: "snapshotId 参数缺失" });
      }

      try {
        const db = await getDatabase();
        const record = await getGlobalSnapshot(db, snapshotId);
        if (!record) {
          return res.status(404).json({ error: "Global snapshot not found" });
        }

        return res.json(record);
      } catch (err) {
        error("读取全局快照失败", err);
        return res
          .status(500)
          .json({ error: "Failed to read global snapshot" });
      }
    },
  );

  router.delete(
    "/var-manager/global-snapshots/:snapshotId",
    async (req: Request, res: Response) => {
      const { snapshotId } = req.params;
      if (!snapshotId) {
        return res.status(400).json({ error: "snapshotId 参数缺失" });
      }

      try {
        const db = await getDatabase();
        await deleteGlobalSnapshot(db, snapshotId);
        return res.sendStatus(204);
      } catch (err) {
        error("删除全局快照失败", err);
        return res
          .status(500)
          .json({ error: "Failed to delete global snapshot" });
      }
    },
  );

  log("插件初始化完成");
}

export async function exit(): Promise<void> {
  try {
    await closeDatabase();
    log("插件已退出");
  } catch (err) {
    error("插件退出时发生错误", err);
  }
}

export const info: PluginInfo = {
  id: "var-manager",
  name: "Variable Manager Plugin",
  description:
    "Provides persistent storage for SillyTavern variable snapshots.",
};

const plugin: Plugin = {
  init,
  exit,
  info,
};

export default plugin;
