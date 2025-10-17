declare module "better-sqlite3" {
  export interface Statement {
    run(...params: unknown[]): { lastInsertRowid: number | bigint };
    get(...params: unknown[]): unknown;
  }

  export interface Database {
    prepare(sql: string): Statement;
    exec(sql: string): void;
    close(): void;
    pragma(_pragma: string): void;
    transaction<TArgs extends unknown[], TResult>(
      handler: (...args: TArgs) => TResult,
    ): (...args: TArgs) => TResult;
  }

  interface Constructor {
    new (path: string): Database;
    (path: string): Database;
  }

  const BetterSqlite3: Constructor;
  export default BetterSqlite3;
}
