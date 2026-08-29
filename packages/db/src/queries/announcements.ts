import { desc, eq, gt, like } from "drizzle-orm";
import { announcements, db, type NewAnnouncement } from "..";

export type AnnouncementRow = typeof announcements.$inferSelect;

/** Všechny, od nejnovější. Pro admin panel. */
export function listAnnouncements(): Promise<AnnouncementRow[]> {
  return db.select().from(announcements).orderBy(desc(announcements.id));
}

/**
 * Co uživatel ještě neviděl, od nejnovější.
 *
 * `afterId` je prázdný řetězec u účtu, který ještě nic neviděl. Ten by tímhle
 * dostal úplně všechno — proto o tenhle případ NEŽÁDÁ handler, ale ošetřuje ho
 * (viz `createGetAnnouncementsHandler`): nový účet, i každý stávající v den
 * nasazení, dostane prázdný seznam a jen si posune značku.
 */
export function listAnnouncementsAfter(
  afterId: string,
): Promise<AnnouncementRow[]> {
  return db
    .select()
    .from(announcements)
    .where(gt(announcements.id, afterId))
    .orderBy(desc(announcements.id));
}

/** Obsazená id daného dne — vstup pro `mintAnnouncementId`. */
export async function listAnnouncementIdsOn(dateKey: string): Promise<string[]> {
  const rows = await db
    .select({ id: announcements.id })
    .from(announcements)
    .where(like(announcements.id, `${dateKey}%`));
  return rows.map((row) => row.id);
}

export async function insertAnnouncement(
  values: NewAnnouncement,
): Promise<AnnouncementRow> {
  const [inserted] = await db.insert(announcements).values(values).returning();
  return inserted;
}

export async function updateAnnouncement(
  id: string,
  values: Partial<NewAnnouncement>,
): Promise<AnnouncementRow | undefined> {
  const [updated] = await db
    .update(announcements)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(announcements.id, id))
    .returning();
  return updated;
}

export async function deleteAnnouncement(id: string): Promise<boolean> {
  const deleted = await db
    .delete(announcements)
    .where(eq(announcements.id, id))
    .returning({ id: announcements.id });
  return deleted.length > 0;
}
