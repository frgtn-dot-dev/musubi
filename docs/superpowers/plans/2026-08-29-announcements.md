# Announcements — implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Majitel serveru napíše ve webovém admin panelu zprávu o novinkách; každému přihlášenému uživateli se ukáže jednou, v modalu, na webu i v mobilní appce, a jen tehdy, když jeho klient dosáhl verze, které se zpráva týká.

**Architecture:** Zprávy leží v nové tabulce `announcements`, jejich `id` je datum a zároveň řazení. Server vrací jen ty novější než značka `lastSeenAnnouncement` v uživatelském nastavení; podle `minVersion` filtruje až **klient**, protože svoji verzi zná jen on. Výběrová pravidla i rozsekání textu na odkazy jsou čisté funkce v `@musubi/types`, aby web a mobil nesdílely jen data, ale i to subtilní rozhodování.

**Tech Stack:** TypeScript, Zod, Drizzle ORM + Postgres, Express, React + TanStack Router/Query (web), Expo + React Native (client). Testy: `node:assert` přes `tsx` v `types`/`db`/`config`/`api`, Vitest ve `web`/`client`. **Žádná nová závislost.**

**Spec:** `docs/superpowers/specs/2026-08-29-announcements-design.md`

## Global Constraints

- **Žádná nová závislost** v žádném balíčku. Splitter odkazů i modaly se staví z toho, co v repu je.
- **Nová UI primitiva nevznikají.** Web skládá z `~/ui/Dialog`, `~/ui/Button`, `~/ui/Field`, `~/ui/Row`, `~/ui/SettingsSection`, `~/ui/ConfirmationDialog`. Client z `@/components/ui/ModalPortal`, `@/components/ui/Btn`, `@/constants/theme`.
- **Radix zůstává uvnitř `apps/web/src/ui`.** Feature kód ho neimportuje.
- **`MIN_CLIENT_VERSION` se nezvedá.** Vše, co přibývá do `SettingsSchema` a `SettingsPatchSchema`, je `.optional()`.
- **Formát `id`:** `YYYY-MM-DD`, při druhé zprávě téhož dne `YYYY-MM-DD-2`, pak `-3`. Regex `/^\d{4}-\d{2}-\d{2}(-\d+)?$/`.
- **Autolinkují se jen `http://` a `https://`.** Nic jiného se neotvírá.
- **Porovnávání verzí vždy `compareVersions` z `@musubi/types`.** Nikdy porovnání řetězců — „0.1.10" se řadí před „0.1.9".
- **Nové API cesty musí být zaregistrované v `apps/api/src/index.ts`**, jinak neprojde `node scripts/check-routes.mjs`.
- **Nové testovací soubory se musí přidat do `test` skriptu svého balíčku** (`packages/*/package.json`, `apps/api/package.json`) — jinak je CI nespustí.
- Text v UI je anglicky (jako zbytek produktu). Komentáře v kódu anglicky. Tento plán a spec jsou česky.

---

### Task 1: Typy announcementu, splitter odkazů a výběrová pravidla

Čisté funkce, žádné I/O. Web i client z nich budou brát totéž rozhodování, takže se ta subtilní pravidla nenapíšou dvakrát.

**Files:**
- Create: `packages/types/src/announcement.ts`
- Create: `packages/types/src/announcement.test.ts`
- Modify: `packages/types/src/index.ts` (přidat export)
- Modify: `packages/types/src/wire.ts` (zapsat dokument do `WIRE_CONTRACT`)
- Modify: `packages/types/contracts/wire.json` (přes `pnpm wire:snapshot`)
- Modify: `packages/types/package.json:11` (přidat test do skriptu)

**Interfaces:**
- Consumes: `compareVersions` z `packages/types/src/version.ts`
- Produces:
  - `AnnouncementSchema`, `type Announcement = { id: string; title: string; body: string; minVersion?: string | null }`
  - `AnnouncementInputSchema`, `type AnnouncementInput = { title: string; body: string; minVersion?: string | null }`
  - `AnnouncementsResponseSchema`, `type AnnouncementsResponse = { announcements: Announcement[]; isAdmin: boolean; markTo?: string }`
  - `mintAnnouncementId(dateKey: string, taken: readonly string[]): string`
  - `type AnnouncementSegment = { type: "text"; value: string } | { type: "link"; value: string; url: string }`
  - `splitAnnouncementText(text: string): AnnouncementSegment[]`
  - `announcementParagraphs(body: string): AnnouncementSegment[][]`
  - `pendingAnnouncements(announcements: readonly Announcement[], clientVersion: string): Announcement[]` — vrací seřazené od nejnovější
  - `newestAnnouncementId(announcements: readonly Announcement[]): string | undefined`

- [ ] **Step 1: Napsat padající test**

Vytvoř `packages/types/src/announcement.test.ts`:

```ts
import assert from "node:assert/strict";
import {
  announcementParagraphs,
  AnnouncementsResponseSchema,
  mintAnnouncementId,
  newestAnnouncementId,
  pendingAnnouncements,
  splitAnnouncementText,
} from "./announcement";

// --- mintAnnouncementId ---
assert.equal(mintAnnouncementId("2026-08-29", []), "2026-08-29");
assert.equal(mintAnnouncementId("2026-08-29", ["2026-08-29"]), "2026-08-29-2");
assert.equal(
  mintAnnouncementId("2026-08-29", ["2026-08-29", "2026-08-29-2"]),
  "2026-08-29-3",
);
// Cizí datum v seznamu nic neblokuje.
assert.equal(mintAnnouncementId("2026-08-29", ["2026-08-28"]), "2026-08-29");

// --- splitAnnouncementText ---
assert.deepEqual(splitAnnouncementText("just words"), [
  { type: "text", value: "just words" },
]);

assert.deepEqual(
  splitAnnouncementText("see https://musubi.pro today"),
  [
    { type: "text", value: "see " },
    { type: "link", url: "https://musubi.pro", value: "https://musubi.pro" },
    { type: "text", value: " today" },
  ],
);

// Tečka na konci věty není součástí odkazu.
assert.deepEqual(
  splitAnnouncementText("go to https://musubi.pro."),
  [
    { type: "text", value: "go to " },
    { type: "link", url: "https://musubi.pro", value: "https://musubi.pro" },
    { type: "text", value: "." },
  ],
);

// Ani uzavírací závorka.
assert.deepEqual(
  splitAnnouncementText("(https://musubi.pro)"),
  [
    { type: "text", value: "(" },
    { type: "link", url: "https://musubi.pro", value: "https://musubi.pro" },
    { type: "text", value: ")" },
  ],
);

// Odkaz na začátku i na konci, bez prázdných text úseků okolo.
assert.deepEqual(splitAnnouncementText("https://musubi.pro"), [
  { type: "link", url: "https://musubi.pro", value: "https://musubi.pro" },
]);

// Bezpečnostní hranice: obsah píše majitel serveru, ale nic než http(s) se
// nesmí stát klikatelným — javascript: URL v modalu je spouštěč skriptu.
assert.deepEqual(splitAnnouncementText("javascript:alert(1)"), [
  { type: "text", value: "javascript:alert(1)" },
]);
assert.deepEqual(splitAnnouncementText("data:text/html,<b>x</b>"), [
  { type: "text", value: "data:text/html,<b>x</b>" },
]);

// --- announcementParagraphs ---
assert.deepEqual(announcementParagraphs("first\n\nsecond"), [
  [{ type: "text", value: "first" }],
  [{ type: "text", value: "second" }],
]);
// Jeden zlom řádku odstavec netvoří.
assert.deepEqual(announcementParagraphs("one\ntwo"), [
  [{ type: "text", value: "one\ntwo" }],
]);
// Tři a víc prázdných řádků nedělá prázdné odstavce.
assert.deepEqual(announcementParagraphs("a\n\n\n\nb"), [
  [{ type: "text", value: "a" }],
  [{ type: "text", value: "b" }],
]);

// --- pendingAnnouncements ---
const all = [
  { id: "2026-08-01", title: "old", body: "x", minVersion: null },
  { id: "2026-08-20", title: "gated", body: "x", minVersion: "0.1.7" },
  { id: "2026-08-10", title: "open", body: "x", minVersion: "0.1.6" },
];

// Klient na 0.1.6 nedostane zprávu určenou pro 0.1.7.
assert.deepEqual(
  pendingAnnouncements(all, "0.1.6").map((a) => a.id),
  ["2026-08-10", "2026-08-01"],
);

// Po aktualizaci na 0.1.7 ji dostane, a jako nejnovější.
assert.deepEqual(
  pendingAnnouncements(all, "0.1.7").map((a) => a.id),
  ["2026-08-20", "2026-08-10", "2026-08-01"],
);

// Číselné porovnání: 0.1.10 je novější než 0.1.9, jako řetězce by to bylo naopak.
assert.deepEqual(
  pendingAnnouncements(
    [{ id: "2026-08-01", title: "t", body: "x", minVersion: "0.1.10" }],
    "0.1.9",
  ),
  [],
);
assert.equal(
  pendingAnnouncements(
    [{ id: "2026-08-01", title: "t", body: "x", minVersion: "0.1.10" }],
    "0.1.10",
  ).length,
  1,
);

// --- AnnouncementsResponseSchema ---
// `markTo` musí schématem projít: bez něj by ho mobil (který parsuje přes
// readWire) zahodil a první pohled by se opakoval při každém startu.
assert.equal(
  AnnouncementsResponseSchema.parse({
    announcements: [],
    isAdmin: false,
    markTo: "2026-08-29",
  }).markTo,
  "2026-08-29",
);
// A chybět smí — běžná odpověď ho neposílá.
assert.equal(
  AnnouncementsResponseSchema.parse({ announcements: [], isAdmin: false })
    .markTo,
  undefined,
);

// --- newestAnnouncementId ---
assert.equal(newestAnnouncementId(all), "2026-08-20");
assert.equal(newestAnnouncementId([]), undefined);
// Přípona téhož dne se řadí za holé datum.
assert.equal(
  newestAnnouncementId([
    { id: "2026-08-29", title: "t", body: "x", minVersion: null },
    { id: "2026-08-29-2", title: "t", body: "x", minVersion: null },
  ]),
  "2026-08-29-2",
);

console.log("announcement tests passed");
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `pnpm --filter @musubi/types exec tsx src/announcement.test.ts`
Expected: FAIL — `Cannot find module './announcement'`

- [ ] **Step 3: Napsat implementaci**

Vytvoř `packages/types/src/announcement.ts`:

```ts
import { z } from "zod";
import { compareVersions } from "./version";

/**
 * `YYYY-MM-DD`, s příponou `-2`, `-3` pro druhou a další zprávu téhož dne.
 *
 * Datum v id není ozdoba: je to zároveň řazení, takže "novější než poslední
 * viděná" je porovnání řetězců a tabulka nepotřebuje druhý sloupec na pořadí.
 * Formát se lexikograficky řadí správně jen díky nulám (`08`, ne `8`).
 */
export const ANNOUNCEMENT_ID_PATTERN = /^\d{4}-\d{2}-\d{2}(-\d+)?$/;

export const AnnouncementSchema = z.object({
  id: z.string().regex(ANNOUNCEMENT_ID_PATTERN),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  /**
   * Nejstarší verze klienta, které se zpráva týká. `null`/chybějící = všem.
   * Filtruje se podle ní na KLIENTOVI: server neví, komu odpovídá.
   */
  minVersion: z.string().max(32).nullish(),
});

export type Announcement = z.infer<typeof AnnouncementSchema>;

/** Co posílá admin panel při vytvoření nebo opravě. `id` přiděluje server. */
export const AnnouncementInputSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  minVersion: z.string().max(32).nullish(),
});

export type AnnouncementInput = z.infer<typeof AnnouncementInputSchema>;

export const AnnouncementsResponseSchema = z.object({
  announcements: z.array(AnnouncementSchema),
  /**
   * Jede s odpovědí, protože tenhle dokument si stahuje každý přihlášený klient
   * při startu tak jako tak — web podle něj ukáže odkaz na panel bez dalšího
   * requestu. Autoritou zůstávají admin endpointy samy.
   */
  isAdmin: z.boolean(),
  /**
   * Posílá se JEN při prvním pohledu — účtu, který ještě nic neviděl. Znamená
   * "nic neukazuj, jen si posuň značku sem". Bez toho by nový účet (a v den
   * nasazení každý stávající) dostal modal se všemi novinkami za celou
   * historii produktu.
   *
   * Volitelné, takže starší klient, který o něm neví, ho prostě ignoruje.
   */
  markTo: z.string().max(64).optional(),
});

export type AnnouncementsResponse = z.infer<typeof AnnouncementsResponseSchema>;

/**
 * Volné id pro dnešní datum.
 *
 * Přiděluje ho server, ne autor: klient by musel znát existující id, aby uhodl
 * volné, a dva otevřené panely by si vybraly totéž.
 */
export function mintAnnouncementId(
  dateKey: string,
  taken: readonly string[],
): string {
  if (!taken.includes(dateKey)) return dateKey;
  for (let suffix = 2; suffix <= taken.length + 2; suffix += 1) {
    const candidate = `${dateKey}-${suffix}`;
    if (!taken.includes(candidate)) return candidate;
  }
  // Nedosažitelné: nejvýš `taken.length + 1` kandidátů může být obsazených.
  throw new Error(`No free announcement id for ${dateKey}`);
}

export type AnnouncementSegment =
  | { type: "text"; value: string }
  | { type: "link"; url: string; value: string };

/**
 * Jen http(s). Obsah píše majitel serveru, ale `javascript:` nebo `data:` URL
 * v modalu je spouštěč skriptu, ne odkaz — takže se nikdy nestanou klikatelnými
 * a zůstanou obyčejným textem.
 */
const LINK_PATTERN = /https?:\/\/[^\s<>"']+/g;

/** Tečka na konci věty ani uzavírací závorka nepatří do URL. */
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

/** Rozseká jeden odstavec na úseky textu a odkazů. */
export function splitAnnouncementText(text: string): AnnouncementSegment[] {
  const segments: AnnouncementSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(LINK_PATTERN)) {
    const start = match.index ?? 0;
    const url = match[0].replace(TRAILING_PUNCTUATION, "");
    // Celý match byl interpunkce po `https://`? Pak to není odkaz.
    if (!url || url === "http://" || url === "https://") continue;

    if (start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, start) });
    }
    segments.push({ type: "link", url, value: url });
    cursor = start + url.length;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  return segments;
}

/** Prázdný řádek dělí odstavce; jeden zlom řádku ne. */
export function announcementParagraphs(body: string): AnnouncementSegment[][] {
  return body
    .split(/\n[ \t]*\n\s*/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map(splitAnnouncementText);
}

/**
 * Co tomuhle klientovi zbývá ukázat, od nejnovější.
 *
 * Server už odfiltroval, co uživatel viděl. Zbývá `minVersion`, a to umí jen
 * klient: server neví, jaká verze se ho ptá. Co tady vypadne, zůstane
 * nevyřízené a vyskočí po aktualizaci — to je celý mechanismus "novinky se
 * propagují při aktualizování verze".
 */
export function pendingAnnouncements(
  announcements: readonly Announcement[],
  clientVersion: string,
): Announcement[] {
  return announcements
    .filter(
      (announcement) =>
        !announcement.minVersion ||
        compareVersions(clientVersion, announcement.minVersion) >= 0,
    )
    .sort((left, right) => (left.id < right.id ? 1 : left.id > right.id ? -1 : 0));
}

/** Nejvyšší id ze seznamu — kam se posune značka po zavření modalu. */
export function newestAnnouncementId(
  announcements: readonly Announcement[],
): string | undefined {
  let newest: string | undefined;
  for (const announcement of announcements) {
    if (newest === undefined || announcement.id > newest) newest = announcement.id;
  }
  return newest;
}
```

- [ ] **Step 4: Napojit export a test skript**

V `packages/types/src/index.ts` přidej řádek za `export * from "./settings";`:

```ts
export * from "./announcement";
```

V `packages/types/package.json` uprav `test` skript (řádek 11) tak, aby začínal novým souborem:

```json
"test": "tsx src/announcement.test.ts && tsx src/event_page.test.ts && tsx src/reminder_options.test.ts && tsx src/settings.test.ts && tsx src/wire.test.ts"
```

- [ ] **Step 5: Zapsat dokument do wire kontraktu**

Mobil parsuje odpověď přes `readWire` proti schématu, se kterým byl zkompilovaný
— je to tedy dokument, který kříží drát, a patří do kontraktu. Jinak by ho
`docs/releasing.md` nehlídal a mohl by se pod rukama zúžit.

V `packages/types/src/wire.ts` přidej import a položku do `WIRE_CONTRACT`
(drž abecední pořadí, tedy hned na začátek objektu):

```ts
import { AnnouncementsResponseSchema } from "./announcement";
```

```ts
  AnnouncementsResponse: {
    direction: "read",
    schema: AnnouncementsResponseSchema,
  },
```

- [ ] **Step 6: Re-baseline kontraktu a ověřit diff**

Run: `pnpm wire:snapshot`
Then: `git diff packages/types/contracts/wire.json`

Expected: přibyl **nový** dokument `AnnouncementsResponse`. Přidání dokumentu
není rozbíjející změna. Pokud diff ukazuje, že se u jiného dokumentu něco
odebralo nebo zpřísnilo, zastav se — to by znamenalo zvednout
`MIN_CLIENT_VERSION`, což tenhle plán nechce.

- [ ] **Step 7: Spustit testy a ověřit, že prochází**

Run: `pnpm --filter @musubi/types test`
Expected: PASS, včetně `wire.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/announcement.ts packages/types/src/announcement.test.ts packages/types/src/index.ts packages/types/src/wire.ts packages/types/contracts/wire.json packages/types/package.json
git commit -m "feat(types): announcement shape, link splitting and selection rules"
```

---

### Task 2: Značka `lastSeenAnnouncement` v uživatelském nastavení

Aditivní, volitelné pole v obou schématech a nový sloupec. Pozor: sloupec je `NOT NULL DEFAULT ''`, ne nullable — prázdný řetězec znamená „nikdy nic neviděl" a schéma pak nemusí řešit `null` vs `undefined`.

**Files:**
- Modify: `packages/types/src/settings.ts` (`SettingsSchema` a `SettingsPatchSchema`)
- Modify: `packages/types/src/settings.test.ts` (přidat test)
- Modify: `packages/db/src/schema.ts:155-201` (`userSettings`)
- Create: `packages/db/drizzle/00XX_*.sql` (vygeneruje drizzle-kit)
- Modify: `packages/types/contracts/wire.json` (přes `pnpm wire:snapshot`)

**Interfaces:**
- Consumes: nic z Tasku 1
- Produces: `Settings["lastSeenAnnouncement"]?: string`, `SettingsPatch["lastSeenAnnouncement"]?: string`, sloupec `user_settings.last_seen_announcement`

- [ ] **Step 1: Napsat padající test**

Na konec `packages/types/src/settings.test.ts` přidej (přizpůsob se stylu, který v souboru už je — přečti si ho nejdřív):

```ts
// Značka poslední viděné zprávy. Volitelná ze stejného důvodu jako `onboarded`:
// starší klient, který uloží celý dokument, ji nesmí shodit zpátky.
assert.equal(
  SettingsPatchSchema.parse({ lastSeenAnnouncement: "2026-08-29" })
    .lastSeenAnnouncement,
  "2026-08-29",
);

// Patch jen s touto značkou je platný patch (není prázdný).
assert.doesNotThrow(() =>
  SettingsPatchSchema.parse({ lastSeenAnnouncement: "2026-08-29-2" }),
);

// Nový uživatel: prázdný řetězec je platná hodnota "nikdy nic neviděl".
assert.equal(
  SettingsPatchSchema.parse({ lastSeenAnnouncement: "" }).lastSeenAnnouncement,
  "",
);
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `pnpm --filter @musubi/types exec tsx src/settings.test.ts`
Expected: FAIL — `lastSeenAnnouncement` je stripnuté (schéma ho nezná), takže `.parse` na prázdném patchi hodí „Settings patch cannot be empty."

- [ ] **Step 3: Přidat pole do obou schémat**

V `packages/types/src/settings.ts`, do `SettingsSchema` za `notificationEmails`:

```ts
  // Nejnovější zpráva o novinkách, kterou uživatel viděl. Prázdný řetězec =
  // ještě žádnou; klient v tom případě modal NEUKÁŽE a jen si značku nastaví,
  // aby nový účet (a v den nasazení každý stávající) nedostal celou historii
  // produktu naráz. Volitelné, aby ji starší klient ukládající celý dokument
  // nemohl shodit zpátky.
  lastSeenAnnouncement: z.string().max(64).optional(),
```

A do `SettingsPatchSchema` (drž abecední pořadí, tedy hned za `defaultReminder`):

```ts
    lastSeenAnnouncement: z.string().max(64).optional(),
```

- [ ] **Step 4: Přidat sloupec do tabulky**

V `packages/db/src/schema.ts`, do `userSettings` za `notificationEmails`:

```ts
  // Nejnovější zpráva o novinkách, kterou uživatel viděl. NOT NULL s prázdným
  // výchozím řetězcem, ne nullable: "" a NULL by znamenaly totéž, a jedna
  // podoba prázdna se zpracovává líp než dvě.
  lastSeenAnnouncement: text("last_seen_announcement").notNull().default(""),
```

- [ ] **Step 5: Vygenerovat migraci**

Run: `pnpm --filter @musubi/db exec drizzle-kit generate`
Expected: nový soubor `packages/db/drizzle/00XX_*.sql` obsahující
`ALTER TABLE "user_settings" ADD COLUMN "last_seen_announcement" text DEFAULT '' NOT NULL;`

Otevři vygenerovaný soubor a ověř, že obsahuje **jen** tenhle `ALTER TABLE` a nic dalšího. Pokud drizzle-kit nabídne přejmenování místo přidání, odmítni a vyber vytvoření nového sloupce.

- [ ] **Step 6: Re-baseline wire kontraktu**

Run: `pnpm wire:snapshot`
Then: `git diff packages/types/contracts/wire.json`

Expected: `Settings` a `PatchSettingsRequest` získaly volitelnou property `lastSeenAnnouncement`. **Nic se neodebralo a nic nepřestalo být volitelné.** Pokud diff ukazuje odebrání nebo zpřísnění, zastav se — to by znamenalo zvednout `MIN_CLIENT_VERSION`, což tenhle plán nechce.

- [ ] **Step 7: Spustit testy a ověřit, že prochází**

Run: `pnpm --filter @musubi/types test && pnpm --filter @musubi/db test`
Expected: PASS, včetně `wire.test.ts`

- [ ] **Step 8: Commit**

```bash
git add packages/types/src/settings.ts packages/types/src/settings.test.ts packages/types/contracts/wire.json packages/db/src/schema.ts packages/db/drizzle
git commit -m "feat(settings): remember the newest announcement a user has seen"
```

---

### Task 3: Tabulka `announcements` a dotazy

**Files:**
- Modify: `packages/db/src/schema.ts` (nová tabulka, na konec souboru)
- Create: `packages/db/src/queries/announcements.ts`
- Modify: `packages/db/src/index.ts:19` (přidat export)
- Create: `packages/db/drizzle/00XX_*.sql` (vygeneruje drizzle-kit)

**Interfaces:**
- Consumes: `db`, `NewAnnouncement` z `packages/db/src/index.ts`
- Produces:
  - `announcements` (Drizzle tabulka), `type NewAnnouncement`
  - `listAnnouncements(): Promise<AnnouncementRow[]>` — všechny, od nejnovější
  - `listAnnouncementsAfter(afterId: string): Promise<AnnouncementRow[]>` — `id > afterId`, od nejnovější
  - `listAnnouncementIdsOn(dateKey: string): Promise<string[]>`
  - `insertAnnouncement(values: NewAnnouncement): Promise<AnnouncementRow>`
  - `updateAnnouncement(id: string, values: Partial<NewAnnouncement>): Promise<AnnouncementRow | undefined>`
  - `deleteAnnouncement(id: string): Promise<boolean>`
  - kde `AnnouncementRow = typeof announcements.$inferSelect`

Dotazy nemají vlastní unit testy: `packages/db` testuje jen čisté funkce (`schema.test.ts`, `queries/settings.test.ts`) a databázi v CI nemá. Pokryté jsou přes handlery v Tasku 5, kterým se vstřikují falešné implementace.

- [ ] **Step 1: Přidat tabulku do schématu**

Na konec `packages/db/src/schema.ts`:

```ts
/**
 * Zprávy o novinkách, které majitel serveru píše v admin panelu.
 *
 * `id` je datum (`2026-08-29`, druhá zpráva téhož dne `2026-08-29-2`) a zároveň
 * řazení — formát se lexikograficky řadí správně, takže "novější než poslední
 * viděná" je porovnání řetězců a druhý sloupec na pořadí není potřeba.
 */
export const announcements = pgTable("announcements", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  // Nejstarší verze klienta, které se zpráva týká. NULL = všem. Filtruje se
  // podle ní na klientovi; server neví, jaká verze se ho ptá.
  minVersion: text("min_version"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type NewAnnouncement = typeof announcements.$inferInsert;
```

- [ ] **Step 2: Vygenerovat migraci**

Run: `pnpm --filter @musubi/db exec drizzle-kit generate`
Expected: nový `.sql` s `CREATE TABLE "announcements"`. Otevři a zkontroluj, že nic jiného nemění.

- [ ] **Step 3: Napsat dotazy**

Vytvoř `packages/db/src/queries/announcements.ts`:

```ts
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
```

- [ ] **Step 4: Přidat export**

V `packages/db/src/index.ts` za `export * from './queries/federation';`:

```ts
export * from './queries/announcements';
```

- [ ] **Step 5: Ověřit, že to kompiluje**

Run: `pnpm --filter @musubi/db test && pnpm exec tsc -p apps/api/tsconfig.json --noEmit --skipLibCheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/schema.ts packages/db/src/queries/announcements.ts packages/db/src/index.ts packages/db/drizzle
git commit -m "feat(db): announcements table and queries"
```

---

### Task 4: `ADMIN_EMAILS` a middleware `requireAdmin`

V repu dosud neexistuje pojem admina serveru. Tohle je nejmenší dostatečné primitivum — seznam e-mailů v env, žádná migrace, žádné UI na udělování práv.

**Files:**
- Modify: `packages/config/src/index.ts` (`SecurityConfig` typ ~ř. 157, `securityConfig` ~ř. 329)
- Modify: `packages/config/src/index.test.ts` (přidat test)
- Create: `apps/api/src/middleware/require_admin.ts`
- Create: `apps/api/src/middleware/require_admin.test.ts`
- Modify: `apps/api/package.json:8` (přidat test do skriptu)
- Modify: `.env.example` — pokud v repu existuje; ověř `ls -a | grep env`, a když ano, přidej řádek `ADMIN_EMAILS=`

**Interfaces:**
- Consumes: `config` z `@musubi/config`, `ForbiddenError` z `@musubi/types`
- Produces:
  - `parseAdminEmails(raw: string | undefined): string[]` (export z `@musubi/config`, kvůli testovatelnosti)
  - `config.security.adminEmails: string[]` — normalizované na malá písmena, ořezané
  - `isAdminEmail(email: string | null | undefined): boolean`
  - `requireAdmin(req, res, next)` — Express middleware, běží **za** `requireAuth`

- [ ] **Step 1: Napsat padající testy**

Do `packages/config/src/index.test.ts` přidej dovnitř `main()`, mezi existující asserty (a doplň `parseAdminEmails` do destrukturovaného importu `await import("./index")`):

```ts
  // Admin serveru je seznam e-mailů v env. Normalizuje se, protože e-mail
  // z Google sign-inu dorazí v jiném psaní než ho admin napsal do .env.
  assert.deepEqual(parseAdminEmails("a@example.com,b@example.com"), [
    "a@example.com",
    "b@example.com",
  ]);
  assert.deepEqual(parseAdminEmails(" A@Example.COM , b@example.com "), [
    "a@example.com",
    "b@example.com",
  ]);
  // Nenastavené nebo prázdné = tenhle server nemá admina.
  assert.deepEqual(parseAdminEmails(undefined), []);
  assert.deepEqual(parseAdminEmails(""), []);
  assert.deepEqual(parseAdminEmails(",  ,"), []);
```

Vytvoř `apps/api/src/middleware/require_admin.test.ts`:

```ts
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createRequireAdmin, isAdminEmailIn } from "./require_admin";

// --- isAdminEmailIn ---
const admins = ["owner@example.com"];
assert.equal(isAdminEmailIn(admins, "owner@example.com"), true);
// Psaní velkých písmen ani mezery kolem nesmí rozhodovat.
assert.equal(isAdminEmailIn(admins, "Owner@Example.com"), true);
assert.equal(isAdminEmailIn(admins, " owner@example.com "), true);
assert.equal(isAdminEmailIn(admins, "someone@example.com"), false);
assert.equal(isAdminEmailIn(admins, undefined), false);
assert.equal(isAdminEmailIn(admins, null), false);
// Server bez adminů neuzná nikoho — prázdný seznam nesmí znamenat "všichni".
assert.equal(isAdminEmailIn([], "owner@example.com"), false);

// --- middleware ---
const response = {} as Response;

function callsNext(email: string | undefined, adminList: string[]) {
  let called = false;
  createRequireAdmin(adminList)(
    { user: email ? { email } : undefined } as Request,
    response,
    () => {
      called = true;
    },
  );
  return called;
}

assert.equal(callsNext("owner@example.com", admins), true);

assert.throws(
  () => callsNext("someone@example.com", admins),
  (error: unknown) => error instanceof Error && error.message === "Admin only",
);

// Nepřihlášený se sem nemá jak dostat (requireAdmin běží za requireAuth),
// ale kdyby se pořadí někdy prohodilo, odmítnout je bezpečnější než spadnout.
assert.throws(
  () => callsNext(undefined, admins),
  (error: unknown) => error instanceof Error && error.message === "Admin only",
);

console.log("require_admin tests passed");
```

- [ ] **Step 2: Spustit testy a ověřit, že padají**

Run: `pnpm --filter @musubi/api exec tsx src/middleware/require_admin.test.ts`
Expected: FAIL — `Cannot find module './require_admin'`

- [ ] **Step 3: Přidat konfiguraci**

V `packages/config/src/index.ts` do typu `SecurityConfig` (za `federationAllowPrivateHosts`):

```ts
  // Kdo smí psát zprávy o novinkách. Seznam e-mailů, ne role v databázi:
  // majitel serveru už svůj .env vlastní, takže tohle se bootstrapuje samo a
  // nestojí to migraci ani UI na udělování práv. Prázdné = server bez admina,
  // a admin endpointy pak neuznají nikoho.
  adminEmails: string[];
```

Nad `const securityConfig` přidej exportovanou čistou funkci:

```ts
export function parseAdminEmails(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}
```

A do `securityConfig` (~ř. 329):

```ts
  adminEmails: parseAdminEmails(process.env.ADMIN_EMAILS),
```

- [ ] **Step 4: Napsat middleware**

Vytvoř `apps/api/src/middleware/require_admin.ts`:

```ts
import { config } from "@musubi/config";
import { ForbiddenError } from "@musubi/types";
import type { NextFunction, Request, Response } from "express";

/**
 * Je tenhle e-mail na seznamu adminů?
 *
 * Obě strany se normalizují: e-mail ze sociálního přihlášení dorazí v jiném
 * psaní, než jaký si majitel serveru napsal do `.env`, a rozhodovat o právech
 * podle velikosti písmen by byla past.
 *
 * Prázdný seznam neuzná nikoho. "Server bez adminů" musí znamenat, že admin
 * endpointy jsou zavřené — ne otevřené všem.
 */
export function isAdminEmailIn(
  adminEmails: readonly string[],
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return adminEmails.includes(email.trim().toLowerCase());
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return isAdminEmailIn(config.security.adminEmails, email);
}

/** Testovatelná varianta — seznam se vstříkne místo čtení konfigurace. */
export function createRequireAdmin(adminEmails: readonly string[]) {
  return function requireAdminWith(
    req: Request,
    _res: Response,
    next: NextFunction,
  ) {
    if (!isAdminEmailIn(adminEmails, req.user?.email)) {
      throw new ForbiddenError("Admin only");
    }
    next();
  };
}

/**
 * Běží VŽDY za `requireAuth`. Sám o sobě neautentizuje — jen se ptá, jestli
 * ten, koho `requireAuth` už poznal, je na seznamu.
 */
export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  return createRequireAdmin(config.security.adminEmails)(req, res, next);
}
```

- [ ] **Step 5: Zaregistrovat test a spustit**

V `apps/api/package.json` (řádek 8) přidej na začátek řetězce `test`:

```
tsx src/middleware/require_admin.test.ts && 
```

Run: `pnpm --filter @musubi/config test && pnpm --filter @musubi/api exec tsx src/middleware/require_admin.test.ts`
Expected: PASS

- [ ] **Step 6: Zdokumentovat env proměnnou**

Zjisti, kde repo popisuje env proměnné:

Run: `ls -a | grep -i env; grep -rln "FEDERATION_ALLOW_PRIVATE_HOSTS" --include="*.md" --include="*.example" --include="*.yml" . | grep -v node_modules`

Do každého nalezeného místa, kde jsou vypsané ostatní `security` proměnné, přidej:

```
# Kdo smí psát zprávy o novinkách v admin panelu. Čárkou oddělené e-maily.
# Prázdné = tento server nemá admina a admin panel je zavřený.
ADMIN_EMAILS=
```

Pokud takové místo neexistuje, tento krok přeskoč a poznamenej to v commit message.

- [ ] **Step 7: Commit**

```bash
git add packages/config/src/index.ts packages/config/src/index.test.ts apps/api/src/middleware/require_admin.ts apps/api/src/middleware/require_admin.test.ts apps/api/package.json
git commit -m "feat(api): server admins, named by ADMIN_EMAILS"
```

---

### Task 5: Handlery a cesty pro announcements

**Files:**
- Create: `apps/api/src/handlers/announcements.ts`
- Create: `apps/api/src/handlers/announcements.test.ts`
- Modify: `apps/api/src/index.ts` (registrace cest, k ostatním `/api/v1/…`)
- Modify: `apps/api/package.json:8` (přidat test do skriptu)

**Interfaces:**
- Consumes: `listAnnouncements`, `listAnnouncementsAfter`, `listAnnouncementIdsOn`, `insertAnnouncement`, `updateAnnouncement`, `deleteAnnouncement`, `getUserSettings` (vše z `@musubi/db`); `AnnouncementInputSchema`, `mintAnnouncementId`, `BadRequestError`, `NotFoundError` (z `@musubi/types`); `isAdminEmail`, `requireAdmin` (z Tasku 4)
- Produces:
  - `createGetAnnouncementsHandler(deps?)`, `handlerGetAnnouncements`
  - `createListAllAnnouncementsHandler(deps?)`, `handlerListAllAnnouncements`
  - `createCreateAnnouncementHandler(deps?)`, `handlerCreateAnnouncement`
  - `createUpdateAnnouncementHandler(deps?)`, `handlerUpdateAnnouncement`
  - `createDeleteAnnouncementHandler(deps?)`, `handlerDeleteAnnouncement`
  - Cesty: `GET /api/v1/announcements`, `GET|POST /api/v1/admin/announcements`, `PATCH|DELETE /api/v1/admin/announcements/:id`

- [ ] **Step 1: Napsat padající test**

Vytvoř `apps/api/src/handlers/announcements.test.ts`:

```ts
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import {
  createCreateAnnouncementHandler,
  createGetAnnouncementsHandler,
} from "./announcements";

function responseRecorder() {
  let statusCode = 0;
  let payload: any;
  const response = {
    json(body: unknown) {
      payload = body;
      return response;
    },
    status(code: number) {
      statusCode = code;
      return response;
    },
  } as unknown as Response;

  return { response, result: () => ({ payload, statusCode }) };
}

const row = (id: string, minVersion: string | null = null) => ({
  id,
  title: `t-${id}`,
  body: "b",
  minVersion,
  createdAt: new Date("2026-08-29T10:00:00.000Z"),
  updatedAt: new Date("2026-08-29T10:00:00.000Z"),
});

async function run() {
  // --- Vrací jen to, co je novější než značka, a nese příznak isAdmin ---
  {
    let askedAfter: string | undefined;
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "2026-08-10" }) as any,
      isAdmin: () => true,
      listAfter: async (afterId: string) => {
        askedAfter = afterId;
        return [row("2026-08-20"), row("2026-08-15")];
      },
      listNewest: async () => [row("2026-08-20")],
    })(
      { user: { id: "user-1", email: "owner@example.com" } } as Request,
      recorder.response,
    );

    assert.equal(askedAfter, "2026-08-10");
    const { payload, statusCode } = recorder.result();
    assert.equal(statusCode, 200);
    assert.equal(payload.isAdmin, true);
    assert.deepEqual(
      payload.announcements.map((a: { id: string }) => a.id),
      ["2026-08-20", "2026-08-15"],
    );
    // Časy se ven neposílají: klient je nepoužívá a wire kontrakt je pak menší.
    assert.equal("createdAt" in payload.announcements[0], false);
  }

  // --- Ne-admin dostane isAdmin: false ---
  {
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => [],
      listNewest: async () => [],
    })(
      { user: { id: "user-2", email: "someone@example.com" } } as Request,
      recorder.response,
    );
    assert.equal(recorder.result().payload.isAdmin, false);
  }

  // --- První pohled: uživatel bez značky nedostane NIC ---
  // Jinak by nový účet (a v den nasazení každý stávající) dostal celou historii
  // produktu naráz. Vrací se prázdno; klient si značku posune na `markTo`.
  {
    let listAfterCalled = false;
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => {
        listAfterCalled = true;
        return [row("2026-08-20"), row("2026-08-01")];
      },
      listNewest: async () => [row("2026-08-20")],
    })(
      { user: { id: "user-3", email: "new@example.com" } } as Request,
      recorder.response,
    );

    const { payload } = recorder.result();
    assert.equal(listAfterCalled, false);
    assert.deepEqual(payload.announcements, []);
    assert.equal(payload.markTo, "2026-08-20");
  }

  // --- Prázdný server: první pohled bez jediné zprávy neposílá značku ---
  {
    const recorder = responseRecorder();
    await createGetAnnouncementsHandler({
      getSettings: async () => ({ lastSeenAnnouncement: "" }) as any,
      isAdmin: () => false,
      listAfter: async () => [],
      listNewest: async () => [],
    })(
      { user: { id: "user-4", email: "new@example.com" } } as Request,
      recorder.response,
    );
    assert.equal(recorder.result().payload.markTo, undefined);
  }

  // --- Vytvoření: id se razí z dnešního data ---
  {
    let inserted: any;
    const recorder = responseRecorder();
    await createCreateAnnouncementHandler({
      idsOn: async () => [],
      insert: async (values: any) => {
        inserted = values;
        return { ...values, createdAt: new Date(), updatedAt: new Date() };
      },
      today: () => "2026-08-29",
    })(
      {
        body: { title: "New", body: "Body", minVersion: "0.1.7" },
        user: { id: "user-1", email: "owner@example.com" },
      } as Request,
      recorder.response,
    );

    assert.equal(recorder.result().statusCode, 201);
    assert.equal(inserted.id, "2026-08-29");
    assert.equal(inserted.minVersion, "0.1.7");
  }

  // --- Druhá zpráva téhož dne dostane příponu ---
  {
    let inserted: any;
    await createCreateAnnouncementHandler({
      idsOn: async () => ["2026-08-29"],
      insert: async (values: any) => {
        inserted = values;
        return { ...values, createdAt: new Date(), updatedAt: new Date() };
      },
      today: () => "2026-08-29",
    })(
      {
        body: { title: "Second", body: "Body" },
        user: { id: "user-1", email: "owner@example.com" },
      } as Request,
      responseRecorder().response,
    );
    assert.equal(inserted.id, "2026-08-29-2");
    // Nevyplněná verze se ukládá jako NULL, ne jako prázdný řetězec — jinak by
    // se prázdno pokoušelo porovnávat jako verze.
    assert.equal(inserted.minVersion, null);
  }

  // --- Nevalidní vstup je odmítnutý, ne uložený ---
  {
    await assert.rejects(
      () =>
        createCreateAnnouncementHandler({
          idsOn: async () => [],
          insert: async () => {
            throw new Error("must not be called");
          },
          today: () => "2026-08-29",
        })(
          {
            body: { title: "", body: "Body" },
            user: { id: "user-1", email: "owner@example.com" },
          } as Request,
          responseRecorder().response,
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message === "Announcement needs a title and a body.",
    );
  }

  console.log("announcements handler tests passed");
}

void run();
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `pnpm --filter @musubi/api exec tsx src/handlers/announcements.test.ts`
Expected: FAIL — `Cannot find module './announcements'`

- [ ] **Step 3: Napsat handlery**

Vytvoř `apps/api/src/handlers/announcements.ts`:

```ts
import {
  deleteAnnouncement,
  getUserSettings,
  insertAnnouncement,
  listAnnouncementIdsOn,
  listAnnouncements,
  listAnnouncementsAfter,
  updateAnnouncement,
  type AnnouncementRow,
} from "@musubi/db";
import {
  AnnouncementInputSchema,
  BadRequestError,
  mintAnnouncementId,
  NotFoundError,
} from "@musubi/types";
import type { Request, Response } from "express";
import { isAdminEmail } from "../middleware/require_admin";

/** Jen to, co klient potřebuje. Časy nikdo nečte a kontrakt je bez nich menší. */
function toWire(row: AnnouncementRow) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    minVersion: row.minVersion,
  };
}

/** Dnešek jako `YYYY-MM-DD` v UTC — id musí být stejné bez ohledu na zónu serveru. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function createGetAnnouncementsHandler(
  dependencies: {
    getSettings?: typeof getUserSettings;
    isAdmin?: typeof isAdminEmail;
    listAfter?: typeof listAnnouncementsAfter;
    listNewest?: typeof listAnnouncements;
  } = {},
) {
  const getSettings = dependencies.getSettings ?? getUserSettings;
  const admin = dependencies.isAdmin ?? isAdminEmail;
  const listAfter = dependencies.listAfter ?? listAnnouncementsAfter;
  const listNewest = dependencies.listNewest ?? listAnnouncements;

  return async function getAnnouncements(req: Request, res: Response) {
    const settings = await getSettings(req.user!.id);
    const isAdmin = admin(req.user!.email);
    const seen = settings.lastSeenAnnouncement ?? "";

    // První pohled: účet, který ještě nic neviděl — nově registrovaný i každý
    // stávající v den nasazení této featury. Nedostane NIC k zobrazení, jen
    // `markTo`, kam si má posunout značku. Bez toho by dostal modal se všemi
    // novinkami za celou historii produktu, ke kterým se nemá jak vztáhnout.
    if (!seen) {
      const [newest] = await listNewest();
      res.status(200).json({
        announcements: [],
        isAdmin,
        ...(newest ? { markTo: newest.id } : {}),
      });
      return;
    }

    const rows = await listAfter(seen);
    res.status(200).json({ announcements: rows.map(toWire), isAdmin });
  };
}

export const handlerGetAnnouncements = createGetAnnouncementsHandler();

export function createListAllAnnouncementsHandler(
  dependencies: { list?: typeof listAnnouncements } = {},
) {
  const list = dependencies.list ?? listAnnouncements;
  return async function listAll(_req: Request, res: Response) {
    const rows = await list();
    res.status(200).json({ announcements: rows.map(toWire) });
  };
}

export const handlerListAllAnnouncements = createListAllAnnouncementsHandler();

function parseInput(body: unknown) {
  const parsed = AnnouncementInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestError("Announcement needs a title and a body.");
  }
  return parsed.data;
}

export function createCreateAnnouncementHandler(
  dependencies: {
    idsOn?: typeof listAnnouncementIdsOn;
    insert?: typeof insertAnnouncement;
    today?: () => string;
  } = {},
) {
  const idsOn = dependencies.idsOn ?? listAnnouncementIdsOn;
  const insert = dependencies.insert ?? insertAnnouncement;
  const today = dependencies.today ?? todayKey;

  return async function createAnnouncement(req: Request, res: Response) {
    const input = parseInput(req.body);
    const dateKey = today();
    const id = mintAnnouncementId(dateKey, await idsOn(dateKey));

    const created = await insert({
      id,
      title: input.title,
      body: input.body,
      // Nevyplněné pole je NULL, ne prázdný řetězec: prázdno se nedá porovnávat
      // jako verze a `null` je jediná podoba "týká se všech".
      minVersion: input.minVersion || null,
    });

    res.status(201).json(toWire(created));
  };
}

export const handlerCreateAnnouncement = createCreateAnnouncementHandler();

export function createUpdateAnnouncementHandler(
  dependencies: { update?: typeof updateAnnouncement } = {},
) {
  const update = dependencies.update ?? updateAnnouncement;

  return async function patchAnnouncement(req: Request, res: Response) {
    const input = parseInput(req.body);
    // `id` se nemění: je to značka, kterou už mají uživatelé uloženou. Oprava
    // překlepu se nikomu neukáže znovu, a to je zamýšlené — nová informace je
    // nová zpráva.
    const updated = await update(req.params.id, {
      title: input.title,
      body: input.body,
      minVersion: input.minVersion || null,
    });

    if (!updated) throw new NotFoundError("No such announcement.");
    res.status(200).json(toWire(updated));
  };
}

export const handlerUpdateAnnouncement = createUpdateAnnouncementHandler();

export function createDeleteAnnouncementHandler(
  dependencies: { remove?: typeof deleteAnnouncement } = {},
) {
  const remove = dependencies.remove ?? deleteAnnouncement;

  return async function removeAnnouncement(req: Request, res: Response) {
    const removed = await remove(req.params.id);
    if (!removed) throw new NotFoundError("No such announcement.");
    res.status(200).json({ deleted: true });
  };
}

export const handlerDeleteAnnouncement = createDeleteAnnouncementHandler();
```

- [ ] **Step 4: Zaregistrovat cesty**

V `apps/api/src/index.ts` přidej import k ostatním handlerům:

```ts
import {
  handlerCreateAnnouncement,
  handlerDeleteAnnouncement,
  handlerGetAnnouncements,
  handlerListAllAnnouncements,
  handlerUpdateAnnouncement,
} from "./handlers/announcements";
import { requireAdmin } from "./middleware/require_admin";
```

A cesty k ostatním `/api/v1/…` (například za blokem `/api/v1/users/settings`, ~ř. 549). `wrap` je helper, který už soubor používá u ostatních async handlerů — najdi si jeho definici a použij ho stejně:

```ts
// Co tenhle uživatel ještě neviděl. Filtrování podle minVersion dělá klient:
// server neví, jaká verze se ho ptá.
app.get("/api/v1/announcements", requireAuth, wrap(handlerGetAnnouncements));

// Psaní zpráv. requireAdmin běží VŽDY za requireAuth — sám neautentizuje.
app.get(
  "/api/v1/admin/announcements",
  requireAuth,
  requireAdmin,
  wrap(handlerListAllAnnouncements),
);
app.post(
  "/api/v1/admin/announcements",
  requireAuth,
  requireAdmin,
  wrap(handlerCreateAnnouncement),
);
app.patch(
  "/api/v1/admin/announcements/:id",
  requireAuth,
  requireAdmin,
  wrap(handlerUpdateAnnouncement),
);
app.delete(
  "/api/v1/admin/announcements/:id",
  requireAuth,
  requireAdmin,
  wrap(handlerDeleteAnnouncement),
);
```

- [ ] **Step 5: Zaregistrovat test a spustit vše**

V `apps/api/package.json` (řádek 8) přidej `tsx src/handlers/announcements.test.ts && ` k ostatním testům.

Run: `pnpm --filter @musubi/api test && node scripts/check-routes.mjs && pnpm exec tsc -p apps/api/tsconfig.json --noEmit --skipLibCheck`
Expected: PASS. `check-routes.mjs` zatím jen ověří, že nic nechybí — klientské volání přibude v Tasku 6.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/handlers/announcements.ts apps/api/src/handlers/announcements.test.ts apps/api/src/index.ts apps/api/package.json
git commit -m "feat(api): announcement endpoints, admin-only for writing"
```

---

### Task 6: Webová API vrstva

Server je hotový. Teď web — nejdřív data, pak UI.

**Files:**
- Modify: `apps/web/src/api/contracts.ts` (přidat schémata)
- Modify: `apps/web/src/api/resources.ts` (přidat funkce)
- Modify: `apps/web/src/api/query-keys.ts` (přidat klíč)

**Interfaces:**
- Consumes: `apiRequest` z `~/api/http`; `AnnouncementSchema`, `AnnouncementsResponseSchema` a `AnnouncementInputSchema` z `@musubi/types` (Task 1)
- Produces:
  - `AdminAnnouncementsResponseSchema` v `contracts.ts` (odpověď `/api/v1/announcements` se přebírá z `@musubi/types`, nepředefinovává se)
  - `getAnnouncements(signal?: AbortSignal)`, `listAdminAnnouncements()`, `createAnnouncement(input)`, `updateAnnouncement(id, input)`, `removeAnnouncement(id)` v `resources.ts`
  - `queryKeys.announcements(serverOrigin, userId)`, `queryKeys.adminAnnouncements(serverOrigin)` v `query-keys.ts`

- [ ] **Step 1: Přidat schémata odpovědí**

V `apps/web/src/api/contracts.ts`, ke stávajícím schématům. Odpověď se
**nepředefinovává** — přebírá se ze sdíleného balíčku, přesně jak to soubor už
dělá u `SettingsResponseSchema` (ř. 44). Dvě definice téhož tvaru by se rozešly.

Doplň `AnnouncementSchema` a `AnnouncementsResponseSchema` do importu
z `@musubi/types` a přidej:

```ts
// Admin seznam je jiný dokument: nese i zprávy, které volající už viděl, a
// nikdy nenese isAdmin (na tuhle cestu se ne-admin nedostane).
export const AdminAnnouncementsResponseSchema = z.object({
  announcements: z.array(AnnouncementSchema),
});
```

Odpověď `/api/v1/announcements` sem **nepřidávej** v žádné podobě, ani jako
alias. `resources.ts` si `AnnouncementsResponseSchema` importuje rovnou
z `@musubi/types` (viz Step 2) — jedna definice, jedno místo, kde se mění.

- [ ] **Step 2: Přidat funkce pro volání API**

V `apps/web/src/api/resources.ts`, k ostatním (doplň nová schémata do importu z `./contracts` a `AnnouncementInput` z `@musubi/types`):

```ts
export function getAnnouncements(signal?: AbortSignal) {
  return apiRequest("/api/v1/announcements", {
    // Ze sdíleného balíčku, ne z lokální kopie — je to týž dokument, jaký
    // parsuje mobil, a jeden tvar znamená jedno místo, kde se mění.
    responseSchema: AnnouncementsResponseSchema,
    signal,
  });
}

export function listAdminAnnouncements() {
  return apiRequest("/api/v1/admin/announcements", {
    responseSchema: AdminAnnouncementsResponseSchema,
  });
}

export function createAnnouncement(input: AnnouncementInput) {
  return apiRequest("/api/v1/admin/announcements", {
    body: input,
    method: "POST",
    responseSchema: AnnouncementSchema,
  });
}

export function updateAnnouncement(id: string, input: AnnouncementInput) {
  return apiRequest(`/api/v1/admin/announcements/${id}`, {
    body: input,
    method: "PATCH",
    responseSchema: AnnouncementSchema,
  });
}

export function removeAnnouncement(id: string) {
  return apiRequest(`/api/v1/admin/announcements/${id}`, {
    method: "DELETE",
    responseSchema: z.object({ deleted: z.boolean() }),
  });
}
```

- [ ] **Step 3: Přidat query klíče**

V `apps/web/src/api/query-keys.ts`, do objektu `queryKeys` za `settings`:

```ts
  announcements: (serverOrigin: string, userId: string) =>
    ["announcements", serverOrigin, userId] as const,

  adminAnnouncements: (serverOrigin: string) =>
    ["admin-announcements", serverOrigin] as const,
```

- [ ] **Step 4: Ověřit typy a cesty**

Run: `pnpm --filter @musubi/web typecheck && node scripts/check-routes.mjs`
Expected: PASS — `check-routes.mjs` teď potvrdí, že všechny čtyři nové cesty existují na serveru

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/api/contracts.ts apps/web/src/api/resources.ts apps/web/src/api/query-keys.ts
git commit -m "feat(web): announcement API layer"
```

---

### Task 7: Modal na webu

**Files:**
- Create: `apps/web/src/calendar/components/AnnouncementDialog.tsx`
- Create: `apps/web/src/calendar/components/AnnouncementDialog.module.css`
- Create: `apps/web/src/calendar/components/AnnouncementDialog.stories.tsx`
- Create: `apps/web/src/calendar/components/AnnouncementDialog.test.tsx`
- Modify: `apps/web/src/auth/SessionGate.tsx` (mount vedle posledního `<Outlet />`)

**Interfaces:**
- Consumes: `getAnnouncements` (Task 6), `queryKeys.announcements` (Task 6), `pendingAnnouncements`, `newestAnnouncementId`, `announcementParagraphs` (Task 1), `useSettingsMutations` z `~/calendar/settings-mutations`, `Dialog` z `~/ui/Dialog`, `Button` z `~/ui/Button`
- Produces: `AnnouncementGate()` — komponenta bez props, sama si načte data i uživatele

- [ ] **Step 1: Napsat padající test**

Nejdřív si přečti `apps/web/src/ui/ConfirmationDialog.test.tsx` a `apps/web/src/ui/Dialog.tsx`, abys mířil na skutečné API `Dialog`u a použil stejný testovací styl (Vitest + Testing Library).

Vytvoř `apps/web/src/calendar/components/AnnouncementDialog.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnnouncementBody } from "./AnnouncementDialog";

describe("AnnouncementBody", () => {
  it("renders paragraphs as separate blocks", () => {
    render(<AnnouncementBody body={"first line\n\nsecond line"} />);
    expect(screen.getByText("first line")).toBeInTheDocument();
    expect(screen.getByText("second line")).toBeInTheDocument();
  });

  it("turns an http url into a link that opens safely", () => {
    render(<AnnouncementBody body="join us at https://discord.gg/example now" />);
    const link = screen.getByRole("link", { name: "https://discord.gg/example" });
    expect(link).toHaveAttribute("href", "https://discord.gg/example");
    expect(link).toHaveAttribute("target", "_blank");
    // noopener: obsah píše majitel serveru, ale odkaz ven nesmí dostat
    // window.opener na Musubi.
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("leaves a javascript url as plain text", () => {
    render(<AnnouncementBody body="javascript:alert(1)" />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("javascript:alert(1)")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Spustit test a ověřit, že padá**

Run: `pnpm --filter @musubi/web exec vitest run --project=unit AnnouncementDialog`
Expected: FAIL — modul neexistuje

- [ ] **Step 3: Napsat komponentu**

Vytvoř `apps/web/src/calendar/components/AnnouncementDialog.module.css` — použij **jen** sdílené tokeny z `apps/web/src/design` (podívej se, jak je čte třeba `PageSettingsDialog.module.css`), žádné napevno psané barvy:

```css
.list {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.entry {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}

.title {
  color: var(--text-primary);
  font-family: var(--font-serif);
  font-size: var(--text-16);
}

.paragraph {
  color: var(--text-secondary);
  font-size: var(--text-14);
  /* Zpráva je prostý text: jednoduchý zlom řádku uvnitř odstavce má zůstat
     zlomem, protože autor ho tam napsal schválně. */
  white-space: pre-wrap;
}

.paragraph + .paragraph {
  margin-top: var(--space-3);
}
```

Tokeny jsou z `packages/design-system/src/foundations.css` (`--space-*`,
`--text-14`, `--text-16`) a ze sémantické vrstvy (`--text-primary`,
`--text-secondary`, `--font-serif`) — tytéž, jaké používá
`apps/web/src/calendar/components/styles/account.module.css`. Žádná napevno
psaná barva ani velikost.

Vytvoř `apps/web/src/calendar/components/AnnouncementDialog.tsx`:

```tsx
import {
  announcementParagraphs,
  newestAnnouncementId,
  pendingAnnouncements,
} from "@musubi/types";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import musubiPackage from "../../../../../package.json";
import { getAnnouncements } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { useSessionUser } from "~/auth/use-session-user";
import { useSettingsMutations } from "~/calendar/settings-mutations";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import styles from "./AnnouncementDialog.module.css";

/** Co tenhle build je. Vite ho vloží; žádný fetch. Stejný zdroj jako use-newer-server. */
const BUILD_VERSION = musubiPackage.version;

/**
 * Text zprávy: odstavce, a odkazy jako odkazy.
 *
 * Exportované zvlášť, protože to je jediná část s pravidly, která stojí za test
 * — zbytek je zapojení dat.
 */
export function AnnouncementBody({ body }: { body: string }) {
  return (
    <>
      {announcementParagraphs(body).map((segments, index) => (
        <p className={styles.paragraph} key={index}>
          {segments.map((segment, segmentIndex) =>
            segment.type === "link" ? (
              <a
                href={segment.url}
                key={segmentIndex}
                // Odkaz ven nesmí dostat window.opener na Musubi.
                rel="noreferrer noopener"
                target="_blank"
              >
                {segment.value}
              </a>
            ) : (
              <span key={segmentIndex}>{segment.value}</span>
            ),
          )}
        </p>
      ))}
    </>
  );
}

/**
 * Ukáže, co je nového — jednou.
 *
 * Server už odfiltroval, co uživatel viděl; `minVersion` dořeší tenhle build,
 * protože server neví, jaká verze se ho ptá. Zavření posune značku v nastavení,
 * takže se totéž neukáže na telefonu.
 */
export function AnnouncementGate() {
  const { user } = useSessionUser();
  const userId = user?.id;
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery({
    enabled: Boolean(userId),
    queryFn: ({ signal }) => getAnnouncements(signal),
    queryKey: queryKeys.announcements(getServerOrigin(), userId ?? ""),
    // Jednou za načtení aplikace. Novinka, která dorazí uprostřed práce, počká
    // na příští spuštění — vyskočit lidem pod rukama je horší než počkat.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const { getSettingsDocument, patchSettings } = useSettingsMutations(
    userId ?? "",
  );

  async function mark(lastSeenAnnouncement: string) {
    try {
      const document = await getSettingsDocument();
      await patchSettings({
        baseRevision: document.revision,
        patch: { lastSeenAnnouncement },
      });
    } catch {
      // Značka se neuložila — zpráva se příště ukáže znovu. Otravné, ale
      // neškodné; ztratit ji úplně by bylo horší.
    }
  }

  // První pohled: nic se neukazuje, jen se posune značka. Bez toho by nový účet
  // (a v den nasazení každý stávající) dostal celou historii produktu naráz.
  //
  // V efektu, ne při renderu: patch je vedlejší efekt, a při renderu by ho
  // StrictMode vyvolal dvakrát a opakoval při každém dalším renderu.
  const markTo = data?.markTo;
  useEffect(() => {
    if (markTo) void mark(markTo);
    // `mark` se mění s každým renderem (uzavírá mutace), a značka se má poslat
    // právě jednou na hodnotu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markTo]);

  const pending =
    data && !markTo ? pendingAnnouncements(data.announcements, BUILD_VERSION) : [];
  if (dismissed || pending.length === 0) return null;

  function close() {
    setDismissed(true);
    const newest = newestAnnouncementId(pending);
    // Značka se posouvá jen na to, co se OPRAVDU ukázalo. Co odfiltroval
    // minVersion, zůstává nevyřízené a vyskočí po aktualizaci.
    if (newest) void mark(newest);
  }

  const single = pending.length === 1;

  return (
    <Dialog
      // Radix uvnitř Dialogu drží focus trap, Escape i vrácení focusu — obojí
      // směřuje sem, takže zavření jakoukoli cestou posune značku.
      closeLabel="Close"
      description={
        single
          ? "A note from this server."
          : `${pending.length} updates since you were last here.`
      }
      footer={<Button onClick={close}>Got it</Button>}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      open
      size="compact"
      title={single ? pending[0].title : "What's new"}
    >
      <div className={styles.list}>
        {pending.map((announcement) => (
          <section className={styles.entry} key={announcement.id}>
            {/* U jediné zprávy je titulek už v hlavičce dialogu; opakovat ho
                uvnitř by byly dva nadpisy pro totéž. */}
            {single ? null : (
              <h3 className={styles.title}>{announcement.title}</h3>
            )}
            <AnnouncementBody body={announcement.body} />
          </section>
        ))}
      </div>
    </Dialog>
  );
}
```

**Poznámka pro implementátora:** `closeLabel`, `description`, `title`,
`onOpenChange` a `open` jsou u `Dialog`u povinné (`apps/web/src/ui/Dialog.tsx:20-38`);
`footer` vykreslí patičku pod tělem. `useSessionUser()` vrací
`{ user, fromSnapshot }` — ověř si přesný tvar v
`apps/web/src/auth/use-session-user.ts:25` a použij to, co skutečně vrací.

- [ ] **Step 4: Spustit test a ověřit, že prochází**

Run: `pnpm --filter @musubi/web exec vitest run --project=unit AnnouncementDialog`
Expected: PASS

- [ ] **Step 5: Přidat Storybook variantu**

Vytvoř `apps/web/src/calendar/components/AnnouncementDialog.stories.tsx` podle vzoru sousedního `PageSettingsDialog.stories.tsx`. Nejméně dvě varianty: jedna zpráva, a tři zprávy s odkazem v textu. Story ukazuje jen prezentaci — vyexportuj si pro ni z modulu čistou část (`AnnouncementBody` + seznam), ať story nepotřebuje query klienta ani session.

- [ ] **Step 6: Namountovat do SessionGate**

V `apps/web/src/auth/SessionGate.tsx` přidej import a uprav **poslední** `return <Outlet />;` (větev, kde `session.data` existuje — ne offline větev, offline stejně není co načíst):

```tsx
  return (
    <>
      <AnnouncementGate />
      <Outlet />
    </>
  );
```

- [ ] **Step 7: Ověřit celý web**

Run: `pnpm --filter @musubi/web test && pnpm --filter @musubi/web typecheck && pnpm --filter @musubi/web lint`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/calendar/components/AnnouncementDialog.tsx apps/web/src/calendar/components/AnnouncementDialog.module.css apps/web/src/calendar/components/AnnouncementDialog.stories.tsx apps/web/src/calendar/components/AnnouncementDialog.test.tsx apps/web/src/auth/SessionGate.tsx
git commit -m "feat(web): show what's new once, then remember it"
```

---

### Task 8: Admin panel

**Files:**
- Create: `apps/web/src/routes/app/admin.tsx`
- Create: `apps/web/src/routes/app/admin.module.css`
- Modify: `apps/web/src/calendar/components/Sidebar.tsx:357-364` (přidat řádek nad „Settings")
- Modify: `apps/web/src/routes/app/p.$pageId.$view.tsx` (předat nový prop do `Sidebar`)

**Interfaces:**
- Consumes: `listAdminAnnouncements`, `createAnnouncement`, `updateAnnouncement`, `removeAnnouncement`, `getAnnouncements`, `queryKeys.adminAnnouncements` (Task 6); `SettingsSection`, `Field`, `Button`, `Row`, `ConfirmationDialog` z `~/ui`
- Produces: route `/app/admin`, prop `isAdmin: boolean` na `Sidebar`

- [ ] **Step 1: Napsat styly**

Vytvoř `apps/web/src/routes/app/admin.module.css`:

```css
.page {
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
  margin: 0 auto;
  max-width: 46rem;
  padding: var(--space-6) var(--space-4);
}

.form {
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

.actions {
  display: flex;
  gap: var(--space-2);
}

.body {
  min-height: 8rem;
  resize: vertical;
}
```

Pole `input`/`textarea` samy o sobě nestylujeme — třídy na ně bere `Field`
z `~/ui`. `.body` jen dává textarea rozumnou výšku.

- [ ] **Step 2: Napsat routu**

Vytvoř `apps/web/src/routes/app/admin.tsx`:

```tsx
import type { Announcement } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  createAnnouncement,
  getAnnouncements,
  listAdminAnnouncements,
  removeAnnouncement,
  updateAnnouncement,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { useSessionUser } from "~/auth/use-session-user";
import { Button } from "~/ui/Button";
import {
  ConfirmationDialog,
  ConfirmationNotice,
} from "~/ui/ConfirmationDialog";
import { Field } from "~/ui/Field";
import { RouteState } from "~/ui/RouteState";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import styles from "./admin.module.css";

export const Route = createFileRoute("/app/admin")({
  component: AdminRoute,
});

const EMPTY = { body: "", minVersion: "", title: "" };

function AdminRoute() {
  const { user } = useSessionUser();
  const origin = getServerOrigin();
  const queryClient = useQueryClient();

  // Tentýž dotaz, jaký si stáhne modal — sdílená cache, takže odpověď navíc
  // tahle stránka nestojí.
  const { data: mine } = useQuery({
    enabled: Boolean(user?.id),
    queryFn: ({ signal }) => getAnnouncements(signal),
    queryKey: queryKeys.announcements(origin, user?.id ?? ""),
  });

  const { data, isPending } = useQuery({
    enabled: mine?.isAdmin === true,
    queryFn: () => listAdminAnnouncements(),
    queryKey: queryKeys.adminAnnouncements(origin),
  });

  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Announcement | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.adminAnnouncements(origin),
    });

  const save = useMutation({
    mutationFn: () => {
      const input = {
        body: draft.body,
        minVersion: draft.minVersion.trim() || null,
        title: draft.title,
      };
      return editing
        ? updateAnnouncement(editing, input)
        : createAnnouncement(input);
    },
    onSuccess: async () => {
      setDraft(EMPTY);
      setEditing(null);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeAnnouncement(id),
    onSuccess: async () => {
      setConfirming(null);
      await refresh();
    },
  });

  // Slušnost UI, ne ochrana. Ta je na serveru: každá admin cesta běží za
  // `requireAdmin` a odmítne i toho, kdo si sem zadá URL ručně.
  if (mine && !mine.isAdmin) {
    return (
      <RouteState
        eyebrow="Server admin"
        description="Only this server's admins can write announcements."
        title="Not your page"
      />
    );
  }

  return (
    <main className={styles.page}>
      <SettingsSection
        description="Everyone signed in to this server sees these once."
        title={editing ? "Edit announcement" : "New announcement"}
      >
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Title">
            <input
              maxLength={200}
              onChange={(event) =>
                setDraft((current) => ({ ...current, title: event.target.value }))
              }
              required
              value={draft.title}
            />
          </Field>

          <Field description="An empty line starts a new paragraph. Links starting with http:// or https:// become clickable." label="Message">
            <textarea
              className={styles.body}
              maxLength={4000}
              onChange={(event) =>
                setDraft((current) => ({ ...current, body: event.target.value }))
              }
              required
              value={draft.body}
            />
          </Field>

          <Field
            description="Only clients on this version or newer will see it. Leave empty to show it to everyone. Write it when you release the version — an older message with a higher minimum than a newer one gets skipped."
            label="Minimum version"
          >
            <input
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  minVersion: event.target.value,
                }))
              }
              placeholder="0.1.7"
              value={draft.minVersion}
            />
          </Field>

          <div className={styles.actions}>
            <Button disabled={save.isPending} type="submit">
              {editing ? "Save changes" : "Publish"}
            </Button>
            {editing ? (
              <Button
                onClick={() => {
                  setEditing(null);
                  setDraft(EMPTY);
                }}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      </SettingsSection>

      <SettingsSection title="Published">
        {isPending ? (
          <Row label="Loading…" />
        ) : data?.announcements.length ? (
          data.announcements.map((announcement) => (
            <Row
              detail={
                announcement.minVersion
                  ? `${announcement.id} · ${announcement.minVersion} and newer`
                  : `${announcement.id} · everyone`
              }
              key={announcement.id}
              label={announcement.title}
              trailing={
                <div className={styles.actions}>
                  <Button
                    onClick={() => {
                      setEditing(announcement.id);
                      setDraft({
                        body: announcement.body,
                        minVersion: announcement.minVersion ?? "",
                        title: announcement.title,
                      });
                    }}
                    size="compact"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => setConfirming(announcement)}
                    size="compact"
                    variant="secondary"
                  >
                    Delete
                  </Button>
                </div>
              }
            />
          ))
        ) : (
          <Row label="Nothing published yet." />
        )}
      </SettingsSection>

      {confirming ? (
        <ConfirmationDialog
          closeLabel="Cancel"
          confirmLabel="Delete"
          confirmVariant="destructive"
          description="Deleting it does not un-show it — anyone who already saw it keeps their mark."
          loading={remove.isPending}
          onConfirm={() => remove.mutate(confirming.id)}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          open
          title={`Delete "${confirming.title}"?`}
        >
          <ConfirmationNotice icon={<Trash2 size={18} />}>
            People who have not seen it yet never will.
          </ConfirmationNotice>
        </ConfirmationDialog>
      ) : null}
    </main>
  );
}
```

**Poznámka pro implementátora:** `ConfirmationDialog` má povinné `children`,
`closeLabel`, `confirmLabel`, `description`, `onOpenChange`, `open`, `title` a
buď `onConfirm`, nebo `confirmForm` — nikdy obojí
(`apps/web/src/ui/ConfirmationDialog.tsx:8-29`). `RouteState` má povinné
`eyebrow` a `title` (`apps/web/src/ui/RouteState.tsx:10-15`). `Row` přijímá
`label`, `detail`, `icon`, `value` a `trailing` (`apps/web/src/ui/Row.tsx:61-64`).
`Button` má varianty `"primary" | "secondary" | "destructive" | "ghost"` a
velikosti `"control" | "compact"` (`apps/web/src/ui/Button.tsx:9-15`), takže
`variant="secondary"` i `size="compact"` výše sedí.

- [ ] **Step 3: Ověřit, že route strom prošel regenerací**

Run: `pnpm --filter @musubi/web typecheck`
Expected: PASS. `apps/web/src/routeTree.gen.ts` je generovaný — pokud typecheck hlásí neznámou routu, spusť dev server nebo build, aby se strom přegeneroval, a vygenerovaný soubor zacommituj s ostatními.

- [ ] **Step 4: Přidat odkaz do sidebaru**

V `apps/web/src/calendar/components/Sidebar.tsx` přidej do props typu (~ř. 55):

```ts
  isAdmin: boolean;
```

a nový `RowAction` **nad** ten se „Settings" (~ř. 357). Použij ikonu `ShieldCheck` z `lucide-react` (přidej do importu na ř. 12) a naviguj na `/app/admin` tak, jak to dělají ostatní odkazy v tomhle souboru:

```tsx
            {isAdmin ? (
              <RowAction
                className={styles.sidebarRow}
                icon={<ShieldCheck size={18} strokeWidth={1.6} />}
                label="Server admin"
                showChevron={false}
                size="compact"
                onClick={onOpenAdmin}
              />
            ) : null}
```

V `apps/web/src/routes/app/p.$pageId.$view.tsx` (~ř. 227 a 275, obě místa, kde se `Sidebar` používá) předej `isAdmin` z dotazu `queryKeys.announcements(...)` a `onOpenAdmin` jako navigaci na `/app/admin`.

- [ ] **Step 5: Ověřit celý web**

Run: `pnpm --filter @musubi/web test && pnpm --filter @musubi/web typecheck && pnpm --filter @musubi/web lint`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/routes/app/admin.tsx apps/web/src/routes/app/admin.module.css apps/web/src/routeTree.gen.ts apps/web/src/calendar/components/Sidebar.tsx apps/web/src/routes/app/p.\$pageId.\$view.tsx
git commit -m "feat(web): admin panel for writing announcements"
```

---

### Task 9: Modal v mobilní appce

Poslední v pořadí, protože telefon je jediný klient, který se nedá opravit redeployem — až sem doletí, je server živý týdny (`docs/releasing.md`).

**Files:**
- Modify: `apps/client/services/api.ts` (přidat metodu do `useApi()`)
- Create: `apps/client/components/AnnouncementModal.tsx`
- Create: `apps/client/components/AnnouncementModal.spec.tsx`
- Modify: `apps/client/app/_layout.tsx:~150` (namountovat vedle `<Stack>`)

**Interfaces:**
- Consumes: `useApi()` z `@/services/api`, `readWire` z `@/services/wire`, `queueSettingsPatch` z `@/services/settingsSync`, `AnnouncementsResponseSchema`, `pendingAnnouncements`, `newestAnnouncementId`, `announcementParagraphs` z `@musubi/types`, `ModalPortal` a `Btn` z `@/components/ui`
- Produces: `api.getAnnouncements()`, komponenta `AnnouncementModal`

- [ ] **Step 1: Přidat volání API**

V `apps/client/services/api.ts` do objektu, který `useApi()` vrací (doplň `AnnouncementsResponseSchema` do importu z `@musubi/types`):

```ts
    async getAnnouncements() {
      const { error, data } = await authClient.$fetch<unknown>(
        `${apiUrl}/api/${apiVersion}/announcements`,
        {},
      );
      throwOnError(error);
      return readWire(
        AnnouncementsResponseSchema,
        data,
        "/api/v1/announcements",
      );
    },
```

- [ ] **Step 2: Napsat padající test**

Přečti si `apps/client/services/wire.spec.ts` kvůli testovacímu stylu (Vitest). Vytvoř `apps/client/components/AnnouncementModal.spec.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import {
  announcementParagraphs,
  newestAnnouncementId,
  pendingAnnouncements,
} from "@musubi/types";

// Modal sám je React Native strom; testovatelné jsou rozhodovací pravidla,
// která rozhodují, CO ukáže a kam posune značku.
describe("announcement selection on the phone", () => {
  const announcements = [
    { id: "2026-08-20", title: "next", body: "x", minVersion: "0.1.7" },
    { id: "2026-08-10", title: "now", body: "x", minVersion: "0.1.6" },
  ];

  it("hides a message meant for a build this phone does not run yet", () => {
    const pending = pendingAnnouncements(announcements, "0.1.6");
    expect(pending.map((a) => a.id)).toEqual(["2026-08-10"]);
    // Značka se posune jen na zobrazené, takže po updatu na 0.1.7 přijde zbytek.
    expect(newestAnnouncementId(pending)).toBe("2026-08-10");
  });

  it("delivers the held-back message after the update", () => {
    const pending = pendingAnnouncements(announcements, "0.1.7");
    expect(pending.map((a) => a.id)).toEqual(["2026-08-20", "2026-08-10"]);
    expect(newestAnnouncementId(pending)).toBe("2026-08-20");
  });

  it("splits the body into paragraphs and links", () => {
    const [first, second] = announcementParagraphs(
      "hello\n\njoin https://discord.gg/example",
    );
    expect(first).toEqual([{ type: "text", value: "hello" }]);
    expect(second[1]).toEqual({
      type: "link",
      url: "https://discord.gg/example",
      value: "https://discord.gg/example",
    });
  });
});
```

- [ ] **Step 3: Spustit test a ověřit, že prochází**

Run: `pnpm --filter @musubi/client exec vitest run AnnouncementModal`
Expected: PASS (pravidla jsou z Tasku 1). Pokud padá, chyba je v Tasku 1, ne tady.

- [ ] **Step 4: Napsat modal**

Vytvoř `apps/client/components/AnnouncementModal.tsx`. Vizuálně se drží
`UpdateRequiredModal.tsx` — stejné `colors`, `fonts`, poloměry i odsazení.

```tsx
import {
  announcementParagraphs,
  newestAnnouncementId,
  pendingAnnouncements,
  type Announcement,
} from "@musubi/types";
import Constants from "expo-constants";
import { useEffect, useState } from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { colors, fonts, styles } from "@/constants/theme";
import { useApi } from "@/services/api";
import { queueSettingsPatch } from "@/services/settingsSync";

/** Co tenhle build je. Stejný zdroj jako UpdateRequiredModal. */
const buildVersion = Constants.expoConfig?.version ?? "0.0.0";

function Body({ body }: { body: string }) {
  return (
    <>
      {announcementParagraphs(body).map((segments, index) => (
        <Text
          key={index}
          style={{
            color: colors.fg2,
            fontFamily: fonts.sans,
            fontSize: 14,
            lineHeight: 22,
            marginTop: index === 0 ? 0 : 12,
          }}
        >
          {segments.map((segment, segmentIndex) =>
            segment.type === "link" ? (
              <Text
                accessibilityRole="link"
                key={segmentIndex}
                onPress={() => void Linking.openURL(segment.url)}
                style={{ color: colors.accent, textDecorationLine: "underline" }}
              >
                {segment.value}
              </Text>
            ) : (
              <Text key={segmentIndex}>{segment.value}</Text>
            ),
          )}
        </Text>
      ))}
    </>
  );
}

/**
 * Ukáže, co je nového — jednou.
 *
 * Server už odfiltroval, co uživatel viděl. `minVersion` dořeší tenhle build:
 * server neví, jaká verze se ho ptá. Co tady vypadne, zůstane nevyřízené a
 * vyskočí po aktualizaci ze storu.
 */
export default function AnnouncementModal() {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const [pending, setPending] = useState<Announcement[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await api.getAnnouncements();
        if (cancelled) return;

        // První pohled: nic se neukazuje, jen se posune značka. Bez toho by
        // nový účet (a v den nasazení každý stávající) dostal celou historii.
        if (data.markTo) {
          queueSettingsPatch(api, { lastSeenAnnouncement: data.markTo });
          return;
        }

        const eligible = pendingAnnouncements(data.announcements, buildVersion);
        if (eligible.length === 0) return;
        setPending(eligible);
        setOpen(true);
      } catch {
        // Novinky nejsou důvod obtěžovat. Síťová chyba nezobrazí nic a nikde
        // nekřičí; příští spuštění to zkusí znovu.
      }
    })();

    return () => {
      cancelled = true;
    };
    // Jednou za spuštění appky. Zpráva, která dorazí uprostřed práce, počká na
    // příští start — vyskočit lidem pod rukama je horší než počkat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function close() {
    setOpen(false);
    const newest = newestAnnouncementId(pending);
    // Značka se posouvá jen na to, co se OPRAVDU ukázalo. `queueSettingsPatch`
    // si revizi řeší sám, takže se tu žádné baseRevision neshromažďuje.
    if (newest) queueSettingsPatch(api, { lastSeenAnnouncement: newest });
  }

  const single = pending.length === 1;

  return (
    <ModalPortal onRequestClose={close} visible={open}>
      <View
        style={[
          styles.modalOverlay,
          {
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            paddingBottom: 32 + insets.bottom,
          },
        ]}
      >
        <View
          style={{
            backgroundColor: colors.bg2,
            borderColor: colors.line2,
            borderRadius: 16,
            borderWidth: 1,
            gap: 16,
            maxHeight: "80%",
            paddingBottom: 20,
            paddingHorizontal: 28,
            paddingTop: 28,
            width: "100%",
          }}
        >
          <Text
            style={{ color: colors.fg, fontFamily: fonts.serif, fontSize: 22 }}
          >
            {single ? pending[0].title : "What's new"}
          </Text>

          <ScrollView>
            {pending.map((announcement, index) => (
              <View
                key={announcement.id}
                style={{ marginTop: index === 0 ? 0 : 20 }}
              >
                {/* U jediné zprávy je titulek už v hlavičce; opakovat ho uvnitř
                    by byly dva nadpisy pro totéž. */}
                {single ? null : (
                  <Text
                    style={{
                      color: colors.fg,
                      fontFamily: fonts.sans,
                      fontSize: 16,
                      marginBottom: 6,
                    }}
                  >
                    {announcement.title}
                  </Text>
                )}
                <Body body={announcement.body} />
              </View>
            ))}
          </ScrollView>

          <Btn label="Got it" onPress={close} />
        </View>
      </View>
    </ModalPortal>
  );
}
```

**Poznámka pro implementátora:** `colors.accent`, `colors.bg2`, `colors.fg2`,
`colors.line2` i `styles.modalOverlay` v `apps/client/constants/theme.ts`
existují (`theme.ts:35`, `:26`, `:32`, `:29`, `:133`). `colors` a `styles` se
při přepnutí motivu mutují, takže se čtou při renderu, ne na úrovni modulu —
proto jsou styly inline a ne ve `StyleSheet.create` mimo komponentu.
`ModalPortal` bere `visible` a `onRequestClose` a Android hardwarové zpět už
řeší sám (`apps/client/components/ui/ModalPortal.tsx:24-35`), takže gesto zpět
zavře modal a posune značku bez dalšího kódu.

- [ ] **Step 5: Namountovat**

V `apps/client/app/_layout.tsx` uprav závěrečný `return` (~ř. 150) tak, aby modal seděl nad `<Stack>` a ukazoval se jen přihlášenému:

```tsx
  return (
    <>
      <Stack screenOptions={{ /* beze změny */ }} />
      {session ? <AnnouncementModal /> : null}
    </>
  );
```

Nechávej `updateRequired` větev nad tím beze změny: kdo musí aktualizovat, nemá dostávat novinky o verzi, kterou nemá.

- [ ] **Step 6: Ověřit klienta**

Run: `pnpm --filter @musubi/client test && pnpm --filter @musubi/client exec tsc --noEmit`
Expected: PASS

- [ ] **Step 7: Ověřit celý repozitář**

Run: `pnpm check`
Expected: PASS — `release:verify`, `check:contracts`, `peers:check`, `typecheck`, `test`, `lint`, `build`

Pokud `check:contracts` hlásí neznámou cestu, chybí registrace v `apps/api/src/index.ts` (Task 5, Step 4). Pokud padá `wire.test.ts`, chybí `pnpm wire:snapshot` (Task 2, Step 6).

- [ ] **Step 8: Commit**

```bash
git add apps/client/services/api.ts apps/client/components/AnnouncementModal.tsx apps/client/components/AnnouncementModal.spec.tsx apps/client/app/_layout.tsx
git commit -m "feat(client): show what's new after an update"
```

---

## Pořadí nasazení

Podle `docs/releasing.md`: **API → web → store build.**

Tasky 1–5 jsou API a sdílené balíčky, a jsou aditivní — starý web i starý telefon je nepocítí. Tasky 6–8 jsou web, který se nasazuje po API. Task 9 je telefon a poletí ve store buildu, kdy k tomu dojde; do té doby appka žádné novinky neukazuje a nic se nerozbije.

Migrace ze zdrojů 2 a 3 běží při startu API (`packages/db/src/migrate.ts`), takže nasazení API je celé zavedení schématu.

## Co plán vědomě nedělá

- **Žádné drafty ani plánování dopředu.** Vytvoření v panelu = publikace, `id` razí server z dnešního data.
- **Žádné realtime doručení.** Zpráva se objeví při dalším startu klienta. Vyskočit lidem pod rukama je horší než počkat, a šetří to nový frame type v `check-realtime.mjs`.
- **Žádné obrázky ani markdown.** Prostý text a odkazy.
- **Žádné obecné nastavení serveru v panelu.** Samostatný návrh — viz spec.
