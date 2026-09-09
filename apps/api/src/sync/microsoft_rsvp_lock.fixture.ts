import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, markGraphRsvpDispatched, type EventOutboxRow } from "@musubi/db";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
/** Pause the actual marker UPDATE inside PostgreSQL, after source validation.
 * A concurrent source mutation must wait until that marker transaction commits. */
export async function verifyGraphDispatchLocks(row: EventOutboxRow, mutate: (tx: Transaction) => PromiseLike<unknown>) {
  const name = `graph_rsvp_lock_${randomUUID().replace(/-/g, "")}`;
  const key = Math.floor(Math.random() * 1_000_000_000) + 1;
  let unlock!: () => void, ready!: () => void;
  const gate = new Promise<void>(resolve => { unlock = resolve; });
  const held = new Promise<void>(resolve => { ready = resolve; });
  await db.execute(sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = '${row.id}' AND NEW.payload->'rsvp'->'graphDispatch' IS NOT NULL AND OLD.payload->'rsvp'->'graphDispatch' IS NULL THEN PERFORM pg_advisory_xact_lock(${key}::bigint); END IF; RETURN NEW; END $$`));
  await db.execute(sql.raw(`CREATE TRIGGER ${name} BEFORE UPDATE ON event_outbox FOR EACH ROW EXECUTE FUNCTION ${name}()`));
  const blocker = db.transaction(async tx => { await tx.execute(sql`select pg_advisory_xact_lock(${key}::bigint)`); ready(); await gate; });
  let marking: Promise<boolean> | undefined, mutation: Promise<void> | undefined;
  const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 200; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail("Expected database lock was not observed"); };
  try {
    await held;
    let markerFinished: boolean | undefined;
    marking = markGraphRsvpDispatched(row).then(result => { markerFinished = result; return result; });
    await waitFor(async () => { if (markerFinished !== undefined) assert.fail(`Marker completed before gate: ${markerFinished}`); const rows = await db.execute(sql`select 1 from pg_locks where locktype = 'advisory' and objid = ${key}::oid and not granted`); return rows.rows.length > 0; });
    let pid: number | undefined, committed = false;
    mutation = db.transaction(async tx => { const { rows: [process] } = await tx.execute(sql`select pg_backend_pid() as pid`); pid = Number(process!.pid); await mutate(tx); }).then(() => { committed = true; });
    await waitFor(async () => { if (committed) assert.fail("Source mutation slipped between validation and dispatch marker"); if (!pid) return false; const rows = await db.execute(sql`select 1 from pg_stat_activity where pid = ${pid} and wait_event_type = 'Lock'`); return rows.rows.length > 0; });
    unlock(); await blocker;
    assert.equal(await marking, true); await mutation;
    assert.equal(committed, true);
  } finally {
    unlock(); await blocker;
    await Promise.allSettled([marking, mutation].filter(Boolean));
    await db.execute(sql.raw(`DROP TRIGGER IF EXISTS ${name} ON event_outbox`));
    await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${name}()`));
  }
}
