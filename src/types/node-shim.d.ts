declare module "crypto" {
  interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(encoding: "hex" | "base64" | "latin1"): string;
  }

  export function createHash(algorithm: string): Hash;

  interface RandomBytes {
    toString(encoding: "hex"): string;
  }

  export function randomBytes(size: number): RandomBytes;
}

declare module "fs" {
  export function existsSync(path: string): boolean;
  export function mkdirSync(
    path: string,
    options: { recursive: boolean },
  ): void;
}

declare module "path" {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
}

declare const __dirname: string;

declare const process: {
  env: Record<string, string | undefined>;
};
