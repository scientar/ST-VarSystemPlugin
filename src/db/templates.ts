import { stableStringify } from "../util/serialization";
import type { SqliteDatabase } from "./connection";

export interface TemplateUpsertParams {
  characterName: string;
  template: unknown;
}

export interface TemplateRecord {
  characterName: string;
  template: unknown;
  createdAt: number;
  updatedAt: number;
}

export async function upsertTemplate(
  db: SqliteDatabase,
  params: TemplateUpsertParams,
): Promise<TemplateRecord> {
  const { characterName, template } = params;
  const now = Date.now();
  const serialized = stableStringify(template);

  const upsertStmt = await db.prepare(
    `INSERT INTO variable_templates (character_name, template_content, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_name) DO UPDATE SET
       template_content = excluded.template_content,
       updated_at = excluded.updated_at,
       created_at = variable_templates.created_at`,
  );

  const selectStmt = await db.prepare(
    `SELECT character_name AS characterName,
            template_content AS templateContent,
            created_at AS createdAt,
            updated_at AS updatedAt
       FROM variable_templates
      WHERE character_name = ?`,
  );

  try {
    await upsertStmt.run(characterName, serialized, now, now);

    const row = (await selectStmt.get(characterName)) as {
      characterName: string;
      templateContent: string;
      createdAt: number;
      updatedAt: number;
    } | null;

    if (!row) {
      return {
        characterName,
        template,
        createdAt: now,
        updatedAt: now,
      };
    }

    try {
      return {
        characterName: row.characterName,
        template: JSON.parse(row.templateContent),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (_err) {
      return {
        characterName,
        template,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }
  } finally {
    // StatementSync 不需要显式 finalize，按引用计数释放。
  }
}

export async function getTemplate(
  db: SqliteDatabase,
  characterName: string,
): Promise<TemplateRecord | null> {
  const stmt = await db.prepare(
    `SELECT character_name AS characterName,
            template_content AS templateContent,
            created_at AS createdAt,
            updated_at AS updatedAt
       FROM variable_templates
      WHERE character_name = ?`,
  );

  try {
    const row = (await stmt.get(characterName)) as
      | {
          characterName: string;
          templateContent: string;
          createdAt: number;
          updatedAt: number;
        }
      | undefined;

    if (!row) {
      return null;
    }

    try {
      return {
        characterName: row.characterName,
        template: JSON.parse(row.templateContent),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    } catch (_err) {
      return null;
    }
  } finally {
    // StatementSync 不需要显式 finalize。
  }
}
