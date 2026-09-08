# Calendar core: checkpoint 2026-09-07

Práce se na žádost vlastníka zastavuje po PR #132. Toto je review dosaženého stavu a důkazů, nikoli nový plošný audit všech zdrojů. Navazuje na [implementační plán](calendar-core-implementation-plan.md).

## Závěr

K01–K09 jsou převzaté. Bezpečnost lokálních změn, trvalé doručování, obnova po selhání a pravdivé stavy na obou klientech mají implementaci a regresní důkazy. Celý core ani release ještě neuzavírat: K10 není napojený end-to-end, K11–K14 zůstávají otevřené a živá kompatibilita K15 není prokázaná. Milník M1 vyžaduje kromě K01–K09 také odpovídající K15, takže zelené CI samo M1 release neuzavírá.

## Stav proti plánu

| Oblast | Stav a praktický význam |
| --- | --- |
| K01–K06 | Převzaté: autorita originálu, úplnost importních cest, oddělení Tasks, bezpečné odmítnutí nepodporovaných zápisů, zachování draftu, revize a nedestruktivní patch. |
| K07–K08 | Převzaté: mutace a záměr v jedné DB transakci, worker s lease/pořadím/retry, recovery nejasných zápisů, pull konflikty a disconnect cleanup. |
| K09 | Převzaté: web i mobil rozlišují lokální uložení a stav každého vzdáleného cíle; dohledatelné nedokončené smazání, retry, explicitní porovnání a řešení konfliktu. |
| K10 | Částečně: kontrakt, nullable storage a přesné převody času. Chybí sdílená expanze s novými metadaty, napojení DTO/callerů/writerů a bezpečné doplnění metadat. |
| K11–K12 | Otevřené: věrné providerové výjimky a atomické operace occurrence/following/series. |
| K13–K14 | Otevřené: skutečné providerové meetingy/RSVP a úplná sémantika reminders/free-busy/soukromí. |
| K15 | Automatizované podklady průběžně existují; živá matice Google/Outlook/iCloud/CalDAV a release gate zůstávají otevřené. |

## Poslední ověřené řezy

- [PR #129](https://github.com/frgtn-dot-dev/musubi/pull/129), squash `39e0dca`: uzavření K09 v nativním klientu. Root check, 199 native testů a 14 CI kontrol. Review opravilo polling starvation a souběh stránkování s obnovou.
- [PR #130](https://github.com/frgtn-dot-dev/musubi/pull/130), squash `5cc7a08`: konkrétní K10 kontrakt a návrh schématu. Root check, kontrakt ve třech host TZ a 14 CI kontrol; čisté review.
- [PR #131](https://github.com/frgtn-dot-dev/musubi/pull/131), squash `207372d`: migrace0063 a oprava fork projekce. Root check, celá DB sada, skutečný seeded upgrade0062→0063 a 14 CI kontrol. Finální čisté review zahrnuje deterministickou opravu flaky30ms deadline testu.
- [PR #132](https://github.com/frgtn-dot-dev/musubi/pull/132): přesné převody přes Temporal a původní civilní start/konec zoned modelu. Root check, type/storage testy, frozen install a Android Metro/Hermes export. Nezávislý reviewer zopakoval šest testovacích běhů: převody a kontrakt v UTC, Europe/Prague a America/New_York. Implementační head `0916a3d` měl všech 14 kontrol zelených; finální merge/CI záznam je v PR.

Každé uvedené PR dostalo samostatné review agentem s čistým kontextem. Nálezy se opravovaly a finální změny se vracely k ověření. To je evidence pro konkrétní diff, nikoli záruka absence všech chyb v produktu.

## Hlavní zbývající rizika

1. **Čas a opakování nejsou ještě vyřešené v produktu.** Dosavadní `packages/calendar/src/recurrence.ts` dál expanduje časované série v lokálním/viewer rámci. Nové přesné helpery na to zatím nejsou napojené. Průchod DST helper testů tedy není důkaz stejného výskytu ve všech klientech.
2. **Samotná metadata neřeší výjimky.** Provider rehydration, původní identita přesunutých/cancelled výskytů a náhrada generovaného výskytu musejí projít jedním modelem. CalDAV navíc potřebuje komponentové mapování více VEVENTů sdílejících resource. Před napojením writerů vynutit i JSON validaci, ownership, zákaz vnořených výjimek a konzistenci času.
3. **Bezpečné odmítnutí stále omezuje podporu.** Zákazy K04, včetně nepodporovaných Graph update/delete cest, se nesmějí zaměňovat za implementovanou providerovou paritu ani hromadně odstranit. Odemykat je až po odpovídajících K11–K13 důkazech.
4. **Chybí živé a fyzické ověření.** Fake provider HTTP, DB, browser a native callback testy nenahrazují round-trip proti skutečným providerům. Android export ověřuje bundling, nikoli spuštění a přístupnost na fyzickém telefonu. Živé účty nebyly použity a produkční migrace/deploy neproběhly.
5. **Rollback musí respektovat outbox.** Návrat ke starému bináru bez durable záměrů není bezpečný rollback; potřebuje kompatibilní postup podle plánu. Lokální testovací migrace není produkční rollout důkaz.

## Doporučené pokračování

Nejprve dokončit jeden end-to-end K10 řez: společná expanze, COUNT/UNTIL přes DST, EXDATE/RDATE, přesunuté/cancelled výjimky, stabilní identita a explicitní zóna všech callerů včetně reminders/widgetů. Až potom zapojit známá metadata do autorizovaných zápisů a providerového doplnění, bez echo zápisů a bez přepsání novějšího draftu. Zachovat starý kompatibilní stav tam, kde zóna není doložená.

Před prohlášením M1 za release-ready doplnit vyhrazené testovací účty/instanci pro K15 a zaznamenat živé read/write/preserve/unsupported výsledky. Další implementace je teď pozastavená; nezačíná automaticky další PR.
