import { and, eq, sql } from "drizzle-orm";
import { db, NewSettings, userSettings } from "..";

type SettingsValues = Omit<
  NewSettings,
  "id" | "createdAt" | "revision" | "updatedAt"
>;

export async function getUserSettings(userID: string) {
  let [result] = await db.select().from(userSettings).where(eq(userSettings.id, userID));

  if (!result) {
    const [inserted] = await db
      .insert(userSettings)
      .values({ id: userID })
      .onConflictDoNothing({ target: userSettings.id })
      .returning();
    if (inserted) return inserted;

    // Another request inserted the one-per-user row after our select.
    [result] = await db.select().from(userSettings).where(eq(userSettings.id, userID));
  }

  return result;
}

export async function saveUserSettings(userID: string, settings: SettingsValues) {
  // Settings may be saved before any GET materializes the row. One upsert makes
  // concurrent first-save/first-read requests converge on the same user row.
  const [saved] = await db
    .insert(userSettings)
    .values({ ...settings, id: userID })
    .onConflictDoUpdate({
      target: userSettings.id,
      set: {
        ...settings,
        revision: sql`${userSettings.revision} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();
  return saved;
}

export async function patchUserSettings(
  userID: string,
  baseRevision: number,
  patch: Partial<SettingsValues>,
) {
  await getUserSettings(userID);
  const [saved] = await db
    .update(userSettings)
    .set({
      ...patch,
      revision: sql`${userSettings.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userSettings.id, userID),
        eq(userSettings.revision, baseRevision),
      ),
    )
    .returning();

  if (saved) {
    return { conflict: false as const, settings: saved };
  }

  return {
    conflict: true as const,
    settings: await getUserSettings(userID),
  };
}
