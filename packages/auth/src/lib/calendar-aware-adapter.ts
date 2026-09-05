import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema, deleteUserWithCalendarRevisions } from "@musubi/db";

/** Intercept SQL deletion, not Better Auth's internal adapter: its before/after
 * hooks and session/account cleanup still surround this operation on all routes.
 * Transaction support remains disabled as before; no adapter call runs while a
 * separate connection holds lifecycle/event locks. */
export const calendarAwareAdapter: ReturnType<typeof drizzleAdapter> = (options) => {
  const adapter = drizzleAdapter(db, { provider: "pg", schema })(options);
  return {
    ...adapter,
    async delete(input) {
      if (input.model !== "user") return adapter.delete(input);
      const [predicate] = input.where;
      if (input.where.length !== 1 || predicate.field !== "id" ||
          (predicate.operator && predicate.operator !== "eq") || typeof predicate.value !== "string") {
        throw new Error("Account deletion requires an exact user identity");
      }
      await deleteUserWithCalendarRevisions(predicate.value);
    },
    async deleteMany(input) {
      // No configured auth flow bulk-deletes users; do not provide a cascade bypass.
      if (input.model === "user") throw new Error("Bulk account deletion is not supported");
      return adapter.deleteMany(input);
    },
  };
};
