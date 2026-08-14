# Sjednocení attendees a RSVP

- Stav: approved (design), implementace ve fázích
- Datum: 2026-08-12
- Kontext: RSVP z veřejné stránky (M8.3) a členská účast v appce vedly dva oddělené
  seznamy lidí u téhož eventu. Odpověď z odkazu nebyla v kalendáři vidět nikde
  kromě dialogu sdílení. Product owner rozhodl seznamy sjednotit.

## Rozhodnutí

Jeden seznam lidí u eventu se stavem, ne dva zdroje. `event_users` dostane
`status`, `event_rsvps` zmizí.

Tím se **ruší** dřívější rozhodnutí zapsané v `docs/ui/calendar-ui.md:1088`
(„RSVP je vlastní tabulka, ne `event_users`"). Původní důvod byl, že cizí člověk
z veřejného odkazu nemá spadnout do seznamu, který vidí členové kalendáře.
Product owner tento trade-off vědomě přijímá: kdo vidí event, vidí i to, kdo na
něj odpověděl. Druhý důvod (boolean vs. „možná") padá tím, že se tříhodnotová
škála zavádí i uvnitř appky.

Odstavec v `docs/ui/calendar-ui.md` se přepíše, aby dokumentace netvrdila opak
toho, co kód dělá.

## Datový model

```
event_users
  + status text NOT NULL DEFAULT 'going'   -- going | maybe | declined
```

- **Žádný řádek = neodpověděl.** Přítomnost + `status` = odpověď. Unikátní
  `(event_id, user_id)` zůstává, takže zápis je dál idempotentní.
- `event_rsvps` se zahodí. Stavy měla stejné (`going | maybe | declined`), takže
  migrace je přesun řádků, ne převod.

Migrace (jedna, v `packages/db`):

1. `ALTER TABLE event_users ADD COLUMN status text NOT NULL DEFAULT 'going'` —
   existující členská účast tím dostane význam „jde", což je to, co dnes znamená.
2. `INSERT INTO event_users (event_id, user_id, status) SELECT … FROM event_rsvps
   ON CONFLICT (event_id, user_id) DO UPDATE SET status = excluded.status` —
   kolize je člen, který navíc odpověděl přes odkaz. Vyhrává explicitní
   tříhodnotová odpověď nad samotnou přítomností v seznamu.
3. `UPDATE events SET has_attendees = true WHERE id IN (SELECT event_id FROM
   event_shares)` — publikovaný event má odpovědi, takže sekce účastníků musí
   být zapnutá (viz Gating).
4. `DROP TABLE event_rsvps`.

## API

### Uvnitř appky

- `GET /api/v1/events/:eventId/attendees` → `[{ id, name, image, status }]`.
  Řadí **server**: `going` → `maybe` → `declined`, v každé skupině podle jména.
  Oba klienti pak zobrazují stejné pořadí bez vlastní logiky. Práva beze změny:
  stačí právo event vidět. E-maily účastníků API dál neposílá.
- `PUT /api/v1/events/:eventId/attendance`
  - nově `{ status: "going" | "maybe" | "declined" | "none" }`; `none` řádek maže.
  - `{ attending: boolean }` zůstává jako **alias** (`true` → `going`,
    `false` → `none`). Důvod: mobilní build je venku na Play a nasazení serveru
    nesmí čekat na store review.
  - vrací tentýž seznam jako `GET`.
- `GET /api/v1/events/:eventId/rsvps` **se ruší** — dialog sdílení ho přestane
  potřebovat a data jsou teď v `/attendees`.

### Veřejná stránka

- `PUT /api/v1/public/events/:token/rsvp` píše do `event_users`. Tvar odpovědi
  (`counts`, `mine`, `names`, `visibility`) zůstává; počty se ale počítají ze
  sjednoceného seznamu, takže **zahrnou i členy, kteří odpověděli v appce**.
  Jeden seznam znamená jeden počet.
- **Jméno je povinné.** Když účet nemá jméno a v těle nepřijde, endpoint vrátí
  400. Klient to blokuje dřív, než pošle kód, takže se to nedozvíš až po
  přihlášení. `nameAnonymousUser` (zápis jen do prázdného jména) zůstává —
  odpověď člena nesmí přepsat jeho profil.
- `"Guest"` zůstává jako fallback pro řádky, které vznikly před touto změnou.
- `attendeeVisibility` (`counts` / `names` / `hidden`) platí **jen pro čtenáře
  stránky**. Uvnitř appky neplatí — jinak by si organizátor nastavením pro cizí
  lidi schoval vlastní data.

### Realtime

SSE frame `attendance_changed` (payload `{ eventID, attendees }`) posílá i RSVP
cesta. Z `handlerSetAttendance` se vytáhne `notifyAttendanceChanged(eventID)` a
volají ho oba handlery — jinak by se logika „komu to poslat" rozešla.

### Federace

`/attendees` a `/attendance` se pro cizí kalendář dál proxují přes gateway
(ADR-005); v payloadu je navíc `status`, žádná nová federační cesta nevzniká.
Veřejná stránka a odpovědi žijí na origin serveru eventu.

## UI

### Ovládání (web i mobil)

Tři tlačítka v řadě: **Jdu / Možná / Nemůžu**, vybrané vyplněné (`aria-pressed`).
Klik na vybrané odpověď zruší (`status: "none"`) — to je dnešní „Leave", bez
čtvrtého tlačítka.

### Seznam

- Facepile nahoře: jen `going`, s „+N" po `FACEPILE_LIMIT`. Počet nad seznamem
  se dá číst na první pohled.
- Rozbalený seznam: skupiny **Jdou / Možná / Nemohou**, v tomto pořadí.
- Web: `EventDetailsPopover`. Mobil: `EventDetailModal`. Stejná anatomie, jak ji
  obě obrazovky mají dnes.

### Gating

Sekce zůstává podmíněná na `event.hasAttendees`; **publikování stránky ho
zapne** (server, při vytvoření share). Tím zůstává jeden zdroj pravdy pro UI a
nevzniká druhá podmínka na dvou klientech.

### Dialog sdílení

Blok „X going · Y maybe" a dotaz `event-rsvps` z `ShareEventDialog` zmizí.
Dialog řeší publikování a viditelnost; kdo odpověděl se čte v detailu eventu.

### Moderace

Organizátor odpovědi nemaže. Kdo má odkaz, může odpovědět znovu, takže mazání by
byl jen úklid — přidá se, až to někdo bude potřebovat.

## Fáze

Každá fáze je samostatně commitnutelná. Fáze 1 nesmí být nasazena bez fáze 3
(viz níže).

1. **DB + API** — migrace, `status` ve schématu, `/attendees` se statusy a
   řazením, `/attendance` se `status` + aliasem, RSVP píše do `event_users`,
   povinné jméno, `notifyAttendanceChanged`, publish → `hasAttendees`, smazání
   `/rsvps` a `event_rsvps` dotazů.
2. **Web** — `EventDetailsPopover` (tři stavy, skupiny, facepile), úklid
   `ShareEventDialog`, povinné jméno v `-rsvp-block.tsx`.
3. **Mobil** — `Attendee.status`, `api.setAttendance(event, status)`,
   `EventDetailModal` (tři stavy, skupiny, facepile).
4. **Docs** — přepsat odstavec v `docs/ui/calendar-ui.md:1088`, doplnit chování
   detailu a RSVP.

Dočasný filtr `declined` pro starý mobil se **nedělá**: fáze 3 jde ven ve stejné
dávce. Bez ní by starý klient zobrazil „nemůžu" jako „jde".

## Testy

- `apps/api` `events.test.ts`: `status` going/maybe/declined, `none` maže řádek,
  alias `{attending}`, řazení odpovědi (going → maybe → declined, pak jméno).
- `apps/api` `event_shares.test.ts`: RSVP zapíše řádek do `event_users`, počty
  zahrnou člena, který odpověděl v appce, 400 bez jména u účtu bez jména,
  publish nastaví `hasAttendees`, `attendeeVisibility` dál řídí jen `names`
  ve veřejné odpovědi.
- `apps/web`: detail popover ukazuje skupiny a klik na aktivní stav pošle
  `none`; share dialog už nedělá dotaz na odpovědi.
- `apps/client` (vitest): `setAttendance` posílá `status`, modal řadí do skupin.

## Rizika

- **Soukromí**: cizí jméno z veřejného odkazu uvidí každý člen kalendáře. Vědomé
  rozhodnutí (viz Rozhodnutí), ne omyl.
- **Starý mobil**: alias `{attending}` drží zápis, ale čtení statusů ne — proto
  fázi 3 nelze vynechat.
- **Migrace je jednosměrná**: `event_rsvps` po dropu neexistuje. Data jsou
  pre-release a přesouvají se, ne převádějí, takže rollback = restore zálohy.
