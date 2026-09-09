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
| K12 CalDAV | Osobní whole-resource series content/time/RRULE změna, explicitní zoned→UTC převod konečné COUNT série se stejným civilním časem bez výjimek a odebrání samotného RRULE bez výjimek, occurrence content/time/cancel/revival, series/following delete a dvoukrokový following update | Známý zoned/floating/all-day model a úplná resource evidence; resource write, collection bind/unbind dle operace. Explicitní potvrzení master/active-child content a uloženého series/active-child time či series RRULE záměru je podporované při shodné původní nativní struktuře. Generated/cancel/revival potvrzení zachovává původní definice a intent; Partial following-delete konflikt má přesné potvrzení bodu řezu, kontrolu tombstones a ochranu proti opožděnému starému syncu. Whole-resource delete konflikt má samostatné potvrzení celé série a collection-unbind proof. Source konflikt splitu před prvním ACK má potvrzení obou operací se stejnou budoucí identitou. Po source ACK lze samostatně potvrdit vytvoření budoucí série na původní adrese, pokud chybí nebo již přesně odpovídá uloženému celému resource; dokončený source receipt zůstává neměnný. Přepis cizího resource, změna budoucí adresy a širší převody zbývají. [Kontrakt a Radicale důkazy](../sync/caldav-series-writes.md) |
| K12 Graph | Default-off veřejný create osobní konečné série: jeden vlastní kalendář, známý zoned/all-day model, COUNT nebo přesně ekvivalentní konečné UNTIL do 366 výskytů / 730 dnů. Durable intent, jediný POST, transaction recovery, úplný family ACK a sync bez duplicit včetně odstranění/obnovy masteru | HTTP 202 potvrzuje místní uložení, ne nativní doručení. Opakování používá stabilní klíč nebo UUID události a vrací aktuální dostupný stav. Web/native draft identita a browser HTTP-mock acceptance jsou pokryté; živý Outlook a fyzická native acceptance zbývají; NOEND, širší převody, konfliktní create recovery a native scope UPDATE/DELETE nejsou uzavřené. Weak ETag ani changeKey nejsou důkaz podmíněného zápisu. [Create kontrakt](../sync/graph-recurring-create.md), [import](../sync/provider-time-import.md#graph-occurrence-mapping-slice) |
| K13 read/preserve | Privátní source observation organizátora, účastníků, rolí a odpovědí pro Google/Graph/CalDAV | CalDAV vlastní identita vyžaduje scheduling proof; provider observation není Musubi social attendance. [Kontrakt](../sync/provider-event-state.md) |
| K13 Google RSVP | Vlastní primary copy one-off a vázané existující instance: přijmout/tentative/odmítnout, veřejný endpoint, web/native editor, queue/worker, explicitní konflikt | Master a generated sloty, neúplná native evidence včetně chybějící zóny timed instance, širší withdraw a živá dvouúčtová acceptance nejsou pokryté. [Kontrakt](../sync/google-rsvp.md) |
| K13 CalDAV RSVP | Default-off osobní one-off RSVP s ověřeným automatic scheduling, public/web/native, durable PUT/CAS a úplným readback ACK | Známý zoned/all-day resource bez recurrence, přesný self/principal/owner/outbox proof; organizer delivery zůstává unknown. Konflikt bez overwrite potvrzení, širší identity/series a živá dvouúčtová acceptance zbývají. [Kontrakt](../sync/caldav-rsvp.md) |
| K13 další zápisy | Bez dalšího produkčního meeting writeru | Graph RSVP a organizer create/update/cancel s explicitní notification policy zůstávají implementační práce. |
| K14 read/preserve | Privátní provider reminders a raw availability/privacy/type observation; Google freeBusyReader se nevydává za plnohodnotný detailový mirror | Google změny přístupu mají version fence proti opožděnému importu a vynucují čerstvé úplné načtení. Zúžení Google přístupu nyní skryje obsah provider-origin mirroru i při neúspěšném fetch, zachová identity/intenty a invaliduje otevřené detaily web/native. Úplné odebrání zdroje rediguje sdílené tombstones; veřejná historie doručování a čekající e-maily znovu ověřují aktuální přístup. Web/native otevřené editory a cache jsou pokryté v navazujících PR #249/#251; zbývá fyzická acceptance, starší klienti a intervalový model. [Web editor kontrakt](../ui/google-editor-privacy-refresh.md); nejde o kompletní intervalový free/busy model. [Access kontrakt](../sync/google-calendar-access.md). [Kontrakt](../sync/provider-event-state.md) |
| K14 CalDAV event alarms | One-off známý zoned/all-day osobní VEVENT, nula/jeden jednoduchý DISPLAY START-relative alarm; web/native editor a explicitní konflikt | Samostatný default-off flag, plný privátní resource proof, strong ETag CAS, durable replay/ACK a blokace neúplného pull jsou lokálně pokryté včetně disposable Radicale. Nejde o per-user preference. Komplexní alarmy, recurrence, meeting/floating resources a živá iCloud/OS acceptance zůstávají otevřené. [Kontrakt](../sync/caldav-event-alarms.md) |
| K14 Google intervalová dostupnost | Default-off freeBusy.query API, privátní registry zdrojů a explicitní výběr do 20 zdrojů v Connections na webu i v nativním klientu; UTC intervalový dialog bez Event identit či edit akcí | Scope/owner/account/generation kontroly, reconnect-required versus unavailable versus potvrzené prázdno, bez offline cache. Grid zůstává implementační práce, nikoli automaticky blokovaná lidským schválením. Nativní callback/transport regrese nejsou fyzická ani renderovaná acceptance; device QA, živý re-consent a aktivace zbývají. [Kontrakt](../sync/google-availability.md) |
| K14 Google reminders | Vlastní one-off a vázané existující instance: defaults/off/custom, veřejný web/native editor, durable delivery a explicitní konflikt | Parent/original identity, známý čas, podmíněný PATCH, plná obnova a explicitní konflikt jsou pokryté lokálně. Web/native callbacky a browser/mock acceptance rozlišují výskyt a sérii. Series, Graph native writer a živá reminder/OS acceptance zůstávají otevřené. Úzký CalDAV one-off alarm writer je samostatně popsaný níže. [Instance kontrakt](../sync/google-instance-reminders.md). Musubi reminder plánování je oddělené. [Kontrakt](../sync/provider-event-state.md#gated-personal-google-reminder-editor) |

## Implementace bez čekání na vlastníka

Pořadí dalších řezů je orientační; nový konkrétní nález může mít přednost. Každý
řez projde stejným postupem: implementace, relevantní regrese, nezávislé review,
opravy a zelené CI před squash mergem. Žádný níže uvedený bod se nepovažuje za
hotový pouze tím, že má bezpečný unsupported guard.

1. **Graph recurring create a echo.** Ověřit native master čas a identitu,
   stable create operation, obnovu po ztracené odpovědi a import bez součtu
   lokálního masteru s provider-expanded instancemi. Vyřešit reset/posun okna,
   vzdálené výjimky a cancellation před povolením create. UPDATE/DELETE nadále
   neodvozovat z `changeKey` ani z úspěšného běžného PATCH.
2. **CalDAV scope konflikty a další reprezentovatelné editace.** Rozšířit
   explicitní fresh preview/confirm pro další implementované scope operace;
   zachovat celý resource, identity, permission evidence a trvalé kroky splitu.
   Odstranění RRULE, změna typu/zóny nebo dated additions/exclusions vyžadují
   samostatný přesný plán, zvlášť pokud existují výjimky.
3. **K13 další meeting operace.** Doplnit podporované native RSVP/organizer
   kontrakty, jejich privátní záměry, obnovu, explicitní notification policy a
   klientské callery. Fake servery ověřují lokální implementaci; reálné
   organizer-visible doručení zůstává samostatnou acceptance.
4. **K14 reminders a privacy.** Doplnit další prokazatelné native reminder
   operace, dostupnost bez detailů a privacy downgrade/regain bez úniku starého
   obsahu. Neodvozovat vlastní odpověď nebo write oprávnění pouze z vlastnictví
   kalendáře. Nezavádět dvojí plánování stejné připomínky.
5. **K15 průběžná evidence.** Aktualizovat tento přehled po změně skutečného
   podporovaného rozsahu. U každé závěrečné kontroly rozlišit unit/HTTP/DB,
   browser/mock native, fyzické zařízení a živého providera.

## Na konec: vstup nebo rozhodnutí vlastníka

Tyto body neblokují výše uvedenou lokální implementaci. Přihlašovací údaje patří
pouze do lokálního připojení, nikdy do chatu, repozitáře nebo testovacích logů.

| Potřeba | Proč ji nelze nahradit lokální regresí |
| --- | --- |
| Outlook vývojové OAuth připojení a vyhrazené testovací kalendáře | Živé round-trip ověření a skutečný event conditional-write kontrakt; `changeKey` ani podobnost Graph API s jiným providerem nejsou CAS důkaz. |
| Dvě oddělené testovací identity a konkrétní schválené invite/RSVP scénáře | Ověřit odpověď viditelnou organizátorovi, změnu a cancellation bez duplicitních pozvánek. Běžné připojení osobního účtu samo tento test nedokazuje. |
| iCloud resource permission kontrakt | Tři standardní DAV dotazy neposkytly positive resource write privilege. Připojení je dostupné, ale zpřístupnění scope writeru vyžaduje důvěryhodný mechanismus nebo výslovně schválený jiný kontrakt. [Živá evidence](calendar-icloud-series-live-acceptance.md#follow-up-three-standard-dav-privilege-queries) |
| Fyzické native/OS a notification QA | Mockované callbacky a Chromium nejsou důkaz chování telefonu, OS oprávnění, klávesnice ani skutečných oznámení. |
| Release, minimální klientské verze a produkční aktivace | Samostatné rozhodnutí až po odpovídající acceptance. Dosavadní práce nemění verze/minima 0.1.8 ani nezapíná produkční time/reminder/RSVP flagy. |

Google whole-series nyní **nevyžaduje opakování otázky**: vlastník již rozhodl
zachovat obsah výjimek a tuto operaci nepodporovat. Nový návrh má smysl pouze s
prokázanou ochranou celé family nebo novým výslovně schváleným produktovým
kontraktem. [Rozhodnutí a reprodukce souběhu](calendar-google-series-live-acceptance.md#follow-up-exception-concurrency-and-product-decision).
