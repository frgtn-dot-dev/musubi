import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { auth } from "@musubi/auth";
import { db, user, session, account, createCalendar, createEvent, getEvent, getEventCalendars,
  deleteUserWithCalendarRevisions, transferCalendarOwnership, calendarMembers, calendars } from "@musubi/db";
import { handlerConfirmDeleteUser } from "./users";
import { middlewareErrorHandler } from "../middleware/error_handler";
import { lockUserLifecycle } from "../../../../packages/db/src/queries/calendar-lifecycle";

async function main() {
  assert.equal(process.env.ENVIRONMENT, "test");
  const ids: string[] = [];
  const makeUser = async () => {
    const id = `delete-calendar-${randomUUID()}`;
    ids.push(id);
    await db.insert(user).values({ id, name: id, email: `${id}@example.test` });
    return id;
  };
  const survivor = await makeUser();
  const home = await createCalendar({ creatorID: survivor, name: "Survivor", color: "#112233" });
  const values = { creatorID: survivor, organizer: survivor, title: "Surviving shared content", color: "#112233", start: new Date(), end: new Date() };
  const ctx = await auth.$context;
  const app = express(); app.use(express.json());
  app.post("/confirm", handlerConfirmDeleteUser); app.use(middlewareErrorHandler);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const confirm = (token: string) => fetch(`${origin}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
  try {
    for (const native of [false, true]) {
      const owner = await makeUser();
      const calendar = await createCalendar({ creatorID: owner, name: "Deleted owner", color: "#112233" });
      const linked = await createEvent({ ...values, id: randomUUID() }, [home.id, calendar.id]);
      const foreignOrigin = await createEvent({ ...values, id: randomUUID(), originCalendarID: calendar.id }, [calendar.id, home.id]);
      const token = randomUUID();
      await ctx.internalAdapter.createVerificationValue({ identifier: `delete-account-${token}`, value: owner, expiresAt: new Date(Date.now() + 60_000) });
      const expired = randomUUID();
      await ctx.internalAdapter.createVerificationValue({ identifier: `delete-account-${expired}`, value: owner, expiresAt: new Date(Date.now() - 60_000) });
      assert.equal((await confirm("invalid")).status, 400);
      assert.equal((await confirm(expired)).status, 400);
      assert.equal((await getEvent(linked.id)).revision, 1);
      const login = await ctx.internalAdapter.createSession(owner);
      await db.insert(account).values({ id: randomUUID(), userId: owner, accountId: owner, providerId: "credential" });
      if (native) {
        for (const bad of ["invalid", expired]) {
          const denial = await auth.handler(new Request(`http://127.0.0.1:7531/api/auth/delete-user/callback?token=${bad}`, {
            headers: { authorization: `Bearer ${login.token}` },
          }));
          assert.equal(denial.status, 404);
          assert.equal((await getEvent(linked.id)).revision, 1);
        }
      }
      const response = native ? await auth.handler(new Request(`http://127.0.0.1:7531/api/auth/delete-user/callback?token=${token}`, {
        headers: { authorization: `Bearer ${login.token}` },
      })) : await confirm(token);
      assert.equal(response.status, 200, await response.text());
      assert.deepEqual(await db.select().from(user).where(eq(user.id, owner)), []);
      assert.deepEqual(await db.select().from(session).where(eq(session.userId, owner)), []);
      assert.deepEqual(await db.select().from(account).where(eq(account.userId, owner)), []);
      assert.equal((await confirm(token)).status, 400, "single-use confirmation remains enforced");
      assert.equal((await getEvent(linked.id)).revision, 2);
      assert.deepEqual(await getEventCalendars(linked.id), [home.id]);
      const changed = await getEvent(foreignOrigin.id);
      assert.equal(changed.revision, 2);
      assert.equal(changed.originCalendarID, null);
      assert.equal(changed.deletedAt, null, "account deletion preserves existing FK retention policy");
    }
    await assert.rejects(ctx.adapter.delete({ model: "user", where: [{ field: "email", value: "not-an-id" }] }), /exact user identity/);
    await assert.rejects(ctx.adapter.deleteMany({ model: "user", where: [] }), /Bulk account deletion/);
    // An exclusive user fence prevents calendar admission after deletion. The
    // admission may wait, then fails its FK check with no partial calendar.
    const owner = await makeUser();
    let ready!: () => void, release!: () => void;
    const acquired = new Promise<void>((resolve) => { ready = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const holder = db.transaction(async (tx) => {
      await lockUserLifecycle(tx, [owner], "exclusive"); ready(); await gate;
      await tx.delete(user).where(eq(user.id, owner));
    });
    await acquired;
    const admission = createCalendar({ creatorID: owner, name: "Must not survive", color: "#112233" }).then(() => null, (error: unknown) => error);
    for (let n = 0; n < 200; n++) {
      if ((await db.$client.query("select 1 from pg_locks where locktype='advisory' and not granted")).rowCount) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (n === 199) throw new Error("calendar admission did not wait");
    }
    release(); await holder;
    assert.ok(await admission instanceof Error);
    assert.deepEqual(await db.select().from(calendars).where(eq(calendars.creatorID, owner)), []);

    // Transfer departure and arrival sets are both fenced. A transfer winning
    // first makes deletion of the old owner leave the transferred calendar alone.
    const departing = await makeUser();
    const transferred = await createCalendar({ creatorID: departing, name: "Transfer", color: "#112233" });
    await db.insert(calendarMembers).values({ calendarID: transferred.id, userID: survivor, role: "viewer" });
    // Pause the real transfer with old+new user fences and its calendar row held.
    const connect = db.$client.connect.bind(db.$client);
    let transferReady!: () => void, finishTransfer!: () => void;
    const atTransfer = new Promise<void>((resolve) => { transferReady = resolve; });
    const transferGate = new Promise<void>((resolve) => { finishTransfer = resolve; });
    (db.$client as any).connect = async () => {
      const client = await connect();
      const query = client.query.bind(client), releaseClient = client.release.bind(client);
      (client as any).query = async (config: any, ...args: any[]) => {
        const text = typeof config === "string" ? config : config.text;
        const result = await (query as any)(config, ...args);
        if (text.includes('from "calendars"') && text.endsWith('for update')) {
          transferReady(); await transferGate;
        }
        return result;
      };
      client.release = (...args) => { client.query = query; client.release = releaseClient; releaseClient(...args); };
      return client;
    };
    const moving = transferCalendarOwnership(transferred.id, departing, survivor);
    await atTransfer;
    db.$client.connect = connect;
    const deletingDeparture = deleteUserWithCalendarRevisions(departing);
    for (let n = 0; n < 200; n++) {
      if ((await db.$client.query("select 1 from pg_locks where locktype='advisory' and not granted")).rowCount) break;
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (n === 199) throw new Error("deletion did not wait for departure fence");
    }
    finishTransfer();
    assert.equal((await moving).status, "updated");
    await deletingDeparture;
    assert.equal((await db.select().from(calendars).where(eq(calendars.id, transferred.id)))[0].creatorID, survivor);
    // Arrival deletion winning first refuses transfer without a dangling owner.
    const destination = await makeUser();
    await db.insert(calendarMembers).values({ calendarID: transferred.id, userID: destination, role: "viewer" });
    await deleteUserWithCalendarRevisions(destination);
    assert.equal((await transferCalendarOwnership(transferred.id, survivor, destination)).status, "member_not_found");
    console.log("account cascade: confirmed token + native auth routes, retained cleanup, revisions, lifecycle admission and transfer OK");
  } finally {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.delete(user).where(inArray(user.id, ids));
  }
}
main().then(() => process.exit(0)).catch((error) => { console.error(error); process.exit(1); });
