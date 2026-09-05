# Implementační plán: důvěryhodný sjednocený kalendář

Stav: K01–K05 implementovány, lokálně ověřeny a převzaty (2026-09-05). K06–K15 čekají.

Navazuje na [audit kalendářového jádra](calendar-core-audit.md), revize `60316a9`.

## Cíl a hranice

> Připojím pracovní, osobní a domácí kalendáře. Vidím správné události ve správný čas. Úprava nezničí původní data a vždy poznám, zda byla doručena.

Plán má dva samostatně ověřitelné výsledky:

- **M1 — Bezpečné a spolehlivé jádro:** oprávnění, import, nedestruktivní editace, trvalé doručování a konflikty. Zbývající omezení opakování jsou explicitní, nikoli vydávaná za plnou podporu.
- **M2 — Věrný každodenní kalendář:** zóny, série a výjimky, běžné pozvánky/RSVP, připomínky a dostupnost napříč providery.

Nyní nevzniká nový provider, message broker, plugin systém, komponentová knihovna ani obecný workflow engine. Existující Tasks, federaci a uložené pohledy zachováme, ale nerozšiřujeme nad potřeby tohoto cíle.

## Pravidla realizace

1. Každý krok začíná ověřením aktuálních zdrojů a reprodukcí konkrétní chyby. Audit je výchozí evidence, nikoli náhrada čtení před změnou.
2. Jedna změna má jeden pozorovatelný výsledek; tabulka níže je pořadí pracovních balíčků, ne požadavek na jeden obří PR za balíček. Větší balíček rozdělit na schéma/kontrakt, serverové chování a klientskou integraci, pokud každý mezistav zůstane bezpečný.
3. Existující `CalendarAdapter`, DB transakce, scheduler, permission model a UI primitives jsou výchozí místa rozšíření.
4. Pro každý změněný stavový tok přidat nejmenší regresní test, který by původní chování odmítl. Providerové změny potřebují test skutečné HTTP hranice, ne pouze serializeru.
5. Jedna zapisující větev/worktree na sdílený kus kódu. Providerové práce lze paralelizovat až po stabilizaci společného kontraktu; migrace a engine mají jednoho vlastníka.
6. Neprovádět zápisy do skutečných účtů bez vyhrazených testovacích účtů a souhlasu s jejich použitím. DB integrační testy pouze nad disposable databází.
7. Po každém balíčku zastavit rozšiřování rozsahu, projít diff a doložit jeho kritérium dokončení. Červené testy nejsou hotový krok.

## Pořadí a závislosti

Značky A1–A10 odkazují na nálezy auditu. K01–K05 jsou `completed`; K06–K15 jsou `pending`.

| ID | Výsledek | Závislosti | Audit |
| --- | --- | --- | --- |
| K01 | Příchozí kopie respektují autoritu originálu | — | A1 |
| K02 | První připojení a discovery jsou úplné | — | A3 |
| K03 | Kalendář nevyžaduje souhlas s Tasks | K02 | A10 |
| K04 | Rizikové operace jsou odmítnuty před změnou dat | K01 | A4, A7 |
| K05 | Základní klientské editace neztrácejí datum ani draft | — | A9 |
| K06 | Event změny mají revize a nedestruktivní patch kontrakt | K01, K04 | A6 |
| K07 | Lokální mutace ukládají trvalý outbound záměr | K06 | A2 |
| K08 | Worker doručuje bezpečně při opakování a souběhu | K02, K03, K07 | A1, A2, A6 |
| K09 | Web a mobil ukazují skutečný stav doručení | K08 | A2, A6 |
| K10 | Zóna a identita série/výskytu jsou součástí modelu | K06 | A4, A5 |
| K11 | Import Google/CalDAV/Graph zachovává výjimky | K08, K10 | A4, A5 |
| K12 | Úprava scope je jedna bezpečná serverová operace | K09, K11 | A4 |
| K13 | Pozvánky a RSVP mění skutečný providerový meeting | K12 | A7, A8 |
| K14 | Připomínky, dostupnost a soukromí mají věrnou sémantiku | K13 | A8 |
| K15 | Živá kompatibilita a dokumentace mají release gate | průběžně; vydání po příslušném milníku | všechny |

Doporučené sériové pořadí je K01 → K02 → K03 → K04 → K05 → K06 → K07 → K08 → K09 → K10 → K11 → K12 → K13 → K14. K15 probíhá od první providerové změny, není to testovací fáze odložená na konec.

**M1:** K01–K09 + odpovídající K15. **M2:** navíc K10–K14 + celá základní kompatibilitní matice.

## První série: zastavit poškozování dat

### K01 — Autorita originálu a odvozených kopií

**Změna:** v inbound update/delete/reset sweep sjednotit kontrolu, zda mapování smí měnit společnou událost. Vycházet ze současného `originCalendarID`; nepřidávat paralelní systém rolí. Příchozí smazání odvozené kopie odstraní pouze její vazbu. Změna odvozené kopie nesmí tiše změnit originál ani se automaticky změnit na nový originál.

Nejasná historická mapování s chybějícím originálem nesmějí získat autoritu jen podle pořadí syncu. Do vyřešení bezpečně odmítnout obsahovou propagaci a uchovat informaci o rozporu. Pokud starý model nedokáže odpojenou kopii bezpečně reprezentovat, dočasně zablokovat vytváření takových externích linků; nezavádět tiché ignorování jako finální UX.

**Místa:** `apps/api/src/handlers/events.ts`, `apps/api/src/sync/engine.ts`, `packages/db/src/queries/external.ts`, permission helpers.

**Test/hotovo:** dvě osoby, originál pouze ke čtení pro druhou osobu, propojená Google/CalDAV kopie. Update, delete i full-reset sweep nesmějí změnit/smazat originál. Legitimní změna autoritativního zdroje funguje. Samostatná fork kopie zůstává nezávislá. Fan-out autoritativních změn se dokončí v K08, nikoli ad-hoc síťovými voláními uvnitř importní transakce.

### K02 — Bootstrap, stránkování, úplné delty

Rozdělit do tří malých oprav:

1. Zavést autentizovaný provider/account-scoped import přes existující orchestrace. Přepojit web i mobil; starou `/calendars/google` routu zachovat pro starší klienty. Scheduler musí najít také způsobilé účty bez zrcadel.
2. Google calendar discovery načte všechny stránky před jakýmkoli odstraňováním zrcadel. Selhání další stránky neznamená smazané kalendáře.
3. Graph při selhání povinného master hydration nevrací úspěšnou neúplnou deltu. Rozlišit očekávané odstranění od 429/5xx; při nejasnosti neposunout cursor.

**Místa:** connection handlers/resources, `sync/orchestrator.ts`, `sync/engine.ts`, oba OAuth adaptéry, DB výběr sync účtů.

**Test/hotovo:** Microsoft-only uživatel bez zrcadel získá kalendáře; scoped import nezasáhne cizí/sesterský účet; selhání druhé discovery stránky nic nemaže; 503 masteru zachová cursor a další pokus doplní data. Testovat klient–handler kontrakt, nejen izolované `syncUser`.

### K03 — Volitelné Tasks oprávnění

Oddělit calendar consent od task consent v account eligibility a discovery. Calendar-only grant zůstane aktivní. Bez Tasks oprávnění se task API nevolá; jeho chyba nesmí zastavit event import. Chybějící oprávnění není důkazem smazání vzdálených task lists, takže nepoužít neúplné discovery pro jejich sweep.

**Místa:** `packages/db/src/queries/oauth.ts`, `packages/auth`, OAuth adaptéry, obě connection UI.

**Test/hotovo:** calendar-only, calendar+tasks, odmítnutý Tasks consent a skutečně revoked token jsou čtyři odlišné ověřené stavy. Dostupné calendar tokeny se nemažou jen pro nedostatek Tasks scope.

**Migrace:** neupravovat aplikovanou `0056_provider_task_scopes.sql`. Pokud již smazala refresh token, nelze jej backfillem obnovit; účet potřebuje pravdivě nabídnutý reconnect. Nová změna tomu zabrání do budoucna.

### K04 — Předběžná validace schopností a read-only

Zavést pouze aktuálně potřebné operation capabilities: základní event write, podporovaná recurrence operace a role organizátora, s důvodem `unsupported`, `denied` nebo `unknown`. Zachovat význam existujících `supportsEvents/supportsTasks`.

CalDAV oprávnění zjistit přes DAV privilege discovery tam, kde je podporováno. Neznámé oprávnění nezaměňovat za owner. API ověří všechny cílové kalendáře před lokální mutací a před prvním providerovým side effectem; UI zobrazuje stejný důvod omezení.

Do K12 blokovat známé destruktivní CalDAV změny detached výjimek a nepodporované Outlook recurring create. Rizikovým legacy scope-edit cestám zabránit v částečném zápisu; dočasné omezení viditelně vysvětlit. Nezakazovat bezpečnou běžnou editaci jen kvůli názvu provideru.

**Test/hotovo:** zakázaná operace nezmění DB, neodešle žádný provider write a vrátí srozumitelný důvod i při přímém API volání. Změna oprávnění mezi formulářem a uložením se znovu kontroluje.

**Lokální evidence K04 (2026-09-05):** řezy `edead87` (API/adaptéry/kontrakt) a `c779f8d` (klienti), následné doplnění regresí a evidence. `event_capabilities.integration.test.ts` používá skutečné autentizované HTTP handlery, adaptéry proti HTTP fixtures a disposable PostgreSQL 18: odmítnutí create/update/delete/link/unlink/fork, pozdější odmítnutý cíl, změna práv, organizer/copy role, DAV bind/write-content/unbind/unknown, zachování detached komponent a lokálně scoped mapping/ETag. Je zapojen do `pnpm test:db`. Prošly celé `pnpm test:db` (včetně K01–K03), `pnpm test`, `pnpm typecheck`, `pnpm check:contracts`, web lint; Chromium 9 scénářů včetně tří důvodů odmítnutí při 1280/390 px, klávesnice, zachování draftu a návratu focusu. Nativní callback testy propojují skutečný detail/formulář, store a API transport; bez nového rendereru či UI vzoru. Logy: `/tmp/musubi-k04-logs/`.

Doplňující audit zachytil mezeru mezi calendar ACL a OAuth grantem: Google/Graph nyní po možném refreshi čtou aktuální uložený grant přes stávající `hasProviderSyncScopes/CALENDAR_SCOPE`. Chybějící evidence je `unknown`, prázdný či nedostatečný grant `denied`; Tasks se nevyžadují. Regrese pro oba providery ověřují owner ACL + read-only/missing grant, refresh-time narrowing, import bez předčasného CREATE kalendáře a zachování `invalid_grant → reconnect_required`. Po opravě znovu prošly celé DB/unit/typecheck/contracts/web-lint gates; logy mají prefix `grant-final-`.

**Revize a finální převzetí (2026-09-05):** nezávislá revize na `ef17b19` našla P1 (legacy CalDAV split bez bind mohl částečně změnit sérii) a P2 (duplicitní fixture ID obcházelo skutečné mazání Google guest copy). Opravy `1361ac3` a `d06a8dd` doplnily skutečné mapping/GET/DELETE assertions a předběžnou kontrolu bind s bezpečným update-only intentem. Rodič samostatně prošel oba opravné diffy, autorizační cestu a regresní důkazy; nálezy jsou uzavřeny. Finální `pnpm test:db`, `pnpm test` (88 native / 351 web), typecheck, contracts a web lint prošly; Chromium 10 scénářů prošlo na nezměněném finálním webovém řezu. LSP potvrdilo všech 30 změněných TS/TSX souborů bez chyb, závěrečné lens diagnostics bez blokujících chyb. Logy mají prefix `review-` v `/tmp/musubi-k04-logs/`. Pět zděděných nestageovaných úprav je beze změny, vlastní testovací DB odstraněna; žádný push ani živá providerová certifikace.

**Schválená rozhodnutí a omezení K04:**

- Scope intent je aditivní `scopeEdit: { updates: [Event], creates: [Event] | [] }` pouze na prvním PUT; prázdné creates vyjadřuje skutečný update-only edit/delete/undo. Server kontroluje shodu prvního payloadu, oprávnění každého kroku a celý známý write-set před prvním zápisem; skutečný request znovu prochází běžným preflightem. Intent se neukládá do event/store/cache ani provider payloadu. Není to rezervace ani atomická operace. Bez intentu zůstávají serverové zákazy změn Outlook recurrence a destruktivních změn CalDAV recurrence s detached overrides; běžný legacy CalDAV content update není plošně zakázán. Po nálezu nezávislého review změna recurrence bez úplného validovaného intentu vyžaduje kromě resource write-content také čerstvý collection bind: první PUT může být částí splitu. Denied/unknown bind zastaví první mutaci se srozumitelným vysvětlením tohoto konzervativního omezení. Validovaný update-only intent nepotřebuje bind, ale neobchází ACL, organizer ani detached-override kontroly; explicitní split ověří skutečné create cíle. Pozdější síťová chyba či souběžná změna mezi requesty patří do K06–K12.
- Původní vlastník externího mirroru může mít `viewer` jako konzervativní provider projekci. Jen v event preflight cestě se ověří současně actor = calendar creator = mirror owner, skutečné vlastnictví účtu a membership; konečné právo určí čerstvý provider důkaz. Obecné `assertCan/canDo`, ostatní členové, Tasks ani origin autorita se neuvolňují.
- Google/Graph DELETE rozlišuje ověřenou organizer copy od pozvánkové kopie; vlastnictví kalendáře není role organizátora. Google respektuje dokumentovaný default `organizer.self=false` při existujícím organizer objektu. CalDAV ORGANIZER vyžaduje ověřenou DAV identitu; odlišný current-user-principal na sdílené organizer kolekci není důkaz vlastní pozvánkové kopie a delete vrací `unknown`. Appointment bez ORGANIZER zůstává běžným zápisem.
- Výslovně schválená výjimka pro ICS import do **nového** externího kalendáře: známý unsupported obsah i nedostatečný OAuth grant se odmítnou ještě před CREATE kalendáře (grant se kontroluje také po refreshi). Práva nové kolekce lze zjistit až po jejím vytvoření; poté se ověří všechny event creates před prvním event/link DB či provider event zápisem. Při denied/unknown může zůstat prázdný kalendář, chyba to výslovně sdělí. Automatický remote rollback se neprovádí. Výjimka neplatí pro existující cíle.
- Žádné migrace, nové závislosti, skutečné provider účty, outbox, konfliktní UI, plný recurrence model ani RSVP/scheduling lifecycle. Jediný schválený přesah do K05 je čekání nativního delete na výsledek (viz níže); Cancel/boolean návrat `GlobalEventModals` a datumové opravy zůstávají mimo K04.

### K05 — Malé opravy klientských ztrát

Čtyři nezávislé patche s regresním scénářem:

- Timed event používá samostatné datum konce ve validaci i serializaci. Title-only edit zachová noc přes půlnoc i více dní.
- Inline scoped editor se inicializuje vybraným výskytem; explicitní editor celé série zůstane master-based. Název na třetím výskytu nesmí posunout sérii.
- Native `GlobalEventModals` vrací výsledek `applySeriesEdit`; Cancel zachová draft a nespustí následnou změnu reminders.
- Native delete čeká na výsledek, zachová detail při chybě a spustí reminder reconciliation až po úspěchu. **Tento konkrétní podbod implementován, ověřen a převzat v K04 se souhlasem vlastníka; v K05 se znovu neimplementoval.**

**Místa:** web `event-form.ts`, `EventEditorForm`, `EventDetailsPopover`; native `GlobalEventModals`, `EventDetailModal`, `AddEventModal`.

**Hotovo:** helper testy plus alespoň test reálného propojení callbacků; samostatný helper test by původní Cancel chybu nezachytil. Použít existující UI bez redesignu.

**Dokončený K05 — evidence a převzetí (2026-09-05):**

- `61e63da`: timed validace i serializace čtou `endDate`. Skutečný formulář zachová overnight/vícedenní title-only edit i inclusive all-day hranice. Se souhlasem rodiče se stávající Ends picker zpřístupnil také timed událostem, minimum času konce platí jen ve stejném dni. Změna Date přenese konec pouze u dosud jednodenního timed draftu; nezávislý vícedenní konec ani all-day konvence se nepřepisují. Bez CSS, nového controlu nebo změny duration/default policy.
- `61d1172`: inline scoped editor používá vybraný výskyt. More options převádí jeho draft přes stávající čisté `seriesEditWrites(scope: "series")` na master, bez zápisu nebo transient intentu v URL. Explicitní full editor zůstává master-based. Chromium ověřuje třetí výskyt pro occurrence/following/series, přesné PUT/POST datumy a K04 write-set intent, Cancel/focus i předání title-only a časové změny do skutečného full editoru a jeho save.
- `GlobalEventModals` vrací boolean skutečného `applySeriesEdit`. Rozšířený existující `AddEventModal.spec.ts` vykonává host → formulář (včetně seed efektů) → scope Alert → helper → skutečný store a API transport. Cancel zachová draft, stav composeru a reminders bez event/cache/API mutace, reminder persistence/reconciliation nebo zavření; opakovaný úspěšný save čeká na odpověď, uloží a zavře. Denied/unknown/unsupported i síťová chyba zachovají draft a K04 rollback. Nativní hosty, animace, cache a notification služby jsou testovací švy, nikoli nový renderer.
- Red před každou opravou: 7 datumových regresí, 5 occurrence browser scénářů a skutečný nativní Cancel callback selhaly na původním chování. Po opravách prošly nejbližší suite a finální `pnpm test` (363 web / 90 native), `pnpm typecheck`, `pnpm check:contracts`, web lint a focused native lint (0 errors; 19 existujících warnings v nezměněném AddEventModal). Finální Chromium 16/16 včetně K04 refusals při 1280/390 px, klávesnice a focus return. Logy: `/tmp/musubi-k05-logs/`; souhrnný diff vůči `b969de3`: `/tmp/musubi-k05-implementation.diff`.
- Celé unit ověření běželo s `ENVIRONMENT=test`, explicitním neexistujícím lokálním DB socketem a bez zděděných credentials (`safe-test.py` v adresáři logů). Žádná DB infrastruktura, migrace, živý provider, závislost, push nebo build. Pět zděděných dirty souborů zůstává byte-for-byte shodných se snapshotem; generated routeTree churn odstraněn. Živá providerová certifikace ani plná E2E matice nebyly součástí tohoto řezu.
- Finální převzetí: nezávislá revize bez nálezů (`OK`), rodič zkontroloval produkční diff a konkrétní důkazy. Čerstvé gates na skutečném worktree znovu prošly: root testy (363 web / 90 native), typecheck, contracts, web lint a Chromium 16/16. LSP potvrdilo všech osm změněných TS/TSX souborů bez chyb, závěrečné lens diagnostics bez blokujících chyb. Logy: `/tmp/musubi-k05-final-logs/`. Dodatečné přeformátování osmi K05 souborů neznámého původu je ekvivalentní podle TypeScript i emitovaných JavaScript AST; spolu s původními pěti změnami zůstává všech 13 souborů beze změny a mimo staging. Implementační commity jsou `61e63da`, `61d1172`, `68070ac`; žádný push.

## Druhá série: spolehlivé doručování

### K06 — Revize a změnové patche

**Stav: K06 ROZPRACOVÁN — NEPŘEVZATO, NEDOKONČENO, NENASAZOVAT.** DB CAS základ není zapojen do API/klientských save cest; stale-draft ochrana ani úplné conditional delivery zatím nejsou dodány. Rodič schválil ukončení tohoto běhu po třech ověřených řezech. Následující revize/finalizace smí posoudit a opravit nálezy těchto řezů, ne automaticky implementovat celý zbývající K06. Celkové K06 acceptance zůstává nesplněné; samostatné pokračování potřebuje zbytek wire/API/client/provider integrace a regresní důkazy.

Aditivně zavést lokální event revision a serverovou kontrolu očekávané revize. Změna obsahu nebo příchozí změna, která obsah opravdu mění, revizi posune. Běžný no-op poll ji neposouvá. Server vypočítá skutečný field diff; neposílat providerovi znovu nezměněný text, čas nebo location.

Externí mapování uchová providerovou verzi. Pro každou službu ověřit konkrétní podporu conditional write a jeho chování testem; nepovažovat Graph `changeKey` automaticky za ekvivalent garantovaného `If-Match`. Samotné GET následované PATCH bez podmínky není atomická ochrana konfliktu. Neprokazatelnou ochranu nepředstírat a nebezpečnou operaci neprovést bez explicitního řešení.

**Místa:** shared types/wire, DB schema a event dotazy, event handlers, adapter contract/serializery, klientské mutace.

**Test/hotovo:** dva drafty ze stejné revize; druhý nevrátí starý čas. Outlook title-only edit zachová původní HTML a strukturované location. Omitted pole není totéž jako explicitní vymazání. Vzdálený konflikt nezpůsobí lokální ztrátu draftu.

**Kompatibilitní gate:** starý klient revision neposílá; bez ní nelze slíbit detekci stale draftu. Před zapnutím enforcement rozhodnout mezi bezpečným omezením starých write cest a zvýšením minimální podporované verze. Doporučení: noví klienti nejdřív, potom enforcement; žádný trvalý tichý bypass. Změnu podpory vydaných klientů schvaluje vlastník.

**K06 rozpracováno — lokální základ, nikoli dokončení (2026-09-05):**

- Vlastník schválil zvýšení minimální verze **klientů na 0.1.8**; produkt zůstává 0.1.8. Autoritou vydání je upstream tag, ne číslo rozpracovaného manifestu: rodič ověřil poslední tag `v0.1.7` (`af02dcfe077c10b67bcba90f85e051d6f98fcf2c`), bez tagu 0.1.8. Původní návrh 0.1.9 je zrušen. Připravit web/native/server společně; nasazení enforcementu čeká na dostupné kompatibilní klienty. Žádný release, push ani produkční migrace nejsou schváleny. Vlastník následně výslovně schválil **také upgrade federovaných serverů a `MIN_PEER_VERSION = 0.1.8`**: starý member-token klient a starý peer mají stejné product endpointy a nelze je bezpečně rozlišit. Toto nahrazuje dřívější ponechání peer floor 0.1.6. Staré cache/connection záznamy se nemažou; revision-less draft se nesmí stát zapisovatelným pomocí vymyšlené revize.
- Vygenerovaná aditivní migrace `0058_classy_captain_america` přidává `events.revision NOT NULL DEFAULT 1`. Nová DB cesta `patchEventAndCalendarLinks` zamyká event před linky, kontroluje očekávanou revizi a ve stejné transakci počítá skutečný patch, mění linky/mapování i případný tombstone. Omitted není null, stale no-op je konflikt, aktuální no-op nemění revizi ani delta čas. Nová identita nepřebírá revizi zdroje. Příchozí autoritativní změny/tombstone/revival posouvají revizi; stejný obsah pouze aktualizuje přijatou provider verzi. K01 odmítnutý mirror nadále nepřijímá jeho nový ETag.
- Lokálně ověřeno na novém, pouze Unix-socket PostgreSQL 18.6 v `/tmp/musubi-k06-pg.*`: migrace předchozího schématu s existujícím eventem, CAS race (právě jeden vítěz), dva stale drafty bez vrácení času, rollback obsahu/linků/mapování, null/omission, no-op poll i změna samotného ETag, inbound/local race a autorita pro všechny tři providery. DB unit, `test:db:sync` a API typecheck prošly; logy `/tmp/musubi-k06-logs/`. Toto nejsou testy živých providerů. Zapojení CAS handlerů, zbývající legacy write cesty, klientské drafty, conditional delivery a finální K06 gates ještě čekají. Základ není připraven k nasazení a čeká na nezávislou revizi a převzetí rodičem.
- Druhý lokální řez zavádí skutečný globální gate v `requireAuth` pro read/write/upload/ICS/stream včetně member tokenů: chybějící, chybná nebo stará klientská verze vrací 426. Web JSON/raw/ICS requesty a browser SSE (jediná query varianta `clientVersion`) i nativní skutečný auth transport/raw ICS/SSE posílají 0.1.8. Veřejné discovery/auth callbacky/upgrade bootstrap/invite preview/avatar zůstávají; jediná authenticated výjimka je existující machine token rotation s původní autentizací. Handshake a každé gateway/stream navázání ověřují kompatibilní peer, gateway předává skutečnou verzi volajícího, ne vlastní. `docs/releasing.md` obsahuje přesné výjimky a koordinovaný upgrade. Reálné auth/DB/HTTP testy pro staré/missing/malformed/read/write/stream/handshake/rotation i gateway forwarding/refusal prošly; celé `test:db`, `test`, `typecheck`, contracts, release VERIFY a oba linty prošly (native pouze existující warnings). K06 tím **není dokončeno**; wire snapshot zatím nebyl přebaselinován a CAS není zapojen do klientských save cest.
- **Schválené dočasné omezení Outlook EVENT:** event-specific conditional PATCH/DELETE ochrana není doložena; `changeKey` ani samotný GET→PATCH nejsou důkaz. Před jakoukoli lokální mutací se má v úplném preflight odmítnout update/delete existující vzdálené Outlook události (včetně známých scope kroků a mirrors), s vysvětlením „ochrana neověřena“, ne tvrzením „Graph nepodporuje“. Read/create a již existující čistě lokální unlink bez remote účinku zůstávají. Žádný nový override/detach UI. Třetí lokální řez toto omezení zapojuje do skutečného Outlook preflight i přímo do adapter update/delete (nelze obejít voláním adapteru); read/create a existující lokální unlink bez mappingu zůstávají. Ukládá se skutečné `@odata.etag`, ne `changeKey`. `toGraphEventPatch` tvoří subject-only payload bez nezměněného HTML body/structured location/time/recurrence, ale není zapojen jako povolená remote write cesta. Skutečný HTTP handler test ověřuje beze změn odmítnutý title-only/update-only/delete i známý Outlook mirror a povolený čistě lokální unlink. Serializer a přímý adapter test ověřují omission a nulové remote volání při odmítnutí. Opětovné povolení vyžaduje explicitní event-specific důkaz enforcementu a novou revizi, fake HTTP samotné nestačí.
- Závěrečné lokální gates na všech třech řezech: celé `test:db`, `test` (365 web / 90 native), `typecheck`, contracts, release VERIFY a lint prošly; native má 107 existujících warnings, bez errors. Chromium 15/15 K04/K05 + reconnect/two-tab stream po úpravě mock URL pro skutečné `clientVersion` query. První Chromium pokus odhalil dvě zastaralé exact stream URL v mocku, nikoli CAS důkaz. V baseline souboru `month-read.spec.ts` se stageují pouze tyto úzké K06 stream hunks; původní K05 formatting zůstává mimo commit, ostatních 12 původních dirty souborů je beze změny. Automatické routeTree přeformátování z testovacího dev serveru bylo vráceno pouze z předem uložených identických bytů. Logy `final-*` v `/tmp/musubi-k06-logs/`; žádný build/publish/push ani živý provider.
- Schválené pořadí je lokální CAS commit před conditional delivery; remote konflikt má vrátit aktuální lokální revizi, `localCommitted` a pravdivý stav částečného/nepotvrzeného doručení. Draft se nesmí ztratit ani tiše přebazovat; nevracet starou cache přes novější inbound. Toto není distribuovaná transakce ani záruka doručení po pádu procesu. K07 outbox a K12 atomické scope operace ani ostatní K07–K15 nejsou součástí K06 a zůstávají pending.

### K07 — Transakční outbound záměr

Přidat jednu interní Postgres outbox tabulku pro event provider delivery. Záznam obsahuje stabilní ID operace, cílový účet/kalendář/objekt, pořadí/revizi, zamýšlený patch nebo potřebný snapshot, očekávanou vzdálenou verzi, pokusy a stav. Není to veřejný obecný job systém.

Create/update/delete/link/unlink uloží lokální změnu a potřebné cílové operace ve stejné transakci. Pro delete uchovat vzdálenou identitu i po odstranění běžného mapování. Nekombinovat trvalý záměr s nekontrolovaným starým inline pushem, který by tutéž operaci odeslal podruhé.

**Místa:** DB schema/migrace, event transakce, handlers, sync engine. Migrační číslo určit až při implementaci.

**Test/hotovo:** rollback DB nevytvoří job; committed změna bez jobu není možná; pád po commitu zachová záměr; unlink neztratí adresu pro delete. Opakovaný klientský request se stejnou identitou mutace nepřidá druhou logickou operaci.

### K08 — Worker, idempotence, konflikty a pull/push koordinace

Použít stávající proces/scheduler. Claim operace musí mít obnovitelný stav po pádu; zápisy do stejného vzdáleného objektu zachovat v pořadí. Starší pending změna nesmí po dokončení novější vrátit starý obsah.

Providerově specifická idempotence:

- Google: ověřené stabilní klientem přidělené event ID pro create.
- Graph: podporovaný `transactionId` a reconciliation nejasného výsledku; ověřit časové a API limity deduplikace.
- CalDAV: stabilní resource URL/UID a podmíněný create.

Žádné univerzální tvrzení „exactly once“. Timeout po odeslání je nejasný výsledek: nejdřív dohledat odpovídající objekt, až potom případně znovu vytvářet. Pull nesmí nové remote echo importovat jako druhou Musubi událost.

Další nutné chování:

- 429/5xx/network → odložený retry respektující `Retry-After`; permission/reconnect/unsupported → viditelný blokovaný stav; konflikt → uchovat obě verze, ne slepý retry.
- Pending lokální změnu nesmí přepsat starší pull; skutečnou souběžnou remote změnu rozpoznat jako konflikt. Cursor nesmí přeskočit změnu, která nebyla aplikována nebo trvale uchována k vyřešení.
- Autoritativní inbound změna vytvoří fan-out pouze do odvozených cílů. Echo nepovede ke smyčce a příchozí neautoritativní kopie neobejde K01.
- Disconnect/smazání kalendáře musí vyřešit jeho pending operace. Odpojený účet nesmí po pozdějším reconnectu obdržet staré překvapivé zápisy.
- Payloady, osobní údaje a tokeny nepatří do logů ani metric labels. Reuse observability pro počty, stáří pending operací a bezpečné kódy chyb.

**Test/hotovo:** fake provider + skutečný disposable Postgres: timeout po remote commitu, pád před uložením mappingu, restart workeru, 429, 403, souběžný pull/update, create→update→delete, disconnect při pending jobu. Žádná tichá ztráta, duplicitní create ani resurrection smazané události.

### K09 — Pravdivé stavy na webu i mobilu

Stav je per vzdálený cíl; agregovaný event může být částečně doručený. „Uloženo v Musubi“ odlišit od „Synchronizováno“. Uživatel vidí čekání, chybu, nutnost reconnectu nebo konflikt a může bezpečně opakovat/řešit konkrétní operaci.

Použít stávající cache, query invalidation, SSE a UI primitives. Retry endpoint musí znovu ověřit vlastnictví a cíle. Optimistický UI stav není potvrzení vzdáleného zápisu. Konflikt nezavře draft; explicitní přepsání vyžaduje novou kontrolu aktuální vzdálené verze.

**Test/hotovo:** event ve dvou cílech, jeden úspěch a jeden 503/403; oba klienti zobrazí pravdu po reloadu i restartu API. Reconnect sibling účtu neovlivní jiný cíl. Nový vizuální vzor projde Storybook schválením podle musubi-ui; běžná kompozice existujících stavů nepotřebuje restyle.

**Gate M1:** všechny K01–K09 acceptance scénáře projdou. Známá omezení sérií jsou viditelná a bezpečná; M1 se neoznačuje jako dokončená providerová parita.

## Třetí série: věrný čas a opakování

### K10 — Časový model a identita výskytu

Nejdřív krátký konkrétní návrh schématu/kontraktu, poté aditivní migrace:

- Událost/série nese vlastní časovou sémantiku: zoned s TZID, floating nebo all-day date; pro legacy zůstává explicitně neznámá zóna. Existující instant a inclusive all-day konvenci bez potřeby nepřepisovat.
- Série a výjimka mají explicitní vztah. Identita výskytu vychází z původního recurrence startu, nikoli z času po přesunu.
- Providerová identita výskytu/verze patří ke vzdálenému mapování; neslučovat různé účty jen podle iCal UID.
- Jedna sdílená expanze pro web, mobil, API reminders i widgety; viewer timezone ovlivňuje zobrazení, ne okamžik zoned události.

**Migrace:** zóny a vztahy znovu načíst od providerů do stávajících mapování, bez wipe kalendářů a bez echo zápisů. Lokální historické zóny nehádat jako „správné“ podle serverového TZ. Uchovat legacy stav, nabídnout explicitní doplnění tam, kde je potřeba. Zabránit souběžnému backfillu v přepsání novějšího draftu.

**Test/hotovo:** stejné okamžiky v UTC/Prague/New_York; evropské a americké DST v různých týdnech; neexistující a dvojznačný lokální čas; all-day přes DST; floating čas podle definované semantiky. Stabilní ID výjimky po přesunu a restartu. Zvolenou politiku DST zdokumentovat, neimplementovat ad-hoc hodinovou aproximaci.

### K11 — Věrný import a zachování providerových výjimek

Tři samostatné providerové řezy nad stejnými fixtures a kontraktem:

- **Google:** `recurringEventId`, `originalStartTime`, přesunutá i cancellation-only výjimka, incremental i full/reset. Nedovolit současně generovaný původní výskyt a jeho náhradu.
- **CalDAV:** master vybrat podle identity, ne prvního VEVENT; detached overrides zachovat jako výjimky s vlastním obsahem/délkou. Ponechat nedotčené VTIMEZONE, VALARM, attendee a neznámé vlastnosti. Neproměňovat obsah výjimky pouze na RDATE.
- **Graph:** uchovat vazbu na master při calendarView importu, nesčítat provider-expanded výskyty a lokální expanzi téže série. Reset/obnova okna nevytvoří nové logické identity.

**Test/hotovo:** opraveny všechny tři reprodukce auditu; pořadí příchozích master/exception záznamů výsledek nemění; odstraněná/přesunutá výjimka přežije restart a úplný sync. Přepsaný název, čas, délka a stav výjimky se zobrazí správně.

**Rozsah historie:** pro první vydání zůstává Graph současné omezené importní okno. UI mimo pokrytý rozsah nesmí tvrdit „žádné události“ bez vysvětlení. Úplná historie/on-demand načítání je samostatný následný řez, ne skrytý příslib této migrace.

### K12 — Serverová scope operace a nativní zápisy série

Jedna autorizovaná/idempotentní operace se scope `occurrence`, `following`, `series`, očekávanou revizí a původní identitou výskytu. Lokální aktualizace série/výjimek + outbound kroky jsou atomické v DB. Web a mobil přestanou skládat samostatný PUT a POST.

- Google/CalDAV: změna jedné instance upravuje nativní výjimku, nesouvisející overrides se nemažou.
- Graph: nejdřív běžné denní/týdenní/měsíční/roční patterny a podporované count/until rozsahy. Převod pouze přesný; nereprezentovatelné pravidlo zachovat a jeho editaci explicitně omezit.
- „Tento a následující“ respektuje možnosti providera. Pokud vyžaduje více vzdálených kroků, jejich pořadí a pokračování řídí durable operace; neslibovat distribuovanou transakci.
- Selhání prostředního providerového kroku zůstane viditelnou rozpracovanou operací s bezpečnou obnovou, nikoli falešným success nebo slepým rollbackem novějších změn.

**Test/hotovo:** všechny tři scopes pro edit/delete, první i pozdější výskyt, COUNT/UNTIL, dřívější přesunuté výjimky, 503 mezi kroky a opakovaný request. Outlook recurring create se objeví jednou u providera i po echo importu. Zákazy K04 odstraňovat jednotlivě až po důkazu podpory.

## Čtvrtá série: pracovní a osobní meetingy

### K13 — Externí účastníci, organizátor, RSVP a rušení

Společný model importuje identitu organizátora, vlastní účast, účastníky/role a odpovědi. Musubi sociální attendance se nesmí vydávat za providerovou odpověď; buď explicitně oddělit, nebo propojit až podle ověřené identity konkrétní kopie.

Postupovat ve třech ověřitelných řezech: (a) čtení + zachování, (b) přijmout/tentative/odmítnout a withdraw tam, kde je podporováno, (c) organizer create/update/cancel s explicitní notification policy. Host nesmí měnit organizátorův meeting jen proto, že vlastní svůj kalendář.

Google/Graph použijí nativní operace. CalDAV scheduling nabídnout pouze při prokázané podpoře serveru; bez ní zachovat data a vysvětlit omezení. Neposílat vedle providerové pozvánky druhý Musubi e-mail za tutéž akci.

**Test/hotovo:** dva testovací účty, vytvoření pozvánky, skutečná odpověď viditelná organizátorovi, změna času a zrušení, jedna instance série, opakovaný request bez duplicitních pozvánek. Meet/Teams informace přežijí unrelated edit; jejich plná tvorba je providerové rozšíření, ne podmínka prvního RSVP řezu.

### K14 — Připomínky, dostupnost, soukromí

Rozdělit na dva řezy:

1. Nativní reminder nastavení se načte a zachová; podporované varianty lze upravit. Osobní Musubi reminder zůstane samostatný a uživatel ví, kdo upozornění odesílá. Neznámý/nespravitelný VALARM zachovat, ne nahradit jedním výchozím alarmem. Neslibovat deduplikaci oznámení mezi nezávislými aplikacemi, které Musubi neovládá.
2. Free/busy, stav události a soukromí mapovat věrně podle providera. Richer stavy jako Outlook workingElsewhere nebo Google special event types zachovat jako rozšíření, ne zploštit při změně názvu. Free/busy-only oprávnění nesmějí zpřístupnit privátní popis, účastníky či konferenční URL.

**Test/hotovo:** reminder round-trip bez změny účastníků/času; lokální all-day upozornění ve správné uživatelské zóně; soukromý meeting a kalendář s pouze free/busy přístupem; title-only edit zachová providerový speciální stav. Kalendářové ACL sharing management a room booking nejsou automatickou součástí tohoto řezu.

## K15 — Ověřování a vydání

### Průběžná matice

Ke každé funkci evidovat zvlášť **read / write / preserve / unsupported**, odkaz na test a případně poslední živé ověření. Není potřeba nový testovací framework; fixtures rozšíří existující API self-checky, DB integrace a browser scénáře.

| Vrstva | Povinný důkaz |
| --- | --- |
| Čistá logika | Regresní test datumů, zón, recurrence a změnových patchů |
| Provider HTTP | Skutečný request/response proti fake serveru: stránkování, chyby, podmínky, replay |
| DB + worker | Transakce, souběh, restart, tombstones, pending operace a scope edit |
| Web/mobil | Uživatel pozná pending/failure, neztratí draft; kontrola skutečných callerů |
| Živý provider | Google, Outlook, iCloud + Radicale nebo jiný obecný CalDAV |

Živé minimum: connect → první pull → delta → create/update/delete → all-day → série/výjimka → reconnect/disconnect. Po zavedení spolupráce přidat organizer/attendee scénáře. Zkoušet alespoň dvě odlišná časová pásma; pouze Europe/Prague browser projekt nestačí.

### Příkazy a gates

- Před buildem proactive LSP diagnostika změněných souborů; před uzavřením práce `lens_diagnostics mode=all`.
- Cílené testy pro měněnou oblast; při změně wire/API `pnpm --filter @musubi/types test` a `pnpm check:contracts`.
- Web: typecheck/lint/test; relevantní Playwright scénář; při změně shared primitive/story také `pnpm storybook:web:test`.
- DB/provider/worker změny: integrační suite nad čerstvě migrovanou disposable DB, včetně restart scénáře.
- Milník: `pnpm check`, relevantní DB integrační sady, `pnpm test:e2e` a zdokumentované živé round-trip výsledky. Nedostupné credentials jsou blokátor živého ověření, ne „passed“.

## Migrační a rollback pravidla

- Postup **expand → dual-compatible read/write → backfill → ověření → enforcement**. Destruktivní contract cleanup není součástí prvního rollout kroku.
- Starší klienti nesmějí při full PUT vymazat nová pole, kterým nerozumějí. Server rozlišuje chybějící pole od explicitního null; unsafe legacy cesty omezí podle schválené verze/capability politiky.
- Neměnit význam existujících IDs, all-day konců ani API rout bez kontraktu. Změny projekce série musí řešit také cache, SSE, reminders a widget occurrence ID.
- Outbox rollout má jedinou aktivní write cestu; žádný dual-send. Pending data musí přežít deploy. Rollback na starý binár bez znalosti outboxu není bezpečný: nejdřív zastavit nové zápisy a vyřešit/drainovat pending operace, nebo použít kompatibilní opravný release. Nezahazovat frontu jako rollback.
- Zóny/instance backfill se restartuje idempotentně; opravuje stejná mapování, nevytváří nové kalendáře a nespouští outbound echo.
- Historicky ztracené tokeny nebo přepsaná providerová metadata nejsou automaticky obnovitelné. Před migracemi záloha; žádný neověřený „repair all“ proti reálným účtům.

## Co potřebuje výslovné rozhodnutí vlastníka

Samotný plán není oprávnění k produkčním migracím, změně minimální verze klientů ani živým mutacím účtů.

Před příslušným krokem potvrdit:

1. **K06:** minimální write-compatible verzi a přechodný režim starších klientů. Bez revision-aware klienta nelze garantovat ochranu stale draftu.
2. **K09 / další UI:** nový výrazný vizuální vzor, pouze pokud ho stávající primitives/patterns nepokrývají.
3. **K15:** vyhrazené testovací účty a infrastrukturu pro skutečné pozvánky, mazání a restart testy.

Výchozí směr ostatních rozhodnutí je uveden výše, aby implementace nestála na zbytečných dotazech. Případné nové závislosti vyžadují samostatné zdůvodnění; pro UI vždy předchozí schválení.

## Dokončený K01 — evidence

- Regrese nejprve selhala na neoprávněném upsertu; oprava je ve společných DB dotazech, nikoli v jednotlivých adaptérech.
- Neautoritativní update/revival je odmítnut; nesoulad se zaznamená bez hodnot providerových polí a bez posunu ETag. Uživatelské řešení konfliktů zůstává K06/K09.
- Delta delete i reset sweep odpojí pouze dané zrcadlo. Mapování stejné vzdálené kolekce přes jiné účty zůstávají nedotčena.
- Příjemci bez zbývajícího přístupu dostanou stávající SSE `event_removed`, i když následný import jiného objektu selže. Mobilní full catch-up již nepovažuje CalDAV zrcadla za offline federaci.
- Regrese souběžného delete a řízený test pořadí zámků ověřují společné pořadí event → link/mapování.
- Prošlo `pnpm --filter @musubi/api test`, celé `pnpm test:db` na samostatném dočasném PostgreSQL 18 clusteru, všech 59 mobilních unit testů, API/mobilní typecheck a kontrakty rout/realtime. Finální DB regrese navíc ověřuje chybu po již commitnutém unlinku.
- Nový test `apps/api/src/sync/external_events.integration.test.ts` je součástí `test:db:sync`, a tím existujícího integračního CI jobu.
- Bez změny schématu nebo wire kontraktu; bez nových závislostí a bez živých providerových zápisů. Nejde o plné zařízení/browser E2E ani certifikaci providerové kompatibility.

## Dokončený K02 — evidence

- Tři sériové řezy: autentizovaný bootstrap, úplný Google calendar-list, fail-closed Graph master hydration. Bez změny schématu, Tasks consent policy, UI vzhledu nebo závislostí.
- `POST /api/v1/users/connections/sync` používá existující orchestrace a identitu z `requireAuth`. Volitelný `accountId` vyžaduje `provider`; explicitní účet omezuje už DB eligibility i profilové/tokenové čtení. Cizí/neznámý účet nevede k širšímu syncu. Legacy Google GET zůstává Google-only.
- Schválený kompromis: OAuth callback webu i mobilu zná provider, ne ID právě připojeného účtu. Bootstrapuje proto způsobilé účty pouze tohoto providera přihlášeného uživatele, nikoli výhradně nově připojený účet. Prázdné tělo slouží ručnímu all-provider refreshi vlastního uživatele.
- `apps/api/src/sync/bootstrap.integration.test.ts`: skutečné HTTP → auth middleware (testovací bearer identita) → handler → orchestrace → provider HTTP fixture → disposable DB. Microsoft-only uživatel bez zrcadel získá kalendář; scheduler najde účet bez zrcadel; explicitní scope nečte profil/token sesterského účtu ani nemění jeho credentials. Testuje také 401, vadné body, cizí účet, provider-only a legacy cestu.
- `google_discovery.integration.test.ts`: regrese před opravou selhala na chybějícím odmítnutí 503 druhé stránky. Skutečný adapter sleduje všechny page tokens včetně prázdné prostřední stránky; neúplný seznam nezmění zrcadla, události ani cursory. Kompletní retry zachová pozdní zrcadla a odstraní jen skutečně chybějící.
- `microsoft_hydration.integration.test.ts`: regrese před opravou selhala na chybějícím odmítnutí master 503. 429/5xx/403 i nejednoznačné 404/410, síťová chyba a neplatný payload nyní zachovají event data i cursor celé delty. Další pokus doplní název/body/all-day data bez duplikátů. Master lookup používá stejný calendar-scoped event path jako ostatní Graph operace; úspěšná hydratace se cachuje pouze v dané deltě.
- Schválená bezpečná hranice: samotný chybějící master nedokazuje smazání výskytu. Pouze explicitní delta `@removed` se zpracuje bez hydratace jako cancellation. Nejednoznačně chybějící master ponechá sync chybový, místo aby zničil data nebo posunul cursor.
- Webový hook test prochází skutečným resource transportem; nativní test vykoná skutečný Outlook button callback a `useApi` při úspěchu i chybě (nativní hosty jsou mockované). Dva Playwright callback scénáře prošly: import Microsoft účtu po návratu a viditelná chyba importu. Nejde o živý OAuth round-trip ani test fyzického telefonu.
- Prošly API suite, všech 62 mobilních a 342 webových unit testů, API/mobilní/web typecheck, web lint, types suite a route/realtime contracts. `pnpm test:db` prošel po každém řezu nad čerstvě migrovaným dočasným PostgreSQL 18.6 (Unix socket, port 55432), včetně nezměněné K01 event authority regrese. Nové tři DB testy jsou zapojeny do `test:db:sync`, a tedy `test:db`.
- Lokální evidence běhu: `/tmp/musubi-k02-logs/` (red/green provider regrese, jednotlivé řezy a finální gates). První full DB běh narazil na chybějící testovací `FEDERATION_ALLOW_PRIVATE_HOSTS`; opakování s existujícím CI nastavením prošlo. Žádné živé providerové volání, produkční migrace, push ani release. Build/full milestone gates a závěrečná LSP kontrola nejsou tímto lokálním ověřením nahrazeny.

## Dokončený K03 — evidence a nezávislá revize

- Calendar eligibility, stav připojení, scheduler i skutečný Better Auth relink hook již nevyžadují Tasks scope. Chybějící Tasks grant nemaže použitelné calendar credentials. Historický `insufficient_scope` se smí uzdravit pouze s existujícím refresh tokenem; token smazaný migrací `0056_provider_task_scopes.sql` nelze obnovit odhadem. Migrace se nemění.
- Stávající `CalendarAdapter.listCalendars` vrací kalendáře a explicitní `taskListsComplete`. Vynechané/selhané Tasks discovery není autoritativní prázdný seznam: task-only zrcadla, mapování, data a cursory zůstanou zachované a nefetchují se. Kompletní prázdný seznam nadále odstraňuje skutečně smazané task lists. CalDAV vrací kompletní discovery beze změny chování.
- Bez uloženého Tasks scope nevolají oba OAuth adaptéry Tasks endpoints ani při přímém task/list zápisu. Volitelné Tasks 403 a přechodné resource chyby neblokují event import; OAuth refresh chyby a resource 401 nejsou spolknuté jako volitelná chyba. Nové testy ověřují také skutečný `invalid_grant` mezi discovery a task fetchem.
- Adapterový i Better Auth Microsoft refresh vynechávají `scope`, aby neeskalovaly calendar-only grant ani nezúžily existující calendar+Tasks grant na identity scopes. Skutečně vrácený scope se uloží; vynechaný scope zachová dosavadní grant. Task writes kontrolují oprávnění znovu po refreshi.
- Schválená UX volba: „Include Tasks (optional)“ je výchozí **ON** kvůli kompatibilitě se stávajícími Tasks uživateli. **OFF** výslovně umožňuje calendar-only v ConnectionsDialog (včetně reconnectu), web Onboarding i native SyncCalendarModal. Všechny tři flow vysvětlují, že OFF nežádá nové Tasks oprávnění, ale neodvolává již udělený souhlas. Backend rozhoduje podle skutečného grantu, nikoli podle checkboxu. Bez odhadování identity účtu před redirectem; Google incremental consent zachovává dřívější granty.
- `optional_tasks.integration.test.ts` používá skutečné Google/Microsoft adaptéry, lokální HTTP fixture, engine a disposable DB: calendar-only/full grant, chybějící či zúžený Tasks scope, 403/503 při discovery i fetchech, selhání druhé stránky listů i items, zachování zrcadel/mapování/data/cursoru při postupujícím event importu, autoritativní odstranění listu, oba refresh flow, skutečný auth hook a revoked/již smazaný token. Všechny task/list write vstupy bez grantu zůstávají bez providerových volání. Better Auth authorization URL test ověřuje, že defaultní konfigurace při OFF Tasks scope nepřidá. Dočasné obnovení staré mandatory-Tasks eligibility způsobilo očekávané selhání nové regrese.
- Upravené K02 fixtures používají pro skutečně nezpůsobilý sibling `User.Read`, nikoli nyní platný calendar-only grant; původní assertions account isolation zůstaly. Prošel celý `pnpm test:db`, včetně K01 autority a K02 Google pagination/Graph hydration/bootstrap, na novém PostgreSQL 18.6 clusteru v `/tmp/musubi-k03-pg.*` (Unix socket, port 55432, local trust/host reject).
- Prošly API/auth suite, 348 webových a 66 mobilních unit testů, `pnpm typecheck`, web lint, types suite a route/realtime contracts. Testy vykonávají skutečné callbacky všech tří UI flow (včetně Google disclosure na mobilu). Čtyři Chromium scénáře prošly bez retry: keyboard ON/OFF + axe v desktop/light a narrow/dark, stávající mobile connections sheet a onboarding.
- Lokální commity: `5b171e6` (eligibility/discovery/fault boundary), `d0d8cdd` (grant-preserving refresh), `493caf8` (volitelný consent v UI). Logy: `/tmp/musubi-k03-logs/`; souhrnný diff vůči `82c106e`: `/tmp/musubi-k03-implementation.diff`. Dodatečná regrese revokace během task fetch a tato evidence tvoří závěrečný test/documentation commit.
- Omezení: žádný živý OAuth/provider round-trip, fyzické zařízení, produkční migrace, nové závislosti, push ani release. Shared UI primitives nebyly měněny a redesign neproběhl. Úplné build/milestone gates nejsou nahrazené lokálními testy. Browser probe navíc odhalil již existující nevrácení focusu na Connections trigger po zavření dialogu; totožně reprodukováno na `82c106e`, beze změny focus plumbing v K03 (`browser-baseline-focus.log`).

- Závěrečné ověření (2026-09-05): nezávislá revize `review.md` má verdikt „OK with notes“, bez P0/P1/P2 nálezů; všech šest věcných závěrů bylo porovnáno se skutečným kódem. Žádná další K03 oprava ani nová regrese nebyla nutná. Znovu prošly API/auth suite, web 348/348, native 66/66, `pnpm typecheck` (včetně API/client/web), web lint, types a contracts; nové logy jsou v `/tmp/musubi-k03-final-logs/`. Beze změny relevantního chování se přebírá celý DB gate z `/tmp/musubi-k03-logs/db-final.log` a Chromium 4/4 z `browser-consent-final.log`; původní vlastní DB cluster je ověřeně odstraněn, nový nebyl spuštěn.
- Původní čtyři nedotčené format-only pracovní změny zůstávají nestageované a shodné s `/tmp/musubi-k03-preexisting.diff`. Při převzetí finalizace byl navíc přítomen sémanticky ekvivalentní ternární výraz v `packages/db/src/queries/oauth.ts` (původ nepotvrzen); podle pokynu rodiče zůstává nedotčený, nestageovaný a mimo commit, se snapshotem `/tmp/musubi-k03-final-inherited-oauth.diff`. Závěrečný souhrnný diff vůči `82c106e` je `/tmp/musubi-k03-final.diff`.

- Finální převzetí rodičem (2026-09-05): zkontrolován produkční diff a konkrétní testové logy, nezávislá revize bez nálezů přijata. LSP potvrdilo 24 změněných TS/TSX souborů bez chyb; kontrola `connections.module.css` opakovaně skončila timeoutem, nikoli potvrzením čistoty. CSS změna je pouze `grid-column: 1 / -1`; ověřena zeleným web lintem a browser scénáři. Závěrečné `lens_diagnostics mode=all` nehlásí blokující chyby. Pět zděděných nestageovaných úprav zůstává zachováno; nic nepushnuto.

## Další konkrétní práce

K05 je převzat včetně nativního delete dokončeného v K04. **K06–K15 zůstávají pending.** Další K06 zavede revize a nedestruktivní patche; před enforcementem musí vlastník rozhodnout kompatibilitu a přechodný režim starších klientů podle gate K06.

Odhady termínů přidat až po prvních opravách a návrhu revizí/outboxu. Kalendářní datum bez ověření těchto hranic by nyní bylo falešně přesné.
