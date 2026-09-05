# Implementační plán: důvěryhodný sjednocený kalendář

Stav: K01 implementován a lokálně ověřen (2026-09-05). K02–K15 čekají.

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

Značky A1–A10 odkazují na nálezy auditu. K01 je `completed`, ostatní položky jsou `pending`.

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

### K05 — Malé opravy klientských ztrát

Čtyři nezávislé patche s regresním scénářem:

- Timed event používá samostatné datum konce ve validaci i serializaci. Title-only edit zachová noc přes půlnoc i více dní.
- Inline scoped editor se inicializuje vybraným výskytem; explicitní editor celé série zůstane master-based. Název na třetím výskytu nesmí posunout sérii.
- Native `GlobalEventModals` vrací výsledek `applySeriesEdit`; Cancel zachová draft a nespustí následnou změnu reminders.
- Native delete čeká na výsledek, zachová detail při chybě a spustí reminder reconciliation až po úspěchu.

**Místa:** web `event-form.ts`, `EventEditorForm`, `EventDetailsPopover`; native `GlobalEventModals`, `EventDetailModal`, `AddEventModal`.

**Hotovo:** helper testy plus alespoň test reálného propojení callbacků; samostatný helper test by původní Cancel chybu nezachytil. Použít existující UI bez redesignu.

## Druhá série: spolehlivé doručování

### K06 — Revize a změnové patche

Aditivně zavést lokální event revision a serverovou kontrolu očekávané revize. Změna obsahu nebo příchozí změna, která obsah opravdu mění, revizi posune. Běžný no-op poll ji neposouvá. Server vypočítá skutečný field diff; neposílat providerovi znovu nezměněný text, čas nebo location.

Externí mapování uchová providerovou verzi. Pro každou službu ověřit konkrétní podporu conditional write a jeho chování testem; nepovažovat Graph `changeKey` automaticky za ekvivalent garantovaného `If-Match`. Samotné GET následované PATCH bez podmínky není atomická ochrana konfliktu. Neprokazatelnou ochranu nepředstírat a nebezpečnou operaci neprovést bez explicitního řešení.

**Místa:** shared types/wire, DB schema a event dotazy, event handlers, adapter contract/serializery, klientské mutace.

**Test/hotovo:** dva drafty ze stejné revize; druhý nevrátí starý čas. Outlook title-only edit zachová původní HTML a strukturované location. Omitted pole není totéž jako explicitní vymazání. Vzdálený konflikt nezpůsobí lokální ztrátu draftu.

**Kompatibilitní gate:** starý klient revision neposílá; bez ní nelze slíbit detekci stale draftu. Před zapnutím enforcement rozhodnout mezi bezpečným omezením starých write cest a zvýšením minimální podporované verze. Doporučení: noví klienti nejdřív, potom enforcement; žádný trvalý tichý bypass. Změnu podpory vydaných klientů schvaluje vlastník.

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

## Další konkrétní práce

Pokračovat **K02**, rozděleným na tři samostatně ověřené změny: bootstrap prvního účtu, Google calendar-list pagination a Graph master hydration.

Odhady termínů přidat až po prvních opravách a návrhu revizí/outboxu. Kalendářní datum bez ověření těchto hranic by nyní bylo falešně přesné.
