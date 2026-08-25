import { eq } from "drizzle-orm";
import { db, user, userAvatars } from "..";
import { config } from "@musubi/config";
import { ForbiddenError } from "@musubi/types";

// DEV ONLY

export async function resetUsers() {
  if (config.api.environment === "dev") {
    const [result] = await db.delete(user).returning();
    return result;
  } else {
    throw new ForbiddenError(
      "This action is not possible in your environment...",
    );
  }
}

export async function userExists(userID: string) {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.id, userID))
    .limit(1);
  return Boolean(row);
}

export async function getUserAvatar(userID: string) {
  const [row] = await db
    .select()
    .from(userAvatars)
    .where(eq(userAvatars.id, userID));
  return row ?? null;
}

export async function deleteUserAvatar(userID: string) {
  await db.delete(userAvatars).where(eq(userAvatars.id, userID));
}
