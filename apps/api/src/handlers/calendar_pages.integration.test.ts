import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  createPage,
  db,
  ensureDefaultPage,
  getPage,
  listPages,
  pages,
  reorderPages,
  savePage,
  softDeletePage,
  user,
} from "@musubi/db";
import { defaultPageConfig } from "@musubi/types";

// Exercises the Pages query layer against a real Postgres: lazy backfill,
// compare-and-swap saves, reorder + default move, and default reassignment on
// delete (the transaction that must not trip the one-default-per-user index).

async function main() {
  if (process.env.ENVIRONMENT !== "test") {
    throw new Error(
      "Refusing to run Pages DB integration test unless ENVIRONMENT=test",
    );
  }

  const userID = `pages-user-${randomUUID()}`;
  await db.insert(user).values({
    id: userID,
    name: "Pages Test",
    email: `${userID}@example.test`,
    emailVerified: true,
  });

  try {
    // Lazy backfill creates exactly one default Page, and is idempotent.
    const first = await ensureDefaultPage(userID, {
      name: "My calendar",
      config: defaultPageConfig("month"),
    });
    assert.equal(first.length, 1);
    assert.equal(first[0].isDefault, true);
    const again = await ensureDefaultPage(userID, {
      name: "My calendar",
      config: defaultPageConfig("month"),
    });
    assert.equal(again.length, 1, "ensureDefaultPage must be idempotent");
    const defaultID = first[0].id;

    // A second Page appends after the default and is not itself default.
    const work = await createPage(userID, {
      name: "Work",
      config: defaultPageConfig("week"),
    });
    assert.equal(work.position, 1);
    assert.equal(work.isDefault, false);

    // Compare-and-swap: correct base revision saves and bumps the revision.
    const saved = await savePage(userID, work.id, work.revision, {
      name: "Work rescoped",
      config: defaultPageConfig("day"),
    });
    assert.equal(saved.status, "saved");
    assert.equal(
      saved.status === "saved" && saved.page.revision,
      work.revision + 1,
    );

    // Stale base revision → conflict, and the caller gets the current row back.
    const conflict = await savePage(userID, work.id, work.revision, {
      name: "Stale write",
      config: defaultPageConfig("month"),
    });
    assert.equal(conflict.status, "conflict");
    assert.equal(
      conflict.status === "conflict" && conflict.page.name,
      "Work rescoped",
    );

    // Unknown id → not_found, never a silent create.
    const missing = await savePage(userID, randomUUID(), 1, {
      name: "Nope",
      config: defaultPageConfig("month"),
    });
    assert.equal(missing.status, "not_found");

    // Reorder: Work moves ahead of the default and becomes the default.
    const reordered = await reorderPages(userID, [work.id, defaultID], work.id);
    assert.deepEqual(
      reordered.map((page) => page.id),
      [work.id, defaultID],
    );
    assert.equal(reordered[0].isDefault, true);
    assert.equal(reordered[1].isDefault, false);

    // Deleting the default reassigns it to the next survivor by position.
    const removed = await softDeletePage(userID, work.id);
    assert.equal(removed.status, "deleted");
    assert.equal(
      removed.status === "deleted" && removed.nextDefault?.id,
      defaultID,
    );
    const survivors = await listPages(userID);
    assert.equal(survivors.length, 1);
    assert.equal(survivors[0].id, defaultID);
    assert.equal(survivors[0].isDefault, true);
    assert.equal(await getPage(userID, work.id), undefined);

    console.log("calendar pages DB integration self-check: OK");
  } finally {
    await db.delete(pages).where(eq(pages.userID, userID));
    await db.delete(user).where(eq(user.id, userID));
  }
}

void main();
