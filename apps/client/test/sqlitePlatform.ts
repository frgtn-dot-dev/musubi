import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Test-only Expo synchronous handle backed by actual SQLite, not DTO storage.
// Production db.ts and drizzle's Expo driver/runner remain in the call path.
export function sqlitePlatform() {
  const database = new DatabaseSync(":memory:");
  return {
    database,
    prepareSync(sql: string) {
      return {
        executeSync(params: SQLInputValue[]) {
          const statement = database.prepare(sql);
          if (statement.columns().length) {
            const rows = statement.all(...params);
            return { getAllSync: () => rows, getFirstSync: () => rows[0] };
          }
          const result = statement.run(...params);
          return { changes: result.changes, lastInsertRowId: result.lastInsertRowid };
        },
        executeForRawResultSync(params: SQLInputValue[]) {
          const statement = database.prepare(sql);
          statement.setReturnArrays(true);
          const rows = statement.all(...params);
          return { getAllSync: () => rows };
        },
      };
    },
    getFirstSync(sql: string) { return database.prepare(sql).get(); },
  };
}
