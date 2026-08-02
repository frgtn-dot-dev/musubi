import type { QueryClient } from "@tanstack/react-query";
import { closeRealtimeStream } from "~/api/realtime";
import { authClient } from "~/auth/auth-client";
import { clearAllSnapshots } from "./persister";
import { clearSessionMarker } from "./session-marker";

/**
 * THE sign-out sequence. Every path that ends a session goes through here.
 *
 * The order is normative (`06-settings-pages-sync.md:167-175`) and the reason is
 * a shared computer: "na sdíleném počítači se nesmí na login screen krátce
 * vyrenderovat data předchozího uživatele". Signing out first — as the workspace
 * used to — leaves a live stream and a full cache behind for however long the
 * clearing takes, and a snapshot on disk for as long as the next person cares to
 * look.
 *
 * Mirrors `apps/client/lib/signOut.ts`, which does the same for the mobile
 * client's SQLite mirror.
 */
export async function signOutAndReset({
  onDone,
  queryClient,
}: {
  /** Where to go once nothing local is left — usually the login route. */
  onDone?: () => void;
  queryClient: QueryClient;
}) {
  closeRealtimeStream();
  // In-flight reads would otherwise land after the clear and refill the cache.
  await queryClient.cancelQueries();
  queryClient.clear();
  await clearAllSnapshots();
  clearSessionMarker();
  // Last, and allowed to fail: with no network the cookie cannot be revoked, but
  // everything on this machine is already gone. The session becomes invalid on
  // the server the next time it is asked, and nothing local survives to render.
  await authClient.signOut().catch(() => undefined);
  onDone?.();
}
