import fs from "node:fs";
import path from "node:path";

const ENV_DATA_DIR = process.env.SILLYTAVERN_DATA_DIR;

function resolvePluginRoot(): string {
  return path.resolve(__dirname, "..");
}

export function resolveDataDirectory(): string {
  if (ENV_DATA_DIR) {
    return path.join(ENV_DATA_DIR, "var-manager");
  }

  return path.join(resolvePluginRoot(), "data");
}

export function ensureDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export function resolveDatabasePath(): string {
  const dataDir = resolveDataDirectory();
  ensureDirectory(dataDir);
  return path.join(dataDir, "var-manager.db");
}
