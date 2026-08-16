import { subscribePush, unsubscribePush } from "~/api/resources";

/**
 * Getting this browser onto the server's push list, and off it again.
 *
 * Everything here is best-effort and reversible. Push is an improvement on
 * in-tab reminders, never a prerequisite: a browser with no service worker
 * support, a denied permission, or a server with no VAPID keys all end up in
 * the same place, which is the app ringing for itself while it is open.
 */

const SERVICE_WORKER_URL = "/app/sw.js";

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

/**
 * VAPID keys travel as base64url; `applicationServerKey` wants raw bytes.
 *
 * Hand-rolled rather than pulled from a library: it is six lines, and adding a
 * dependency to the browser bundle for one base64 variant is not a trade.
 */
function decodeKey(base64Url: string) {
  const padded = base64Url.padEnd(
    base64Url.length + ((4 - (base64Url.length % 4)) % 4),
    "=",
  );
  const binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function registration() {
  return navigator.serviceWorker.register(SERVICE_WORKER_URL, {
    scope: "/app/",
  });
}

/** Is this browser already on the list? Cheap enough to ask on every load. */
export async function currentSubscription() {
  if (!pushSupported()) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration("/app/");
    return (await existing?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/**
 * Subscribe, assuming permission is already granted.
 *
 * The permission prompt belongs where the user is switching reminders ON, not
 * here — see `requestReminderPermission`. This function is the plumbing that
 * runs after they said yes.
 */
export async function subscribeToPush(publicKey: string) {
  if (!pushSupported()) return false;

  try {
    const worker = await registration();
    await navigator.serviceWorker.ready;

    const subscription =
      (await worker.pushManager.getSubscription()) ??
      (await worker.pushManager.subscribe({
        applicationServerKey: decodeKey(publicKey),
        // Chrome refuses anything else, and it is the honest setting: every
        // push this server sends carries a notification the user will see.
        userVisibleOnly: true,
      }));

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.auth || !json.keys?.p256dh) return false;

    await subscribePush({
      endpoint: json.endpoint,
      keys: { auth: json.keys.auth, p256dh: json.keys.p256dh },
    });
    return true;
  } catch {
    // A blocked worker, a push service that will not issue an endpoint, an
    // offline tab. None of it is worth an error in the user's face: the in-tab
    // reminders they already had keep working.
    return false;
  }
}

/** Come off the list, on this browser, and tell the server so it stops sending. */
export async function unsubscribeFromPush() {
  const subscription = await currentSubscription();
  if (!subscription) return;

  const endpoint = subscription.endpoint;
  // Server first: a browser that unsubscribed locally but stayed on the list
  // would have the server pushing at a dead endpoint until it 410s.
  await unsubscribePush({ endpoint }).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}
