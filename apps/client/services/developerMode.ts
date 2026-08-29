// Where the developer-mode flag lives.
//
// Device-local on purpose: it sits in `sync_meta` next to the other local blobs
// rather than in the settings document, because that document syncs to the
// server and roams between devices. Turning diagnostics on for this phone
// should not turn them on for the tablet, or travel anywhere.
//
// The gesture that flips it is in `lib/developerMode.ts`.

import { eq } from "drizzle-orm";
import { syncMetaTable } from "@/db/schema";
import { db, sqlite } from "./db";

const KEY = "developerMode";

/**
 * Read synchronously, so the settings screen renders with the row already in
 * its right state. A row that appears a frame late reads as a glitch.
 */
export function developerModeEnabled(): boolean {
  try {
    const row = sqlite.getFirstSync<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = 'developerMode'",
    );
    return row?.value === "true";
  } catch {
    // Fresh install: the table appears once migrations run.
    return false;
  }
}

export async function setDeveloperMode(enabled: boolean) {
  // Delete-then-insert rather than an upsert: drizzle's onConflictDoUpdate
  // emits a bind expo-sqlite rejects on iOS. Same reason as `setMeta` next door.
  await db.delete(syncMetaTable).where(eq(syncMetaTable.key, KEY));
  await db.insert(syncMetaTable).values({ key: KEY, value: String(enabled) });
}
