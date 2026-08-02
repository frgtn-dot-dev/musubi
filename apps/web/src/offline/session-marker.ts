const KEY = "musubi:last-session";

/**
 * Who was signed in last, and when.
 *
 * Without this an offline start never reaches the calendar: the session fetch
 * fails, so the gate sends the user to the login page and the snapshot behind it
 * is never read. The marker is the answer to "whose snapshot is this" when the
 * server cannot be asked.
 *
 * It holds only what the shell renders — id, name, email. No tokens, ever: the
 * cookie stays the sole credential, and the server decides again the moment
 * there is a network.
 */
export type SessionMarker = {
  email: string;
  id: string;
  name: string;
  savedAt: number;
};

// localStorage, not IndexedDB: this is read on the way to the first paint, and a
// synchronous read of three short strings is exactly what it is good at. The
// calendar data itself is far too big for it, which is why that lives in IDB.
export function readSessionMarker(): SessionMarker | undefined {
  if (typeof window === "undefined") return undefined;

  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<SessionMarker>;

    return typeof parsed.id === "string" &&
      typeof parsed.name === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.savedAt === "number"
      ? (parsed as SessionMarker)
      : undefined;
  } catch {
    return undefined;
  }
}

export function writeSessionMarker(user: {
  email: string;
  id: string;
  name: string;
}) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...user, savedAt: Date.now() } satisfies SessionMarker),
    );
  } catch {
    // Private mode or a full store: the app just loses its offline start.
  }
}

export function clearSessionMarker() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to do — and nothing worth failing a sign-out over.
  }
}
