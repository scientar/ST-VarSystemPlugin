import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "null";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => stableStringify(item));
    return `[${items.join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`);

  return `{${entries.join(",")}}`;
}

export function hashString(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function detectValueType(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

export function shouldInline(value: unknown): boolean {
  if (value === null) {
    return true;
  }

  const valueType = typeof value;

  if (valueType === "number" || valueType === "boolean") {
    return true;
  }

  if (valueType === "string") {
    const str = value as string;
    return str.length <= 32;
  }

  return false;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }

  return Object.getPrototypeOf(value) === Object.prototype;
}
