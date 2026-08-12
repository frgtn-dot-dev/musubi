# Sjednocení attendees a RSVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Jeden seznam lidí u eventu se stavem (`going | maybe | declined`), do kterého píše i RSVP z veřejné stránky, viditelný v detailu eventu na webu i na mobilu.

**Architecture:** `event_users` dostane `status`; `event_rsvps` se zmigruje a zahodí. `GET /events/:id/attendees` vrací statusy seřazené serverem, `PUT /attendance` bere `{status}` (se zpětně kompatibilním `{attending}`), veřejné RSVP píše do stejné tabulky a posílá stejný SSE frame. Klienti (web popover, mobil modal) ukazují tři tlačítka a seznam ve skupinách.

**Tech Stack:** Postgres + Drizzle (`packages/db`), Express (`apps/api`, testy `node:assert` nad čistými funkcemi), TanStack Start + Zod kontrakty (`apps/web`, vitest + Storybook), Expo/React Native + zustand (`apps/client`, vitest).

## Global Constraints

- Stavy jsou přesně `going | maybe | declined`; `none` je jen vstup do API a znamená smazání řádku. Žádný jiný string.
- Žádný řádek v `event_users` = neodpověděl. Přítomnost + `status` = odpověď.
- `PUT /events/:eventId/attendance` musí do odvolání přijímat i `{ attending: boolean }` (`true`→`going`, `false`→`none`) — starý mobilní build je venku na Play.
- API neposílá e-maily účastníků. Payload je `{ id, name, image, status }` a nic víc.
- `attendeeVisibility` (`counts | names | hidden`) platí **jen** pro veřejnou projekci, nikdy pro pohled uvnitř appky.
- Řazení seznamu dělá server: `going` → `maybe` → `declined`, uvnitř skupiny podle jména. Klienti nepřeřazují.
- Jméno je u RSVP povinné; `nameAnonymousUser` zapisuje jen do prázdného jména.
- Commity: konvence repa (`fix(web):`, `feat(api):` …), bez `Co-Authored-By`, zpráva 1–2 věty.
- Fáze 3 (mobil) musí jít ven ve stejné dávce jako 1–2. Žádný dočasný filtr `declined` na serveru.

---

## File Structure

**packages/db**
- `src/schema.ts` — `eventUsers.status`, smazaná tabulka `eventRsvps` + její relace/typy.
- `src/queries/events.ts` — `getEventAttendees` (statusy + řazení), `setAttendance(status)`, typ `AttendanceStatus`.
- `src/queries/event_shares.ts` — RSVP dotazy nahrazené čtením z `event_users`; `setEventRsvp`/`getEventRsvp`/`listEventRsvps` pryč.
- `src/index.ts` — exporty.
- `drizzle/0043_*.sql` — migrace (ALTER + přesun dat + DROP).
- `src/schema.test.ts` — assert na default a na to, že `event_rsvps` zmizelo.

**apps/api**
- `src/handlers/events.ts` — `parseAttendanceBody` (čistá funkce), `handlerSetAttendance`, `notifyAttendanceChanged`.
- `src/handlers/events.test.ts` — testy `parseAttendanceBody`.
- `src/handlers/event_shares.ts` — RSVP píše do `event_users`, povinné jméno, publish zapíná `hasAttendees`, `handlerGetEventRsvps` + `groupRsvps` pryč.
- `src/handlers/event_shares.test.ts` — testy `rsvpSummaryOf` (nová čistá funkce místo `groupRsvps`).
- `src/index.ts` — smazaná route `/events/:eventId/rsvps`.

**apps/web**
- `src/api/contracts.ts` — `AttendeeSchema.status`.
- `src/api/resources.ts` — `setAttendance(eventId, status, connectionId?)`.
- `src/calendar/attendance.ts` (nový) — `groupAttendees`, `nextStatus`; čistá logika pro popover, testovatelná bez DOM.
- `src/calendar/attendance.test.ts` (nový).
- `src/calendar/components/EventDetailsPopover.tsx` — tři tlačítka, skupiny, facepile jen `going`.
- `src/calendar/components/styles/event-details.module.css` — skupiny v seznamu.
- `src/calendar/components/ShareEventDialog.tsx` — blok odpovědí a dotaz `event-rsvps` pryč.
- `src/routes/-rsvp-block.tsx` — povinné jméno.

**apps/client (mobil)**
- `services/api.ts` — `Attendee.status`, `setAttendance(event, status)`.
- `lib/attendance.ts` (nový) — `groupAttendees` (stejná logika jako web, vlastní kopie kvůli hranici balíčků).
- `lib/attendance.test.ts` (nový).
- `components/calendar/EventDetailModal.tsx` — tři tlačítka, skupiny, facepile jen `going`.

**docs**
- `docs/ui/calendar-ui.md` — přepsaný odstavec o oddělených tabulkách.

---

### Task 1: `status` ve schématu a migrace

**Files:**
- Modify: `packages/db/src/schema.ts:400-428` (smazat `eventRsvps`, `eventRsvpsRelations`, `NewEventRsvp`), `packages/db/src/schema.ts:528-555` (přidat `status`)
- Create: `packages/db/drizzle/0043_<jméno od drizzle-kit>.sql`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Consumes: nic.
- Produces: `eventUsers.status` (text, NOT NULL, default `'going'`); tabulka `event_rsvps` a symboly `eventRsvps`, `eventRsvpsRelations`, `NewEventRsvp` už neexistují.

- [ ] **Step 1: Napiš padající test**

Do `packages/db/src/schema.test.ts` přidej (a `eventUsers` doplň do importu ze `./schema`):

```ts
assert.equal(
  eventUsers.status.notNull,
  true,
  "an attendee row must always say which answer it is",
);
assert.equal(
  eventUsers.status.default,
  "going",
  "membership rows that predate answers mean 'going'",
);
```

- [ ] **Step 2: Spusť test, musí padnout**

Run: `pnpm --filter @musubi/db test`
Expected: FAIL — `eventUsers.status` je `undefined`.

- [ ] **Step 3: Uprav schéma**

V `packages/db/src/schema.ts` v `eventUsers`:

```ts
  userID: text("user_id")
    .references(() => user.id, {
      onDelete: "cascade",
    })
    .notNull(),
  // going | maybe | declined. Žádný řádek = neodpověděl; presence + status je
  // celá odpověď. Členská účast z doby před RSVP je "going" (default).
  status: text("status").notNull().default("going"),
}, (t) => [unique().on(t.eventID, t.userID)]); // makes join idempotent (onConflictDoNothing)
```

Komentář nad tabulkou přepiš na: `// Attendees a jejich odpověď. Sem píše i RSVP z veřejné stránky (spec 2026-08-12).`

Smaž `eventRsvps`, `eventRsvpsRelations` a `NewEventRsvp` včetně komentáře nad nimi.

- [ ] **Step 4: Spusť test, musí projít**

Run: `pnpm --filter @musubi/db test`
Expected: PASS. TypeScript v `apps/api` teď padá na chybějících exportech — to řeší Task 2 a 3.

- [ ] **Step 5: Vygeneruj migraci**

Run: `pnpm --filter @musubi/db exec drizzle-kit generate`
Vznikne `drizzle/0043_*.sql` s `ALTER TABLE "event_users" ADD COLUMN "status" text DEFAULT 'going' NOT NULL;` a `DROP TABLE "event_rsvps" CASCADE;`.

- [ ] **Step 6: Doplň do migrace přesun dat**

Mezi ALTER a DROP (oddělené `--> statement-breakpoint`, stejně jako `drizzle/0042_fearless_mentor.sql`) vlož:

```sql
INSERT INTO "event_users" ("event_id", "user_id", "status")
SELECT "event_id", "user_id", "status" FROM "event_rsvps"
ON CONFLICT ("event_id", "user_id") DO UPDATE SET "status" = excluded."status";
--> statement-breakpoint
UPDATE "events" SET "has_attendees" = true
WHERE "id" IN (SELECT "event_id" FROM "event_shares");
```

Pořadí je závazné: DROP musí být poslední, jinak se přesouvá z neexistující tabulky.

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): give attendees a status and fold RSVPs into them"
```

---

### Task 2: Dotazy nad sjednoceným seznamem

**Files:**
- Modify: `packages/db/src/queries/events.ts:98-114`
- Modify: `packages/db/src/queries/event_shares.ts:119-162`
- Modify: `packages/db/src/index.ts` (exporty)

**Interfaces:**
- Consumes: `eventUsers.status` (Task 1).
- Produces:
  - `export type AttendanceStatus = "declined" | "going" | "maybe"`
  - `getEventAttendees(eventID: string): Promise<Array<{ id: string; name: string; image: string | null; status: AttendanceStatus }>>` — řazeno `going` → `maybe` → `declined`, pak podle jména.
  - `setAttendance(eventID: string, userID: string, status: AttendanceStatus | "none"): Promise<void>` — `"none"` řádek maže, jinak upsert.
  - `listEventAnswers(eventID: string): Promise<Array<{ name: string; status: AttendanceStatus; userID: string }>>` — pro veřejné počty; nahrazuje `listEventRsvps`.
  - Zrušené: `setEventRsvp`, `getEventRsvp`, `listEventRsvps`, `type RsvpStatus`.

- [ ] **Step 1: Přepiš `getEventAttendees` a `setAttendance`**

`packages/db/src/queries/events.ts` — řazení dělá SQL, aby web i mobil dostaly totéž:

```ts
export type AttendanceStatus = "declined" | "going" | "maybe";

// Řadí databáze, ne klient: web a mobil pak nemají dvě verze pořadí.
const STATUS_RANK = sql`CASE ${eventUsers.status}
  WHEN 'going' THEN 0 WHEN 'maybe' THEN 1 ELSE 2 END`;

export async function getEventAttendees(eventID: string) {
  const rows = await db
    .select({
      id: user.id,
      image: user.image,
      name: user.name,
      status: eventUsers.status,
    })
    .from(eventUsers)
    .innerJoin(user, eq(user.id, eventUsers.userID))
    .where(eq(eventUsers.eventID, eventID))
    .orderBy(STATUS_RANK, user.name);

  return rows as Array<{
    id: string;
    image: string | null;
    name: string;
    status: AttendanceStatus;
  }>;
}

// Idempotentní zápis odpovědi. "none" = odpověď zrušena, řádek zmizí.
export async function setAttendance(
  eventID: string,
  userID: string,
  status: AttendanceStatus | "none",
) {
  if (status === "none") {
    await db.delete(eventUsers).where(and(eq(eventUsers.eventID, eventID), eq(eventUsers.userID, userID)));
    return;
  }
  await db
    .insert(eventUsers)
    .values({ eventID, status, userID })
    .onConflictDoUpdate({
      set: { status, updatedAt: new Date() },
      target: [eventUsers.eventID, eventUsers.userID],
    });
}
```

Doplň importy `sql`, `user` (a ověř, že `and`, `eq` už tam jsou).

- [ ] **Step 2: Nahraď RSVP dotazy**

V `packages/db/src/queries/event_shares.ts` smaž `RsvpStatus`, `setEventRsvp`, `getEventRsvp`, `listEventRsvps` a přidej:

```ts
/** Odpovědi pro veřejné počty. Jeden seznam, takže členy z appky zahrnuje. */
export async function listEventAnswers(eventID: string) {
  const rows = await db
    .select({
      name: user.name,
      status: eventUsers.status,
      userID: eventUsers.userID,
    })
    .from(eventUsers)
    .innerJoin(user, eq(user.id, eventUsers.userID))
    .where(eq(eventUsers.eventID, eventID));

  return rows as Array<{ name: string; status: AttendanceStatus; userID: string }>;
}
```

Import `eventUsers` a `AttendanceStatus` (z `./events`).

- [ ] **Step 3: Sjednoť exporty**

V `packages/db/src/index.ts` odstraň `RsvpStatus`, `setEventRsvp`, `getEventRsvp`, `listEventRsvps`, `NewEventRsvp`, `eventRsvps` a přidej `AttendanceStatus`, `listEventAnswers`. (Pokud index re-exportuje `export * from`, ověř jen `pnpm --filter @musubi/db test`.)

- [ ] **Step 4: Ověř, že balíček stojí**

Run: `pnpm --filter @musubi/db test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db
git commit -m "feat(db): read and write attendance as a status"
```

---

### Task 3: `PUT /attendance` se stavem a společný SSE helper

**Files:**
- Modify: `apps/api/src/handlers/events.ts:251-278`
- Test: `apps/api/src/handlers/events.test.ts`

**Interfaces:**
- Consumes: `setAttendance`, `getEventAttendees`, `AttendanceStatus` (Task 2).
- Produces:
  - `export function parseAttendanceBody(body: unknown): AttendanceStatus | "none"` — `{status}` i legacy `{attending}`; jinak `BadRequestError`.
  - `export async function notifyAttendanceChanged(eventID: string, eventCalendars: string[]): Promise<Array<Attendee>>` — pošle frame `attendance_changed` členům všech kalendářů eventu a vrátí seznam, který poslala.

- [ ] **Step 1: Napiš padající testy**

Do `apps/api/src/handlers/events.test.ts` přidej (import `parseAttendanceBody` z `./events`):

```ts
assert.equal(parseAttendanceBody({ status: "going" }), "going");
assert.equal(parseAttendanceBody({ status: "maybe" }), "maybe");
assert.equal(parseAttendanceBody({ status: "declined" }), "declined");
assert.equal(parseAttendanceBody({ status: "none" }), "none");
// Starý mobilní build posílá boolean — nesmí přestat fungovat při nasazení API.
assert.equal(parseAttendanceBody({ attending: true }), "going");
assert.equal(parseAttendanceBody({ attending: false }), "none");
// Status vyhrává, kdyby klient poslal obojí.
assert.equal(parseAttendanceBody({ attending: false, status: "maybe" }), "maybe");
assert.throws(
  () => parseAttendanceBody({ status: "perhaps" }),
  (error: unknown) => error instanceof BadRequestError,
);
assert.throws(
  () => parseAttendanceBody({}),
  (error: unknown) => error instanceof BadRequestError,
);
```

- [ ] **Step 2: Spusť testy, musí padnout**

Run: `pnpm --filter @musubi/api test`
Expected: FAIL — `parseAttendanceBody` neexistuje.

- [ ] **Step 3: Implementuj**

V `apps/api/src/handlers/events.ts`:

```ts
const ATTENDANCE_STATUSES = new Set(["declined", "going", "maybe", "none"]);

/**
 * Co klient chce, aby platilo. `{status}` je dnešní tvar; `{attending}` je starý
 * mobilní build, který je venku na Play — nasazení API na něj nesmí čekat.
 */
export function parseAttendanceBody(body: unknown): AttendanceStatus | "none" {
  const input = (body ?? {}) as { attending?: unknown; status?: unknown };
  if (typeof input.status === "string") {
    if (!ATTENDANCE_STATUSES.has(input.status)) {
      throw new BadRequestError("status must be going, maybe, declined or none...");
    }
    return input.status as AttendanceStatus | "none";
  }
  if (typeof input.attending === "boolean") return input.attending ? "going" : "none";

  throw new BadRequestError("status (going | maybe | declined | none) is required...");
}

/** Živý update otevřených detailů. Volá to attendance i veřejné RSVP. */
export async function notifyAttendanceChanged(eventID: string, eventCalendars: string[]) {
  const attendees = await getEventAttendees(eventID);
  const memberIDSeen = new Set<string>();
  for (const cal of eventCalendars) {
    for (const member of await getCalendarMembers(cal)) memberIDSeen.add(member.userID);
  }
  notifyCalendarMembers([...memberIDSeen], "attendance_changed", { eventID, attendees });

  return attendees;
}

export async function handlerSetAttendance(req: Request, res: Response) {
  const eventID = requireUUID(req.params.eventId, "eventId");
  const status = parseAttendanceBody(req.body);
  const eventCalendars = await assertCanViewEvent(req.user!.id, eventID);
  await setAttendance(eventID, req.user!.id, status);

  res.status(200).json(await notifyAttendanceChanged(eventID, eventCalendars));
}
```

- [ ] **Step 4: Spusť testy, musí projít**

Run: `pnpm --filter @musubi/api test && pnpm --filter @musubi/api exec tsc --noEmit`
Expected: testy PASS; `tsc` ještě padá na `event_shares.ts` (Task 4).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/handlers/events.ts apps/api/src/handlers/events.test.ts
git commit -m "feat(api): accept an attendance status, keep the boolean as an alias"
```

---

### Task 4: Veřejné RSVP píše do attendees

**Files:**
- Modify: `apps/api/src/handlers/event_shares.ts:1-12` (importy), `:60-120` (publish), `:195-300` (RSVP sekce)
- Modify: `apps/api/src/index.ts:197` (smazat route)
- Test: `apps/api/src/handlers/event_shares.test.ts`

**Interfaces:**
- Consumes: `setAttendance`, `listEventAnswers`, `notifyAttendanceChanged` (Task 2, 3).
- Produces:
  - `export function rsvpSummaryOf(input: { answers: Array<{ name: string; status: string; userID: string }>; userID: string; visibility: string }): { counts: { declined: number; going: number; maybe: number }; mine: string | null; names: string[]; visibility: string }`
  - `handlerGetEventRsvps` a `groupRsvps` už neexistují.

- [ ] **Step 1: Napiš padající testy**

V `apps/api/src/handlers/event_shares.test.ts` nahraď import `groupRsvps` za `rsvpSummaryOf` a testy nad ním přidej:

```ts
const ANSWERS = [
  { name: "Bára", status: "going", userID: "u-1" },
  { name: "Cyril", status: "maybe", userID: "u-2" },
  { name: "Dana", status: "declined", userID: "u-3" },
  { name: "Ema", status: "going", userID: "u-4" },
];

{
  const summary = rsvpSummaryOf({ answers: ANSWERS, userID: "u-2", visibility: "names" });
  assert.deepEqual(summary.counts, { declined: 1, going: 2, maybe: 1 });
  assert.equal(summary.mine, "maybe");
  // Jména jen těch, kdo řekli ano — "možná" a "ne" jsou odpovědi dané v důvěře.
  assert.deepEqual(summary.names, ["Bára", "Ema"]);
}
{
  // Počty jsou počty všech, kdo odpověděli, včetně členů z appky: jeden seznam,
  // jeden počet.
  const summary = rsvpSummaryOf({ answers: ANSWERS, userID: "nobody", visibility: "counts" });
  assert.equal(summary.mine, null);
  assert.deepEqual(summary.names, []);
}
{
  const summary = rsvpSummaryOf({
    answers: [{ name: "  ", status: "going", userID: "u-5" }],
    userID: "u-5",
    visibility: "names",
  });
  // Řádky z doby před povinným jménem musí být čitelné, ne prázdné.
  assert.deepEqual(summary.names, ["Guest"]);
}
```

- [ ] **Step 2: Spusť testy, musí padnout**

Run: `pnpm --filter @musubi/api test`
Expected: FAIL — `rsvpSummaryOf` neexistuje.

- [ ] **Step 3: Přepiš RSVP sekci**

V `apps/api/src/handlers/event_shares.ts`:

```ts
export function rsvpSummaryOf({
  answers,
  userID,
  visibility,
}: {
  answers: Array<{ name: string; status: string; userID: string }>;
  userID: string;
  visibility: string;
}) {
  return {
    counts: {
      declined: answers.filter((answer) => answer.status === "declined").length,
      going: answers.filter((answer) => answer.status === "going").length,
      maybe: answers.filter((answer) => answer.status === "maybe").length,
    },
    mine: answers.find((answer) => answer.userID === userID)?.status ?? null,
    // Jména jen když to organizátor zapnul, a jen u těch, kdo řekli ano.
    names:
      visibility === "names"
        ? answers
            .filter((answer) => answer.status === "going")
            // "Guest" jen pro řádky z doby před povinným jménem.
            .map((answer) => answer.name.trim() || "Guest")
            .sort((left, right) => left.localeCompare(right))
        : [],
    visibility,
  };
}

export async function handlerPutPublicRsvp(req: Request, res: Response) {
  const status = String(req.body?.status ?? "");
  if (!RSVP_STATUSES.has(status)) {
    throw new BadRequestError("status must be going, maybe or declined...");
  }
  const name = String(req.body?.name ?? "").trim().slice(0, 80);
  // Jméno je povinné: seznam účastníků v appce je seznam lidí, ne seznam prázdna.
  if (!name && !req.user!.name?.trim()) {
    throw new BadRequestError("name is required for a first answer...");
  }
  if (name) await nameAnonymousUser(req.user!.id, name);

  const share = await getSharedEventId(String(req.params.token));
  if (!share) throw new NotFoundError("This event page is not available...");

  await setAttendance(share.eventID, req.user!.id, status as AttendanceStatus);
  // Členům kalendáře se otevřený detail aktualizuje sám — stejný frame jako
  // účast z appky, protože je to teď tentýž seznam.
  await notifyAttendanceChanged(share.eventID, await getEventCalendars(share.eventID));

  res.status(200).json(await rsvpSummary(share, req.user!.id));
}

async function rsvpSummary(
  share: { attendeeVisibility: string; eventID: string },
  userID: string,
) {
  return rsvpSummaryOf({
    answers: await listEventAnswers(share.eventID),
    userID,
    visibility: share.attendeeVisibility,
  });
}
```

Smaž `handlerGetEventRsvps`, `groupRsvps`, `rsvpCounts` a nepoužité importy (`listEventRsvps`, `setEventRsvp`, `RsvpStatus`). Přidej importy `getEventCalendars`, `listEventAnswers`, `setAttendance`, `type AttendanceStatus` z `@musubi/db` a `notifyAttendanceChanged` z `./events`.

- [ ] **Step 4: Publikování zapne `hasAttendees`**

V `handlerPutEventShare` (kolem `apps/api/src/handlers/event_shares.ts:92`, tam kde se volá `nameAnonymousUser(req.user!.id, organizer)`) doplň za `upsertEventShare`:

```ts
  // Publikovaná stránka sbírá odpovědi, takže sekce účastníků musí být zapnutá —
  // jinak by detail eventu odpovědi měl a neukázal je.
  await setEventHasAttendees(share.eventID, true);
```

V `packages/db/src/queries/events.ts` k tomu přidej:

```ts
export async function setEventHasAttendees(eventID: string, hasAttendees: boolean) {
  await db.update(events).set({ hasAttendees }).where(eq(events.id, eventID));
}
```

(a exportuj z `packages/db/src/index.ts`, pokud index vyjmenovává symboly).

- [ ] **Step 5: Smaž zrušenou route**

V `apps/api/src/index.ts` smaž řádek s `app.get("/api/v1/events/:eventId/rsvps", …)` a `handlerGetEventRsvps` z importu.

- [ ] **Step 6: Spusť testy a typy**

Run: `pnpm --filter @musubi/api test && pnpm --filter @musubi/api exec tsc --noEmit`
Expected: PASS oboje.

- [ ] **Step 7: Commit**

```bash
git add apps/api packages/db
git commit -m "feat(api): write public RSVPs into the attendee list"
```

---

### Task 5: Web — tři stavy a skupiny v detailu

**Files:**
- Modify: `apps/web/src/api/contracts.ts:17-23`
- Modify: `apps/web/src/api/resources.ts:643-655`
- Create: `apps/web/src/calendar/attendance.ts`
- Create: `apps/web/src/calendar/attendance.test.ts`
- Modify: `apps/web/src/calendar/components/EventDetailsPopover.tsx:85-92, 187-190, 417-434, 677-745`
- Modify: `apps/web/src/calendar/components/styles/event-details.module.css`
- Modify: `apps/web/src/calendar/components/Workspace.tsx` (typ `onSetAttendance`)
- Modify: `apps/web/src/routes/app/p.$pageId.$view.tsx` (volání `setAttendance`)

**Interfaces:**
- Consumes: API z Tasku 3 a 4.
- Produces:
  - `AttendeeSchema` má `status: z.enum(["declined", "going", "maybe"])`.
  - `setAttendance(eventId: string, status: AttendanceChoice, connectionId?: string)` kde `AttendanceChoice = "declined" | "going" | "maybe" | "none"`.
  - `apps/web/src/calendar/attendance.ts`:
    - `export const ATTENDANCE_CHOICES: Array<{ label: string; value: "declined" | "going" | "maybe" }>` — `Going`, `Maybe`, `Can't go` v tomto pořadí.
    - `export function groupAttendees(attendees: Attendee[]): Array<{ items: Attendee[]; status: "going" | "maybe" | "declined"; title: string }>` — vrací jen neprázdné skupiny, v pořadí going → maybe → declined.
    - `export function nextChoice(mine: string | undefined, clicked: "declined" | "going" | "maybe"): AttendanceChoice` — klik na už vybraný stav vrací `"none"`.

- [ ] **Step 1: Napiš padající test**

`apps/web/src/calendar/attendance.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { groupAttendees, nextChoice } from "./attendance";

const attendee = (id: string, status: "declined" | "going" | "maybe") => ({
  id,
  image: null,
  name: id,
  status,
});

describe("groupAttendees", () => {
  it("keeps the server order and drops empty groups", () => {
    const groups = groupAttendees([
      attendee("a", "going"),
      attendee("b", "declined"),
      attendee("c", "going"),
    ]);

    expect(groups.map((group) => group.status)).toEqual(["going", "declined"]);
    expect(groups[0]!.items.map((item) => item.id)).toEqual(["a", "c"]);
    expect(groups[0]!.title).toBe("Going");
  });
});

describe("nextChoice", () => {
  it("clears the answer when the chosen state is clicked again", () => {
    expect(nextChoice("going", "going")).toBe("none");
    expect(nextChoice("going", "maybe")).toBe("maybe");
    expect(nextChoice(undefined, "declined")).toBe("declined");
  });
});
```

- [ ] **Step 2: Spusť test, musí padnout**

Run: `pnpm --filter @musubi/web exec vitest run src/calendar/attendance.test.ts`
Expected: FAIL — modul neexistuje.

- [ ] **Step 3: Implementuj `attendance.ts`**

```ts
import type { Attendee } from "~/api/contracts";

export type AttendanceChoice = Attendee["status"] | "none";

/** Odpověď, ne nastavení: pořadí je to, v jakém lidé odpovídají. */
export const ATTENDANCE_CHOICES: Array<{
  label: string;
  value: Attendee["status"];
}> = [
  { label: "Going", value: "going" },
  { label: "Maybe", value: "maybe" },
  { label: "Can’t go", value: "declined" },
];

const GROUP_TITLES: Array<{ status: Attendee["status"]; title: string }> = [
  { status: "going", title: "Going" },
  { status: "maybe", title: "Maybe" },
  { status: "declined", title: "Can’t go" },
];

/** Server už seznam seřadil, tady se jen krájí na skupiny. */
export function groupAttendees(attendees: Attendee[]) {
  return GROUP_TITLES.map(({ status, title }) => ({
    items: attendees.filter((attendee) => attendee.status === status),
    status,
    title,
  })).filter((group) => group.items.length > 0);
}

/** Klik na už vybranou odpověď ji zruší — to je dnešní „Leave". */
export function nextChoice(
  mine: string | undefined,
  clicked: Attendee["status"],
): AttendanceChoice {
  return mine === clicked ? "none" : clicked;
}
```

- [ ] **Step 4: Spusť test, musí projít**

Run: `pnpm --filter @musubi/web exec vitest run src/calendar/attendance.test.ts`
Expected: PASS.

- [ ] **Step 5: Kontrakt a resource**

`contracts.ts`:

```ts
export const AttendeeSchema = z.object({
  id: z.string(),
  image: z.string().nullish(),
  name: z.string(),
  status: z.enum(["declined", "going", "maybe"]),
});
```

`resources.ts`:

```ts
export function setAttendance(
  eventId: string,
  status: AttendanceChoice,
  connectionId?: string,
) {
  return apiRequest(
    route(connectionId, `/api/v1/events/${eventId}/attendance`),
    {
      body: { status },
      method: "PUT",
      responseSchema: AttendeesResponseSchema,
    },
  );
}
```

Volající v `apps/web/src/routes/app/p.$pageId.$view.tsx` (hledej `setAttendance`) a typ `onSetAttendance` ve `Workspace.tsx` / `EventDetailsPopover.tsx` přepiš z `attending: boolean` na `status: AttendanceChoice`.

- [ ] **Step 6: Popover — tři tlačítka a skupiny**

V `EventDetailsPopover.tsx` nahraď `isAttending`/`handleAttendance`:

```ts
	const mine = attendees?.find((attendee) => attendee.id === user.id)?.status;
	const going = attendees?.filter((attendee) => attendee.status === "going") ?? [];

	async function handleAnswer(choice: Attendee["status"]) {
		setBusyAction("attendance");
		setActionError(undefined);
		const next = nextChoice(mine, choice);

		try {
			setAttendees(
				await onSetAttendance({
					calendarId: homeCalendar?.id,
					eventId: master.id,
					status: next,
				}),
			);
			onNotice(next === "none" ? "Answer cleared." : "Answer saved.");
		} catch (error) {
			setActionError(getEventMutationError(error, "update", homeCalendar));
		} finally {
			setBusyAction(undefined);
		}
	}
```

V hlavičce sekce místo jednoho tlačítka:

```tsx
											{attendees ? (
												<div className={styles.answerRow} role="group" aria-label="Your answer">
													{ATTENDANCE_CHOICES.map((choice) => (
														<Button
															aria-pressed={mine === choice.value}
															key={choice.value}
															loading={busyAction === "attendance"}
															size="compact"
															variant={mine === choice.value ? "primary" : "secondary"}
															onClick={() => void handleAnswer(choice.value)}
														>
															{choice.label}
														</Button>
													))}
												</div>
											) : null}
```

Počet v toggle labelu ber z `going.length` (`Attendees · ${going.length}`), facepile renderuj z `going`, a rozbalený seznam přes `groupAttendees(attendees)`:

```tsx
											<ul className={styles.attendeeList}>
												{groupAttendees(attendees).map((group) => (
													<li key={group.status}>
														<p className={styles.attendeeGroupTitle}>{group.title}</p>
														<ul>
															{group.items.map((item) => (
																<li key={item.id}>
																	<Avatar image={item.image} name={item.name} size="small" />
																	<span>{item.name}</span>
																</li>
															))}
														</ul>
													</li>
												))}
											</ul>
```

(Přesný tvar řádku opiš ze stávajícího seznamu — mění se jen zanoření do skupin.)

- [ ] **Step 7: CSS pro skupiny a řadu odpovědí**

Do `styles/event-details.module.css`:

```css
/* Odpověď je jedna volba ze tří, ne tři akce — proto řada, ne rozházená tlačítka. */
.answerRow {
  display: flex;
  gap: var(--space-1);
}

.attendeeGroupTitle {
  margin: 0 0 var(--space-1);
  color: var(--text-muted);
  font-size: var(--text-11);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.attendeeList > li + li {
  margin-top: var(--space-3);
}
```

- [ ] **Step 8: Spusť testy, typy a lint**

Run: `pnpm --filter @musubi/web exec tsc --noEmit && pnpm --filter @musubi/web exec vitest run && pnpm --filter @musubi/web lint`
Expected: PASS. Testy, které volaly `onSetAttendance({attending})`, uprav na `{status}`.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): answer events with going, maybe or can't go"
```

---

### Task 6: Web — úklid dialogu sdílení a povinné jméno v RSVP

**Files:**
- Modify: `apps/web/src/calendar/components/ShareEventDialog.tsx`
- Modify: `apps/web/src/api/resources.ts` (smazat `getEventRsvps`)
- Modify: `apps/web/src/api/contracts.ts` (smazat schéma odpovědí, pokud je jen pro tenhle dotaz)
- Modify: `apps/web/src/routes/-rsvp-block.tsx:79-170`

**Interfaces:**
- Consumes: `rsvpSummaryOf` odpověď z Tasku 4 (tvar se nemění).
- Produces: `getEventRsvps` a `styles.answers`/`AnswerList` v `ShareEventDialog` už neexistují.

- [ ] **Step 1: Vyhoď blok odpovědí ze dialogu**

Ze `ShareEventDialog.tsx` smaž dotaz `rsvps` (`useQuery` s `["event-rsvps", …]`), sekci `{answered ? …}` včetně `AnswerList`, proměnné `counts`/`answered` a import `getEventRsvps`. Ze `resources.ts` smaž `getEventRsvps`, z `contracts.ts` jeho response schéma.

- [ ] **Step 2: Jméno povinné dřív, než se pošle kód**

V `-rsvp-block.tsx` u formuláře:

```tsx
          <Field label="Your name">
            <input
              autoComplete="name"
              name="name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
```

a odesílací tlačítko drž zavřené, dokud jméno není:

```tsx
	const identityReady = name.trim().length > 0 && email.trim().length > 0;
```

`disabled={!identityReady}` na tlačítku, které posílá kód. Pro přihlášený účet bez jména (`session.data?.user.name` prázdné) ukaž stejné pole nad tlačítky odpovědí a odpověď bez jména neposílej — server by ji odmítl 400.

- [ ] **Step 3: Spusť testy, typy a lint**

Run: `pnpm --filter @musubi/web exec tsc --noEmit && pnpm --filter @musubi/web exec vitest run && pnpm --filter @musubi/web lint`
Expected: PASS. Storybook story `ShareEventDialog`, která čekala odpovědi, uprav nebo smaž.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src
git commit -m "fix(web): read answers in the event detail and require a name to RSVP"
```

---

### Task 7: Mobil — statusy v detailu

**Files:**
- Modify: `apps/client/services/api.ts:14-15, 266-296`
- Create: `apps/client/lib/attendance.ts`
- Create: `apps/client/lib/attendance.test.ts`
- Modify: `apps/client/components/calendar/EventDetailModal.tsx:55-83` a sekce účastníků

**Interfaces:**
- Consumes: API z Tasku 3.
- Produces:
  - `export type Attendee = { id: string; name: string; image?: string | null; status: "declined" | "going" | "maybe" }`
  - `api.setAttendance(event: Event, status: Attendee["status"] | "none"): Promise<Attendee[]>`
  - `apps/client/lib/attendance.ts`: `ATTENDANCE_CHOICES`, `groupAttendees`, `nextChoice` — stejné signatury jako web (Task 5), vlastní kopie kvůli hranici balíčků.

- [ ] **Step 1: Napiš padající test**

`apps/client/lib/attendance.test.ts` — stejná dvě tvrzení jako na webu (Task 5, Step 1), jen s `import { groupAttendees, nextChoice } from "./attendance";` a bez `image: null` (na mobilu je `image?`).

- [ ] **Step 2: Spusť test, musí padnout**

Run: `pnpm --filter @musubi/client exec vitest run lib/attendance.test.ts`
Expected: FAIL — modul neexistuje. 

- [ ] **Step 3: Implementuj `lib/attendance.ts` a uprav api**

Obsah `attendance.ts` je kopie webové verze (Task 5, Step 3) s importem `Attendee` z `@/services/api`.

V `services/api.ts`:

```ts
// Names + avatars only — the API deliberately sends no attendee emails.
export type Attendee = {
  id: string;
  name: string;
  image?: string | null;
  status: "declined" | "going" | "maybe";
};
```

a `setAttendance` posílá `{ status }` místo `{ attending }` (obě větve — federovanou i domácí).

- [ ] **Step 4: Detail modal**

V `EventDetailModal.tsx`:
- `isAttending`/`toggleAttendance` nahraď `mine = attendees?.find(a => a.id === userID)?.status` a `answer(choice)`, které pošle `nextChoice(mine, choice)`; optimistický zápis do storu nastav `status` (u `none` řádek odeber).
- Místo jednoho `Tap` s „Attend/Leave" řadu tří `Tap` (Going / Maybe / Can't go), vybraný s `backgroundColor: colors.fill` a `colors.onFill`, ostatní průhledné — stejná pilulka, jakou má dnešní tlačítko.
- `Attendees · {attendees.length}` → počet `going`; facepile mapuj z `going`; rozbalený `ScrollView` renderuj přes `groupAttendees(attendees)` s hlavičkou skupiny (`fontSize: 11, color: colors.fg4, textTransform: "uppercase"`).

- [ ] **Step 5: Spusť testy a typy**

Run: `pnpm --filter @musubi/client exec vitest run && pnpm --filter @musubi/client exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/client
git commit -m "feat(client): answer events with going, maybe or can't go"
```

---

### Task 8: Dokumentace

**Files:**
- Modify: `docs/ui/calendar-ui.md:1088-1090` a okolí

**Interfaces:**
- Consumes: hotové Tasky 1–7.
- Produces: dokumentace, která netvrdí opak kódu.

- [ ] **Step 1: Přepiš odstavec**

Nahraď odstavec „RSVP je vlastní tabulka, ne `event_users` …" tímto:

```markdown
- **RSVP a účast jsou jeden seznam** (spec `docs/superpowers/specs/2026-08-12-attendees-rsvp-unification-design.md`).
  `event_users` nese `status` (`going | maybe | declined`), veřejná odpověď píše
  do stejné tabulky a `event_rsvps` zmizelo. Důvod: odpověď z odkazu nebyla v
  kalendáři vidět nikde kromě dialogu sdílení, a dva seznamy u jedné akce se
  nedaly srovnat. Cenou je, že cizí jméno z veřejného odkazu uvidí každý, kdo
  vidí event — vědomý trade-off, ne omyl.
- Detail eventu odpovídá **třemi tlačítky** (Jdu / Možná / Nemůžu); klik na už
  vybrané odpověď zruší (`status: "none"`), což je dřívější „Leave". Facepile
  ukazuje jen `going`, rozbalený seznam má skupiny.
- `PUT /events/:id/attendance` bere `{status}` a **stále** `{attending}` jako
  alias — mobilní build je venku na Play a nasazení API na store review nečeká.
- `attendeeVisibility` řídí jen veřejnou projekci. Uvnitř appky seznam vidí
  každý, kdo vidí event; `GET /events/:id/rsvps` už neexistuje.
```

- [ ] **Step 2: Commit**

```bash
git add docs/ui/calendar-ui.md
git commit -m "docs: record that attendance and RSVP are one list"
```

---

## Self-Review

**Spec coverage:** model + migrace → Task 1–2; API včetně aliasu, SSE, federace (proxy beze změny) a zrušení `/rsvps` → Task 3–4; publish → `hasAttendees` → Task 4 Step 4; povinné jméno → Task 4 Step 3 (server) + Task 6 Step 2 (klient); tři stavy, skupiny, facepile → Task 5 a 7; úklid dialogu → Task 6; docs → Task 8. Moderace se záměrně neimplementuje (spec: „přidá se, až to někdo bude potřebovat").

**Typová konzistence:** `AttendanceStatus` (`packages/db`, `apps/api`) = `"declined" | "going" | "maybe"`; `"none"` existuje jen jako vstup API a `AttendanceChoice` na klientech. `groupAttendees`/`nextChoice`/`ATTENDANCE_CHOICES` mají stejné signatury na webu i na mobilu.
