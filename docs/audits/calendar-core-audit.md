# Audit hlavní funkce Musubi: sjednocený kalendář

Datum: 2026-09-05. Auditovaná revize: `60316a921651feaf0e2bfc4604d68c4e85ca8cfc`, větev `main`.

## Závěr

Musubi má použitelný architektonický základ, ale zatím nelze slíbit věrnou a spolehlivou obousměrnou práci se všemi třemi providery. Největší problém není nedostatek obrazovek. Je to rozdíl mezi úspěšným lokálním uložením, skutečným doručením providerovi a zachováním významu původní události.

Doporučený produktový slib:

> Všechny moje kalendáře na jednom místě. Správné časy, bezpečné úpravy a jasná informace, co je skutečně synchronizované.

Nepřepisovat aplikaci ani adapterovou architekturu. Dokončit současné jádro; nyní nerozšiřovat počet providerů nebo vedlejší produktové oblasti.

## Rozsah a síla důkazů

- Pročteny adaptéry, synchronizační engine, relevantní DB dotazy a schéma, API mutace, webové a nativní klientské cesty, testy a CI.
- Tři nezávislé read-only kontroly: věrnost providerů, spolehlivost synchronizace, úplnost klientských cest. Závažné závěry následně ověřeny proti zdrojům.
- Tři chyby reprodukovány lokálně nad skutečnými funkcemi a syntetickými vstupy: časová pásma, Google výjimka opakování, CalDAV obsah výjimky.
- Ostatní nálezy vycházejí ze zdrojového toku, nikoli z provedených útoků nebo zápisů do živých účtů.
- Neproběhl živý Google/Outlook/iCloud round-trip, DB integrační běh, browser E2E, kontrola na fyzickém telefonu ani plný build/typecheck. Toto není certifikace kompatibility ani úplný bezpečnostní audit.
- Implementace zůstala beze změn; výstupem je pouze tento dokument.

## Co už stojí za zachování

- `CalendarAdapter` odděluje providerové API od orchestrace a normalizace.
- Více účtů, externí zrcadlové kalendáře, jednotný pohled, CRUD a sdílené výpočty opakování existují.
- Google má inkrementální event sync; Microsoft stránkované calendar-view delta; CalDAV již používá `sync-collection` s úplným fallbackem. Není pravda, že současný CalDAV vždy pouze stahuje vše.
- OAuth refresh/reconnect, izolace selhání účtů, šifrování přihlašovacích údajů, SSE, cache a tombstones jsou skutečné implementace.
- CalDAV při běžné úpravě zachovává UID, ETag, původní časové zóny, alarmy a nedotčené části ICS.
- Existují unit testy, lokální falešné HTTP servery, DB integrační testy a browserové testy; není potřeba budovat další testovací framework.
- Web i mobil mají vlastní Musubi vizuální jazyk. Restyle není nutný pro dokončení hlavní funkce.

Základní zdroje: `apps/api/src/sync/adapter.ts`, `apps/api/src/sync/engine.ts`, `packages/db/src/queries/external.ts`, `packages/calendar/src`, `.github/workflows/quality.yml`.

## Skutečné pokrytí providerů

„Částečně“ rozlišuje čtení, zápis a zachování původních dat. Existence CRUD neznamená úplnou kompatibilitu.

| Oblast | Google Calendar | Outlook / Graph | CalDAV |
| --- | --- | --- | --- |
| Jednorázové události, základní pole | Čtení a zápis implementovány | Čtení a zápis implementovány | Čtení a zápis implementovány |
| Více účtů a kalendářů | Ano; chybí stránkování seznamu kalendářů | Ano; vadný bootstrap prvního účtu na webu | Ano |
| Celodenní události | Převod DATE a exkluzivního konce | Převod exkluzivního konce; širší non-UTC ověření chybí | Převod DATE a exkluzivního konce |
| Opakované série | RRULE; ztrácí se identita nativních výjimek | Import rozbalených výskytů; vytvoření série z Musubi odmítnuto | RRULE/EXDATE/RDATE; výjimky zredukovány na rozvrh |
| Jeden výskyt / následující / série | Lokální transformace, nikoli plné nativní operace | Importované výskyty ztrácejí vazbu na sérii | Lokální transformace s rizikem ztráty nativních výjimek |
| Časové pásmo série | V normalizovaném modelu chybí | Importované výskyty rozbaluje provider | Původní TZID se zachovává při zápisu, ale chybí pro lokální expanzi |
| Externí účastníci a RSVP | Nesynchronizují se do společného modelu | Totéž | Totéž; scheduling není totéž co VEVENT CRUD |
| Nativní připomínky | Nejsou propojené s Musubi připomínkami | Totéž | VALARM se zachovává, ale není sjednoceně spravovaný |
| Ochrana souběžných event zápisů | Chybí použití verzí/podmíněných zápisů | Totéž | ETag/podmíněné zápisy existují; chybí uživatelské řešení konfliktu |
| Read-only | Kontrola calendar accessRole | Kontrola canEdit | Discovery nepředává oprávnění; chybí bezpečný stav „neznámé“ |
| Rozsah importu | Event sync podle providerového seznamu | Okno přibližně −180 / +730 dní; není úplný archiv | Kolekce podle discovery/reportů |

Musubi RSVP, členství kalendáře a lokální připomínky jsou užitečné vlastní funkce, ale nejsou důkazem podpory Google/Outlook/CalDAV pozvánek a alarmů.

## Prioritizované nálezy

Priority jsou pořadí produktové nápravy, nikoli CVSS hodnocení.

### A1 — Neautoritativní externí kopie může změnit nebo smazat originál

**Blokuje důvěryhodné sdílení.** Uživatel s právem čtení smí propojit událost do svého zapisovatelného kalendáře. Vznikne externí kopie. Příchozí změna této kopie aktualizuje společný `events` řádek bez kontroly `originCalendarID`; příchozí smazání jej tombstonuje globálně.

Scénář: Bob pouze čte událost Alice, přidá si ji do Googlu a upraví/smaže ji tam. Synchronizace může změnit/smazat událost Alice, ačkoli přímé Musubi API by Bobovu obsahovou úpravu odmítlo. Nejde o prolomení Google ACL, ale o obejití Musubi hranice vlastnictví přes import.

Důkazy: `apps/api/src/handlers/events.ts:251–274`, `packages/db/src/queries/external.ts:457–560`.

Směr: oddělit autoritativní zdroj od odvozených kopií. Smazání neautoritativní kopie odpojí pouze tento cíl. Autoritativní import musí mít explicitní pravidla propagace do dalších kopií. Žádné automatické slučování nesouvisejících událostí podle názvu a času.

### A2 — Zápisy se mohou ztratit, zatímco API hlásí úspěch

**Blokuje důvěryhodnou obousměrnou synchronizaci.** `pushEventToCalendars` chyby zachytí a zaloguje. Lokální create/update přesto vrátí úspěch. Neexistuje trvalá fronta nedoručených operací.

- Neúspěšný create zanechá pouze lokální událost. Další update bez externího mapování přeskočí doručení.
- Neúspěšný delete může přijít o mapování potřebné pro opakování operace, zatímco vzdálená událost žije dál.
- Vzdálený create může uspět, ale odpověď nebo uložení mapování selhat; následný import může vytvořit duplicitu.
- Polling opakuje čtení, nikoli ztracený úmysl zápisu.

Důkazy: `apps/api/src/sync/engine.ts:337–415`, `apps/api/src/handlers/events.ts:98–118,147–176,220–245`.

Směr: lokální změna a záznam outbound operace v jedné DB transakci; idempotence, uchování adresy smazaného objektu, retry/backoff a stavy pending/synced/failed/conflict. Stačí současný Postgres a worker v existujícím procesu. Samotné vyhození chyby až po lokálním commitu problém neřeší.

### A3 — Bootstrap a úplnost importu nejsou spolehlivé

1. **První Microsoft účet na webu:** callback volá `syncProviderCalendars()`, ale `/calendars/google` synchronizuje pouze Google. Scheduler vybírá uživatele z již existujících externích zrcadel. Microsoft-only uživatel bez zrcadel se tak vůbec nemusí dočkat prvního importu. Důkazy: `apps/web/src/calendar/connections.ts:110`, `apps/web/src/api/resources.ts:480–498`, `apps/api/src/handlers/google.ts:23–31`, `packages/db/src/queries/external.ts:605–609`.
2. **Google calendar discovery:** ignoruje `nextPageToken`; engine považuje první stránku za kompletní seznam a chybějící zrcadla odstraňuje. Nejde o smazání kalendáře u Googlu, ale o lokální ztrátu platného zrcadla. Důkazy: `apps/api/src/sync/adapters/google.ts:512–533`, `apps/api/src/sync/engine.ts:148–165`.
3. **Graph načtení masteru:** neúspěšný požadavek na master série vrátí `null`; neúplné výskyty se přesto uloží a cursor postoupí. Transientní 429/503 tak může zanechat výskyt bez názvu nebo správného all-day příznaku bez garantovaného opakování. Důkazy: `apps/api/src/sync/adapters/microsoft.ts:413–429,477–502`.

Směr: explicitní provider/account bootstrap, discovery práce z oprávněných účtů i bez zrcadel, úplné stránkování před mazáním, neposouvat cursor přes neúplné povinné závislosti.

### A4 — Opakování není věrné napříč providery

- **Google:** normalizace zahazuje `recurringEventId` a `originalStartTime`. Přesunutý výskyt se přidá jako samostatná událost a původní slot se dál generuje z masteru. Zrušená instance obdobně nedokáže potlačit generovaný výskyt. Důkaz: `apps/api/src/sync/adapters/google.ts:157–197`.
- **CalDAV:** detached výjimky se promění na EXDATE/RDATE. Jejich vlastní název, délka a další přepsaná pole se nezobrazí. Při změně recurrence řetězce se navíc odstraní všechny detached komponenty stejného UID, tedy potenciálně i nesouvisející výjimky. Důkaz: `apps/api/src/sync/adapters/caldav.ts:83–114,440–481`.
- **Outlook:** import zahodí vztah výskyt–master; vytvoření opakované události adapter explicitně odmítá. V kombinaci s A2 může přesto vzniknout úspěšně uložená lokální série. Důkaz: `apps/api/src/sync/adapters/microsoft.ts:92–164`.
- **Oba klienti:** „tento výskyt“ a „tento a následující“ provádějí samostatnou aktualizaci masteru a vytvoření náhrady. Selhání druhého kroku zanechá sérii oříznutou. Důkaz: `packages/calendar/src/recurrence-edit.ts:34–123`, `apps/client/lib/seriesEdit.ts:65–70`, `apps/web/src/calendar/components/Workspace.tsx:419–429`.

Směr: explicitní identita série a původního výskytu, oddělené overrides a operace se scope prováděná na serveru. Nezaměňovat nativní výjimku za nový nezávislý meeting. Nepodporované destruktivní změny dočasně odmítnout před uložením, nikoli tiše zploštit.

### A5 — Časové pásmo série závisí na čtenáři

`Event` nemá vlastní TZID. Expanze používá lokální časové pásmo runtime a sama tento limit dokumentuje. Jeden meeting tak může pro dva čtenáře reprezentovat jiný okamžik, nejen jiné lokální zobrazení.

Důkazy: `packages/types/src/event.ts:3–22`, `packages/calendar/src/recurrence.ts:93–132,166–219`.

Směr: časová zóna série musí patřit události. Oddělit okamžik, lokální čas s TZID, floating čas a celodenní datum podle potřeby providerů. Interní inclusive all-day konec dnes adaptéry převádějí; nepřepisovat jej samoúčelně bez kompatibilní migrace. Nová pole zavádět aditivně, včetně rozumného chování starších klientů a historických událostí s neznámou zónou.

### A6 — Běžná editace může přepsat cizí změny nebo bohatší data

Google/Graph event PATCH posílají více polí než skutečně změněné pole, bez kontroly vzdálené verze. Ani lokální event mutace nemají revision precondition. Titulková změna ze starého formuláře tak může vrátit starý čas schůzky.

Graph navíc načítá popis jako plain text a při každém zápisu jej posílá jako plain text zpět. Pouhé přejmenování tak může zploštit původní HTML popis. Neznamená to, že PATCH automaticky maže neposlané attendees či reminders.

Důkazy: `apps/api/src/sync/adapters/google.ts:221–240,547–585`, `apps/api/src/sync/adapters/microsoft.ts:50,122,144–147,609–629`, `packages/types/src/event.ts:3–22`.

Směr: změnové patche, uchování verzí, providerem podporované podmíněné zápisy a řešení konfliktu bez ztráty draftu. Zachovat pole, která Musubi neumí bezpečně upravit.

### A7 — Oprávnění a capabilities jsou příliš hrubé

`supportsEvents`, `supportsTasks` a role owner/editor/viewer nedokážou popsat vytvoření série, odpověď na pozvánku, změnu organizátora nebo omezení konkrétního meetingu. CalDAV discovery nepředává read-only oprávnění; engine při jejich absenci nastavuje owner.

Důkazy: `apps/api/src/sync/adapter.ts:62–82`, `apps/api/src/sync/adapters/caldav.ts:770–793`, `apps/api/src/sync/engine.ts:175–182`, `packages/types/src/permissions.ts`.

Směr: capabilities odvozené z provideru, konkrétního účtu, kalendáře a události. Rozlišit unsupported, denied a unknown. Stejný kontrakt musí ověřovat API i používat UI. Právo zapisovat do kalendáře není totéž jako právo organizátora změnit meeting.

### A8 — Pozvánky, dostupnost a připomínky zatím netvoří jednotné jádro

Normalizovaný event nemá externí účastníky, jejich odpovědi, pravidla nativních připomínek, visibility ani free/busy semantiku. Musubi RSVP upravuje vlastní attendance, nikoli odpověď u providera. Odkaz Meet/Teams lze načíst, ale to není podpora vytvoření nebo správy online meetingu.

Důkazy: `apps/api/src/sync/adapter.ts:5–19`, `apps/api/src/handlers/events.ts:403–409`, `apps/api/src/handlers/reminders.ts:73–91`.

Směr: organizer/self/attendees/response, meeting cancellation a notification policy; oddělit osobní Musubi připomínku od providerového alarmu. U CalDAV zvlášť detekovat scheduling rozšíření, nevyvozovat je z podpory VEVENT. Následně doplnit availability/privacy a providerově specifické možnosti podle priorit.

### A9 — Klientské cesty mají chyby v základních úpravách

- Web timed end používá start date: událost přes půlnoc nelze uložit, vícedenní událost se může při změně názvu zkrátit. `apps/web/src/calendar/event-form.ts:147–152,191–200`.
- Web scoped editor se inicializuje z masteru, ale datum pak vyhodnocuje vůči vybranému výskytu. U ne-prvního výskytu hrozí nežádoucí posun. `apps/web/src/calendar/components/EventDetailsPopover.tsx:291–313,599`.
- Mobilní volání nevrací `false` po zrušení výběru scope, a composer proto může zavřít draft. `apps/client/components/calendar/GlobalEventModals.tsx:34–44`, `apps/client/lib/seriesEdit.ts:51–52`, `apps/client/components/calendar/AddEventModal.tsx:538–543`.
- Mobilní delete handlery nečekají na promise a detail zavírají před výsledkem; rollback není doprovázen odpovídající chybou. `apps/client/components/calendar/EventDetailModal.tsx:169–202`.

Jde o opravy stávajícího chování, nikoli důvod pro UI redesign. Mobilní web je navíc záměrně blokován při šířce ≤599 px; podporované platformy je potřeba popisovat pravdivě, neodvozovat je z responsive stories.

### A10 — Vedlejší funkce nesmějí podmiňovat hlavní produkt

Současné OAuth `PROVIDER_SYNC_SCOPES` vyžadují vedle kalendářů i Google Tasks / Microsoft Tasks. Calendar-only grant je nedostatečný a vyřazen ze syncu; reconnect helper může vyčistit tokeny. Je to explicitní implementované rozhodnutí, ne náhodný chybějící catch, ale pro úzký kalendářový produkt je nevhodné: uživatel bez souhlasu s úkoly nesmí přijít o kalendář.

Důkaz: `packages/db/src/queries/oauth.ts:16–25,57–82,126–149`, `packages/db/drizzle/0056_provider_task_scopes.sql`.

Směr: úkoly jako volitelná capability a oddělený consent/failure boundary. Existující VTODO/Tasks nemažeme, ale jejich další rozvoj nepředbíhá kalendářovou spolehlivost.

## Doporučená abstrakce

Zachovat adaptery; nerozšiřovat `NormalizedEvent` na obří union všech API ani na nejmenší společný jmenovatel.

1. **Společné doménové jádro:** datum/čas a zóna, identita série/výskytu, základní obsah, účastníci/odpověď, dostupnost/soukromí a jasně oddělené připomínky. Zavádět po funkčních řezech, nikoli jednorázovým přepisem.
2. **Metadata konkrétní vzdálené kopie:** provider/account/calendar/event ID, verze, původní identita výskytu, autorita a stav doručení. Nezaměňovat je s globální identitou Musubi události.
3. **Capabilities konkrétní operace:** možnost číst, upravit, zachovat a důvod omezení; hodnotit podle zdroje i oprávnění uživatele.
4. **Providerová rozšíření:** Teams/Meet, specifické recurrence patterny, pracovní místo/focus/OOO, kategorie apod. postupně. Co nelze bezpečně upravit, alespoň zachovat a umožnit otevření v původní službě. Odkaz není trvalá náhrada běžných základních funkcí.

Jednotný UX znamená stejné pojmy a důvěryhodný výsledek, ne předstírání stejných možností všech služeb. Sjednocený pohled také neznamená automatické kopírování pracovních dat do osobních účtů.

## Návrh realizačního plánu

### Etapa 0 — Bezpečnostní a funkční stopky

Opravit A1, bootstrap/paginaci/neúplný import z A3, CalDAV read-only a malé klientské chyby A9. Zablokovat známé destruktivní či nepodporované operace ještě před změnou dat. Oddělit calendar-only consent od Tasks.

**Hotovo:** čtenář originál nezmění přes externí kopii; nový Microsoft-only účet skutečně importuje data; všechny stránky discovery se započtou; read-only/unsupported neprodukuje falešně uložené změny; title-only edit nemění datum/délku; Cancel zachová draft.

### Etapa 1 — Spolehlivé zápisy a pravdivý stav

A2 a A6: transakční outbox v Postgresu, idempotentní doručování, zachování delete identity, řízený souběh pull/push, lokální a vzdálené verze, retry/backoff a rozhraní pending/failed/conflict. Opět použít existující proces a observabilitu, ne nový broker.

**Hotovo:** timeout po vzdáleném create nevytvoří duplicitu; restart neztratí operaci; 429/503 se bezpečně opakuje; odvolané oprávnění má trvalý a viditelný stav; souběžná editace nepřepisuje tiše cizí změnu. Lokální uložení není prezentováno jako potvrzené doručení providerovi.

### Etapa 2 — Věrný čas a opakování

A4/A5: aditivní model zón a instancí; Google exceptions, CalDAV overrides, Outlook série a podporované převody Graph recurrence. Jedna serverová scope operace s atomickou lokální částí a trvalými outbound kroky; nikoli několik nesouvisejících klientských requestů.

**Hotovo:** stejný meeting znamená stejný okamžik pro čtenáře i server v různých zónách; přesun/zrušení instance netvoří duplicity; změna jednoho výskytu zachová ostatní overrides; Outlook podporované série lze vytvořit i změnit. Nevystihnutelná pravidla se zachovají a jejich omezení je explicitní, ne aproximované.

### Etapa 3 — Každodenní pracovní a osobní kalendář

A8: skutečné pozvánky a RSVP, organizátor vs host, rušení meetingu, nativní a lokální připomínky, dostupnost/soukromí, zachování konferenčních informací. Stejné běžné operace dostupné na webu i mobilu; providerová specifika pod capabilities.

**Hotovo:** přijmout/odmítnout pozvánku v Musubi změní správnou odpověď u providera; změna meetingu respektuje organizátora i notifikace; přejmenování nesmaže alarmy, účastníky, bohatý popis či konferenci; nedochází k nechtěnému sdílení detailů mezi účty.

### Etapa 4 — Vydání podložené kompatibilitou

Průběžné testy z předchozích etap doplnit živou maticí: Google, Outlook, iCloud a alespoň jeden obecný CalDAV server. Vymezit historii Outlooku, podporované platformy a skutečné read/write/preserve/unsupported pokrytí. Dokumentaci sladit s implementací.

**Hotovo:** release scénáře pro připojení, první pull, delta, CRUD, all-day, DST, recurrence scopes, konflikty, restart, reconnect a disconnect procházejí nad oddělenými testovacími účty. Feature support je doložen scénářem, ne pouze existencí serializeru.

## Co zatím odložit

- Nové providery, další task-manager funkce, rozšiřování federace a administračních funkcí mimo potřeby jádra.
- Velký UI restyle, nový komponentový systém nebo přepis monorepa.
- Webhooky Google/Graph jako prioritu před správností: později mohou být další trigger stejné sync cesty, polling zůstane fallbackem.
- Horizontální škálování a nový message broker bez doložené potřeby.
- Stoprocentní klon každé zvláštnosti všech tří platforem před spolehlivou podporou běžných operací.

Existující sdílení a Calendar Pages jako uložené pohledy ponechat. Nezaměňovat omezení dalšího rozvoje za plošné mazání fungujících částí.

## Provedené ověření

Úspěšně spuštěno:

- `pnpm --filter @musubi/calendar test`
- `pnpm --filter @musubi/types test`
- Devět API self-check souborů: `sync/errors.test.ts`, `sync/orchestrator.test.ts`, `sync/engine.test.ts`, `sync/adapters/provider_http.test.ts`, `sync/adapters/caldav.test.ts`, `sync/caldav_client.test.ts`, `sync/oauth.test.ts`, `sync/adapters/microsoft.test.ts`, `handlers/events.test.ts`.
- `pnpm --filter @musubi/web test`: **46 souborů, 339 testů prošlo**.
- `pnpm check:contracts`: 142 klientských call sites / 58 rout; 13 realtime typů.

API self-checky byly spuštěny s neprodukční nedostupnou DB adresou, nikoli proti lokálním uživatelským datům. Varování chybějící konfigurace Microsoft/Apple OAuth nebránila self-checkům a nejsou výsledkem živého přihlášení.

Reprodukce nad existujícími funkcemi, bez změny zdrojů:

1. `expandRecurringEvents`: týdenní série od `2026-03-01T08:00Z`, výskyt 15. března. Runtime `Europe/Prague` vrací `08:00Z`, runtime `America/New_York` vrací `07:00Z`. Rozdílný okamžik je chyba, nikoli běžný časový převod.
2. `fetchGoogleChanges` s falešnou odpovědí master + výjimka, následně `expandRecurringEvents`: přesun 8. března z 09:00 na 11:00 vrací oba sloty.
3. `icalToNormalized` + `expandRecurringEvents`: CalDAV výjimka s novým názvem a délkou 11:00–13:00 vrací původní název a 11:00–12:00.

Existující testy tedy procházejí, ale uvedené scénáře věrnosti nepokrývají. Hlavní browser E2E mockuje API; Radicale integrační cesta se soustředí na VTODO. Ani jedno samo neprokazuje živý end-to-end event round-trip.

## Externí referenční kontrakty

- Google event model, TZID, `recurringEventId`, `originalStartTime`, cancelled exceptions: <https://developers.google.com/workspace/calendar/api/v3/reference/events>
- Google recurring events a operace se sériemi: <https://developers.google.com/workspace/calendar/api/guides/recurringevents>
- Microsoft event, účastníci, recurrence, verze a transactionId: <https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0>
- Microsoft recurrence patterns/ranges: <https://learn.microsoft.com/en-us/graph/outlook-schedule-recurring-events>
- CalDAV calendar access: <https://www.rfc-editor.org/rfc/rfc4791.html>
- CalDAV scheduling jako samostatné rozšíření: <https://www.rfc-editor.org/rfc/rfc6638.html>

## Doporučený bezprostřední další krok

Schválit úzký milník **„Důvěryhodný obousměrný kalendář“**. První backlog: hranice autority propojených kopií → bootstrap/úplnost discovery → ochrana nepodporovaných zápisů → durable delivery. Časové zóny a série jsou další hlavní funkční řez, nikoli volitelný polish. Termíny odhadovat až po rozdělení těchto konkrétních změn a návrhu kompatibilních migrací.
