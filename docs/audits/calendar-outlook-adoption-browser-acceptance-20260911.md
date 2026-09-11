# Outlook changed-create adoption — živá acceptance 2026-09-11

Podporovaná osobní all-day COUNT=3 série prošla skutečným Musubi vytvořením,
řízenou ztrátou odpovědi nad živým Graph, explicitním Use provider version,
stabilní synchronizací a úklidem. Samostatná varianta prosté změny názvu přes
nativní Outlook editor **neprošla**: provider přitom změnil i časová metadata,
která přísný kontrakt odmítá. Pozitivní výsledek níže následoval až po výslovné
QA normalizaci těchto metadat; nepřebírá tuto nativní UI variantu.

## Vstup a řízená nejistota

Vlastní osobní Outlook kalendář, žádní hosté, místo, URL ani poznámky.
Quick form → More options; skutečné datumové ovladače nastavily 1. října
2026 jako začátek i inkluzivní konec. Time model byl výslovně All-day dates;
Custom recurrence nastavilo Day, interval 1, After 3 a skutečné home radio
vybralo Outlook. Uložení proběhlo přes Create, bez URL úpravy nebo přímé API
admission. Musubi zobrazilo výskyty 1.–3. října.

Periodický scheduler byl vypnutý. Jednorázový untracked helper ověřil přesný
UI receipt, vlastní účet, source, payload, pending/attempts=0 a absenci mapování
a dětí. Soukromý snapshot zachytil původní záměr před spuštěním standardního
workeru. Wrapper připustil jediný POST přesně zmrazeného body; skutečný Graph
vrátil HTTP 201. Helper spotřeboval odpověď, nasimuloval transportní ztrátu
a odmítl následující okamžitý GET jen v této invokaci. Běžný worker zaznamenal
unconfirmed, attempts=1, attempted marker a žádnou result reference.

Jde o **řízenou ztrátu odpovědi nad živým providerem**, nikoliv přirozený
providerový výpadek. Journal nebyl ručně vytvořený ani upravovaný.

## Nativní UI varianta: bezpečné odmítnutí

Outlook zobrazil tři celodenní výskyty. Přes Upravit → Všechny události v řadě
byl změněn pouze textbox názvu, přidáním přípony `adopted`, a stisknuto Uložit.
Následná čtecí diagnostika našla jednu původní transaction a správný nový název,
prázdný obsah, žádné hosty, výjimky ani cancellations. Zároveň však nativní
master měl exkluzivní konec **3. října místo 2. října** a recurrenceTimeZone
**Central European Standard Time**. Start i originalStart/EndTimeZone zůstaly
UTC. Přesný mechanismus této vedlejší změny v Outlook editoru test neurčuje.

`graphMasterTimeFromUtc` tuto all-day variantu správně odmítl. Skutečné Review
changes / Load comparison dostalo HTTP 409 provider-conflict. Žádná adoption
neproběhla a celý původní receipt se nezměnil. Produkční parser ani podmínky
převzetí nebyly kvůli tomuto výsledku rozšířené.

Tento krok odhalil opravenou chybu hlášení: HTTP klient dekóduje odpověď s
`error`, `code`, `localCommitted` jako EventMutationError, zatímco dialog
rozpoznával jen ApiError. Serverové odmítnutí proto chybně ukazoval jako síťový
výpadek. Dialog nyní rozpozná doménovou chybu; provider-conflict odstraní staré
porovnání a vyžádá nové. Ostatní doménové zprávy zachová. Živé opakování po
opravě ukázalo správné bezpečné odmítnutí místo Could not reach the server.

## Oddělená podporovaná fixture a pozitivní převzetí

Kontrolovaný QA PATCH upravil pouze tuto přesnou vlastní sérii: obnovil
exkluzivní konec 2. října UTC a původní daily COUNT=3 s explicitním range UTC.
Nový název zachoval. Před zápisem proběhl unique-transaction lookup, čerstvý
exact-master read a kontrola přesného pozorovaného stavu bez účastníků a výjimek.
Soukromý exclusive attempt marker zakázal replay i po ztrátě odpovědi. Jeden
PATCH vrátil 200; následný strict candidate a complete-family proof prošly.
Nešlo o nový produktový writer ani tvrzení Graph CAS. Původní journal zůstal
beze změny a nebyl spuštěný sync ani retry.

Skutečné Load comparison pak ukázalo původní a změněný název, shodné datumové
hranice a ekvivalentní COUNT=3. **Use provider version** přijalo pozorovanou
rodinu. Musubi zobrazilo všechny tři nové názvy; series delivery správně uvedlo
Provider version accepted in Musubi a zachování původního požadavku v historii.

Readback doložil jeden master, tři děti, čtyři unikátní mapy a jediný receipt
`not-needed` / `adopted-provider-version`, attempts=1, s legitimním adoption
markerem. Původní event i native-create payload, revision a identity souhlasily
se snapshotem; jediný přípustný přídavek do payloadu byl validovaný adoption
marker. Celá rodina i receipt byly stabilní po standardním sync. Samotný proof
provedl nula Graph zápisů. UI adoption běžela v API procesu mimo tento observer;
absence provider write v této akci je kontrakt implementace a lokálních regresí,
nikoliv celoživotní HTTP měření tohoto helperu. Native title edit a výslovný QA
normalizační PATCH jsou samostatné zápisy popsané výše.

## Úklid a ověření opravy

Nativní Outlook Odstranit → Všechny události v řadě s potvrzením odstranilo
pouze testovací osobní sérii. Přesný master lookup následně vrátil absenci.
Standardní sync bez resetu cursoru zanechal nula aktivních fixture řádků,
čtyři tombstones, čtyři mapy a jeden převzatý receipt s původním záměrem.

Dvě regrese skutečného HTTP error envelope (preview a resolve) selhaly před
opravou dialogu a prošly po ní; všech 27 testů dialogu, web typecheck a lint
změněných souborů prošly. Nezávislé review opravy nenašlo připomínky.

Pozitivní důkaz je omezený na normalizovanou osobní all-day plain COUNT=3 family
se změnou názvu. Neprokazuje obecnou nativní UI editaci, zoned/time/recurrence
adoption, exceptions/cancellations, sdílené kalendáře, fyzická zařízení ani
produkční aktivaci. QA helper a soukromé identifikátory nejsou součástí commitu.
