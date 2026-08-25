export type NotePart = { text: string; href?: string };

const URL = /\b(?:https?:\/\/|www\.)[^\s<]+/giu;
const TRAILING_PUNCTUATION = /[),.;!?]+$/u;

/** Split plain event notes into text and safe HTTP links for native and web UIs. */
export function noteParts(note: string): NotePart[] {
  const parts: NotePart[] = [];
  let cursor = 0;

  for (const match of note.matchAll(URL)) {
    const start = match.index;
    const linkedText = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = /^www\./iu.test(linkedText) ? `https://${linkedText}` : linkedText;

    try {
      new globalThis.URL(href);
    } catch {
      continue;
    }

    if (start > cursor) parts.push({ text: note.slice(cursor, start) });
    parts.push({ href, text: shortUrlLabel(href) });
    cursor = start + linkedText.length;
  }

  if (cursor < note.length) parts.push({ text: note.slice(cursor) });
  return parts.length ? parts : [{ text: note }];
}

/** Keep the destination intact while displaying only its recognizable host. */
export function shortUrlLabel(url: string): string {
  try {
    return new globalThis.URL(url).hostname.replace(/^www\./iu, "");
  } catch {
    return url;
  }
}
