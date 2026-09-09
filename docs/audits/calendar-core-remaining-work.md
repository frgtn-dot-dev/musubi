# Core kalendáře: zbývající práce

Aktualizováno 2026-09-09. Tento přehled doplňuje
[implementační plán](calendar-core-implementation-plan.md); jeho historické
checkpointy popisují stav v okamžiku příslušného řezu, ne vždy dnešní omezení.
K12–K14 zůstávají rozpracované. K15 ani produkční M2 nejsou převzaté.

## Co už lze lokálně ověřit

„Implementováno“ níže znamená podporovaný kontrakt za příslušným vypnutým flagem,
s lokálními regresními důkazy. Není to živá certifikace všech účtů nebo povolení
produkční aktivace. Stejný provider může podporovat jednu operaci a odmítnout jinou.

| Oblast | Implementovaný rozsah | Zbývající hranice a důkaz |
| --- | --- | --- |
| K12 Google | Osobní generated/existing occurrence update, čas ve stejném typu, cancel; durable queue/worker/ACK a explicitní apply-saved konflikt | Whole-series nepodporované podle rozhodnutí o zachování výjimek; following nepovolené. [Kontrakt](../sync/google-occurrence-writes.md) |
| K12 CalDAV | Osobní whole-resource series content/time/RRULE změna, explicitní zoned→UTC převod konečné COUNT série se stejným civilním časem bez výjimek, obnovení vybraných importovaných all-day EXDATE dat v konečné COUNT sérii bez výjimek a odebrání samotného RRULE bez výjimek, occurrence content/time/cancel/revival, series/following delete a dvoukrokový following update | Známý zoned/floating/all-day model a úplná resource evidence; resource write, collection bind/unbind dle operace. Explicitní potvrzení master/active-child content a uloženého series/active-child time či series RRULE záměru je podporované při shodné původní nativní struktuře. Generated/cancel/revival potvrzení zachovává původní definice a intent; Partial following-delete konflikt má přesné potvrzení bodu řezu, kontrolu tombstones a ochranu proti opožděnému starému syncu. Whole-resource delete konflikt má samostatné potvrzení celé série a collection-unbind proof. Source konflikt splitu před prvním ACK má potvrzení obou operací se stejnou budoucí identitou. Po source ACK lze samostatně potvrdit vytvoření budoucí série na původní adrese, pokud chybí nebo již přesně odpovídá uloženému celému resource; dokončený source receipt zůstává neměnný. Přepis cizího resource, změna budoucí adresy a širší převody zbývají. [Kontrakt a Radicale důkazy](../sync/caldav-series-writes.md) |
| K12 CalDAV přidané datum | Přidání nebo odebrání jednoho all-day RDATE mimo pravidlo osobní konečné COUNT série; explicitní stored-master scope, neměnný záměr, konflikt a úplný ACK | Jeden VEVENT bez EXDATE a detached historie, zachovaný DTSTART/COUNT, trvání a ostatní raw bytes. Web a native callery včetně generated slotu používají uložený master. HTTP/DB a disposable Radicale evidence nenahrazují živý iCloud; více dat, timed/UNTIL a kombinace zůstávají nepodporované. [Kontrakt](../sync/caldav-rdate-writes.md) |
| K12 CalDAV DATE import/export | Veřejný ICS import/export zachovává all-day RDATE/EXDATE, původní DTSTART a COUNT včetně vyloučeného začátku a přidaných dat za koncem pravidla | Nejednoznačné či neplatné datumové parametry se odmítnou před vytvořením cílového kalendáře; přesné chyby zachovává i sdílený legacy serializer. Nejde o nový nativní dated writer ani úplné zachování detached importu. [Kontrakt](../sync/caldav-date-export.md) |
| K12 Graph | Default-off veřejný create osobní konečné série: jeden vlastní kalendář, známý zoned/all-day model, COUNT nebo přesně ekvivalentní konečné UNTIL do 366 výskytů / 730 dnů. Durable intent, jediný POST, transaction recovery, úplný family ACK a sync bez duplicit včetně odstranění/obnovy masteru | HTTP 202 potvrzuje místní uložení, ne nativní doručení. Opakování používá stabilní klíč nebo UUID události a vrací aktuální dostupný stav. Web/native draft identita a browser HTTP-mock acceptance jsou pokryté; živý Outlook a fyzická native acceptance zbývají; NOEND, širší převody, konfliktní create recovery s výjimkami a native scope UPDATE/DELETE nejsou uzavřené. Weak ETag ani changeKey nejsou důkaz podmíněného zápisu. [Create kontrakt](../sync/graph-recurring-create.md), [import](../sync/provider-time-import.md#graph-occurrence-mapping-slice)  Explicitní lokální převzetí jedinečné změněné osobní plain finite create family je pokryté bez provider write; širší exception/cancellation adoption zbývá. [Adoption kontrakt](../sync/graph-create-adoption.md) |
| K13 read/preserve | Privátní source observation organizátora, účastníků, rolí a odpovědí pro Google/Graph/CalDAV | CalDAV vlastní identita vyžaduje scheduling proof; provider observation není Musubi social attendance. [Kontrakt](../sync/provider-event-state.md) |
| K13 Google RSVP | Vlastní primary copy one-off a vázané existující instance: přijmout/tentative/odmítnout, veřejný endpoint, web/native editor, queue/worker, explicitní konflikt | Master a generated sloty, neúplná native evidence včetně chybějící zóny timed instance, širší withdraw a živá dvouúčtová acceptance nejsou pokryté. [Kontrakt](../sync/google-rsvp.md) |
| K13 CalDAV RSVP | Default-off osobní one-off RSVP s ověřeným automatic scheduling, public/web/native, durable PUT/CAS a úplným readback ACK | Známý zoned/all-day resource bez recurrence, přesný self/principal/owner/outbox proof; organizer delivery zůstává unknown. Konflikt bez overwrite potvrzení, širší identity/series a živá dvouúčtová acceptance zbývají. [Kontrakt](../sync/caldav-rsvp.md) |
| K13 Graph RSVP | Default-off vlastní primary one-off attendee copy: accept/tentativelyAccept/decline, veřejný endpoint, web/native editor a trvalý marker před POST | Po možném odeslání jen read-only Check response, včetně konfliktu a zmizelé kopie. Bez CAS nebo garance doručení organizátorovi. Recurring/delegated RSVP a živá acceptance zbývají. [Kontrakt](../sync/microsoft-rsvp.md) |
| K13 Google organizer | Default-off vlastní primary one-off create/update/cancel a existující vázaná instance content-update/cancel s explicitním oznámením všem hostům, stabilní identitou a trvalým markerem před odesláním; veřejný endpoint a web/native callery | Nejistá obnova pouze čte stav a nikdy automaticky neopakuje pozvánku. Změny seznamu hostů, času instance, celé série, delegace/federace, další provideři a živé dvouúčtové doručení zůstávají otevřené. [Kontrakt](../sync/google-organizer.md) |
| K13 CalDAV organizer | Default-off one-off create, změna obsahu, explicitní změna času ve stejném typu/zóně a cancel s ověřeným automatic scheduling a explicitním server-invite; vlastní principal/owner, operaci odpovídající privilege proof a web/native callery | Stabilní URL/UID, podmíněný zápis, úplný readback a trvalý marker brání opakování nejisté pozvánky. Samostatné update/delete capabilities zachovávají i cancellation-only obnovu. Změna času vyžaduje úplný nativní časový důkaz a obnoví žádost o odpověď u hostů. Recurrence, změna hostů, změna typu/zóny a živé doručení nejsou pokryté. [Kontrakt](../sync/caldav-organizer.md) |
| K14 read/preserve | Privátní provider reminders a raw availability/privacy/type observation; Google title-only HTTP update/readback zachovává special state, conference metadata a reminders, Graph HTTP read/re-read zachovává workingElsewhere/Teams (writer zůstává blokovaný); Google freeBusyReader se nevydává za plnohodnotný detailový mirror | Google změny přístupu mají version fence proti opožděnému importu a vynucují čerstvé úplné načtení. Zúžení Google přístupu nyní skryje obsah provider-origin mirroru i při neúspěšném fetch, zachová identity/intenty a invaliduje otevřené detaily web/native. Úplné odebrání zdroje rediguje sdílené tombstones; veřejná historie doručování a čekající e-maily znovu ověřují aktuální přístup. Web/native otevřené editory a cache jsou pokryté v navazujících PR #249/#251; zbývá fyzická acceptance, starší klienti a intervalový model. [Web editor kontrakt](../ui/google-editor-privacy-refresh.md); nejde o kompletní intervalový free/busy model. [Access kontrakt](../sync/google-calendar-access.md). [Kontrakt](../sync/provider-event-state.md) |
| K14 Graph private-read access | Discovery rozlišuje canEdit a tri-state canViewPrivateItems; potvrzené zúžení rediguje staré detaily před fetch a generation fence blokuje opožděný import/delete/cursor včetně rodin | Čerstvý omezený read může obnovit aktuálně povolený obsah; unknown proof neobnoví redigovaný obsah. Retained receipts/email a web/native editor drafty mají stejnou privacy hranici. Fake HTTP/DB a mounted klientské regrese nenahrazují živou Graph/device acceptance. CalDAV collection read-privilege parity je popsána v samostatném řádku níže. [Kontrakt](../sync/microsoft-calendar-access.md) |
| K14 CalDAV collection read access | Přesné href/namespace/úspěšné propstat discovery; samostatný DAV read/free-busy/write důkaz a generační fence pro VEVENT rodiny i VTODO | Potvrzená ztráta read rediguje import před fetch, čerstvý celý resource obnovuje stejnou identitu; stale task DTO/ACK nemůže vrátit starý obsah. Web task/event a native event editory zachovávají vlastní drafty. Starší task klient po retirement dostane conflict; živé iCloud resource ACL a device acceptance zůstávají lidské ověření. [Kontrakt](../sync/caldav-read-access.md) |
| K14 CalDAV event alarms | One-off nebo explicitní konečná COUNT master série: známý zoned/all-day osobní VEVENT, nula/jeden jednoduchý DISPLAY START-relative alarm; web/native editor a explicitní konflikt | Samostatný default-off flag, plný privátní resource proof, strong ETag CAS, durable replay/ACK a blokace neúplného pull jsou lokálně pokryté včetně disposable Radicale. Nejde o per-user preference. Master-only série zachovává přesný RRULE a vyžaduje explicitní scope; active/retired exceptions, RDATE/EXDATE, složitější recurrence, komplexní alarmy, meeting/floating resources a živá iCloud/OS acceptance zůstávají otevřené. [Kontrakt](../sync/caldav-event-alarms.md) |
| K14 Google intervalová dostupnost | Default-off freeBusy.query API, privátní registry zdrojů a explicitní výběr do 20 zdrojů v Connections na webu i v nativním klientu; UTC intervalový dialog bez Event identit či edit akcí | Scope/owner/account/generation kontroly, reconnect-required versus unavailable versus potvrzené prázdno, bez offline cache. Web day/week nabízí explicitní session/page opt-in statických intervalů pro normální 24hodinové dny. Přechody DST mají výslovný list fallback; oprava existující časové osy a další grid pohledy zůstávají implementace. Nativní callback/transport regrese nejsou fyzická ani renderovaná acceptance; device QA, živý re-consent a aktivace zbývají. [Kontrakt](../sync/google-availability.md) |
| K14 Google reminders | Vlastní one-off a vázané existující instance: defaults/off/custom, veřejný web/native editor, durable delivery a explicitní konflikt | Parent/original identity, známý čas, podmíněný PATCH, plná obnova a explicitní konflikt jsou pokryté lokálně. Web/native callbacky a browser/mock acceptance rozlišují výskyt a sérii. Series, Graph native writer a živá reminder/OS acceptance zůstávají otevřené. Úzký CalDAV one-off alarm writer je samostatně popsaný níže. [Instance kontrakt](../sync/google-instance-reminders.md). Musubi reminder plánování je oddělené. [Kontrakt](../sync/provider-event-state.md#gated-personal-google-reminder-editor) |

## Implementace bez čekání na vlastníka

Pořadí dalších řezů je orientační; nový konkrétní nález může mít přednost. Každý
řez projde stejným postupem: implementace, relevantní regrese, nezávislé review,
opravy a zelené CI před squash mergem. Žádný níže uvedený bod se nepovažuje za
hotový pouze tím, že má bezpečný unsupported guard.

1. **K12 společné ověření dokončených řezů.** Graph finite create/echo a
   lokální převzetí změněné plain family jsou implementované; původní create
   položka už není otevřenou implementací. CalDAV scope konflikty, RRULE removal,
   EXDATE restoration a jednotlivé RDATE mají vlastní přesné kontrakty. Při
   integraci ověřit jejich společné chování a úplnost registrace regresí.
2. **K13 organizer operace.** CalDAV one-off create/content/time/cancel a
   Google content/cancel již uloženého výskytu jsou implementované. Dokončit
   Graph one-off create s obnovou pouze čtením a společné ověření všech větví.
   Privátní neměnný záměr, explicitní notification policy a ochrana proti
   opakovanému odeslání zůstávají součástí každého podporovaného kontraktu.
   Živé doručení zůstává samostatné.
3. **K14 CalDAV read privacy.** Ověřit společnou integraci úplného discovery
   důkazu, redakce VEVENT/VTODO a ochrany otevřených editorů a opožděných odpovědí.
   Google/Graph read privacy, dostupnost a vymezené reminder operace už mají
   implementované kontrakty výše; další rozsah neodvozovat pouze z vlastnictví.
4. **Závěrečná společná evidence.** Relevantní celé kontroly, nezávislé review
   integrace a CI po ucelených dávkách; aktualizace tohoto přehledu podle skutečně
   podporovaného rozsahu. Rozlišovat unit/HTTP/DB, browser/mock native, fyzické
   zařízení a živého providera. Širší nepodporované varianty nejsou automaticky
   novou podmínkou dokončení původního rozsahu.

## Na konec: vstup nebo rozhodnutí vlastníka

Tyto body neblokují výše uvedenou lokální implementaci. Přihlašovací údaje patří
pouze do lokálního připojení, nikdy do chatu, repozitáře nebo testovacích logů.

| Potřeba | Proč ji nelze nahradit lokální regresí |
| --- | --- |
| Outlook vývojové OAuth připojení a vyhrazené testovací kalendáře | Živé round-trip ověření a skutečný event conditional-write kontrakt; `changeKey` ani podobnost Graph API s jiným providerem nejsou CAS důkaz. |
| Dvě oddělené testovací identity a konkrétní schválené invite/RSVP scénáře | Ověřit odpověď viditelnou organizátorovi, změnu a cancellation bez duplicitních pozvánek. Běžné připojení osobního účtu samo tento test nedokazuje. |
| iCloud resource permission kontrakt | Tři standardní DAV dotazy neposkytly positive resource write privilege. Připojení je dostupné, ale zpřístupnění scope writeru vyžaduje důvěryhodný mechanismus nebo výslovně schválený jiný kontrakt. [Živá evidence](calendar-icloud-series-live-acceptance.md#follow-up-three-standard-dav-privilege-queries) |
| Podoba DST osy v týdnu | Konkrétní [Storybook návrh](../ui/proposals/dst-axis.md) rezervuje neinteraktivní řádky pro neexistující místní časy a rozlišuje opakované hodiny UTC offsetem. Nový produkční vizuální vzor vyžaduje schválení podle Musubi UI skillu; čistý model je připravený, integrace interakcí zbývá. |
| Fyzické native/OS a notification QA | Mockované callbacky a Chromium nejsou důkaz chování telefonu, OS oprávnění, klávesnice ani skutečných oznámení. |
| Release, minimální klientské verze a produkční aktivace | Samostatné rozhodnutí až po odpovídající acceptance. Dosavadní práce nemění verze/minima 0.1.8 ani nezapíná produkční time/reminder/RSVP flagy. |

Google whole-series nyní **nevyžaduje opakování otázky**: vlastník již rozhodl
zachovat obsah výjimek a tuto operaci nepodporovat. Nový návrh má smysl pouze s
prokázanou ochranou celé family nebo novým výslovně schváleným produktovým
kontraktem. [Rozhodnutí a reprodukce souběhu](calendar-google-series-live-acceptance.md#follow-up-exception-concurrency-and-product-decision).


### Samostatná následná oprava DST osy

`packages/calendar/src/layout/day-segments.ts` počítá elapsed minuty od místní
půlnoci a ořezává je na 1440, zatímco `TimeGridView.tsx` vykresluje 24 wall-clock
hodin. V Europe/Prague dne 2026-03-29 událost v 09:00 získá `startMin=480`,
tedy polohu 08:00; podzimní 25hodinový den se navíc ořezává. Nová regrese
`availability-grid.test.ts` tento existující rozpor dokládá. Tento řez osu nemění:
intervaly se na takových dnech nevykreslí a coverage notice odkazuje na UTC list.
Další práce musí sjednotit grid/label/selection/drag geometrii pro 23/25hodinové
dny; chybějící busy bloky se nesmějí vydávat za volno.

Samostatný model přesných okamžiků a Storybook návrh pro Prague/Lord Howe je
připravený a lokálně ověřený; žádný produkční caller jej zatím nepoužívá.
[Návrh a zbývající integrace](../ui/proposals/dst-axis.md) pokrývá opakované
hodiny i chybějící civilní časy. Nový vizuální vzor týdne čeká na rozhodnutí
vlastníka, potom zbývá propojit stejnou osu s vykreslením a všemi interakcemi.
