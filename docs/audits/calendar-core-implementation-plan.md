# Implementační plán: důvěryhodný sjednocený kalendář

Stav: K01–K06 implementovány, lokálně ověřeny a převzaty (2026-09-05). K06 je převzat celý, nikoli pouze jeho dřívější checkpoint. K07 byl schválen a squash-mergnut (2026-09-07); navazující nezávislé review má samostatnou UUID opravu. K08 je převzatý; K09 je převzatý; K10 je lokálně dokončený; K11 je lokálně převzatý v dokumentovaném podporovaném rozsahu; K12–K14 jsou rozpracované (dílčí převzaté řezy níže); K15 probíhá průběžně; release ani nasazení nejsou schváleny.

Navazuje na [audit kalendářového jádra](calendar-core-audit.md), revize `60316a9`.

Aktuální rozdělení implementovaných schopností, zbývající autonomní práce a vstupů vlastníka je v [přehledu zbývající práce](calendar-core-remaining-work.md). Historické checkpointy níže zachycují stav při daném řezu; pozdější implementace může jejich tehdejší omezení překonat.

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
8. Každé PR před squash mergem posoudí nezávislý agent s čistým kontextem proti jeho skutečnému base/head diffu. Nálezy opravit, doplnit odpovídající regrese a nechat ověřit finální změnu; merge až po uzavření nálezů a zelených povinných kontrolách.

## Pořadí a závislosti

Značky A1–A10 odkazují na nálezy auditu. K01–K07 jsou `completed` (K07 UUID oprava po review viz níže); K08 je `completed`; K09 je `completed`; K10 je `completed` (lokální implementace; produkční aktivace čeká); K11 je `completed` (lokální podporovaný importní kontrakt); K12–K14 jsou `in_progress`; K15 probíhá průběžně. Dílčí read model ani lokální scope neznamenají uzavření providerových zápisů nebo živé acceptance.

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

**Stav: K06 DOKONČEN A PŘEVZAT.** DB CAS je zapojen do skutečných API a obou klientů, včetně zmrazených draftů, SQLite revizí a conditional delivery s pravdivými postcommit chybami. Nezávislé revize i rodičovské ověření uzavřely nalezené blokery. Platí [závěrečné převzetí](#dokončený-k06--závěrečné-převzetí); níže uvedené checkpointy jsou dobovou historií, nikoli aktuálními blokery. Nasazení stále vyžaduje koordinovaně dostupné klienty/peery 0.1.8 a samostatný souhlas.

Aditivně zavést lokální event revision a serverovou kontrolu očekávané revize. Změna obsahu nebo příchozí změna, která obsah opravdu mění, revizi posune. Běžný no-op poll ji neposouvá. Server vypočítá skutečný field diff; neposílat providerovi znovu nezměněný text, čas nebo location.

Externí mapování uchová providerovou verzi. Pro každou službu ověřit konkrétní podporu conditional write a jeho chování testem; nepovažovat Graph `changeKey` automaticky za ekvivalent garantovaného `If-Match`. Samotné GET následované PATCH bez podmínky není atomická ochrana konfliktu. Neprokazatelnou ochranu nepředstírat a nebezpečnou operaci neprovést bez explicitního řešení.

**Místa:** shared types/wire, DB schema a event dotazy, event handlers, adapter contract/serializery, klientské mutace.

**Test/hotovo:** dva drafty ze stejné revize; druhý nevrátí starý čas. Outlook title-only edit zachová původní HTML a strukturované location. Omitted pole není totéž jako explicitní vymazání. Vzdálený konflikt nezpůsobí lokální ztrátu draftu.

**Kompatibilitní gate:** starý klient revision neposílá; bez ní nelze slíbit detekci stale draftu. Před zapnutím enforcement rozhodnout mezi bezpečným omezením starých write cest a zvýšením minimální podporované verze. Doporučení: noví klienti nejdřív, potom enforcement; žádný trvalý tichý bypass. Změnu podpory vydaných klientů schvaluje vlastník.

**K06 rozpracováno — lokální základ, nikoli dokončení (2026-09-05):**

- Vlastník schválil zvýšení minimální verze **klientů na 0.1.8**; produkt zůstává 0.1.8. Autoritou vydání je upstream tag, ne číslo rozpracovaného manifestu: rodič ověřil poslední tag `v0.1.7` (`af02dcfe077c10b67bcba90f85e051d6f98fcf2c`), bez tagu 0.1.8. Původní návrh 0.1.9 je zrušen. Připravit web/native/server společně; nasazení enforcementu čeká na dostupné kompatibilní klienty. Žádný release, push ani produkční migrace nejsou schváleny. Vlastník následně výslovně schválil **také upgrade federovaných serverů a `MIN_PEER_VERSION = 0.1.8`**: starý member-token klient a starý peer mají stejné product endpointy a nelze je bezpečně rozlišit. Toto nahrazuje dřívější ponechání peer floor 0.1.6. Staré cache/connection záznamy se nemažou; revision-less draft se nesmí stát zapisovatelným pomocí vymyšlené revize.
- Vygenerovaná aditivní migrace `0058_classy_captain_america` přidává `events.revision NOT NULL DEFAULT 1`. Nová DB cesta `patchEventAndCalendarLinks` zamyká event před linky, kontroluje očekávanou revizi a ve stejné transakci počítá skutečný patch, mění linky/mapování i případný tombstone. Omitted není null, stale no-op je konflikt, aktuální no-op nemění revizi ani delta čas. Nová identita nepřebírá revizi zdroje. Příchozí autoritativní změny/tombstone/revival posouvají revizi; stejný obsah pouze aktualizuje přijatou provider verzi. K01 odmítnutý mirror nadále nepřijímá jeho nový ETag.
- Lokálně ověřeno na novém, pouze Unix-socket PostgreSQL 18.6 v `/tmp/musubi-k06-pg.*`: migrace předchozího schématu s existujícím eventem, CAS race (právě jeden vítěz), dva stale drafty bez vrácení času, rollback obsahu/linků/mapování, null/omission, no-op poll i změna samotného ETag, inbound/local race a autorita pro všechny tři providery. DB unit, `test:db:sync` a API typecheck prošly; logy `/tmp/musubi-k06-logs/`. Toto nejsou testy živých providerů. Zapojení CAS handlerů, zbývající legacy write cesty, klientské drafty, conditional delivery a finální K06 gates ještě čekají. Základ není připraven k nasazení; jeho dílčí převzetí a hranice důkazů jsou zaznamenány níže.
- Druhý lokální řez zavádí skutečný globální gate v `requireAuth` pro read/write/upload/ICS/stream včetně member tokenů: chybějící, chybná nebo stará klientská verze vrací 426. Web JSON/raw/ICS requesty a browser SSE (jediná query varianta `clientVersion`) i nativní skutečný auth transport/raw ICS/SSE posílají 0.1.8. Veřejné discovery/auth callbacky/upgrade bootstrap/invite preview/avatar zůstávají; jediná authenticated výjimka je existující machine token rotation s původní autentizací. Handshake a každé gateway/stream navázání ověřují kompatibilní peer, gateway předává skutečnou verzi volajícího, ne vlastní. `docs/releasing.md` obsahuje přesné výjimky a koordinovaný upgrade. Reálné auth/DB/HTTP testy pro staré/missing/malformed/read/write/stream/handshake/rotation i gateway forwarding/refusal prošly; celé `test:db`, `test`, `typecheck`, contracts, release VERIFY a oba linty prošly (native pouze existující warnings). K06 tím **není dokončeno**; wire snapshot zatím nebyl přebaselinován a CAS není zapojen do klientských save cest.
- **Schválené dočasné omezení Outlook EVENT:** event-specific conditional PATCH/DELETE ochrana není doložena; `changeKey` ani samotný GET→PATCH nejsou důkaz. Před jakoukoli lokální mutací se má v úplném preflight odmítnout update/delete existující vzdálené Outlook události (včetně známých scope kroků a mirrors), s vysvětlením „ochrana neověřena“, ne tvrzením „Graph nepodporuje“. Read/create a již existující čistě lokální unlink bez remote účinku zůstávají. Žádný nový override/detach UI. Třetí lokální řez toto omezení zapojuje do skutečného Outlook preflight i přímo do adapter update/delete (nelze obejít voláním adapteru); read/create a existující lokální unlink bez mappingu zůstávají. Ukládá se skutečné `@odata.etag`, ne `changeKey`. `toGraphEventPatch` tvoří subject-only payload bez nezměněného HTML body/structured location/time/recurrence, ale není zapojen jako povolená remote write cesta. Skutečný HTTP handler test ověřuje beze změn odmítnutý title-only/update-only/delete i známý Outlook mirror a povolený čistě lokální unlink. Serializer a přímý adapter test ověřují omission a nulové remote volání při odmítnutí. Opětovné povolení vyžaduje explicitní event-specific důkaz enforcementu a novou revizi, fake HTTP samotné nestačí.
- Závěrečné lokální gates na všech třech řezech: celé `test:db`, `test` (365 web / 90 native), `typecheck`, contracts, release VERIFY a lint prošly; native má 107 existujících warnings, bez errors. Chromium 15/15 K04/K05 + reconnect/two-tab stream po úpravě mock URL pro skutečné `clientVersion` query. První Chromium pokus odhalil dvě zastaralé exact stream URL v mocku, nikoli CAS důkaz. V baseline souboru `month-read.spec.ts` se stageují pouze tyto úzké K06 stream hunks; původní K05 formatting zůstává mimo commit, ostatních 12 původních dirty souborů je beze změny. Automatické routeTree přeformátování z testovacího dev serveru bylo vráceno pouze z předem uložených identických bytů. Logy `final-*` v `/tmp/musubi-k06-logs/`; žádný build/publish/push ani živý provider.
- Schválené pořadí je lokální CAS commit před conditional delivery; remote konflikt má vrátit aktuální lokální revizi, `localCommitted` a pravdivý stav částečného/nepotvrzeného doručení. Draft se nesmí ztratit ani tiše přebazovat; nevracet starou cache přes novější inbound. Toto není distribuovaná transakce ani záruka doručení po pádu procesu. K07 outbox a K12 atomické scope operace ani ostatní K07–K15 nejsou součástí K06 a zůstávají pending.

**Převzetí pouze dílčího checkpointu (2026-09-05):** commity `677e01d`, `0169c7f`, `5634359` prošly nezávislou revizí bez nálezů. Původní běh skončil chybou `Request was aborted`; obnova stejným subagentovým protokolem dokončila revizi a ověření bez změn zdrojů. Čerstvě prošly typecheck, contracts, release VERIFY a cílené DB unit / Outlook / federation / web transport / native version testy. Plné DB/root/Chromium důkazy pro nezměněný checkpoint byly výslovně převzaty z původních logů, nikoli vydávány za nové spuštění. Rodič zkontroloval klíčové zdroje a důkazy; LSP potvrdilo všech 31 změněných TS/TSX souborů bez chyb, lens bez blokujících chyb. Logy obnovy: `/tmp/musubi-k06-checkpoint-logs/`. Staging prázdný, 13 zděděných úprav zachováno, testovací DB odstraněna. **Celý K06 zůstává nedokončený a nesmí se nasadit; žádný push.**

**Pokračování K06, provider hranice stage 1 (2026-09-05):** commit `fec0835` doplňuje Google EVENT opaque ETag a conditional PATCH/DELETE se skutečným field diffem. CalDAV používá úplný guarded GET, vyžaduje shodu jeho strong ETag s již přijatým mappingem a mění pouze vybrané property spans; neprovádí lossy serializaci celého ICS. Unknown/rich properties, parametry, folded lines, VALARM/VTIMEZONE, UID a detached exceptions zůstávají zachovány; K04 recurring/organizer omezení platí dál. Chybějící/slabý response validator se maže na null, nikoli nahrazuje starým tagem nebo novým neodsouhlaseným GET. Prepared delivery drží scoped refs i přes unlink a vrací interní receipts; 412 se nespolkne ani neopakuje bez podmínky. Skutečné lokální HTTP/handler/DB regrese, API testy a typecheck prošly; dokumentace a přesné další seams jsou v [provider boundary](../sync/event-write-boundary.md), logy `/tmp/musubi-k06-completion-logs/providers/`. Toto **není převzetí celého K06**: API stále používá legacy non-CAS writers, delete-before-local pořadí a generic 500 místo pravdivého `localCommitted`/revision/partial delivery response. Další writer vlastní CAS/wire/client integraci, pořadí a zmrazené drafty. Outlook mapped EVENT update/delete zůstává odmítnut, verze klientů/peerů 0.1.8 se nemění; K07/K12 ani release nejsou součástí tohoto řezu.

**K06 completion stage 2 — kandidát k nezávislé revizi (2026-09-05):** skutečné strict PATCH/expectedRevision kontrakty (PUT je stejný strict alias), event-locked CAS update/delete/link/unlink/fork, serverová revize create 1, odmítnutí revisionless cache, omission/null/no-op a guardy opožděných provider ACK. Authorization a celý známý preflight před lokálním commitem; conditional delivery až po něm. Veřejné 409/502 uvádí `localCommitted`, aktuální revizi/řádek a sanitizované partial/unconfirmed receipts, bez provider/account metadat. Oba klienti drží vlastní occurrence/master/links/revision přes SSE a More-options; chyby zachovají draft a nepřepíšou novější cache. Nativní skutečné scope callbacky vrací boolean a Cancel nemá API/reminder/close efekty. Sync access-loss SSE nese revizi; purged-row frame bez revize vyvolá full catch-up. Wire snapshot vznikl generátorem nad zapojenými schématy při 0.1.8. Lokální HTTP/DB, Chromium a skutečné native host/store/transport/SSE regrese jsou v testech a `/tmp/musubi-k06-completion-logs/integration/`. Přesný finální gate/commit/inherited-isolation záznam patří do managed implementation handoffu. Existující fork zachovává zdroj; není zaveden nový implicitní move/unlink. K07 outbox, K12 atomic scopes, živí provideři ani release nejsou součástí tohoto kandidáta. **Celý K06 zatím není převzat.**

- Lokální runtime/test commit: `778a72e`. Prošel celý `pnpm check` včetně release VERIFY 0.1.8, contracts (142 calls / 59 routes; 13 SSE frames), peers, typecheck, root tests (365 web / 100 native), lint (native 106 existujících warnings, 0 errors; web 0) a API/web build. Prošel celý `pnpm test:db` na vlastní PG18 Unix-socket DB a relevantní Chromium 21/21 bez retry. Po čistě formátovací projekci vlastního diffu znovu prošly root tests/typecheck/contracts/VERIFY, oba linty a Chromium; build/full DB evidence se přebírá přes ověřenou TS i emitted-JS AST ekvivalenci, nikoli vydává za nový běh. Dvě cache LSP chyby o EOF v native index/CalendarDetail zůstávají výslovně waived rodičem proti čerstvému skutečnému compileru; není tvrzena plošná LSP čistota.
- Všech 23 entry snapshotů má přesnou inverse-owned-delta rekonstrukci: 15 souborů zůstalo byte-untouched, 8 mělo vlastní překryv. 22 zděděných dirty cest zůstává nestageovaných. Rodič výslovně schválil jedinou výjimku: šest format-only oblastí EventDetailsPopover bylo celé překryto skutečnými draft/scope/Undo/handoff změnami, proto soubor již není dirty; nesimuluje se nový formatting diff jen kvůli počtu. Původní snapshoty a AST/byte důkazy jsou zachovány. Vlastní PG cluster `/tmp/musubi-k06-completion-integration-pg.OSKFJv` byl zastaven a odstraněn; `pg-cleanup.log` zaznamenává i zánik procesu. Bez nových závislostí, živého providera, produkční migrace, push nebo release. **Nezávislá revize a parent acceptance teprve následují.**

### K07 — Transakční outbound záměr

Přidat jednu interní Postgres outbox tabulku pro event provider delivery. Záznam obsahuje stabilní ID operace, cílový účet/kalendář/objekt, pořadí/revizi, zamýšlený patch nebo potřebný snapshot, očekávanou vzdálenou verzi, pokusy a stav. Není to veřejný obecný job systém.

Create/update/delete/link/unlink uloží lokální změnu a potřebné cílové operace ve stejné transakci. Pro delete uchovat vzdálenou identitu i po odstranění běžného mapování. Nekombinovat trvalý záměr s nekontrolovaným starým inline pushem, který by tutéž operaci odeslal podruhé.

**Místa:** DB schema/migrace, event transakce, handlers, sync engine. Migrační číslo určit až při implementaci.

**Test/hotovo:** rollback DB nevytvoří job; committed změna bez jobu není možná; pád po commitu zachová záměr; unlink neztratí adresu pro delete. Opakovaný klientský request se stejnou identitou mutace nepřidá druhou logickou operaci.

**Implementační kandidát K07 (2026-09-07):** po squash merge PR #119 do `main` (`70c334f`) vlastník schválil pokračování. Migrace `0059_event_outbox` přidává jedinou interní tabulku. Create/update/delete/link/unlink/fork a event část ICS importu ukládají připravené operace ve stejné transakci jako lokální změnu; skutečný no-op nemá outbound operaci. Záznam uchovává cílový účet a původní link ID, remote adresu/ETag/UID, committed snapshot a patch, revizi, předchůdce, stav a pokusy. Smazání mapování ani tombstone purge neztrácí delete adresu; smazání vlastníka cíle maže jeho payloady, odchod jiného autora změny nikoli.

První requestový pokus claimuje uložený řádek; odstraněné legacy push wrappers neposkytují druhou write cestu. Nedořešený předchůdce blokuje pozdější pokus, i když create zatím nemá remote mapping. Již změněná revize nebo nahrazený/odpojený cíl se před odesláním odmítne. To není úplná pull/push koordinace ani ochrana všech závodů během HTTP; ty patří K08. `pending`/`attempting` přežijí pád, ale K07 je automaticky neobnovuje.

Volitelný UUID `Idempotency-Key` je předáván i federation proxy. Opakované outbound sloty stejného autora a mutace jsou pod transakčním zámkem odmítnuty 409 a druhá lokální změna se rollbackne (včetně forku s novým ID). Bez hlavičky vzniká nová identita a platí stávající CAS. Nejde o replay původní HTTP odpovědi ani obecnou idempotenci lokálních-only operací či vytvoření samotného importního kalendáře; tabulka eviduje event provider delivery.

Regrese v `event-outbox.integration.test.ts` a skutečných HTTP/provider fixtures pokrývají atomický rollback, proces ukončený po commitu, zachování delete adresy, duplicitu identity, concurrent claim, pořadí create→update→delete bez mappingu a vlastnictví payloadů. Finální důkazy: čerstvá PG18 migrace a celý `pnpm test:db`, root `pnpm check`; viz také [hranice doručení](../sync/event-write-boundary.md). K07 tím není prohlášen za nezávisle převzatý. Worker/retry/reconciliation, disconnect cleanup a pull/fan-out jsou K08; UI stavu je K09. Produkční migrace, release a deploy neproběhly.

**Převzetí a nezávislé review K07 (2026-09-07):** vlastník schválil squash merge #120 (`eaf6a2b`) po všech 14 zelených CI kontrolách a pokračování až do konce plánu včetně jeho průběžných úprav. Každé další PR před mergem projde nezávislým agentem s čistým kontextem; nálezy se opraví a příslušné gates zopakují. Zpětné read-only review K07 našlo P1: uppercase UUID při create PostgreSQL normalizuje, ale case-sensitive filtr záměrů mohl commitnout event bez outboxu. Skutečný HTTP test nejdřív selhal 502 místo 201. Navazující oprava kanonizuje API UUID, srovnání outbox identit a calendar lifecycle/advisory mutation klíče; opaque user/account/provider ID zůstávají case-sensitive. Druhé čisté review rozšířilo nález na case-only PATCH (ztráta mappingu) a opakovaný link (duplicitní create). DB link diff i link/fork/unlink hranice proto porovnávají kanonická UUID; scope envelope se nepřepisuje před kontrolou jeho shody. Regrese pokrývá HTTP mixed-case event/calendar/origin, case-only PATCH/link bez změny revize nebo mappingu, fork refusal, uppercase unlink, přímé durable delivery guardy, raw DB enqueue, opakovanou mutation identitu a společný lifecycle zámek.

UUID oprava prošla třetím čistým review bez nálezů, lokálními gates a všemi 14 CI joby; PR #121 je squash-mergnuté (`81f5265`).

K08 bude dodán ve dvou reviewovatelných řezech: (a) stabilní provider create identity a dohledání nejasného výsledku, (b) worker/recovery a pull/push/lifecycle koordinace. Splnění celého K08 stále vyžaduje všechny acceptance scénáře níže, nikoli pouze první řez. K15 živé ověření potřebuje vyhrazené testovací účty; požadavek na jejich dostupnost byl vznesen, není nahrazen fake-provider výsledkem. Schválené pokračování zahrnuje implementaci, testy, PR a squash merge, nikoli implicitní živé mutace osobních účtů nebo produkční deploy.

### K08 — Worker, idempotence, konflikty a pull/push koordinace

**K08a převzat (PR #122, squash `3551487`, 2026-09-07):** nové outbox create intenty mají explicitní protokolovou značku a používají stabilní Google event ID + private marker, Graph transactionId a CalDAV URL/UID + conditional PUT. Adaptéry umí read-only dohledat matching objekt po ztracené odpovědi; Graph absence není povolení slepého POST. Staré neoznačené operace se nepřeznačují. Důkaz tvoří skutečné adapter/DB/HTTP fixtures; [kontrakt a zdroje](../sync/event-create-recovery.md). Finální čisté review bylo bez nálezů a všech 14 CI kontrol prošlo. Worker a celá níže uvedená K08 koordinace jsou další řez.

**K08b kandidát:** jeden durable dispatcher pro request i scheduler, obnovitelné lease s token fencingem a atomický ACK + mapping; read-before-retry po nejasném výsledku; `Retry-After`, blokovaná oprávnění a retained remote snapshots. Pull chrání pending obsah a páruje create echo s původním intentem. Autoritativní inbound enqueueuje pouze odvozené cíle; odstranění kalendáře ruší jeho nedokončené operace. Scheduler používá stávající API proces, batch 40/concurrency 4/15 s, respektuje vypnutí external sync. Průběžné nezávislé DB review našlo a opravilo expirovanou lease po čekání na lock a starý predecessor ETag přebíjející novější inbound baseline; oba mají regrese. K08b je převzat: PR #123 squash `57eda59` po čistém review celého `3551487..d241867`, všech 14 zelených CI kontrolách, lokálním root checku, celé DB/sync sadě a migracích 0000–0061 od prázdné PG18 DB. Review opravilo i provider projekci (CalDAV milisekundy), uchování unmapped delete včetně opaque Graph ID před create ACK a nový create při fan-out revivalu; scénáře mají regrese. [Kontrakt workeru](../sync/event-outbox-worker.md).

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

K09 se dodá v malých reviewovatelných řezech: read-only serverový kontrakt/stav; autorizované retry a explicitní řešení konfliktu; potom napojení obou klientů přes existující cache/SSE/primitives. Celý K09 se převezme až po acceptance obou klientů níže.

**K09 read-only stav převzat (PR #124, squash `19dc178`, 2026-09-07):** autentizované per-target receipts přežijí reload, novou instanci API i odstranění eventu; viditelnost každého cíle respektuje členství, soukromé payloady a providerové adresy se nevrací. Import bez receipt je `unknown`. Čisté review opravilo skrytý cancelled predecessor a uzavřelo finální diff `57eda590..408a709` bez dalších nálezů; lokální root check, celá DB sada, cílené opravené regrese a všech 14 CI kontrol prošly. [Kontrakt](../sync/event-delivery-status.md). Retry, explicitní řešení konfliktu a obě klientská UI jsou navazující práce.

**K09 retry převzat (PR #125, squash `a0f6ea9`, 2026-09-07):** retry reautorizuje vlastníka a přesný živý cíl, zachovává payload/ETag/identitu, uncertainty, Retry-After i aktivní lease; konflikt a zrušený cíl odmítá. Používá stejný dispatcher a scoped SSE. Status má bezpečné důvody reconnect/denied/unsupported. Čisté review finálního `19dc178..11c3767` bez nálezů; root check, celá DB sada, přímý HTTP→commit→claim test a všech 14 CI kontrol prošly. Explicitní řešení konfliktů a obě klientská UI zůstávají otevřené.

**K09 řešení konfliktů převzato (PR #126, squash `aaae1ca`, 2026-09-07):** explicitní náhled čte čerstvý providerový stav; potvrzení znovu ověří revizi, ETag, mapování, delete marker i celý čekající řetězec. Archivuje staré záměry a uloží nový, aniž změní lokální draft. Google/CalDAV conditional HTTP regrese zahrnují zachování cizích polí, ztracenou create odpověď, opakované potvrzení, souběžný pull/retry a neodpovídající OAuth refresh. Review opravilo P1 změnu uncertainty po náhledu a P2 timeout čekajícího refresh; nové čisté review celého `a0f6ea9..37ccf4b` bez nálezů. Root check, celá DB sada a všech 14 CI kontrol prošly.

**K09 klientská dohledatelnost převzata (PR #127, squash `2ccebd6`, 2026-09-07):** owner-scoped stránkovaný seznam nedokončených doručení má čisté review `aaae1ca..b7ff362`, zelený root check, plnou DB sadu i všech 14 CI kontrol. Samotné GET podle event ID nestačí pro nedoručené smazání po reloadu, kdy event už není v kalendáři. Seznam vrací jen identifikátor a název z vlastního uloženého záměru; detail vždy znovu načte oprávnění a stav. Poté napojit oba klienty přes existující připojení, cache/SSE a UI primitives.

**K09 web převzat (PR #128, squash `a8250b6`, 2026-09-07):** detail události otevře per-target stav; Connections nabízí dohledatelné nedokončené operace včetně smazání. Retry a náhled/potvrzení používají skutečný resource transport, owner-gated akce, scoped query cache a SSE/reconnect invalidaci. Náhled se pod rukama nemění; ztracená odpověď zachová mutation ID, stale-state odmítnutí vyžaduje nový náhled. Existující Row/SettingsSection/Dialog/ConfirmationDialog, bez nové závislosti či restylu. Čisté review celého `2ccebd6..ddc83e1` bez potvrzených nálezů, root check, web 386/386, Chromium 9/9 (K09 + K06 draft/SSE/postcommit) a všech 14 CI kontrol prošly. Mobilní napojení zůstává otevřené; tento řez neuzavírá celý K09.

**K09 nativní klient převzat (PR #129, squash `39e0dca`, 2026-09-07):** detail události a Sync a Calendar zpřístupňují per-target stav a vlastní nedokončené záměry včetně smazání. Striktní DTO parsing, server/user/connection keyed lifecycle, pořadí asynchronních čtení, SSE/reconnect/foreground invalidace; načtené stránky přežijí refresh. Náhled zůstává zmrazený, nativní Cancel nic neposílá a potvrzení po unmount/account switch je ignorováno. Síťové opakování používá stejný mutation ID; 409 vyžaduje nový náhled. Callback regrese vykonávají skutečné oba callery, useApi, wire schemas, nativní Alert a stream listener nad mockovanými nativními hosty. Není to důkaz fyzického telefonu ani živého providera. Čisté review `a8250b6..1f127f6` opravilo polling starvation na pomalém připojení a souběh stránkování s refresh; finální diff bez potvrzených P0/P1/P2 nálezů. Root check, 199 nativních testů a všech 14 CI kontrol prošly. K09 je převzat; živá providerová certifikace zůstává samostatným K15 gate.

Stav je per vzdálený cíl; agregovaný event může být částečně doručený. „Uloženo v Musubi“ odlišit od „Synchronizováno“. Uživatel vidí čekání, chybu, nutnost reconnectu nebo konflikt a může bezpečně opakovat/řešit konkrétní operaci.

Použít stávající cache, query invalidation, SSE a UI primitives. Retry endpoint musí znovu ověřit vlastnictví a cíle. Optimistický UI stav není potvrzení vzdáleného zápisu. Konflikt nezavře draft; explicitní přepsání vyžaduje novou kontrolu aktuální vzdálené verze.

**Test/hotovo:** event ve dvou cílech, jeden úspěch a jeden 503/403; oba klienti zobrazí pravdu po reloadu i restartu API. Reconnect sibling účtu neovlivní jiný cíl. Nový vizuální vzor projde Storybook schválením podle musubi-ui; běžná kompozice existujících stavů nepotřebuje restyle.

**Gate M1:** všechny K01–K09 acceptance scénáře projdou. Známá omezení sérií jsou viditelná a bezpečná; M1 se neoznačuje jako dokončená providerová parita.

## Třetí série: věrný čas a opakování

### K10 — Časový model a identita výskytu

**Aktuální převzetí:** lokální implementace K10 je dokončená. [Acceptance matice a závazné podmínky aktivace](calendar-k10-acceptance.md) shrnují finální stav. Níže jsou historické checkpointy; jejich tehdejší „pending“ není nový blocker. Produkční flag zůstává vypnutý, provider rehydratace je K11, atomic detached scopes K12 a release/device QA K14/K15.

**K10 kontrakt převzat (PR #130, squash `5cc7a08`, 2026-09-07):** [konkrétní návrh schématu a rollout](../sync/event-time-model.md), striktní samostatné kontrakty time model / original start / occurrence identity. Nezapojují se zatím do event DTO ani writable requestů. Čisté review `39e0dca..863e47e` bez nálezů; root check, kontrakt testovaný v UTC/Prague/New_York a všech 14 CI kontrol prošly. Následuje aditivní storage, sdílená expanze a atomické napojení čtení/zápisů; samotný kontrakt neuzavírá K10.

**K10 storage převzat (PR #131, squash `207372d`, 2026-09-07):** migrace0063 přidává nullable metadata a strukturální vazby výskytu, bez změny starých instantů/revizí a bez outbox zápisů. Skutečný upgrade0062→0063 zachoval všechny staré hodnoty časované i all-day události. Root check, celá DB sada, čisté review `5cc7a08..37f227b` a všech 14 CI kontrol prošly. Opravená HTTP fork projekce a deterministický deadline-after-write test nahrazují raw-row kopii a flaky30ms čekání. Zápis známé metadata, ownership/nesting kontrola a providerová rehydratace se teprve napojí; CalDAV komponenty sdílející resource vyžadují v K11 samostatné component mapping.

Nejdřív krátký konkrétní návrh schématu/kontraktu, poté aditivní migrace:

- Událost/série nese vlastní časovou sémantiku: zoned s TZID, floating nebo all-day date; pro legacy zůstává explicitně neznámá zóna. Existující instant a inclusive all-day konvenci bez potřeby nepřepisovat.
- Série a výjimka mají explicitní vztah. Identita výskytu vychází z původního recurrence startu, nikoli z času po přesunu.
- Providerová identita výskytu/verze patří ke vzdálenému mapování; neslučovat různé účty jen podle iCal UID.
- Jedna sdílená expanze pro web, mobil, API reminders i widgety; viewer timezone ovlivňuje zobrazení, ne okamžik zoned události.

**Migrace:** zóny a vztahy znovu načíst od providerů do stávajících mapování, bez wipe kalendářů a bez echo zápisů. Lokální historické zóny nehádat jako „správné“ podle serverového TZ. Uchovat legacy stav, nabídnout explicitní doplnění tam, kde je potřeba. Zabránit souběžnému backfillu v přepsání novějšího draftu.

**Test/hotovo:** stejné okamžiky v UTC/Prague/New_York; evropské a americké DST v různých týdnech; neexistující a dvojznačný lokální čas; all-day přes DST; floating čas podle definované semantiky. Stabilní ID výjimky po přesunu a restartu. Zvolenou politiku DST zdokumentovat, neimplementovat ad-hoc hodinovou aproximaci.

**K10 převod času — implementováno a ověřeno (PR #132):** sdílené přesné převody přes Temporal polyfill, oddělená explicitní/recurrence DST politika, testy v UTC/Prague/New_York včetně půlhodinového posunu a přeskočeného dne. Zoned model uchovává původní místní start/konec, protože instant neuchová neexistující02:30 po DST normalizaci. Dosavadní expanze se tím ještě nemění. Root check, striktní kontrakty, storage regrese, frozen install a Android Metro/Hermes export prošly; čistý reviewer nezávisle spustil kontrakty i převody v UTC/Prague/New_York (6 běhů bez chyby). Stav finálního převzetí je v [PR #132](https://github.com/frgtn-dot-dev/musubi/pull/132).

**Checkpoint na žádost vlastníka splněn:** PR #132 squash-mergnut jako `5b1ae9c` po všech 14 zelených CI kontrolách a čistém review; review stavu předáno. Vlastník 2026-09-08 obnovil pokračování. K10 zůstává `in_progress`; pokračování začíná sdílenou expanzí a jejím napojením. [Review aktuálního stavu](calendar-core-checkpoint-2026-09-07.md).

**K10 sdílená expanze převzata (PR #133, squash `9bddfc5`, 2026-09-08):** veřejný `expandRecurringEvents` rozlišuje doložený zoned/floating/all-day model od legacy. Nová cesta zachovává původní identitu, nahrazuje přesunuté/zrušené výjimky, počítá COUNT až po vynechání neexistujících časů a vyhodnocuje civilní RRULE v zóně série. All-day překryv používá datum konzumenta; floating vyžaduje explicitní zónu. Neplatné a nepodporované pravidlo se hlásí chybou. Metadata dosud nejsou připuštěná v produkčním DTO/writerech, takže současné klienty tento slice nepřepíná. Root check, regrese v UTC/Prague/New_York, čisté review `5b1ae9c..7dadf13` a všech 14 CI kontrol prošly. Následuje napojení konzumentů a konzistentní revision-CAS read/write kontrakt; K10 tím ještě není převzatý.

**K10 konzument připomínek převzat (PR #134, squash `a2078e7`, 2026-09-08):** sdílený resolver dostává zónu příjemce, zachovává cancellation/declined definice až do náhrady výjimek a používá původní identitu jako tag oznámení. Výjimka má vlastní cílové UUID; její reminder override přebije override série. Root check, regrese ve třech host zónách, čisté nezávislé review `9bddfc5..ee35d70` a všech 14 CI kontrol prošly. Produkční reminder projekce ještě metadata vynechávají. Před jejich zapnutím musí mobilní receipt reconciliation porovnávat i `eventID` (nově vzniklá výjimka může mít stejný původní klíč a dueAt jako původní generovaný výskyt); zůstává také napojení DTO, kalendářových view, widgetů a preview a jejich hlášení chyb.

**K10 pohledy a widgety převzaty (PR #135, squash `799462f`, 2026-09-08):** všechny produkční vstupy expanze předávají explicitní consumer zone. View/widget používají zónu zařízení odpovídající současnému layoutu, reminder příjemcovu zónu a anonymní serverový preview UTC. Agenda předává série i výjimky společně a zachovává vzdálené standalone/detached události volbou `includeAllNonRecurring`; web/home/federated cancellation filtrují až po nahrazení výjimek. Root check, tři host TZ, čtyři nové web adapter regrese, čisté review `a2078e7..2429f74` a všech 14 CI kontrol prošly. Metadata DTO, backend range query (musí vracet také výjimky přesunuté mimo okno), projekce a srozumitelné chyby konzumentů zůstávají podmínkou aktivace; tento slice nemění writable kontrakt.

**K10 úplnost range reads převzata (PR #136, squash `75697cd`, 2026-09-08):** user-scoped dotaz zachová viditelné detached výjimky včetně cancellation i po přesunu mimo okno. Floating událost nevylučuje podle kompatibilního instantu; inclusive all-day data mají konzervativní hranice pro všechny viewer offsety včetně večerního hodinového okna. Membership zůstává vnější podmínkou, soft delete se nevrací v range a vrací se v delta. Skutečná DB regrese, celá DB integrační sada a root check prošly; nezávislé review opravilo nedostatečnou dolní all-day mez a finální review `799462f..912bc92` je bez nálezů a všech 14 CI kontrol prošlo. Metadata DTO/projekce/writery zůstávají mimo tento balíček.

**K10 mobilní cache převzata (PR #137, squash `0636909`, 2026-09-08):** aditivní SQLite migrace0008 přidává nullable time model / series / original start. Cache striktně validuje přítomná metadata, zachová původní identitu po přesunu a odmítne její částečný pár či self-reference. Starší revize a stejně verzovaná legacy projekce nesmějí smazat uložená metadata; zachovává se celý konzistentní řádek. Skutečné SQLite testy pokrývají upgrade staré i již verzované cache, obě zápisové cesty, roundtrip do sdílené expanze a rollback při neplatném batchi. Transportní EventSchema a writery se tím ještě neaktivují. Root check, 201 nativních testů, čisté nezávislé review a všech 14 CI kontrol prošly.

**K10 nativní plánování připomínek převzato (PR #138, squash `a04cc80`, 2026-09-08):** scheduler předává časová metadata a přepočítává celou rodinu při scoped aktualizaci. Původní occurrence key spojuje i receipt již odstraněné výjimky; změna cílového UUID obnoví OS payload. Serializace plánování a rušení chrání souběžné změny, generation guard brání pokračování starého účtu po odhlášení. Form helpers zachovávají dědění pravidla masteru. Skutečné SQLite regrese používají simulované OS API; fyzické zařízení tím není ověřeno. Root check, finální nativní sada 211/211, čisté nezávislé review a všech 14 CI kontrol prošly. DTO/projekce/writery a aktivace známých modelů zůstávají navazující prací.

**K10 ochrana legacy časových zápisů převzata (PR #139, squash `8e4c1b7`, 2026-09-08):** skutečný diff start/end/isAllDay/recurrence se kontroluje pod event lockem po revision CAS. Známý model nebo detached identita vyžadují budoucí explicitní časový/scope kontrakt; starý PATCH ani provider pull nesmí změnit čas a ponechat stale metadata. Odmítnutí předchází obsahu, vazbám a přijetí nového ETag. Title-only a časový no-op metadata zachovají; unresolved legacy chování zůstává. Guard sám neaktivuje DTO, provider serializéry, fork ani scope/cascade operace. Root check, celá DB sada, nezávislé čisté review včetně samostatné HTTP regrese a všech 14 CI kontrol prošly.

**K10 anonymní preview převzato (PR #140, squash `ffc6cbc`, 2026-09-08):** náhled pozvánky zachová časovou/occurrence metadata a cancellation až do společné UTC expanze. Výstup explicitně projektuje pouze dosavadní veřejné údaje konkrétních výskytů s recurrence=null. Přesunuté a zrušené výjimky nenahrazuje falešným původním slotem; inclusive all-day poslední datum zůstává viditelné i odpoledne. Nové časované datum je stále omezeno přesným třicetidenním oknem; all-day podle UTC kalendářních dat. Regrese v UTC/Prague/New_York, původní federace a root check prošly; čisté nezávislé review bez nálezů. Všech 14 CI kontrol prošlo. Žádné rozšíření writable DTO.

**K10 serverová reminder projekce převzata (PR #141, squash `cef4f51`, 2026-09-08):** seskupení user-scoped DB rows do reminder definic zachová timeModel, seriesID a originalStart. Skutečná PostgreSQL regrese ověřuje jednu definici přes více kalendářových vazeb, master override na detached UUID, DST v příjemcově zóně a potlačení cancellation/moved-out slotu. Odeslání živých push zpráv se netestuje. Root check, celá DB sada, čisté nezávislé review a všech 14 CI kontrol prošly. Webová projekce a obecné DTO zůstávají navazující prací.

**K10 inclusive all-day widget převzat (PR #142, squash `6dace56`, 2026-09-08):** JS snapshot i Kotlin agenda filtr zachovají událost až do konce inclusive posledního data. Kalendářový pruh neodečítá milisekundu od all-day konce; timed midnight si zachová exclusive chování. Test spouští skutečný debounced snapshot a kontroluje JSON v UTC/Prague/New_York včetně ověření efektivní zóny (samotné TZ před Vitest příkazem přepisuje dosavadní konfigurace). Root check a finální native sada 214/214 prošly; nezávislé review je čisté. Všech 14 CI kontrol prošlo. Kotlin změna je source-reviewed, bez tvrzení nativního buildu či fyzického zařízení.

**K10 jednotná reminder projekce převzata (PR #143, squash `e32a2ce`, 2026-09-08):** tři dosavadní explicitní projekce používají společný `toReminderEvent`; web tak zachová stejná metadata jako mobil a server. Sdílené regrese nyní zahrnují tento převod před expanzí a původní nativní SQLite/serverová PostgreSQL regrese dále ověřují skutečné hranice konzumentů. Root check, cílená DB regrese, čisté nezávislé review a všech 14 CI kontrol prošly. Obecné DTO, hlášení chyb konzumentů a writable aktivace zůstávají pending.

**K10 webové chyby expanze převzaty (PR #144, squash `5f61c42`, 2026-09-08):** home/federated expanze a reminder resolver převádějí neplatný známý model na srozumitelnou chybu v existujícím workspace stavu. Chyba připomínek zruší původní lokální časovače; retry obnoví zdroje kalendáře i připomínek. Tři hook integrační regrese ověřují známá metadata a zotavení. Chromium ověřuje obecný HTTP error/retry, návrat draftu z editoru a izolaci nedostupného federovaného serveru; transport známá metadata ještě nepřipouští, takže tento E2E není důkazem jejich aktivace. Root check, čisté nezávislé review a všech 14 CI kontrol prošly. Nativní error UI, obecné DTO a konzistentní writery zůstávají navazující prací.

**K10 webové dědění připomínek převzato (PR #145, squash `efbb689`, 2026-09-08):** event editor předává seriesID do společného resolveru a při porovnání zděděného pravidla odstraní jen vlastní override. Nastavení série tak zůstane účinné i pro detached UUID; volba shodná s kalendářem se nesmaže, pokud série nastavuje jiný čas. Regrese ověřují prioritu own/series/calendar/default i neměnnost dokumentu; Chromium ověřuje existující PUT rule:null menu a následné obnovení pravidla. Root check, nezávislé čisté review a všech 14 CI kontrol prošly. Obecný transport stále metadata neaktivuje.

**K10 nativní chyby expanze převzaty (PR #146, squash `ab6f995`, 2026-09-08):** společná prezentační hranice vrátí úplný výsledek nebo explicitní chybu bez parserových údajů. Kalendář, agenda, detail kalendáře a invite preview zobrazí vysvětlení; hlavní refresh/agenda/pozvánka nabízí existující retry. Kalendář ani composer se při chybě neodmountují, takže se draft nezahodí. Regrese ověřuje chybu, zotavení, neměnnost definic, cancellation a vzdálené agenda události. Root check (216 native / 396 web), nezávislé review a všech 14 CI kontrol prošly. Testy používají logiku bez fyzického nativního vykreslení; transport a writery zůstávají před aktivací.

**K10 explicitní časový edit převzat (PR #147, squash `0d2d3ea`, 2026-09-08):** striktní úplný zoned/floating/all-day intent se převádí na konzistentní start/end/isAllDay/timeModel. Známá explicitní DST politika se nemění; kontroluje se výsledné pořadí instantů. Floating kompatibilní instants používají deterministicky UTC, nikdy ne odhad serverové zóny. All-day zachová inclusive konec. Samostatné procesy UTC/Prague/New_York ověřují kontrakt, mezery/fold, půlhodinový posun, původní civilní anchor a návaznost na shared expanzi. Root check, nezávislé čisté review a všech 14 CI kontrol prošly. Následuje atomické CAS napojení, validace celé výsledné recurrence a outbound/DTO/editor kontrakt; tento čistý resolver dosud neaktivuje žádný writer.

**K10 interní lokální časový CAS převzat (PR #148, squash `fe66cb2`, 2026-09-08):** nový DB writer nejprve zamkne calendar lifecycle a event, ověří revizi a membership/origin a pak atomicky zapíše start/end/isAllDay/timeModel s jedním zvýšením revize. Bezezměnový intent je no-op; neplatný čas nebo recurrence transakci nezmění. Celá definice se validuje i při cancellation. Detached/master-with-children, externí kalendář/mapování i outbox historie zatím vyžadují navazující scope/provider cestu. Skutečný PostgreSQL test ověřuje souběh dvou CAS editů, rollback a durable roundtrip. Root check, celá DB sada, nezávislé čisté review a všech 14 CI kontrol prošly. Nejde o veřejný endpoint ani aktivaci DTO; API authorization a oznámení commitu se teprve napojí.






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

1. **K06 — rozhodnuto vlastníkem:** produkt, minimum klienta i peeru 0.1.8; staré/missing/malformed verze odmítat bez tichého bypassu. Koordinovaný rollout klientů a peerů zůstává podmínkou samostatně schváleného nasazení.
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

**K06 je celý převzat; K07–K15 zůstávají pending.** Vlastník schválil následnou samostatnou kontrolu odložených pracovních změn a závěrečný běžný push pouze větve `fix/calendar-origin-authority`. Není to souhlas s merge, release, nasazením, produkční migrací ani automatickým zahájením K07. Produkt, minimum klienta i peeru zůstávají 0.1.8; Outlook EVENT remote update/delete zůstává dočasně blokován podle schválené hranice.

Odhady termínů přidat až po prvních opravách a návrhu revizí/outboxu. Kalendářní datum bez ověření těchto hranic by nyní bylo falešně přesné.

## Historie závěrečných oprav K06

Následující záznamy zachovávají dobový stav před jednotlivými rechecky. Aktuální výsledek je v závěrečném převzetí pod nimi.

**K06 závěrečné review opravy — lokálně ověřeno, čeká na převzetí rodičem:**
Potvrzené P1 server/client review jsou opraveny: všechny postcommit notifikace a
reconciliation chyby zachovají `localCommitted` nezávisle na dalším DB čtení;
`committed` je poslední commit, nikoli potvrzené nejnovější `current`. Běžné selhání
reminder cleanup již bylo best-effort (review korekce), nyní doloženo skutečným DB
fault testem. ICS import drží partial receipts a revize pro opožděné create ACK.
Kalendářové admission/removal a account-delete FK kaskády mají schválené úzké
transakční lifecycle fences před event locks; multi-calendar removal zamyká union
řádků, transfer obě identity vlastníků. Auth adapter zachovává původní tokenové
handlery/hooks/session cleanup a FK retention policy; neznámé/bulk delete predikáty
neobcházejí ochranu. SSE unlink nese revizi původního commitu přes souběžný relink.
Oba klienti neobnoví řádek opožděným success/error receiptem po inbound odstranění,
native nevrací rollback jen kvůli chybějícímu `current`. URL-only description/end/
recurrence/calendar draft nemá vypůjčenou revizi; title-only web PATCH zachovává
nedotčené whitespace/empty texty. Regrese běží přes skutečné HTTP/DB/adapter seams,
query/store callbacky a Chromium, ne živé účty ani fyzická zařízení. Čerstvé logy
`/tmp/musubi-k06-final-logs/`; přesný commit/isolation/gate report je ve finálním
managed handoffu. K07/K09/K12 se nerozšiřují, Outlook refusal a 0.1.8 platí dál.
**Celý K06 stále není převzat ani schválen k nasazení; následuje readonly recheck.**

**K06 klientský recheck — tři zbývající blokery opraveny a lokálně ověřeny, čeká na nový nezávislý recheck:**
Předchozí důkazy nepokrývaly SQLite refresh, souběh dvou nativních identit ani
nově vytvořený web query během mutace. Nativní generovaná aditivní migrace
`0007_event_revision` přidává nullable revizi bez backfillu; původní řádky zůstávají
unknown/read-only do autoritativního refresh. Skutečný Expo drizzle runner a cache
serializéry běží v regresích nad SQLite (Node test-only platform adapter, bez nové
závislosti); skutečný refresh → composer → PATCH zachová očekávanou revizi.
Synchronní cache transakce nevrací starší/unknown řádek přes prokázanou novější revizi.
Nativní receipts sledují odstranění konkrétní identity, nikoli globální removal
čítač: unrelated A nespolkne potvrzené B delete/update/create/link/fork. Nová
serverová identita není identita zdroje; nejasná full/access-loss absence vyvolá
skutečný refresh, ne tiché dokončení. Překonaný success drží draft a nespustí nové
reminder override callbacky. Evidence i případný refresh končí s account/server
lifecycle. Web zapisuje receipt pouze do jednotlivých nezměněných query snapshotů;
nová date/view query s novější absencí ani její tombstone se nezmění, i když refetch
není dostupný. Původní zmrazený draft, revision guard a rollback chování zůstává.
Čerstvé lokální gates jsou v `/tmp/musubi-k06-client-closure-logs/`: SQLite/cache/
refresh/composer a dvoueventové red/green regrese, web skutečné hooks/QueryClient,
root check a Chromium K04/K05/K06 (26/26). Server/shared runtime nebyl měněn;
předchozí plný DB důkaz je výslovně převzat, nikoli vydáván za nový DB běh.
Žádná produkční migrace, živý provider, fyzické zařízení, push nebo release.
**Toto není převzetí celého K06; rodič zvlášť zkontroluje kandidáta i zděděné residue.**

**K06 poslední nativní target-calendar receipt P1 — lokálně ověřeno, čeká na readonly recheck:**
`calendar_removed` nyní ukládá ID kalendáře do právě čekajících request fences i bez
známého event řádku/linku. Opožděný link nebo server-assigned fork success/error.current
odkazující na tento kalendář vyžaduje skutečný autoritativní refresh; selhání nebo
chybějící cílový link nevrátí falešný success ani neobnoví cache/reminders. Ani stejná
revize se serverem odstraněným linkem není potvrzením pickeru. Evidence není globální
ban: unrelated calendar/source odstranění zůstává nezávislé, následný rejoin/revival
a nový request fungují. Zmrazený draft, localCommitted, per-identity ordering,
SQLite revize a post-await composer guard zůstávají zachovány. Povinné načtení
home kalendářů předchází prvnímu cache zápisu refresh: úspěšný GET events a následně
neúspěšný GET calendars nesmí do SQLite vrátit odebraný link. Autoritativní filtering
při úspěšném načtení i offline federované řádky zůstávají beze změny.
Skutečný stream listener, picker/composer, store, transport, refresh a SQLite sdílí
existující fixture; 37 nových případů (16 target-calendar a 6 partial-refresh RED
před opravami), nyní native 183/183, web 379/379, root typecheck/contracts/VERIFY/
lint/check prošly.
Logy `/tmp/musubi-k06-last-receipt-logs/`; první úspěšný check sestavil web čerstvě,
finální check převzal oba builds z cache. Jeden nezměněný web all-day test jednou
selhal; cílený i celý opakovaný běh bez změny zdroje prošel (log chyby zachován).
Nezměněný PostgreSQL a Chromium důkaz je výslovně převzat z předchozího handoffu;
žádný nový provider/device důkaz, backend/shared/web runtime změna, verze, push,
release, K07/K09/K12 ani nové převzetí K01–K05. Všech 52 vstupních residue cest
zůstává pro samostatnou rodičovskou kontrolu; vlastní delta je oddělená a reverzibilní.
**Celý K06 není převzat; následuje nezávislá readonly revize a rozhodnutí rodiče.**

## Dokončený K06 — závěrečné převzetí

Rodič převzal celý K06 nad `78f9452145022b2420d47eefda32ee45640e6134` (2026-09-05), po uzavření serverových i klientských nezávislých revizí. Poslední readonly recheck `1dd06139-eb92-41fb-af2e-63f0401749ab` je **bez nálezů**; zbývající target-calendar receipt P1 uzavřen. Předchozí rechecky uzavřely postcommit/ICS/lifecycle/auth/SSE opravy, SQLite skutečný refresh a webové nově vzniklé query.

- Převzatý celek: DB-owned revize a strict expectedRevision/PATCH, atomický lokální CAS obsahu/linků/tombstones, odmítnutí stale draftů, skutečný field diff, přijaté providerové validátory, Google/CalDAV conditional writes a pravdivé postcommit/partial failures. Nativní generovaná SQLite migrace `0007` zachovává unknown revize jako nezapisovatelné; normální cache → refresh → composer používá skutečnou revizi. Receipts nepřekryjí novější identitu/query ani odebraný cílový kalendář a nepovolí falešné dokončení pickeru či připomínek.
- Rodič zkontroloval klíčové zdroje a migrační/receipt/reconciliation hranice, finální diff, RED/GREEN důkazy a nezávislý verdikt. Čerstvě znovu prošel celý `pnpm check`: **183 native / 379 web**, ostatní root testy, typecheck, route/realtime contracts, release VERIFY, peer kontrola, lint a build gate. Log `/tmp/musubi-k06-parent-final-logs/check.log`, exit 0. Build cache je přiznané opětovné použití, ne nový nezávislý build. Session `lens_diagnostics mode=all` nehlásí blokující chyby; nejde o tvrzení plošně čistého LSP a staré úzké compilerem vyvrácené diagnostiky se neskrývají.
- Platné plné DB důkazy z `/tmp/musubi-k06-final-logs/test-db-staged.log` a **Chromium 26/26** z `/tmp/musubi-k06-client-closure-logs/chromium-postcommit.log` jsou výslovně převzaty: server/shared/web runtime se od jejich ověření funkčně nezměnil. Nové mobilní regrese používají skutečný stream/store/refresh/cache a SQLite, nikoli náhradu persistence. Jeden dřívější nezměněný web date-picker test selhal; cílený i úplný opakovaný běh a rodičovský check prošly, původní log zůstává zachován.
- Hranice: vlastník schválil **0.1.8** pro produkt/klienty/peery a dočasné odmítnutí existujících Outlook EVENT remote update/delete před lokální změnou. Event-specific Graph conditional enforcement je **neověřený**, nikoli prokázaně nepodporovaný; subject-only serializer není povolením zápisu. Žádná živá providerová či fyzická-device certifikace, distribuovaná/crash atomicita, outbox ani záruka doručení po pádu. K07–K15 zůstávají pending.
- Všech **52** zděděných pracovních cest zůstalo mimo funkční commity; 49 bylo byte-untouched a tři překryvy přesně reverzibilní. Rodič znovu ověřil TS i emitovaný JS pro 51 formátovacích rozdílů a původní OAuth byty. Jejich samostatná kontrola a případný commit následují po tomto převzetí. Testovací PG i dočasné služby jsou uklizeny; nic nenasazeno ani vydáno.

## Závěrečná kontrola odložených změn

Po převzetí `c42c701` rodič samostatně prověřil všech **52** odložených zdrojových cest. U 51 odpovídá TypeScript i emitovaný JavaScript AST, pořadí parserových tokenů a komentářů; jde pouze o formátování. U OAuth je jedinou změnou prohození ekvivalentních větví podmínky `scope === undefined`, se zachováním hodnot i počtu vyhodnocení getteru. Žádná další funkční změna ani neznámý soubor nebyly přidány či zahozeny. Ověřené úpravy jsou zachovány v odděleném stylovém commitu s tímto záznamem, nikoli přimíchány do funkčních oprav K06.

Explicitní 52cestný manifest a důkazy: `/tmp/musubi-k06-parent-final-logs/residue-{manifest.json,equivalence-final.log,lexical-comments.log,final.diff}`. Zdrojové byty jsou přesně totožné s úspěšným rodičovským `pnpm check`; po této kontrole se produktový kód znovu neměnil. Závěrečný push této větve je schválen jako samostatný poslední krok, bez merge, release či nasazení.


## PR #119 — oprava CI E2E (2026-09-07)

CI nad `dc7ec08` prošlo DB integracemi, root checkem, Storybookem i buildy,
ale 11 webových E2E scénářů selhalo. Zastaralé event interceptory nyní sledují
PATCH s `expectedRevision` a `patch`; federovaný mock vrací úplný event s novou
revizí. Resize ověřuje vynechání nezměněného začátku, title-only edit série
zachování startu a celé recurrence v odpovědi. Také cancel-drag kontrola již
nemůže falešně projít sledováním nepoužívaného PUT.

Předání popover → full editor se ověřuje odděleně od reloadu: reload zachová URL
draft, ale bez původní revize neodešle zápis. K06 ochrana se neobchází.
Přepínač All day je na ukotvené straně měnících se časových polí: nad nimi
na desktopu, pod nimi v mobilním spodním panelu. Používá jediný existující
Checkbox a sdílený viewport hook, se shodným vizuálním a DOM pořadím.

Lokální evidence: celá E2E sada 161 passed / 2 záměrně skipped (UI katalog,
Radicale), poté finální cílené regrese 5/5 včetně 1280/390 px a reloadu.
Plný běh předcházel poslední úpravě mobilního umístění přepínače; tuto úpravu
ověřil cílený běh se screenshoty a znovu web 379/379, typecheck a lint.
Logy a screenshoty: `/tmp/musubi-pr119-*`. Finální GitHub CI zůstává samostatným
gatem. Žádná změna backendu, migrací, verzí ani rozsahu K07–K15.


**K10 read metadata a autorizovaný lokální časový endpoint převzat (PR #149, squash `d9f294b`, 2026-09-08):** EventSchema zachová timeModel/seriesID/originalStart v read odpovědích. Generic create/patch tato pole nepřijímá; kopie známého modelu vyžaduje navazující věrnou copy cestu. Samostatný PUT `/api/v1/events/:eventId/time` přijímá pouze expectedRevision a úplný časový intent. Oprávnění se znovu ověřuje a zamyká v DB transakci; konflikt, no-op i chyba notifikace po commitu zachovají pravdivou revizi a receipt. Provider preflight i durable worker odmítnou známý model před legacy serializací. Endpoint je ve výchozím stavu vypnutý (`EVENT_TIME_EDITS_ENABLED=false`); aktivace vyžaduje oba časově věrné editory a kompatibilní klientský rollout. Tento mezikrok nezvyšuje minimum klienta, nespouští backfill a neuzavírá K10. Regrese pokrývají HTTP/read kontrakt, revoked DB oprávnění, provider gate a webové zotavení po nepodporovaném známém recurrence pravidle.


**K10 atomický draft obsahu a času převzat (PR #150, squash `17c5378`, 2026-09-08):** před připojením editorů rozšiřujeme vypnutý lokální časový endpoint o volitelný striktní patch title/color/description/location/url/recurrence. Obsah, časový model, kompatibilní instants a jedna nová revize se uloží stejnou CAS transakcí. Validuje se výsledná recurrence, včetně explicitního nahrazení starého nepodporovaného pravidla. Omitted/undefined pole zachovají hodnotu, null ji vymaže; bezezměnový celý draft nezvyšuje revizi. Calendar membership, meeting identity, cancellation a occurrence scope nejsou součástí tohoto patche. Skutečné DB/HTTP regrese pokrývají rollback celého draftu, dvě souběžné úplné verze, strict admission a potvrzení celého draftu při post-commit selhání. Editory a kompatibilní rollout nadále čekají; samostatné časové a obsahové požadavky nejsou přípustná implementace jednoho společného uložení.


**K10 známé civilní drafty ve webu a mobilu převzaty (PR #151, squash `ed1d437`, 2026-09-08):** oba editory čtou uložené civilní anchory, nikoli zpětný převod instantu v zóně zařízení. Změna data zachová skryté sekundy/milisekundy; změna minut je explicitně nahradí. Jednorázový známý zoned/floating/all-day draft jde přes jeden PUT se společným content patchem, včetně domácí/federované transportní cesty. Request intent se neukládá do cache. Nativní editor používá u známého modelu civilní textová pole, protože Android implementace stávajícího Expo pickeru ignoruje timeZoneName; po commitu plánuje reminder z vyřešeného draftu. Web ukazuje časový kontext a při odmítnutí vypnutým endpointem zachová celý draft pro retry. Změna typu, explicitní doplnění legacy zóny a změna času/recurrence u známé série zatím vyžadují další kroky; jejich odmítnutí nic neukládá. Výchozí serverová aktivace zůstává vypnutá a fyzická native QA ani kompatibilní rollout nejsou tímto checkpointem nahrazeny.


**K10 explicitní volba časového modelu a zóny převzata (PR #152, squash `1b461cc`, 2026-09-08):** webový rozšířený editor a nativní editor umožňují u existující události zvolit zoned/floating/all-day a u zoned výslovně zadat IANA zónu. Volba interpretuje právě zobrazené datum a čas; změna modelu či zóny tedy může změnit instant a formulář to vysvětluje. Legacy událost nepřebírá zónu zařízení jako uloženou pravdu. Bez zadané zóny se celý draft zachová a neodešle se žádný zápis. Jednorázová adopce i převod známého typu používají jeden CAS PUT se společným obsahem; stejné civilní minuty zachovají skrytou přesnost. Bezezměnová známá zóna se normalizuje před no-op porovnáním, aby mezery neblokovaly obsahový edit série. All-day přepínač v mobilu se inicializuje podle události a jeho legacy pickery promítají uložené UTC datum do lokálního data bez posunu dne. Adopce převezme právě zobrazené hodnoty. Testy pokrývají tři host zóny, nativní adopci a první převod celodenní události (19 testů v Prague i v samostatném procesu New York s ověřením skutečné zóny), webové uložení přesného requestu v light 1280 px a dark 390 px včetně accessibility. Časové/scope změny sérií, věrná copy/create cesta a kompatibilní rollout zůstávají otevřené. Endpoint zůstává ve výchozím stavu vypnutý; bez backfillu, zvýšení minimální verze či aktivace. Fyzická native QA stále čeká. K10 zůstává `in_progress`.


**K10 konzistentní čas výskytu v mobilním detailu převzat (PR #153, squash `c577e88`, 2026-09-08):** při přípravě časových změn celé série se odhalilo spojování start/end vybraného výskytu s civilními anchory masteru. Native detail i jeho live refresh nyní přenášejí start/end/isAllDay/timeModel společně. Obsah zůstává živý a composer dále odděleně zmrazí master a vybraný výskyt. Obsahový edit celé série vrací do optimistické cache model masteru společně s jeho instanty, nikoli model vybraného výskytu. Integrační regrese vede reálnou sdílenou expanzi přes detail, live přejmenování, otevření editoru, scope All events, pending cache a autoritativní receipt v zoned/floating/all-day modelech přes evropské DST. Tento opravný předpoklad nepovoluje časové scope změny; jejich implementace stále následuje. Legacy a detached cesty, default-off endpoint a rollout hranice zůstávají zachované.


**K10 civilní časový posun celé série převzat (PR #154, squash `7b631fd`, 2026-09-08):** oba editory mohou u známé lokální série s prostým RRULE změnit data/časy při rozsahu All events. Sdílený planner přenese civilní posun obou endpointů z vybraného výskytu na zmrazený master a teprve potom vyřeší instants; nejde o elapsed posun přes DST. Model a zóna musejí zůstat stejné, recurrence se tímto krokem nemění. Výsledný obsah a čas jdou jedním revizním PUT, bez legacy scope envelope a bez samostatných dílčích zápisů. Native reminder dostává skutečně uložený master. Starý zobrazený výskyt nesmí převzít novější revizi masteru: změna času vyžaduje obnovu a nové otevření. Plný webový editor převezme master civilní draft; chyby planneru zachovají formulář i scope dialog. Nová časová operace nenabízí neplatné legacy Undo.

This event / following, konverze typu nebo zóny série, legacy adopce série, dated recurrence (včetně parametrizované jednořádkové RDATE), detached identity, děti i jejich tombstones a providerová historie stále vyžadují navazující cesty. Serverové family/provider guards ani default-off aktivace se neuvolňují. Testy pokrývají UTC/Prague/New_York, DST civilní posun, frozen revision, společný content/time request, reálné HTTP/DB CAS a rollback stale requestu, nativní scope odmítnutí/retry/reminder a webový narrow-dark scope retry + desktop-light full handoff s axe. K10, fyzická native QA, create/copy a kompatibilní rollout zůstávají otevřené.


**K10 explicitní lokální create/copy převzat (PR #155, squash `93ffa75`, 2026-09-08):** nový POST `/api/v1/events/time` přijímá oddělený obsah a explicitní časový intent, zapisuje revision 1 a celé vazby v jedné transakci. Membership i calendar lifecycle zámky chrání oprávnění až do commitu; autor/organizátor jsou autentizovaný aktér. Existující fork pro známý model má vlastní CAS cestu a zachovává přesný uložený instant i civilní metadata, včetně druhého DST foldu. Rodiny, externí kalendáře a providerová historie se odmítnou. Generic create nadále nepřijímá metadata. Oba editory umožňují explicitní model při vytváření a transportují samostatný create intent; nativní Weekly odvozuje den z civilního draftu. Chybějící zóna či vypnutá funkce draft zachová. Default-off zůstává; navazuje finální acceptance a kompatibilitní activation guard.

Validace create/copy: root `pnpm check` (225 native / 397 web), celá `test:db:events`, 24 composer testů v Prague i skutečném New York procesu, 2 Playwright scénáře dark390/light1280 s axe. Nezávislé čisté review odhalilo původní Weekly den v mobilním create; oprava má regresi a opakované review nemá další blocker.


**K10 uzavření lokální implementace:** generic unlink/tombstone nyní odmítá detached rodinu včetně masteru s tombstone child, aby se neobnovil původní slot ani neosiřely výjimky. Produkční startup kontroluje kompatibilní release a obě vynucená minima novější než vydané 0.1.8 ještě před migrací a listen. Flag i všechny verze zůstávají beze změny. Finální scope a důkazy jsou v [K10 acceptance](calendar-k10-acceptance.md); dalším bodem je K11.

**K11 Google import — ověřovaný první providerový řez:** explicitní časový import zachová `recurringEventId` / `originalStartTime`, před zápisem dohledá chybějící master a seřadí závislosti. Cancellation-only výjimka je živá zrušená definice, nikoli tombstone obnovující původní slot. Transakční metadata writer zachová local UUID, source authority a pending guard; metadata adoption nevytvoří outbound echo. Master-only změna nesmí zneplatnit uložené children. Provider delete/revival zahrnuje rodinu a zachová durable fanout. Podrobnosti a hranice jsou v [provider time import](../sync/provider-time-import.md). Google HTTPfixture→engine→PostgreSQL pokrývá reorder, move/duration, DST, all-day cancellation, 503, reset, linked adoption a family delete/revival. Čisté nezávislé review našlo tři hrany; opravy mají regrese a závěrečná revize nemá blocker. Flag zůstává default-off; CalDAV a Graph následují.


**K11 Google převzat (PR #157, 2026-09-08):** věrný import výjimek, cancellation-only záznamů a hydratace masteru prošel nezávislým review, root checkem, celou DB sadou i čerstvou migrací a všemi 14 CI kontrolami. PR byl squash mergnut.

**K11 CalDAV komponenty — implementační řez (2026-09-08):** master podle identity, vlastní obsah/délka detached výjimek, atomické nahrazení celého resource včetně odstraněných výjimek, rollback ETagů a blokace pending rodiny. Parser respektuje explicitní zóny a přesné DST fold endpoints. Izolovaný Radicale ověřuje HTTP → adapter → sync → DB reset/delta, revival/deletion a nezměněný resource včetně alarmů/extensions. Validní masterless/RANGE a recurring nominal-day duration formy zůstávají explicitně unsupported do navazujícího model/scope řezu; K11 jako celek není uzavřen. Matice a regrese: [provider time import](../sync/provider-time-import.md).

**K11 Graph vazba výskytu — implementační řez (2026-09-08):** omezené calendarView zůstává provider-expanded; mapování uchová master a původní instant bez druhé lokální expanze. Hydratuje se skutečná výjimka, její ETag se nikdy nedědí z masteru, opakovaný 410 nezacyklí sync. HTTP/DB regrese ověřuje adopci starších mapování, přesunutý obsah/délku, stabilitu při resetu a chyby identity. Následuje explicitní informace o pokrytém okně ve webu/mobilu; K12–K14 zůstávají navazující autorizovaný rozsah.

**K11 CalDAV převzat (PR #158, 2026-09-08):** všechny 14 CI kontroly zelené; jeden webový create-dialog scénář v prvním CI běhu selhal, trace prověřen a osm lokálních opakování (tři se zpomaleným CPU) prošlo, opakovaný shard zelený bez změny produktu. Nezávislé finální review čisté; atomické rodiny i skutečný izolovaný Radicale roundtrip prošly. Tato evidence není živé iCloud ověření.

**K11 rozsah Outlooku — klientský řez (2026-09-08):** webové kalendářové pohledy a nativní kalendář/agenda/detail zobrazují persistentní informaci o omezeném rozsahu při aktivním Outlook event kalendáři. Upozornění zůstává i na prázdném vzdáleném datu a zmizí po skrytí těchto zdrojů. Netvrdí smyšlené přesné hranice podle aktuálního dne. Browser wide/narrow + axe a root check prošly; native physical-device gate stále čeká. Jde o stávající styl status banneru, nikoli restyle.

**K11 Graph převzat (PR #159, 2026-09-08):** všech 14 kontrol zelených i po přenesení na main; čisté nezávislé rereview, root check a celá disposable DB sada prošly. Scope metadata jsou providerová mapování; žádný syntetický lokální master ani domyšlená Windows/IANA zóna. Klientské upozornění je PR #160.

**K12 čistý scope kontrakt/planner — implementační řez (2026-09-08):** všechny scopes edit/delete nad explicitní lokální rodinou, oddělená revize masteru/výjimky, typed original identity, COUNT/UNTIL partition a zachování vlastního obsahu výjimek. Opakované review doplnilo přesnou fold identitu a odmítnutí změn, které by obnovily EXDATE nebo osiřely výjimky. Není to endpoint ani idempotentní DB operace; následuje transakce/outbox a zapojení klientů. Kontrakt a omezení: [scope operations](../sync/event-scope-operations.md).

**K11 upozornění převzato (PR #160, 2026-09-08):** všech 14 CI kontrol a čisté nezávislé review prošly, squash merge dokončen. Implementované importní řezy a viditelná hranice Outlook window jsou na main; explicitní providerová omezení a živé/device acceptance zůstávají uvedené v matici.

**K12 atomická lokální transakce — rozpracovaný řez:** scope plán se ukládá s durable actor/operation receipt, master/child CAS a současnou kontrolou oprávnění. Externí historie/destinace jsou zatím odmítnuté. Review odhalilo kolizi průběžných originálů při posunu sousedních výjimek; odložená unikátnost kontroluje finální rodinu, regrese pokrývá i běžný create writer. Následují HTTP/client a providerové operace, K12 zatím není dokončená.

**K12 HTTP scope — implementační řez:** jeden autentizovaný POST přijímá scope intent a vrací potvrzené ID/revize včetně replay po odstranění rodiny. Strict schema, gate, owner/viewer, 400/409 a opakovaný HTTP request mají integrační regresi. Nezávislé review bez nálezů; klientské zapojení a provider delivery stále následují.

**K12 klientský POST — implementační řez:** web detail a nativní composer/delete používají pro explicitní série jediný scope request. Nezávislé review opravilo native detached delete, stabilitu retry napříč nově vytvořenými draft objekty a reminder targeting po splitu. Reminder-only scope může explicitně materializovat definici; obyčejný no-op zůstává no-op. Wide/narrow browser+axe, skutečné native callbacky a DB materializace mají regrese. Legacy/full-editor/drag a providerové hranice jsou uvedené v [scope kontraktu](../sync/event-scope-operations.md); nejde o dokončení celé K12.

**K12 transakce převzata (PR #162, 2026-09-08):** všech 14 CI kontrol, celá DB sada a čisté nezávislé review. Planner #161 je také na main. HTTP #163 a klient #164 navazují ve vlastních PR.

**K12 Graph recurrence kandidát:** čistý převod běžných RRULE patternů a COUNT/UNTIL zachovává explicitní hranice a odmítá neprokázané formy. Není ještě připojen k delivery; echo dedup a conditional-write proof zůstávají nezbytné pro povolení konkrétního Graph zápisu.

**K13/K14 providerový read model — implementační řez:** organizátor, účastníci, vlastní providerová odpověď, nativní připomínky a raw dostupnost/soukromí se ukládají odděleně od sociálních dat Musubi. Čtecí endpoint zpřístupní osobní stav jen vlastnímu propojenému source účtu. Pending pozorování zůstává durable a potvrzené echo se přenese s časovou ochranou proti starším ACK. Nezávislé review odhalilo nested JSON porovnání a chybějící ACK přenos; obojí má DB regresi. [Přesná hranice](../sync/provider-event-state.md): RSVP/meeting writes, reminder editing, freebusy redakce a UI stále následují. Nejde o uzavření K13/K14 ani o náhradu živé acceptance.

**K13/K14 klientské čtení:** web/mobil zobrazují oddělená providerová data a pojmenují Musubi attendance/reminder. Generovaný výskyt načte uloženou sérii a výslovně to sdělí; detached výjimka má vlastní ID. Late response po změně účtu se nezobrazí. Root check, native transport/detail regrese a wide-light/narrow-dark browser + axe prošly; nezávislé review opravy identity čisté. Nativní fyzické QA a providerové mutace zůstávají otevřené.

**K14 Google freeBusyReader guard:** free/busy-only grant není vydáván za čitelný Events kalendář. Úspěšné kompletní discovery odstraní staré zrcadlo detailů ještě před případným 503 z event fetch; obnovená reader práva dovolí nový import. Neprovádí se providerový delete. Busy-interval model a ostatní privacy downgrades zůstávají explicitně navazující rozsah, nikoli hotová free/busy implementace.


**K14 Google native reminder — vypnutý implementační řez (2026-09-08):** vlastník výslovně schválil kód za samostatným `PROVIDER_REMINDER_EDITS_ENABLED=false`, bez produkční aktivace a bez skutečných účtů. Authenticated API ukládá osobní durable intent s revision/state CAS a idempotencí, bez změny obsahu/revize a fanoutu. Worker ověřuje čerstvý obsah i ETag a posílá pouze conditional `reminders` PATCH; po 503 nebo neúplné úspěšné odpovědi nejprve rekonciluje GET. Nezávislé review odhalilo chybnou adopci cizího content ETag a klasifikaci neúplného ACK; lokální HTTP/DB regrese pokrývají obě opravy. Stejnorevizní intenty mají monotónní pořadí vůči canonical outbox operacím. [Hranice a kontrakt](../sync/provider-event-state.md#default-off-google-reminder-writes): chybí editační UI, specializované řešení native konfliktu, Graph/CalDAV varianty a živá acceptance. K12 provider scope delivery a K13 meeting/RSVP writes zůstávají otevřené; tento řez neuzavírá K14.

**Dodatečná hranice reminder ACK:** první vypnutý Google write řez přijímá pouze legacy jednorázové události. Známé civilní modely a série odmítne už enqueue i worker: samotné porovnání instantů neprokazuje shodu zóny ani původní identity výskytu. Jejich podpora vyžaduje plnou native temporal evidence a zůstává implementační úkol K14, nikoli hotová schopnost.

**K12 Google occurrence — implementační řez:** vlastní osobní Google série bez attendees nově připraví skutečné instance ID/ETag podle původní identity, poté atomicky uloží výjimku, master revision, mapování, durable outbox a replay receipt. Worker provede pouze conditional instance PATCH; cancellation-only pull a 503 recovery mají vlastní temporal/identity matching. Generated výskyt se nevytváří jako nezávislá Google událost. HTTP/DB regrese pokrývají souběžný replay, zrušení přesunuté výjimky, baseline/echo sync, posun času, all-day konec, 412 a preflight CAS race. [Kontrakt a otevřené hranice](../sync/google-occurrence-writes.md): following/series, další provideři, meetingy, specializované řešení scope konfliktu a živá acceptance nejsou tímto dokončeny; aktivace zůstává vypnutá.


**K11 — lokální převzetí (2026-09-08):** nezávislé review implementace a acceptance původního K11 potvrdilo Google identitu/přesuny/cancellation/reset, CalDAV výběr masteru a vlastní detached obsah s atomickým resetem, Graph mapping bez dvojí expanze a viditelné omezení coverage ve webu/mobilu. Důkazy jsou v [provider import kontraktu](../sync/provider-time-import.md); plná root/DB sada naposledy prošla nad navazujícím Google scope řezem. Převzetí nezahrnuje výslovně odmítané CalDAV masterless overrides, RANGE ani timed recurring nominal-day/week DURATION. Živá acceptance, fyzické native QA a produkční aktivace zůstávají otevřené; K12 providerové zápisy tím nejsou převzaté.


**K12 Google occurrence conflict resolution — navazující řez:** existující comparison flow má samostatnou typed scope větev. Náhled ukáže původní identitu, cancellation a civilní čas; potvrzení vyžaduje také revizi masteru. Čerstvé providerové čtení a atomický CAS vytvoří jediný náhradní scope intent, zachovají uložený draft a po potvrzeném doručení uvolní archivovanou historii pro další úpravu. Změněný master, chybějící providerová identita a meetingy zůstávají odmítnuté. Lokální HTTP/DB, web wide-light/narrow-dark + axe a native callback regrese pokrývají úpravu i zrušení, stale náhled a souběžný replay. Podrobnosti: [Google scope kontrakt](../sync/google-occurrence-writes.md). Following/series, další provideři a K13/K14 dále čekají; flag zůstává vypnutý.


**K12 Google whole-series evidence — přípravný řez:** default-off adapter umí načíst master a úplný seznam nativních výjimek bez časového okna. Kontroluje stránkování, ETagy, původní identity, cancellation-only definice a osobní oprávnění; změněný master nebo neúplná rodina se odmítnou. Lokální HTTP regrese pokrývá zoned/all-day a zachování dosavadních occurrence cest. Nejde o atomický providerový snapshot ani o aktivovaný series writer; endpoint a durable whole-series kroky následují. Viz [Google scope kontrakt](../sync/google-occurrence-writes.md#whole-series-evidence-preparation).


**K12 Google živé title-only ověření (2026-09-08):** schválený izolovaný test zoned a all-day série prokázal, že conditional PATCH názvu masteru přepisuje i vlastní název přesunuté výjimky a mění ETagy výjimek. Původní identity, přesuny a cancellation zůstaly zachované. Dočasný kalendář je smazaný; aplikační flagy zůstaly vypnuté. Parent-only writer proto nesplní současný kontrakt zachování child obsahu. Původní návrh následné durable reconciliation byl navazujícím testem souběhu níže vyvrácen jako dostatečná ochrana. [Postup, důkazy a hranice](calendar-google-series-live-acceptance.md). Nejde o dokončení K12 ani o důkaz pro časové/recurrence změny.


**K12 Google whole-series — výslovně odložená schopnost (2026-09-08):** další živý test prokázal nezměněný master ETag po úpravě child, přijetí následného conditional master PATCH a ztrátu nového child názvu. PATCH-then-restore obnoví starou kopii, nikoli nepozorovanou souběžnou změnu; ani durable journal tento problém neřeší. Uživatel zvolil zachovat obsah a Google whole-series zatím nepodporovat. Endpoint zůstává uzavřený i při zapnutém aplikačním flagem; HTTP/DB regrese hlídá nulové lokální/providerové mutace s prázdnou i neprázdnou lokální rodinou. [Důkaz, nezávisle prověřený závěr a rozhodnutí](calendar-google-series-live-acceptance.md#follow-up-exception-concurrency-and-product-decision). Nejde o dokončení této schopnosti; pokračují ostatní podporovatelné části K12–K14.


**K12 CalDAV complete resource evidence — přípravný řez:** default-off interní reader ověřuje vlastní účet/importovaný kalendář, DAV oprávnění a úplný GET s přijatým strong ETagem. Porovnává master a všechny lokální výjimky včetně civilního modelu a ponechá původní resource bytes. Lokální Radicale ověřil, že změna child mění ETag celého prostředku a následný master PUT se starým If-Match skončí 412 bez ztráty child změny. Unit regrese pokrývají zoned/floating/all-day, cancellation a odmítnutí neúplné rodiny či meetingu. [Kontrakt a otevřené části](../sync/caldav-series-writes.md): enqueue, durable resource delivery/recovery a atomické potvrzení všech component mappings následují. Nejde o aktivaci writeru, živou iCloud acceptance ani dokončení K12.


**K12 CalDAV conditional resource writer — interní řez:** příprava povoluje pouze název, popis a místo masteru a zachovává všechny původní child komponenty, časy, alarmy a rozšíření. Adapter před PUT ověří celý původní prostředek i jeho strong ETag; po PUT potvrdí celý požadovaný prostředek novým GET. Ztracená odpověď/aplikované 503 se obnoví bez opakovaného PUT, souběžná změna child nebo alarmu se odmítne. Fake HTTP pokrývá zoned/floating/all-day, místní Radicale ověřuje skutečný podmíněný zápis a obnovu. [Kontrakt](../sync/caldav-series-writes.md#internal-content-writer). Endpoint, durable enqueue/worker a atomický ACK všech mapování stále následují; interní adapter nemění DB. Flag zůstává vypnutý, iCloud acceptance odložená. Nejde o dokončení K12.


**K12 CalDAV scope/outbox — navazující řez:** default-off autentizovaný series/update ukládá obsahový master patch, jediný privátní resource intent a idempotentní receipt atomicky. Preflight/commit CAS ověřuje celý lokální kontext; typed worker po úplném providerovém potvrzení posune ETag všech component mappings v jedné lease-fenced transakci. Pending pull nepřijme žádnou část rodiny, následné echo nemění její identity/revize. HTTP/DB regrese pokrývá replay/no-op, civilní modely, aplikované 503, změnu child/mapování, cizí lease a tombstone; Radicale prochází celou scoped cestou. [Přesný podporovaný rozsah](../sync/caldav-series-writes.md#scoped-transaction-and-durable-delivery). Specializované řešení CalDAV konfliktu, další scopes/time/recurrence schopnosti a živá iCloud acceptance zůstávají otevřené. Generic master-only ACK/resolution je pro resource intent výslovně odmítnuté; flagy a verze se nemění. Nejde o dokončení celé K12.


**K12 iCloud — živé ověření interního content writeru (2026-09-08):** po připojení účtu a opravě 10s timeoutu připojení (PR #178) prošel autorizovaný test v novém dočasném kalendáři. Zoned/all-day/floating rodiny zachovaly vlastní přesunuté a zrušené výjimky, alarm i rozšíření. Ověření celého prostředku potvrdilo obsahový master PUT; replay a simulovaná ztráta odpovědi po skutečně přijatém PUT nevytvořily další zápis. Souběžná skutečná změna child způsobila 412 a zůstala zachovaná. Kalendář byl odstraněn (204). [Postup a hranice důkazu](calendar-icloud-series-live-acceptance.md): šlo o interní transport, nikoli živý iCloud průchod endpoint → outbox → atomický ACK. Ten, specializované řešení konfliktu a další scope schopnosti stále čekají. Běžící dev flagy zůstaly vypnuté; K12 ani K13/K14 tím nejsou dokončené.


**K12 iCloud — překážka aplikační acceptance:** navazující izolovaný sync importoval zoned master a obě výjimky, autentizovaný scope POST však skončil 403 (`event-write`, `unknown`). Resource PROPFIND vrátil 207 se správným href bez použitelných vlastností `current-user-privilege-set`. Adapter proto nemá pozitivní důkaz oprávnění a před scope commitem/workerem bezpečně odmítá zápis. Dočasný iCloud kalendář i lokální testovací uživatel jsou odstraněni. Je nutné vyřešit důvěryhodné resource oprávnění a teprve poté ověřit úplnou cestu; úspěšný přímý transport tuto podmínku nenahrazuje. [Podrobnosti](calendar-icloud-series-live-acceptance.md#follow-up-authenticated-scope-acceptance-is-blocked).


**K12 CalDAV — explicitní řešení master-content konfliktu:** stávající náhled a potvrzení mají typed resource větev. Čerstvý autorizovaný GET může převzít změněný název/popis/místo masteru jen při zachování celého časového modelu, recurrence a všech child definic; vložené VTIMEZONE se porovnávají také proti původním fyzickým datům. Nové privátní alarmy/rozšíření zůstanou zachované. Potvrzení přesného náhledu atomicky posune baseline ETag všech mapování a uloží jediný náhradní intent; teprve úplný worker ACK uvolní nahrazenou historii pro další editaci. Regrese pokrývají HTTP potvrzení, replay, stale náhled, změnu lokálního/remote child, embedded timezone a skutečný Radicale. [Rozsah](../sync/caldav-series-writes.md#explicit-master-content-conflict-resolution): změněné child definice/časy, odstraněné resources a iCloud neznámá oprávnění stále vyžadují navazující řešení. K12 tím není uzavřené; flagy a verze zůstávají beze změny.


**K14 Google připomínky — časový důkaz jednorázových událostí:** vypnutá osobní reminder cesta přijímá také známé zoned/all-day one-offs. GET i PATCH odpověď nesou nativně normalizovaný čas; worker před zápisem a každým ACK/recovery porovnává také explicitní civilní model. Stejný instant/offset v jiné IANA zóně není shoda. HTTP/DB regrese pokrývá oba modely, opakování po 503, zachování času/účastníků/konference a odmítnutí změněné zóny bez adopce ETagu. Floating, série, detached a zrušené definice zůstávají odmítnuté; UI, vlastní řešení reminder konfliktu, další provideři a živé ověření následují. Flag zůstává vypnutý.

**Doplnění review reminder důkazu:** sdílené porovnání platí i pro pending pull; změněná zóna nebo nativní reminder preference se uchová jako konflikt, skutečné echo projde. Google resource s odlišně zadanou koncovou zónou se odmítne už při importu před posunem cursoru, protože jednou zónou jej nelze věrně reprezentovat. HTTP/DB regrese simuluje pull mezi providerovým response a ACK.

Import při nezávisle zapnutých připomínkách nese časový důkaz pouze pro pending porovnání i při vypnutých časových editacích. Neprovádí tím adopci kanonického modelu. Regrese používá skutečný fetch adapter, nikoli ručně doplněná metadata.

**K14 explicitní reminder conflict — API/DB řez:** autentizovaný náhled odděluje uložené a čerstvé nativní připomínky. Potvrzení vyžaduje jejich vlastní opaque state version; content-only klient nemůže osobní změnu potvrdit. Čerstvý provider read a transakční CAS nahradí jediný izolovaný reminder intent bez změny kanonického obsahu/revize. HTTP/DB regrese pokrývá disabled gate, stale state i při stejném ETagu, lokální revizi, souběžný replay a následující edit. Změněný čas/obsah nebo jiná pending historie zůstávají odmítnuté. Klientské zobrazení, reminder editor, další provideři a živá acceptance následují; flagy zůstávají vypnuté.

**K14 reminder conflict — klientské zapojení:** web i mobil ukazují uložené a aktuální osobní Google připomínky se společným formátováním defaults/off/unknown. Potvrzení posílá přesnou zobrazenou state version, síťový retry drží operation identity. Použity stávající dialogy a primitiva; obsahový comparison zůstává oddělený. Callback regrese obou klientů a Chromium light 1280/dark 390 ověřují retry, focus a axe. Reminder editor, další provideři, živé roundtripy a fyzické native QA zůstávají navazující; flagy a verze se nemění.

**K14 Google reminder editor — vypnutý klientský řez:** privátní state response nabídne podporovanou vlastní one-off editaci pouze při zapnutém reminder flagem. Web/mobil umí defaults/off a až pět email/popup připomínek, zachovají draft i operation identity při síťové chybě a použijí frozen revision/state CAS včetně federovaného originu. Neznámé preference se nenahrazují automaticky. Potvrzení fronty není vydáváno za potvrzení Googlu; výsledný stav je v Delivery details. Browser regrese navíc kontroluje skutečnou viditelnost dialogu a selectů nad kalendářem. UI, typy, callbacky, privátní HTTP/DB a celý root check doplňují předchozí native writer/obnovu; živé roundtripy a physical native QA zůstávají. Žádné zapnutí flagu nebo změna verze/minim.


**K15 iCloud — ověření tří cest k resource oprávnění:** samostatný dočasný kalendář a minulá událost bez účastníků umožnily porovnat resource PROPFIND, parent Depth 1 PROPFIND a calendar-multiget REPORT. Všechny vrátily 207, ale požadované privilege/owner vlastnosti u přesného resource href byly v 404 propstat; žádná cesta nedoložila write grant. Kalendář byl odstraněn (204), běžící flagy zůstaly vypnuté. [Živá evidence](calendar-icloud-series-live-acceptance.md#follow-up-three-standard-dav-privilege-queries) proto drží iCloud aplikační acceptance jako odloženou podmínku; jiný dotaz ani úspěšný přímý PUT neopravňuje k povolení unknown oprávnění.


**K13 Google RSVP — čistý důkazní řez:** interní planner připraví pouze odpověď jediného prokázaného self účastníka normální jednorázové události. Vyžaduje přesnou providerovou identitu a strong ETag; následné porovnání uchová všechny ostatní nativní údaje včetně konferencí, alarmů a cizích odpovědí. [Kontrakt a regrese](../sync/google-rsvp.md) oddělují tuto přípravu od dosud nezapojené autorizace účtu, HTTP zápisu, outboxu a klientů. Není to odeslaná ani živě ověřená RSVP; navazuje explicitní notification policy a bezpečná obnova.


**K13 Google RSVP — interní podmíněný HTTP transport:** nový default-off flag chrání reader i writer před token/network přístupem. Produkční adapter sváže OAuth grant a čerstvou primární providerovou identitu s jediným self účastníkem; sekundární/delegované kalendáře zatím odmítá. Přesný PATCH mění pouze vlastní odpověď, používá If-Match a explicitní notification policy. Kompletní GET ověří zachování; ztracenou odpověď/přijaté 503 lze rozpoznat bez druhého PATCH, cizí změna brání retry. [Fake HTTP důkazy a hranice](../sync/google-rsvp.md#default-off-internal-http-transport) nejsou důkazem doručeného e-mailu ani živé odpovědi. Endpoint, lokální CAS/outbox, klienti a dvě skutečné účastnické identity následují.


**K13 RSVP — interní prepare/commit a privátní záměr:** lokální source/revision/state kontext se ověří před čerstvým provider readem a znovu pod transakčními zámky před uložením. Souběžný identický request vytvoří jedinou receipt; replay neprovádí nový HTTP read. OAuth, membership, native time/state a lokální CAS regrese prošly nad fake serverem a disposable DB. Kanonický event ani přijatý provider stav se při enqueue nemění. [Hranice](../sync/google-rsvp.md#internal-transactional-preparation-and-enqueue): dosud není veřejný endpoint ani specializovaný worker; generic write/ACK/resolution/echo nový intent explicitně odmítají. Navazuje durable doručení a teprve potom klienti/živá acceptance.


**K13 RSVP — specializovaný worker a atomický ACK:** worker ověřuje saved native baseline, zdroj a lease znovu těsně před conditional PATCH. Vlastní ACK pod transakčními zámky potvrzuje přesnou revizi, membership a mapping/state CAS; generic ACK zůstává zakázaný. HTTP/DB testy pokrývají aplikované 503/ztracenou odpověď bez druhého PATCH, ztrátu lease/oprávnění a skutečný adapter → pending pull při samostatně zapnuté RSVP funkci. Echo přijme pouze odpovídající privátní stav i časový obsah; cizí změna zůstává konfliktem. [Kontrakt](../sync/google-rsvp.md#specialized-durable-delivery-and-pull-coordination). Veřejný endpoint, klienti, vlastní řešení konfliktu a živá organizer-visible acceptance dále následují; flag zůstává vypnutý.

**K15 — aktualizace zranitelných závislostí:** samostatný údržbový řez aktualizuje Astro/Sharp, Nodemailer, Vitest a zranitelné tranzitivní parsery. Lockfile již neobsahuje verze odpovídající 22 tehdy otevřeným Dependabot nálezům; nejde o tvrzení úplné bezpečnosti ani o dokončený live provider rollout. Query-string 7 zachovává named API požadované Expo Routerem, používá opravený decoder 0.5 s minimálním ESM interop patchem. Root check ověřuje Node i skutečný nativní Metro bundle včetně dlouhého malformed UTF-8 vstupu. Všechny container build kontexty obsahují pnpm patch; docs mají explicitní cookie 2 runtime závislost potřebnou novým Astro výstupem. Verze aplikace/minima ani produkční flagy se nemění.

**K13 RSVP — autentizovaný HTTP enqueue:** default-off endpoint přijímá pouze strict vlastní odpověď s explicitním `sendUpdates: all` a frozen revision/state/operation identitou. Auth a HTTP/DB regrese odmítají cizí účet i editora sdíleného kalendáře před provider readem; enqueue ani replay neposílá PATCH. Privátní 202 receipt odděluje přijetí záměru od neověřitelného doručení notifikace. [Kontrakt](../sync/google-rsvp.md#authenticated-http-enqueue); klienti, vlastní konflikt a živá acceptance následují.

**K13 RSVP — web a native klient:** privátní default-off capability nabízí odpověď pouze pro vlastní podporovanou Google kopii. Existující dialog/sheet a výběr odpovědi používají čerstvé načtení při otevření, frozen identitu při retry, explicitní notification policy a oddělené pending/confirmed/unknown výsledky. [Kontrakt](../sync/google-rsvp.md#default-off-web-and-native-response-controls). Mock browser/native a DB regrese nejsou živá organizer-visible acceptance; vlastní řešení nativního konfliktu a další provideři dále následují.

**K13 RSVP — vlastní řešení konfliktu:** privátní náhled porovnává uloženou a čerstvou vlastní odpověď; opaque verze váže kompletní native baseline včetně nezobrazených polí. Potvrzení znovu čte provider a pod zámky kontroluje source/revision/mapping/state/permission i pending chain. Atomická náhrada záměru zachovává aktuální cizí obsah; worker rozpozná již aplikovanou odpověď bez dalšího PATCH. [HTTP/DB a klientský kontrakt](../sync/google-rsvp.md#explicit-native-rsvp-conflict-resolution); živá acceptance a další provideři zůstávají samostatnou prací.

**K12 CalDAV — obsah existující výjimky:** scope `occurrence` nyní připraví pouze content změnu aktivní detached definice se známou původní identitou/revizí. Celý resource zůstává pod silným ETag; master a nesouvisející výjimky/alarmy/unknown vlastnosti se nepřepisují. Lokální family + child revize a jeden outbox intent jsou atomické; ACK ověřuje celý požadovaný kanonický stav a posune všechny mapping validators společně. [HTTP/DB a Radicale důkazy](../sync/caldav-series-writes.md#existing-detached-occurrence-content). Generated occurrence, čas/delete/following a vlastní conflict preview následují; iCloud unknown privileges zůstávají odmítnuté.

**K12 CalDAV — zrušení existující výjimky:** explicitní occurrence delete mění pouze STATUS vybrané aktivní definice na CANCELLED a zachovává její identitu/čas/obsah i celý zbytek resource. Family revize, outbound záměr a ACK používají stejný úplný důkaz; applied 503/replay nevede k druhému PUT a pull neobnoví původní generovaný slot. [HTTP/DB + Radicale kontrakt](../sync/caldav-series-writes.md#cancel-an-existing-detached-occurrence). Generated definice a revival navazují; iCloud privilege gate zůstává beze změny.

**K12 CalDAV — nativní vytvoření výjimky:** interní writer umí pro ověřený generated slot připojit content/cancelled definici odvozenou z původních fyzických dat masteru. Zachová alarmy, rozšíření a všechny existující komponenty; plný GET a If-Match recovery zabrání duplicitnímu appendu. HTTP důkazy pokrývají zoned/all-day/floating, Radicale nový obsah i zrušení. [Kontrakt](../sync/caldav-series-writes.md#native-generated-occurrence-definition). Veřejný scope zatím vyžaduje existující detached definici; atomické vytvoření lokálního child a mapování následuje. Flagy ani privilege gate se nemění.

**K12 CalDAV — generated occurrence scope:** chybějící definice má explicitní `expectedOccurrenceRevision: null`. Preflight zmrazí její ID, commit znovu ověří celou family a atomicky uloží child, členství, deterministické nativní mapování, root revizi a jeden outbox. Pending pull nesmí novou definici odstranit; plný ACK posune všechny ETagy společně a potvrzený echo import používá stejné ID. [DB/Radicale kontrakt](../sync/caldav-series-writes.md#generated-occurrence-scope-transaction). Revival zrušené definice, čas/following a vlastní occurrence conflict preview následují; flagy/privileges beze změny.

**K12 CalDAV — obnova zrušené výjimky:** explicitní occurrence update při aktuální child revizi obnoví stejnou definici jako `STATUS:CONFIRMED`, případně s content patchem. Původní identita, čas a další nativní obsah zůstávají zachované; žádná definice se nemaže. [HTTP/DB/Radicale důkazy](../sync/caldav-series-writes.md#restore-a-cancelled-detached-occurrence) pokrývají zotavení po 503, replay, souběh a echo import. Čas/following a vlastní occurrence conflict preview následují. Meeting scheduling a iCloud unknown privileges se tím nepovolují.

**K12 CalDAV — čas existující výjimky:** occurrence update může změnit explicitní začátek/konec při zachování časového typu a IANA zóny. Writer upravuje jen DTSTART/DTEND/DURATION vybrané definice; RECURRENCE-ID, master, ostatní výjimky a alarmy zachová. [HTTP/DB/Radicale důkazy](../sync/caldav-series-writes.md#existing-occurrence-time-edit) zahrnují JSON persistence, 503 recovery, souběh a echo. Čas nového generated slotu, změna typu/zóny a series/following navazují; flagy/privilege gate beze změny.

**K12 CalDAV — čas nového generated výskytu:** scope může rovnou vytvořit přesunutou definici při zachování časového typu a zóny masteru. Planner samostatně ověří původní slot a požadovaný výsledek; RECURRENCE-ID vzniká z původního slotu, nikdy z nového DTSTART. [HTTP/DB/Radicale důkazy](../sync/caldav-series-writes.md#generated-occurrence-time-edit) pokrývají zoned/all-day/floating, první výskyt, 503, konflikt a echo identitu. Master/following a změny typu/zóny navazují; flagy/privileges beze změny.

**K12 CalDAV — čas celé série:** planner posune čas masteru a původní identity výjimek, přitom jejich vlastní časy/obsah/cancellation zachová. Nativní PUT mění jen čas masteru a dotčené RECURRENCE-ID. DB atomicky přemapuje i sousední identity přes dočasné adresy uvnitř transakce; cílový tombstone vrátí vše zpět. [HTTP/DB/Radicale důkazy](../sync/caldav-series-writes.md#series-time-edit-preserving-detached-content) zahrnují 503, souběh a echo. Časový konflikt nepoužívá content-only řešení. Following/delete a změny typu/zóny navazují; flagy/privileges beze změny.

**K12 CalDAV — změna RRULE:** scope může nahradit jedno pravidlo při zachování všech výjimek. Planner před uložením odmítne pravidlo, do kterého nepatří některá původní identita; nativní writer zachová RRULE extension parametry i všechny ostatní komponenty. [HTTP/DB/Radicale důkazy](../sync/caldav-series-writes.md#recurrence-rule-update) pokrývají COUNT/UNTIL, 503, souběh, odmítnutí orphaningu a echo. Odstranění recurrence a přepis RDATE/EXDATE zůstávají omezené; recurrence konflikty neprocházejí content-only řešením. Flagy/privileges beze změny.

**K12 CalDAV — podmíněný DELETE transport:** interní adapter ověřuje collection `unbind`, vlastnictví a úplný osobní resource. DELETE používá přijatý silný ETag; teprve následný GET 404 potvrzuje nepřítomnost. Retry po ztracené odpovědi neopakuje již provedené smazání, souběh/recreated resource/readback failure nejsou falešný success. [HTTP/Radicale kontrakt](../sync/caldav-series-writes.md#conditional-series-deletion-transport). Veřejný series delete a atomické tombstone/outbox ACK zapojení následují; flagy zůstávají vypnuté.

**K12 CalDAV — opětovná kontrola autority workeru:** family context nově vyžaduje aktuální lokální edit grant i při preflightu a ACK. Těsně před PUT po vzdálených čteních worker znovu kontroluje destination, family, grant a lease. [DB regrese](../sync/caldav-series-writes.md#worker-authority-recheck) odebere grant během GET (žádný PUT) a po PUT (žádný ACK/posun ETagů). DELETE executor má stejný checkpoint pro navazující durable zapojení. Flagy/verze beze změny.

**K12 CalDAV — durable smazání celé série:** series/delete atomicky tombstonuje master i všechny výjimky a uloží jeden outbox; mapování ponechá do potvrzeného GET 404. Worker kontroluje celou family, oprávnění a lease před DELETE i ACK a všechna mapování odstraní v jedné transakci. Dokončený receipt blokuje obnovení starým snapshotem stejného ETagu. [HTTP/DB/Radicale kontrakt](../sync/caldav-series-writes.md#durable-whole-series-deletion) zahrnuje replay, ztracenou odpověď, souběhy a odebrání oprávnění. Following a vlastní deletion conflict resolution zůstávají otevřené; flagy/verze beze změny.

**K12 CalDAV — nativní smazání následujících výskytů:** interní writer zkrátí jedno RRULE přes společný planner a odstraní jen definice s původní identitou od zvoleného řezu. Dřívější přesunutá výjimka přežije i při skutečném čase za hranicí. [HTTP/Radicale kontrakt](../sync/caldav-series-writes.md#native-following-deletion) zahrnuje COUNT/UNTIL, tři časové typy a obnovu bez opakovaného PUT. První výskyt patří do whole-resource DELETE; veřejný following scope a atomické lokální ACK zapojení následují. Flagy/verze beze změny.

**K12 CalDAV — durable following delete:** první výskyt používá whole-resource DELETE, pozdější řez jeden conditional PUT. Lokální změna masteru, tombstones a outbox jsou atomické; ACK odstraní jen mapování budoucích výjimek a společně posune ostatní ETagy. [HTTP/DB/Radicale kontrakt](../sync/caldav-series-writes.md#durable-following-deletion) pokrývá opakování, souběhy, cleanup, stale snapshot, další editace i obnovu původního ID výjimky. Following update/split a vlastní conflict resolution zůstávají otevřené; flagy/verze beze změny.

**K12 CalDAV — nativní split příprava/create:** interní builder odvodí z úplné přijaté family zkrácený zdroj a nový prostředek s vlastní zmrazenou URL/UID. Výjimky zachovají obsah a skutečný čas, změna času nové části přepíše jen jejich původní identity. [HTTP/Radicale kontrakt](../sync/caldav-series-writes.md#native-split-preparation-and-conditional-creation) používá collection bind, If-None-Match a plný readback; obnova neopakuje provedený create. Veřejné following update, lokální reparenting a durable pořadí dvou providerových kroků následují. Flagy/verze beze změny.


**K12 CalDAV — privátní split transakce:** interní commit atomicky uloží zkrácený master, novou část, přepojené výjimky a dva outbox kroky s explicitní závislostí. Replay i rollback zachovávají jedinou lokální identitu; import rozpracovaných adres nesmí vytvořit další family. [DB kontrakt](../sync/caldav-series-writes.md#private-split-transaction-and-dependency-journal) drží generic delivery/ACK/resolution uzavřené. Specializovaný dvoufázový worker, ACK a veřejný following update následují; flagy/verze beze změny.


**K12 CalDAV — durable split worker:** první krok ověří obě nativní části a práva, podmíněně zkrátí zdroj a atomicky potvrdí jeho mapování. Závislý create potvrdí celou novou family společně; obnova po 503 neopakuje přijatý PUT. [HTTP/DB/Radicale kontrakt](../sync/caldav-series-writes.md#durable-split-delivery-and-independent-family-ack) zahrnuje synchronizaci mezi kroky a nezávislou editaci původní části po prvním ACK. Veřejný following update a jeho permission preflight bridge ještě následují; flagy/verze beze změny.


**K12 CalDAV — veřejný following update:** autentizovaný scope endpoint spojuje úplný nativní preflight, resource write + collection bind a atomický split journal. První výskyt použije stávající series PUT, no-op pouze replay receipt. [HTTP/DB/Radicale kontrakt](../sync/caldav-series-writes.md#public-following-update-scope) ověřuje souběžné retry, tři časové typy, RRULE/time změny a odmítnutí stale kontextu či nové deletion/mapping identity před uložením. Konflikty mimo master content a širší recurrence/time převody zůstávají samostatnou prací; iCloud unknown privilege ani produkční flagy/verze se nemění.

**K13 Google — privátní RSVP jedné existující instance:** nativní evidence vyžaduje serverem přijatý parent ID a původní identitu výskytu; přesunutý čas je nenahrazuje. Conditional PATCH mění pouze vlastní odpověď na URL instance a úplný readback zachová zbytek. [Čisté a HTTP regrese](../sync/google-rsvp.md#bound-instance-evidence-and-conditional-transport) ověřují DST, souběh a obnovu bez opakovaného PATCH. Veřejná queue/capability zatím recurring RSVP odmítá; atomické binding/ACK a conflict resolution navazují. Google whole-series zůstává nepodporované podle schváleného kontraktu zachování výjimek. Flagy/verze se nemění.

**K13 Google — privátní RSVP journal existující instance:** interní příprava odvodí child/parent/mapování a původní slot z přijatého stavu. Parent-before-child commit vše znovu ověří a uloží jeden záměr bez změny kanonické události. [DB regrese](../sync/google-rsvp.md#private-instance-journal-and-accepted-family-binding) pokrývají souběh, replay, změnu/smazání/unlink rodiče a identity. Veřejný enqueue, capability, worker i ACK tohoto staged záměru zatím zůstávají zavřené; úplné instance delivery/ACK a conflict resolution navazují. Flagy/verze beze změny.

**K13 Google — privátní instance worker a ACK:** worker znovu ověří přijatou parent/child vazbu před zápisem; úplný readback a atomický ACK potvrdí jen vlastní odpověď vybrané instance. Pending pull porovnává původní identitu, parent a přesný čas, ne jen shodný začátek. [HTTP/DB regrese](../sync/google-rsvp.md#instance-worker-full-confirmation-and-pull-coordination) pokrývají ztracenou odpověď/503 bez druhého PATCH, změnu rodiče/mapování/oprávnění, lease, nativní identitu a echo. Veřejný instance enqueue/capability a explicitní conflict resolution navazují; chybějící nativní zone evidence zůstává odmítnutá. Flagy/verze beze změny.

**K13 Google — explicitní konflikt RSVP instance:** náhled váže celý nativní baseline i přijatou parent revizi/mapování, takže starý souhlas neplatí po změně série ani skrytého komentáře. Commit zachová původní canonical/external parent a slot, atomicky nahradí záměr a případný další PATCH změní pouze vlastní odpověď. [HTTP/DB důkazy](../sync/google-rsvp.md#explicit-instance-rsvp-conflict-resolution) zahrnují stale preview, oprávnění, cizí parent/slot, replay a already-desired zotavení bez druhého PATCH. Veřejný instance enqueue/capability a klientské zpřístupnění navazují; flagy/verze beze změny.

**K13 Google — veřejné RSVP existující instance:** endpoint odvodí přijatý parent/slot, ověří vlastní nativní kopii a vrátí 202 s jediným outbox záměrem; klient nepředává vlastní occurrence binding a HTTP request neposílá PATCH inline. Web/native nabízí „Respond to this occurrence“ nad child UUID, čerstvou capability a frozen retry. [HTTP/DB a klientské důkazy](../sync/google-rsvp.md#public-instance-rsvp) zahrnují souběh/replay, master/foreign identity odmítnutí, změnu rodiče, conditional worker, narrow/dark a accessibility/focus. Generované sloty, master RSVP, chybějící nativní zone evidence a živé dvouúčtové acceptance zůstávají otevřené/omezené; produkční flagy/verze se nemění.


**K12 Graph — nativní recurrence kandidát:** striktní zpětný převod podporovaných pattern/range ověřuje přijatý začátek a zónu masteru, nedělní Graph default i inclusive endDate. [Samostatné expanzní regrese](../sync/event-scope-operations.md#native-graph-recurrence-evidence-candidate) pokrývají šest vzorů, all-day a DST ve dvou zónách; neznámá či nejednoznačná data se neodhadují. Jde o čistou přípravu: calendarView zůstává provider-expanded, recurring create stále odmítnutý. Nativní master identity, create/echo dedup a HTTP/DB integrace následují; Graph update/delete dále vyžaduje živý důkaz conditional-write kontraktu.


**K12 CalDAV — konflikt obsahu existující výjimky:** veřejný náhled/confirm odvozuje vybraný child z uloženého záměru a ukazuje jeho původní slot a uložený/aktuální obsah. Celý resource se znovu ověří; commit zachová cíl a pod family zámky atomicky nahradí journal bez změny kanonického draftu. [HTTP/DB a nativní regrese](../sync/caldav-series-writes.md#existing-occurrence-content-conflict-resolution) pokrývají tři časové typy, stale/repeated konflikty, oprávnění, identity, souběh, 503 a echo. Generated/revival/cancel/time/RRULE/following/split konfliktové operace následují; iCloud privileges a produkční flagy/verze zůstávají beze změny.


**K12 CalDAV — potvrzení uloženého time/RRULE záměru:** fresh preview nyní vychází z původního nativního baseline a přesně znovu aplikuje uložený čas série/existující výjimky nebo RRULE. Commit váže původní čas/rule/scope a celý kanonický family stav; rekeyed identity se potvrdí společně. [HTTP/DB kontrakt](../sync/caldav-series-writes.md#saved-time-and-rrule-conflict-confirmation) pokrývá tři časové typy, souběhy, repeated/503, tampering a odmítnutí jiné nativní struktury. Nejde o adopci souběžné providerové změny času či pravidla; generated/cancel/following/split konflikty zůstávají navazující práce. Flagy/verze/privileges beze změny.


**K12 CalDAV — generated/cancel/revival konflikty:** explicitní potvrzení zachová vybranou identitu, zmrazenou novou definici a cancellation/time/rule volbu. Generated/cancel vyžadují shodná původní kanonická nativní data; revival porovnává obsah existující stále zrušené definice. [HTTP/DB a Radicale důkazy](../sync/caldav-series-writes.md#generated-cancellation-and-revival-conflict-confirmation) pokrývají tři časové typy, souběhy, tampering, repeated/503 a echo bez změn UUID/revizí. Following/whole-resource delete a split reconciliation následují; iCloud privileges, flagy/verze a živé účty se nemění.

- K12 CalDAV following-delete conflict follow-up (2026-09-09): explicit comparison/confirmation now retains the original cut and validates the complete family including saved child tombstones. Web/native label the destructive scope and submit an exact scope assertion; clients omitting it are refused. Completed replacement receipts fence superseded pre-cut ETags so delayed sync cannot revive removed exceptions, while a new remote version may restore them. Local HTTP/DB, Radicale, client and browser evidence is tracked in `docs/sync/caldav-series-writes.md#following-deletion-conflict-confirmation`; whole-resource delete/split conflicts, live acceptance and activation remain open.

- K12 CalDAV whole-series deletion conflict follow-up (2026-09-09): fresh complete-family evidence now uses the separate collection-unbind contract, then explicit `series-delete` preview/confirmation locks and validates all saved local tombstones. Clients name the entire series and exceptions; older/mismatched scope requests fail. Conditional DELETE/404 ACK releases only the exact superseded deletion chain and fences its accepted ETags against delayed resurrection. See `docs/sync/caldav-series-writes.md#whole-series-deletion-conflict-confirmation`; split conflicts and live/physical acceptance remain open.

- K12 split conflict groundwork (2026-09-09): delivery row UUIDs are now independent of the frozen new-family UUID/native URL. The unmapped-delete fence uses the exact saved split address and journal creation ID; legacy shared-UUID journals remain supported. Existing split HTTP/DB and Radicale delivery checks cover the distinction. Explicit pair conflict replacement remains open; no new scope capability or production activation is claimed.

- K12 CalDAV split source-conflict follow-up (2026-09-09): fresh complete-source proof and an unattempted companion create permit one explicit confirmation replacing both journal rows without changing the future UUID/URL/UID or canonical revisions. Preview shows earlier/current/future content and the exact following-update cut/identity; clients refuse an incomplete future comparison. Phase-specific ACK releases only corresponding superseded rows, permitting old-family edits while preserving future delivery and stale-source ETag fences. See `docs/sync/caldav-series-writes.md#split-source-conflict-confirmation-before-the-first-ack`; post-source-ACK creation conflicts remain separate work.

- K12 Graph master-time preparation: strict native UTC projection + IANA recurrence-zone evidence and civil serializer now validate recurrence candidates. Invalid canonical anchors, ambiguous DST times, lossy precision and unsupported all-day zones fail closed. Independent native/time tests added; production recurring create and provider-expanded import remain unchanged pending durable identity/recovery and echo integration.

- K12 Graph native create-recovery candidate: frozen operation identity, complete scoped listing, exact master GET with exception/cancellation evidence and saved content/time/rule validation. Fake HTTP covers duplicates, late-page failures, unknown/changed native state and request scoping. No POST, production write capability or import promotion enabled; durable delivery and family echo handling remain open.

- K12 Graph private native-create candidate: default-off transport checks current calendar permission, freezes the transaction/body, invokes a pre-write callback and sends at most one POST. Lost/partial/503 results require complete native recovery evidence; uncertain absence cannot resend. Fake HTTP covers zoned/all-day payloads, permissions, callback failure, conflicts and post-write uncertainty. Production adapter, durable family journal/ACK and canonical import remain unchanged/pending.

- K12 Graph finite-family preparation: private native create now requires a complete COUNT footprint (<=366 occurrences, <=730 days) with exact original identities, unambiguous civil start/end and fixed same-day timed duration. Civil enumeration detects gaps before COUNT replenishment; actual known-time expansion must match. Native family reading, cancellation evidence, durable ACK and echo integration remain separate pending work.

- K12 Graph finite-family read candidate: exact scoped master and complete finite instances, expanded exceptions outside the window, own native UIDs/ETags, explicit unique cancellation cardinality and repeated full master comparison. Timed exceptions retain exact UTC instants without guessing current zones from historical metadata. Independent native/HTTP regressions cover incomplete, duplicate, foreign and changed observations; durable import/ACK and production recurring create remain pending.

- K12 exact detached instant reading: shared recurrence expansion now preserves an explicit legacy-unknown timed child with valid UTC endpoints and original instant identity, suppressing its generated slot without borrowing a zone. Public tests cover moved-in/out, agenda, cancellation, malformed/nested/duplicate definitions, host/viewer zones and both fold instants. Graph family import and durable create ACK remain pending; no writer or production flag is enabled.

- K12 Graph private family persistence: complete finite observations now have a dedicated atomic DB query with accepted local/source context revalidation. Active originals retain canonical UUIDs and own native mappings; cancellation preserves prior exception content, absent-native slots never receive fabricated IDs, retired originals can revive under their existing UUIDs. PostgreSQL regressions cover rollback, no-op, source/local/pending fences and concurrent commits. Engine reset/echo and pending-create/ACK integration remain open; production create remains unsupported.

- K12 Graph tracked-family sync: already mapped known masters now read their complete finite native family before the bounded view, filter matching/stale instances before ordinary hydration, and retain family IDs through reset. Both edit-flag states preserve the canonical family; HTTP/PostgreSQL regressions cover no-op, window movement, moved/cancelled/revived UUIDs, failed reads and local-revision races. Whole-master removal and pending/new-create coordination plus durable ACK remain required before recurring creation is enabled.
