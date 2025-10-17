import { randomBytes } from "node:crypto";

export function generateIdentifier(): string {
  const timestamp = Date.now();
  const randomPart = randomBytes(4).toString("hex");
  return `var_snapshot_${timestamp}_${randomPart}`;
}
