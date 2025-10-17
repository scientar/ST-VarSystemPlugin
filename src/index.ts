import bodyParser from "body-parser";
import type { Request, Response, Router } from "express";
import { z } from "zod";
import { closeDatabase, getDatabase } from "./db/connection";
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

export async function init(router: Router): Promise<void> {
  const db = getDatabase();
  try {
    applyMigrations(db);
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
    (req: Request, res: Response) => {
      const parsed = snapshotRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        warn("快照请求数据校验失败", parsed.error.format());
        return res.status(400).json({
          error: "Invalid snapshot request payload",
          details: parsed.error.format(),
        });
      }

      const db = getDatabase();
      try {
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
        const result = saveSnapshot(db, snapshotParams);
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
    (req: Request, res: Response) => {
      const { identifier } = req.params;
      if (!identifier) {
        return res.status(400).json({ error: "identifier 参数缺失" });
      }

      const db = getDatabase();
      const record = getSnapshot(db, identifier);
      if (!record) {
        return res.status(404).json({ error: "Snapshot not found" });
      }

      return res.json(record);
    },
  );

  router.post(
    "/var-manager/templates",
    jsonParser,
    (req: Request, res: Response) => {
      const parsed = templateRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        warn("模板保存请求校验失败", parsed.error.format());
        return res.status(400).json({
          error: "Invalid template payload",
          details: parsed.error.format(),
        });
      }

      const db = getDatabase();
      try {
        const record = upsertTemplate(db, {
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
    (req: Request, res: Response) => {
      const { characterName } = req.params;
      if (!characterName) {
        return res.status(400).json({ error: "characterName 参数缺失" });
      }

      const db = getDatabase();
      const record = getTemplate(db, characterName);
      if (!record) {
        return res.status(404).json({ error: "Template not found" });
      }

      return res.json(record);
    },
  );

  router.post("/var-manager/reprocess", (_req: Request, res: Response) => {
    return res
      .status(501)
      .json({ error: "Reprocess command not implemented yet" });
  });

  log("插件初始化完成");
}

export async function exit(): Promise<void> {
  try {
    closeDatabase();
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
