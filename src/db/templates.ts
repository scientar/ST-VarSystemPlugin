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

export function upsertTemplate(
  db: SqliteDatabase,
  params: TemplateUpsertParams,
): TemplateRecord {
  const { characterName, template } = params;
  const now = Date.now();
  const serialized = stableStringify(template);

  const stmt = db.prepare(
    `INSERT INTO variable_templates (character_name, template_content, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(character_name) DO UPDATE SET
       template_content = excluded.template_content,
       updated_at = excluded.updated_at,
       created_at = variable_templates.created_at`,
  );

  stmt.run(characterName, serialized, now, now);

  const selectStmt = db.prepare(
    `SELECT character_name AS characterName,
            template_content AS templateContent,
            created_at AS createdAt,
            updated_at AS updatedAt
       FROM variable_templates
      WHERE character_name = ?`,
  );

  const row = selectStmt.get(characterName) as {
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
}

export function getTemplate(
  db: SqliteDatabase,
  characterName: string,
): TemplateRecord | null {
  const stmt = db.prepare(
    `SELECT character_name AS characterName,
            template_content AS templateContent,
            created_at AS createdAt,
            updated_at AS updatedAt
       FROM variable_templates
      WHERE character_name = ?`,
  );

  const row = stmt.get(characterName) as
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
}
