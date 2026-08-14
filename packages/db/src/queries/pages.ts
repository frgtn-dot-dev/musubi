import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, NewPage, PageRow, pages } from "..";

// All reads scope to the owner and exclude soft-deleted rows. The handler owns
// Zod validation of the JSONB config; queries treat it as opaque so an unknown
// future field round-trips untouched.

const active = (userID: string) =>
  and(eq(pages.userID, userID), isNull(pages.deletedAt));

export async function listPages(userID: string): Promise<PageRow[]> {
  return db
    .select()
    .from(pages)
    .where(active(userID))
    .orderBy(asc(pages.position), asc(pages.createdAt));
}

export async function getPage(
  userID: string,
  id: string,
): Promise<PageRow | undefined> {
  const [row] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, id), active(userID)));
  return row;
}

export async function createPage(
  userID: string,
  input: { name: string; config: unknown },
): Promise<PageRow> {
  const [{ next }] = await db
    .select({ next: sql<number>`coalesce(max(${pages.position}), -1) + 1` })
    .from(pages)
    .where(active(userID));

  const [row] = await db
    .insert(pages)
    .values({
      userID,
      name: input.name,
      config: input.config,
      position: next ?? 0,
      isDefault: false,
    } satisfies NewPage)
    .returning();
  return row;
}

export type SavePageResult =
  | { status: "saved"; page: PageRow }
  | { status: "conflict"; page: PageRow }
  | { status: "not_found" };

export async function savePage(
  userID: string,
  id: string,
  baseRevision: number,
  input: { name: string; config: unknown },
): Promise<SavePageResult> {
  const [saved] = await db
    .update(pages)
    .set({
      name: input.name,
      config: input.config,
      revision: sql`${pages.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(pages.id, id),
        active(userID),
        eq(pages.revision, baseRevision),
      ),
    )
    .returning();

  if (saved) return { status: "saved", page: saved };

  // Zero rows: either the Page is gone/not ours (404) or the revision moved (409).
  const current = await getPage(userID, id);
  return current
    ? { status: "conflict", page: current }
    : { status: "not_found" };
}

export type DeletePageResult =
  | { status: "deleted"; nextDefault?: PageRow }
  | { status: "not_found" };

export async function softDeletePage(
  userID: string,
  id: string,
): Promise<DeletePageResult> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .update(pages)
      .set({ deletedAt: new Date() })
      .where(and(eq(pages.id, id), active(userID)))
      .returning();

    if (!removed) return { status: "not_found" as const };
    if (!removed.isDefault) return { status: "deleted" as const };

    // Default moved deterministically to the lowest-position survivor. The
    // deleted row leaves the partial unique index (deleted_at is set), so
    // promoting another to default can't collide.
    const [heir] = await tx
      .select()
      .from(pages)
      .where(and(eq(pages.userID, userID), isNull(pages.deletedAt)))
      .orderBy(asc(pages.position), asc(pages.createdAt))
      .limit(1);

    if (!heir) return { status: "deleted" as const };

    const [promoted] = await tx
      .update(pages)
      .set({
        isDefault: true,
        revision: sql`${pages.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(pages.id, heir.id))
      .returning();
    return { status: "deleted" as const, nextDefault: promoted };
  });
}

export type ReorderPagesResult =
  | { status: "saved"; pages: PageRow[] }
  | { status: "invalid_order" };

export async function reorderPages(
  userID: string,
  pageIds: string[],
  defaultPageId?: string,
): Promise<ReorderPagesResult> {
  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(pages)
      .where(active(userID))
      .orderBy(asc(pages.position), asc(pages.createdAt));
    const currentById = new Map(current.map((page) => [page.id, page]));

    // This is a replacement order, not a partial patch. Reject stale or foreign
    // lists before changing anything, otherwise an omitted Page could retain a
    // colliding position and an unknown default could leave the user with none.
    if (
      pageIds.length !== current.length ||
      new Set(pageIds).size !== pageIds.length ||
      pageIds.some((id) => !currentById.has(id)) ||
      (defaultPageId !== undefined && !currentById.has(defaultPageId))
    ) {
      return { status: "invalid_order" as const };
    }

    const currentDefault = current.find((page) => page.isDefault)?.id;
    // The first Page repairs accounts affected by older clients that submitted
    // an order-only write which accidentally cleared every default flag.
    const nextDefault = defaultPageId ?? currentDefault ?? current[0]?.id;

    // Clear the old flag first so setting the new default never trips the
    // one-active-default partial unique index mid-transaction. The revision is
    // bumped once below together with any position change.
    if (nextDefault !== currentDefault && currentDefault) {
      await tx
        .update(pages)
        .set({ isDefault: false })
        .where(and(eq(pages.id, currentDefault), active(userID)));
    }

    for (const [position, id] of pageIds.entries()) {
      const previous = currentById.get(id)!;
      const isDefault = id === nextDefault;
      if (previous.position === position && previous.isDefault === isDefault) {
        continue;
      }
      await tx
        .update(pages)
        .set({
          position,
          isDefault,
          revision: sql`${pages.revision} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(pages.id, id), eq(pages.userID, userID), isNull(pages.deletedAt)));
    }

    const saved = await tx
      .select()
      .from(pages)
      .where(active(userID))
      .orderBy(asc(pages.position), asc(pages.createdAt));
    return { pages: saved, status: "saved" as const };
  });
}

// Lazy backfill: existing users have no Page until their first GET. The partial
// unique index makes a concurrent double-create safe — the loser's insert throws
// and we just re-read.
export async function ensureDefaultPage(
  userID: string,
  input: { name: string; config: unknown },
): Promise<PageRow[]> {
  const existing = await listPages(userID);
  if (existing.length > 0) {
    if (existing.some((page) => page.isDefault)) return existing;

    // At most one default is enforced by the partial unique index, but older
    // order-only writes could leave zero. Repair that state deterministically.
    const first = existing[0]!;
    await db
      .update(pages)
      .set({
        isDefault: true,
        revision: sql`${pages.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(pages.id, first.id), active(userID)));
    return listPages(userID);
  }

  try {
    await db.insert(pages).values({
      userID,
      name: input.name,
      config: input.config,
      position: 0,
      isDefault: true,
    } satisfies NewPage);
  } catch {
    // Unique-index race: another request created the default first.
  }

  return listPages(userID);
}
