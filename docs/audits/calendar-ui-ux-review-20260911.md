# Musubi — kritická kontrola UI/UX, 11. 9. 2026

## Závěr

Musubi nepotřebuje nový vizuální styl. Největší slabina je hierarchie informací a akcí v rozšířených formulářích a providerových funkcích. Důležité rozhodnutí je někdy schované pod vysvětlením; vedle sebe naopak dostávají stejnou váhu běžné, pokročilé a servisní činnosti. Řešením je lepší pořadí, postupné odhalování detailů a důsledná aplikace stávajících pravidel komponent.

Toto je audit a návrh pořadí oprav, nikoli záznam dokončené implementace. Žádný níže uvedený návrh tímto není automaticky schváleným novým produkčním vzorem.

## Rozsah a důkazy

- Živý localhost v QA worktree `/tmp/musubi-live-browser-20260910`; kontrolován aktuální pracovní stav s implementací PR #284. Nejde o ověření nasazené produkce.
- V prohlížeči: měsíc, týden, agenda, prázdné úkoly, detail importované události, rychlé vytvoření, plný editor, Connections, Calendars, Settings/Appearance a Reminders, úvodní stav vyhledávání.
- Desktop 1280 × 720 v tmavém i světlém vzhledu; plný editor navíc 1000 × 800 a 768 × 1024; 390 × 844 ověřilo telefonní vstupní bránu.
- Světlý vzhled byl emulován a emulace následně odstraněna. Prázdný rozepsaný editor byl zrušen. Nevytvářely se události ani se neměnila nastavení účtů.
- Nezávislý agent prošel komponenty a CSS se zaměřením na kompozici, copy, rozestupy a rozměry. Kódové nálezy jsou níže oddělené od pozorování v prohlížeči.
- Neproběhl audit nativní aplikace, měření kontrastu, úplný průchod čtečkou obrazovky ani kompletní klávesnicová certifikace. Telefonní gate neumožňuje vydávat desktopovou emulaci za test mobilního formuláře.
- Screenshoty byly během kontroly prohlédnuty, nejsou součástí tohoto dokumentu. Rozměry uvedené jako měření pocházejí z DOM, ostatní popisy z vizuální kontroly.

Priority: **P1** výrazně zhoršuje běžný úkol nebo pochopení stavu; **P2** zbytečná zátěž či nekonzistence; **P3** drobné doladění. Nejde o hodnocení závažnosti backendových chyb.

## Nálezy a konkrétní návrhy

### UX01 — P1: detail události upřednostňuje servisní informace

**Ověřeno v prohlížeči.** U importované Outlook události je hned pod názvem `Delivery details`, teprve potom datum a čas. Dlouhý text importované pozvánky zabere více než jednu obrazovku; providerové informace a připomínka jsou pod ním. K jejich přečtení bylo nutné opakovaně scrollovat. Patka obsahuje čtyři téměř stejně výrazné akce `Edit`, `Link`, `Copy`, `Delete`.

**Návrh pořadí:** název → datum/čas → místo nebo jednoznačná akce připojení → relevantní účast a stav → krátký náhled poznámky → rozbalitelné podrobnosti. Úspěšné technické doručení patří do podrobností; nevyřešená změna má naopak dostat viditelný stručný stav s konkrétní akcí.

Poznámku zkrátit pouze vizuálně na několik řádků s `Show more`; nikdy neodstraňovat původní text. Primární akci zvolit podle možností události. `Link` pojmenovat podle skutečné operace, například `Copy link`, pouze pokud ji opravdu provádí. Méně časté akce přesunout do stávajícího menu; zachovat dostupnost klávesnicí a ochrany destruktivních operací.

**Přijetí:** datum, čas a hlavní akce viditelné při otevření i s dlouhou poznámkou; plný obsah dostupný; nevyřešené doručení není skryté; návrat focusu funguje. Zdroj: `apps/web/src/calendar/components/EventDetailsPopover.tsx`, `styles/event-details.module.css`.

### UX02 — P1: providerový blok je technický odstavec místo přehledu

**Ověřeno v prohlížeči.** Jeden blok obsahuje organizátora, roli, odpověď, účastníky, připomínky, dostupnost, soukromí, stav i typ události. Zobrazuje hodnoty `tentativelyAccepted` a `singleInstance`, opakuje adresy a přidává dlouhé upozornění na oznámení z více aplikací.

**Návrh:** nejdříve krátký lidský stav (`Your response: Maybe`), potom samostatné řádky organizátora a účastníků. Vzácné technické údaje pod `Provider details`. Mapovat známé enumy na srozumitelné názvy, u neznámých zachovat poctivý fallback. Rozlišit připomínku Musubi a providera dvěma pojmenovanými řádky, ne opakovaným obecným disclaimerem. Vysvětlení dvojího upozornění zobrazit tam, kde je pro rozhodnutí relevantní.

**Přijetí:** žádné známé camelCase enumy v běžném zobrazení; odpověď a organizátor dohledatelné pohledem; identita nejednoznačných účastníků se neztratí; zjednodušení nesmí zaměnit lokální a potvrzený providerový stav. Zdroj: `ProviderEventDetails.tsx:63`, `styles/event-details.module.css:177`.

### UX03 — P1: plný editor má špatně rozdělenou prioritu a místo

**Ověřeno v prohlížeči.** Tři silně oddělené panely dávají stejnou váhu času, obsahu a vícekalendářovému nastavení. Nad datem je `Time model` s dlouhým vysvětlením. All-day se objevuje v časovém modelu i jako samostatný checkbox. Popis `Every detail of the event, on one surface.` neposkytuje žádnou pomoc.

Při šířce 1000 px zůstávají tři sloupce, seznam kalendářů drží přibližně 320 px a časový formulář je stlačený. Naměřeno: běžná pole 44 px / text 14 px, časová pole 38 px / text 12 px. Rozdíl může být legitimní kompaktní varianta, ale zde nejsou vedle sebe ve stejně hustém kontextu.

**Návrh:** běžná cesta název → datum/čas → cílový kalendář → místo/poznámka. Pokročilé časové režimy explicitně dostupné ve vedlejší části, bez předstírání zóny u neznámého času. Kalendář nejprve jako kompaktní výběr a souhrn; další projekce až po rozbalení. Na střední šířce nejvýše dva sloupce, obsahově přirozený přechod na jeden. Oddělovat sekce mezerou, nikoli každé pole linkou.

**Přijetí:** z názvu/date/time/calendar lze pochopit běžné vytvoření bez čtení vysvětlujících odstavců; jediný srozumitelný vstup pro all-day; zachované významy floating/unknown/zoned a kalendářových projekcí. Zdroj: `EventEditorForm.tsx`, `styles/event-editor.module.css:584`, `:750`, route `app/p.$pageId.$view.event.new.tsx:71`.

### UX04 — P1: tabletový editor odsune potvrzení daleko pod obrazovku

**Ověřeno a změřeno.** V editoru 768 × 1024 je `Create` na souřadnici y ≈ 1695–1739. Uživatel k němu může doscrollovat; tlačítko není nedostupné, ale proti desktopu není průběžně vidět.

**Návrh:** sdílený shell s viditelnou patkou a scrollujícím tělem. Patka nesmí zakrývat poslední pole, chyby, focus ani obsah při otevřené klávesnici. Neřešit lokálním absolutním umístěním tlačítka v doménové komponentě.

**Přijetí:** na 768 × 1024 hlavní akce dostupná bez projití celého formuláře; poslední pole a validace dosažitelné; při zvětšení textu nevznikne horizontální scroll.

### UX05 — P2: Connections míchá příliš mnoho různých úkolů

**Ověřeno v prohlížeči.** Vlevo účty, refresh přes celou šířku panelu, Google availability a uložené změny. Vpravo nejprve připojení sdíleného kalendáře, teprve pod ním připojení účtu. Dlouhé vysvětlení a vypnuté tlačítko availability přitahují pozornost i bez možnosti akci provést.

**Návrh:** připojené účty s kompaktním `Refresh` u nadpisu; jasná sekce `Add connection`; připojení sdíleného kalendáře jako vedlejší cesta. Providerově specifické možnosti u příslušného účtu. Nevyřešené změny zobrazit jako stručný stav s `Review`, nikoli další trvalou vysvětlující sekci. Vysvětlení oprávnění ponechat přímo u volby, které se týká.

**Kód doplňuje:** levý grid má původní definici dvou řádků, pozdější sekce tvoří implicitní řádky; copy `on the right` nevydrží složený layout. Providerová tlačítka mají 52 px proti běžnému 44 px — ověřit, zda je rozdíl zamýšlený, ne slepě sjednotit loga.

**Přijetí:** připojení účtu čitelné jako hlavní cesta; jednotné vnitřní osy; žádné prostorově závislé instrukce. Zdroj: `ConnectionsDialog.tsx:359`, `:371`, `styles/connections.module.css:47`, `:252`.

### UX06 — P2: Calendars věnuje příliš místa příležitostným operacím

**Ověřeno v prohlížeči.** Pravý panel stále ukazuje přesun, export a import, zatímco seznam kalendářů potřebuje vlastní scroll. V dialogu vznikají dva vnitřní scrollující panely. Řádky mají několik samotných ikon včetně `Stop syncing`; přístupné názvy existují, vizuální význam ale není stejně zřejmý.

**Návrh:** hlavní plocha pro seznam a běžnou správu. Import/export jako explicitní sekundární akce otevírající příslušný formulář. `Stop syncing` do menu kalendáře, nepřidávat další univerzální row shell. Zachovat existující jasné providerové skupiny.

**Přijetí:** běžná správa nepotřebuje číst import/export; jasný scroll owner; méně často používané operace zůstávají dohledatelné klávesnicí.

### UX07 — P2: upozornění na rozsah Outlooku nemá konkrétní další krok

**Ověřeno v prohlížeči.** Měsíc, týden i agenda trvale zobrazují `Outlook sync covers a limited date range. Older and far-future events may not be loaded.` Text neříká konkrétní rozsah ani co má uživatel udělat.

**Návrh:** dostupný rozsah zpřístupnit u stavu synchronizace. Výrazný banner použít při skutečně dotčeném zobrazení nebo neznámém pokrytí; nabídnout dostupnou další akci. Rozhodnutí musí vycházet z reálných coverage dat, nikoli z kosmetického skrytí varování.

**Přijetí:** uživatel rozliší „žádné události“ a „tento rozsah nemáme“; aplikace netvrdí úplnost bez důkazu. Kratší copy samo o sobě tuto podmínku nesplňuje.

### UX08 — P2: prázdné úkoly vybízejí k akci bez lokálního tlačítka

**Ověřeno v prohlížeči.** `No tasks yet` a `Add a task for one of the calendars on this Page.` bez tlačítka u výzvy. Existuje globální plus, ale uživatel musí propojit dvě oddělené části obrazovky.

**Návrh:** použít existující empty-state komponentu s `Add task`, pokud existuje zapisovatelný cíl; jinak nabídnout skutečný další krok pro jeho zajištění. Nadpis a jedna akce zpravidla stačí, neopakovat instrukci v odstavci.

**Přijetí:** klik otevře správný task flow, respektuje práva/offline stav a focus. Zdroj: `TaskList.tsx:270`.

### UX09 — P2: navigace při 720 px výšce skrývá základní správu

**Ověřeno v prohlížeči.** Už s jedinou Page se `Settings` částečně schová pod spodní pevnou část sidebaru; po scrollu se naopak odřízne vršek mini-kalendáře. Funkce je dosažitelná, ale stále přítomná velká horní část zvyšuje hledání.

**Návrh:** rozhodnout výškový rozpočet sidebaru: stabilní správa a účet, scroll primárně pro Pages; mini-kalendář adaptovat na malou výšku, případně umožnit jeho složení stávajícím vzorem. Nezmenšovat všechny hit targety kvůli několika řádkům.

**Přijetí:** na 1280 × 720 jsou hlavní management akce vidět; větší počet Pages má předvídatelný scroll a focus se nezakryje.

### UX10 — P2: delivery řádky potřebují oddělit stav, metadata a akce

**Kódový nález; problematický stav nebyl v tomto průchodu reprodukován v prohlížeči.** `EventDeliveryDialog.tsx:210–264` skládá stav, vysvětlení, časy a upozornění do drobného detailu vedle akcí. Sdílená trailing oblast (`ui/primitives.module.css:1164`) má nesmršťující se grid bez explicitního gapu. Dlouhá akce typu `Discard saved alarm change` může výrazně omezit prostor textu.

**Návrh:** cíl + krátký stav na první řádek, důvod níže, čas jako klidná metadata; akce ve vlastní skupině s tokenovým gapem a přechodem do sloupce. Před opravou vykreslit reprezentativní stavy ve Storybooku. Změnu shared primitive posoudit i na dalších konzumentech.

**Přijetí:** dlouhé názvy a konflikt se čtou bez stlačeného odstavce; retry/ownership/discard význam zůstává přesný. Žádné zkrácení nesmí tvrdit úspěch při neznámém výsledku.

## Co zachovat

- Washi/sumi barevnost, serifové nadpisy a současnou identitu Musubi.
- Klidné opakované řádky a osy Settings; dobrý referenční vzor pro nové core funkce.
- Rychlé vytvoření: krátká cesta, jasné `More options` versus `Create`.
- Základní mřížku měsíce/týdne a skenovatelnou agendu. Nezaměňovat potřebnou informační hustotu kalendáře za příliš malé formulářové ovládání.
- Search má jasný vstup a opakované akce; úvodní stav funguje. Výsledky hledání a plný průchod search flow tento audit necertifikuje.

## Pravidla pro implementaci

Použít existující tokeny a primitives, nikoli založit novou souběžnou stupnici:

| Vztah | Stávající rytmus |
| --- | --- |
| Těsně související informace | 4 px |
| Label → control; související prvky | 8 px |
| Skupina ovládání | 12 px |
| Vnitřní inset | 16 px |
| Pole formuláře | 20 px |
| Vrstvy | 24 px |
| Sekce | 32 px |

Čísla jsou vysvětlení současných rolí, ne pobídka k hardcodování. Default control 44 px desktop / 48 px touch; compact 38 px desktop a nejméně 44 px touch. Menší varianta má vycházet z hustoty kontextu. Sjednotit osu header/body/footer ve sdíleném shellu. Dělicí linky používat pro skutečné regiony a opakované řádky, ne jako náhradu všech mezer. Jedna nejsilnější akce v každé funkční skupině.

V kódu editoru jsou lokální breakpointy 900/1000 oproti dokumentované ladder 599/1023/1439. Posoudit je podle obsahu a sjednotit, kde nejde o zdůvodněnou výjimku. Samotná odlišná hodnota není automaticky chyba.

Kódové malé weekday/home controls potřebují následné touch ověření. Na 390 × 844 ale nyní aplikace místo formuláře zobrazuje Android download gate bez pokračování do webu. To je samostatný produktový kontrakt; audit jej neobchází a netvrdí, že zde otestoval mobilní UI. Přenos pravidel do nativní aplikace vyžaduje její vlastní kontrolu.

## Doporučené balíky práce

1. **Čitelnost a přímé akce:** mapování providerových názvů, odstranění prázdné editorové věty, task empty-state akce, copy bez `on the right`. Ověřit dlouhé texty, oprávnění a stávající layout; nepřepisovat celé obrazovky.
2. **Detail a delivery:** jeden Storybook návrh informační hierarchie s dlouhou pozvánkou, běžným stavem a konfliktem. Po odsouhlasení vzoru implementovat detail + recovery kompozici společně, s nezávislým review významu stavů.
3. **Editor a tablet:** Storybook varianta zjednodušené kompozice a společná práce na scroll shellu, kalendářovém souhrnu a časových režimech. Kontrola 1280/1024/768, dlouhých labelů, focusu a validace.
4. **Správa a navigace:** Connections + Calendars + výškový rozpočet sidebaru. Coverage banner řešit s reálnými coverage daty, ne pouze CSS.

U každého balíku jeden ucelený průchod kontrolami a nezávislé review; ne kompletní CI po každé změně mezery. Pro významné nové kompozice nejprve Storybook dle `.agents/skills/musubi-ui/SKILL.md`, potom produkční migrace. Zachovat klávesnici, návrat focusu, oba motivy, reduced motion a pravdivost providerových stavů. Tento audit sám nemění core akceptační výsledky ani nezapíná providerové schopnosti.

## Navazující implementace a opakovaná vizuální kontrola

Po integraci panelu uživatel odmítl jeho vizuální dotažení; samotné funkční testy
nezachytily chyby kompozice. Merge PR #285 byl pozastaven a následoval průchod
skutečnou aplikací i izolovanými reprezentativními stavy.

Opravené příčiny:

- rozdílné osy a dvojité odsazení v detailu; kalendář patří k identitě události;
- providerové značky větší než slot kompaktního řádku; zavedena sdílená varianta;
- nalepené providerové akce a nečitelné recovery řádky na malém okně;
- event editor s předřazeným pokročilým časovým nastavením a různými osami polí;
- úkol s rozdělenými datum/čas páry, neostylovaným TimePickerem a chybějícími
  vazbami mezi Field a vnořenými pickery;
- prázdný stav h2 mimo sdílenou typografii a chybějící akce vytvoření úkolu;
- roztahované hlavičky skupin Calendars, rozměrové tokeny použité jako pozadí;
- navigace správy skrytá společně se scrollujícími Pages;
- plný nový event na tabletu s potvrzením až pod dlouhým formulářem.

Vizuálně prohlédnuto: Month, Week, Day, Agenda, Tasks, detail, quick create,
rozšířený event editor, task editor, Page settings, Connections, Calendars,
všechny sekce Settings, search a onboarding. Přihlášené providerové stavy byly
prohlédnuty v živém localhostu; dlouhé a chybové kombinace i menší viewporty
používaly existující izolované testovací fixtures. Jde o webovou kontrolu, nikoli
certifikaci nativní aplikace nebo vyčerpávající audit všech kombinací dat.

Budoucí změny musí splnit konkrétní kompoziční kontrakty v části 11 dokumentu
`docs/ui/design-system.md`. Výchozí nálezy výše zůstávají historií původního stavu;
nejde o tvrzení, že každá dříve navržená produktová přestavba byla implementována.
