# Kalendářové UI/UX — pravidla a plán polishe

- Stav: living document
- Datum: 2026-07-27
- Zdroj principů: `store/UI-UX/` (playbook, spec, studie Google Calendar)
- Platí pro: `apps/web` primárně, `apps/client` kde to má smysl

Studie Google Calendar je **referenční úroveň disciplíny, ne vizuální předloha**.
Kopírujeme způsob skládání vrstev a míru závaznosti akcí. Nekopírujeme paletu,
ikony, typografii ani microcopy — Musubi má vlastní identitu (sumi tonalita,
Inter Tight + Noto Serif, kanji akcenty, pigmenty dune/moss/ochre/indigo) a
vlastní doménový koncept **Pages**, který referenční produkt nemá.

## 1. Jak rozhodovat, když si pravidla odporují

V tomto pořadí, vždy:

1. časová a datová korektnost,
2. přístupnost a vratnost akcí,
3. kontinuita kontextu,
4. srozumitelnost interakce,
5. výkon,
6. vizuální polish.

Vizuální polish je **poslední**. Nikdy neposouvej pixely, když ještě není
deterministická geometrie času nebo chybí rollback mutace.

## 2. Domácí pravidla

**R1 — Kalendář je prostorový editor času, ne tabulka.** Datum = poloha, čas =
vertikální poloha, délka = velikost, souběh = uspořádání. Když se s časem nedá
manipulovat přímo, je to prohlížeč s formuláři.

**R2 — Stálá orientace.** Uživatel vždy vidí aktivní rozsah, pohled, cestu na
dnešek, prev/next a Create. Běžná akce nesmí bezdůvodně změnit datum, pohled,
scroll ani aktivní objekt.

**R3 — Vrstva odpovídá závaznosti.** Lehká akce nesmí otevřít těžkou vrstvu:

| Vrstva | Otázka | Závaznost | V Musubi |
|---|---|---|---|
| Slot / buňka | Kdy? | velmi nízká | selection v gridu |
| Quick create | Co a kdy? | nízká | `QuickCreate` popover |
| Preview | Co to je, co teď můžu? | nízká–střední | `EventDetailsPopover` |
| Full editor | Jak se to má přesně chovat? | vysoká | `EventEditorForm` |
| Dialog dopadu | Koho/co to ovlivní? | velmi vysoká | recurrence scope, nevratné |

**R4 — Lokální akce má lokální reakci.** Klik na slot otevře vrstvu u slotu, ne
uprostřed obrazovky. Validace u pole, které ji způsobilo. Drag ukazuje čas u
taženého objektu.

**R5 — Dvě rychlosti, bez ztráty draftu.** Quick create ↔ full editor si předají
všechno rozpracované. Editor nikdy nezakládá nový prázdný draft.

**R6 — Vratné akce mají Undo, ne dialog.** Dialog jen pro: nevratné, externí
dopad, rozsah série, konflikt oprávnění. `window.confirm` není cílový stav —
je to placeholder.

**R7 — Jedna geometrie času.** Grid, event layout, selection, hit-testing a drag
musí číst stejné hodnoty (`pxPerMinute`, `snapMinutes`, `minEventHeight`,
`visibleDayStart/End`). Dvě různé matematiky = kurzor „ujíždí" oproti času.

**R8 — Optimisticky, s rollbackem.** Mutace se projeví okamžitě, chyba vrátí
stav a **řekne to lidsky**: co selhalo, proč, co dělat, že byl stav obnoven.

**R9 — Barva nikdy nenese význam sama.** Vždy doplněná textem, ikonou nebo
borderem. Platí pro kalendáře, stavy i typy.

**R10 — Přístupnost je architektura, ne dodatek.** Focus-visible, návrat focusu
na spouštěč, klávesnicová cesta k core workflow, screen-reader názvy. Drag musí
mít klávesnicovou alternativu.

**R11 — Stav je vidět.** Každý interaktivní prvek: default, hover, focus-visible,
pressed, selected, dragging, resizing, pending, disabled, error.

**R12 — Mobil/narrow se adaptuje, nezmenšuje.** Pod 600 px popover → sheet,
permanentní zóny → vrstvy. Zachovej v tomto pořadí: rozsah → Today/navigace →
event content → Create → přepnutí pohledu.

## 3. Tokeny a geometrie

Náhodné hodnoty v komponentách jsou zakázané. Spacing jen z škály
`4 / 8 / 12 / 16 / 24 / 32`.

Dnes v `design/tokens.css` je 47 tokenů (surfaces, borders, text, accent,
pigmenty, radius, `--sidebar-width`, `--toolbar-height`, motion fast/standard).
Chybí a musí přijít:

| Token | Doporučení | Poznámka |
|---|---|---|
| `--space-1..8` | 4/8/12/16/24/32 | žádné ad-hoc mezery |
| `--hour-height` | 48–72 px | **řízeno density**, dnes hardcoded `HOUR_HEIGHT = 64` v `TimeGridView.tsx` |
| `--date-header-height` | 40–52 px | sticky v day/week |
| `--event-radius` | 4–8 px | menší v husté mřížce |
| `--focus-ring` | 2 px solid accent | nesmí kolidovat s event borderem |
| `--popover-width` | 320–420 px | collision-aware, max-height + vnitřní scroll |
| `--motion-slow` | ~260 ms | máme jen fast/standard |

Vizuální hierarchie: mřížka nízký kontrast → **eventy dominantní**; dnešek
zvýrazněný bez zabarvení celého sloupce; now indicator jediný svého typu;
destruktivní barva jen kontextově.

## 4. Interakční stavový automat (cíl)

```text
idle
├── pointerDown na eventu -> pressCandidate
│   ├── release < threshold -> openPreview
│   ├── move > threshold    -> dragging
│   └── pointerCancel       -> idle
├── pointerDown v gridu -> selecting (drag-to-create)
├── Enter na eventu     -> openPreview
├── Enter v gridu       -> quickCreate
└── resizeHandleDown    -> resizing

dragging / resizing
├── pointerMove -> updateGhost + autoScroll   (žádná síť!)
├── pointerUp   -> optimisticCommit -> idle
└── Escape      -> rollback -> idle
```

Bez explicitního automatu se click, drag, resize, long-press a scroll začnou
míchat — to je zdroj náhodných popoverů a ztraceného focusu.

## 5. Kde `apps/web` stojí (audit 2026-07-27)

**Hotové (a dobré):**

- Shell: toolbar s rozsahem, Today, prev/next, view switcher, Create; sidebar
  Pages + Calendars.
- Views: Month (+N overflow), Day/Week time grid (all-day řádek, now marker,
  overlap layout), Agenda.
- **Sdílená a testovaná časová geometrie** v `@musubi/calendar/layout`
  (`overlaps`, `all-day-spans`, `month-grid`, `ranges`, `layout.test.ts`) →
  playbook „Gate 1" je v podstatě splněná, jsme legitimně ve fázi 2.
- Vrstvy závaznosti: slot → QuickCreate → EventDetailsPopover → EventEditorForm.
- Permission gating přes sdílené `can()`; Pages s explicit save a 409 conflict UI.
- SSE realtime, offline/error stavy, light/dark, `prefers-reduced-motion`.
- Klávesnice: `c` create, arrows/Home/End/PageUp/Down scroll v gridu, navigace
  buněk v Month, Escape zavírá, `Ctrl/Cmd+S` v Page editoru.

**Mezery proti referenci (ověřené greppem, ne dojmem):**

| # | Mezera | Dopad |
|---|---|---|
| G1 | **Žádná přímá manipulace** — chybí drag-to-move, resize, drag-to-create | největší; produkt působí jako prohlížeč s formuláři (porušuje R1) |
| G2 | **Žádné Undo** — mazání jde přes `window.confirm` | R6; každá vratná akce platí cenu dialogu |
| G3 | `HOUR_HEIGHT = 64` hardcoded v komponentě → **žádná density/zoom** | R7; a Page config `density` **nikdo nečte** |
| G4 | Page config deklaruje `density`, `weekend`, `groupBy`, `showAdjacentDays` — **renderer je ignoruje** | mrtvý kontrakt, hotový hook nevyužit |
| G5 | Chybí mini calendar | skok na vzdálené datum jen přes prev/next |
| G6 | Neúplná klávesová mapa (chybí `T/D/W/M/A`, `E`, `Delete`, `/`, `?`), arrows scrollují místo pohybu focus buňky (žádný roving tabindex) | R10 |
| G7 | Toast bez akce — není snackbar s Undo | R6/R8 |
| G8 | Event blok neadaptuje obsah podle **vlastního** rozměru (žádné container queries) | krátké eventy nečitelné |
| G9 | Není viditelná selection layer po kliknutí do slotu | R4 |
| G10 | Chybí tokeny z §3 | R7 |

## 6. Plán polishe

Pořadí je dané prioritou z §1 a tím, co odemyká „pocit". **Fáze A je předpoklad
pro B** (snap potřebuje px/min jako data, ne magickou konstantu).

### Fáze A — Geometrie a tokeny — **HOTOVO** (2026-07-27)

- Tokeny z §3 doplněné (`--space-*`, `--hour-height`, `--date-header-height`,
  `--event-radius`, `--focus-ring`, `--popover-width`, `--motion-slow`).
- `HOUR_HEIGHT = 64` → `time-geometry.ts`: `TimeGeometry` + čisté funkce
  (`minutesToY`, `yToMinutes`, `durationToHeight`, `gridHeight`). Čte to grid,
  event layout, hodinové linky, now marker, klávesnicový scroll **i
  pointer→čas** (dřív měl vlastní snap na 30 min, teď sdílených 15).
  CSS bere výšku z `--hour-height`, které nastavuje komponenta ze stejné
  geometrie → jedno číslo pro JS i CSS.
- **`density` z Page configu zapojená**, rozšířená na 3 stupně
  (`compact 44 / comfortable 64 / spacious 88`); přepínač v edit módu, ukládá se
  s Page. Draft ukazuje náhled živě.
- Scroll: jeden effect vlastní pozici. Změna rozsahu → ukotví u pracovní hodiny;
  změna density → **přepočítá scrollTop**, aby zůstal vidět stejný čas (jinak
  by stejný pixel ukazoval jinou hodinu).
- Testy: 11 unit testů geometrie (round-trip ve všech hustotách, snap, clamp,
  min height) + e2e, že density mění výšku mřížky a uloží se.

- `weekend` a `showAdjacentDays` zapojené: weekend filtruje **podle dne v týdnu**
  (platí pro oba week starty), den nikdy nezmizí; skrytý cizí měsíc si nechá
  buňku (výška měsíce se nemění), jen nemá obsah, klik ani počet eventů v SR
  názvu. Oba přepínače v edit módu.

Tím je fáze A uzavřená — mrtvý kontrakt `PageConfigV1.view` je celý živý.

### Fáze B — Přímá manipulace

**B1 — drag-to-move + resize: HOTOVO** (2026-07-27)

- Pointer automat v `use-time-grid-drag.ts` podle §4: press → threshold (4 px) →
  drag/resize → commit/rollback. Listenery se navěšují **při stisku**, ne
  z effectu (jinak by se re-registrovaly při každém pohybu ghostu).
- Čistá matematika v `time-grid-drag.ts` (+16 testů): absolutní snap na 15 min
  (event mimo mřížku se srovná), zachování délky u move, **nikdy neinvertuje**
  event při resize (jeden interval vždy zůstane), clamp na hranice dne,
  auto-scroll s rampou u okraje, day index z pointeru.
- Živý čas přímo v bloku (ukazuje čas dropu, ne původní), elevace + `grab`
  kurzor, **highlight cílového dne** při přesunu mezi dny, `ns-resize` úchyty
  8 px nahoře/dole (zvýrazní se až při hoveru).
- Escape ruší drag (`stopPropagation`, aby nezavřel celou obrazovku), pointer
  cancel taky; nulová síťová mutace během pohybu — commit až po dropu, chyba
  vrátí blok na serverovou pravdu a řekne to.
- Gating: `canEditEvent` + žádný drag u **opakovaných** eventů, protože update
  dnes mění celou sérii — tichý přesun série je přesně ten skrytý dopad, který
  pravidla zakazují. Scope dialog patří do C, kde se dialogy staví.

**B2 — drag-to-create + klávesnice: HOTOVO** (2026-07-27)

- `useDragToCreate`: tažení přes prázdnou mřížku vybere interval (funguje i
  nahoru), **selection layer je vidět dřív, než se popover otevře** (§R4, G9),
  s časovým rozsahem. Po uvolnění se délka přenese do QuickCreate — `endTime`
  prošlo až do `defaultEventFormValues`, takže se místo výchozí hodiny použije
  vytažený interval.
- Klik zůstal klikem: po dragu se trailing click **spolkne** (`consumeClick`),
  jinak by uvolnění vytvořilo druhý event.
- **Klávesnicová alternativa** (§R10): `Alt+↑/↓` posune o snap interval,
  `Alt+Shift+↑/↓` mění délku. Používá **stejnou** `nextDragTimes` matematiku
  jako myš, a výsledek se **oznámí** do notice live regionu — bez toho by
  screen-reader uživatel neměl potvrzení.

**B3 — Month + persistence selection: HOTOVO** (2026-07-27, po zpětné vazbě)

- **Month drag-to-move** (`useMonthDrag`): tažení chipu na jinou buňku změní
  **jen datum**, čas a délka zůstanou; cílová buňka se zvýrazní (`data-drop-target`
  jako v time gridu), Escape ruší, chyba vrátí. Stejné gating (role + žádné
  opakované). Resize v Month nemá smysl (buňka není časová osa).
- **Selection zůstává vidět, dokud je quick create otevřený.** Odvozuje se
  z `pendingCreate` (otevřený intent), ne z drag stavu — takže platí i pro
  **klik**, ne jen tažení. Dřív zmizela v okamžiku, kdy se popover otevřel, což
  bylo proti §8.2.

**B4 — Month drag-to-create: HOTOVO** (2026-07-27)

- `useDayRangeCreate`: pointerdown na prázdné místo buňky → sleduje
  `[data-day-key]` pod kurzorem → normalizovaný rozsah (tažení dozadu je stejně
  platné). Buňka nemá časovou osu, takže výsledek je **all-day rozsah**, ne
  interval — quick create se otevře s `isAllDay: true`, `date` = začátek,
  `endDate` = konec.
- Rozsah je zvýrazněný během tažení i po dobu, co je popover otevřený
  (`data-range-selected`, stejný zdroj `pendingCreate` jako v B3).
- Prostý klik si drží svou cestu (jednodenní timed event); trailing click po
  tažení se spolkne přes `consumeClick`.
- `defaultEventFormValues` 4. parametr je teď objekt `{ endDate, endTime,
  isAllDay }` — gesto předá to, co odvodilo, zbytek má default.

Tím je fáze B hotová. Zbývá jen scope pro opakované eventy (patří do C).

### Fáze C — Vratnost

**C1 — Undo v toastu: HOTOVO** (2026-07-28)

- `Notify = (message, undo?) => void` (`src/calendar/notice.ts`). Undo se
  nepřidával jako abstraktní command model — reverzní akce je closure u místa,
  které mutaci provedlo, protože jen ono ví, co byl původní stav.
- Toast s Undo žije 9 s (bez Undo 3,5 s): nabídka platí jen tehdy, když tam je
  ještě v okamžiku, kdy si chybu všimneš. Klik Undo nabídku hned sundá, aby se
  reverzace nedala přehrát dvakrát.
- Undo má: přesun a resize (time grid i month, včetně Alt+šipek), mazání eventu,
  odebrání jednoho výskytu / následujících.
- **Mazání běžného eventu je na jeden klik**, bez potvrzovacího kroku. Confirm
  zůstal jen tam, kde ho Undo nezastoupí: série (potřebuje rozsah) a kalendář
  s providerem (změna už odešla jinam, restore by tam vznikl jako nový event).

**C2 — Rozsah série + drag opakovaných: HOTOVO** (2026-07-28)

- `seriesEditWrites` (`src/calendar/recurrence-edit.ts`) vrací **data, ne
  volání** — `{ creates, updates }` — takže se každý rozsah dá zkontrolovat bez
  serveru a volající si řídí pořadí i undo.
- Tři rozsahy: `series` (posune master o stejný delta; resize hýbe jen taženou
  hranou), `occurrence` (EXDATE + odpojená kopie), `following`
  (`endSeriesBefore` + nová série). `remainderRule` v `@musubi/calendar` sníží
  `COUNT`, aby rozdělením série nevznikly occurrences dvakrát; `UNTIL` je
  absolutní, takže se nechává.
- Tím padlo gating v TimeGridView i MonthCalendar — **opakované eventy se dají
  táhnout**.
- Dialog se ptá **před** zápisem a v textu **říká nový čas**, protože kalendář za
  ním pořád ukazuje starý (nic se nezapsalo). Zavření dialogu nezapíše nic.

*Zbývá v C:* discard draftu stránky pořád `window.confirm` (Undo by muselo
obnovit celý draft i edit mód); editace série přes formulář zapisuje celou sérii
— tlačítko to říká („Edit series“), scope se tam ale hodí. Error copy podle čtyř
otázek projít napříč.

### Fáze D — Orientace a kontinuita

- Mini calendar v sidebaru (klik = změna anchor date, zachová view/filtry/scroll).
- Viditelná selection layer.
- Plná klávesová mapa + `?` overlay se zkratkami; zkratky spouštějí **stejné
  commandy** jako GUI.
- Roving tabindex v gridu (šipky hýbou focus buňkou, ne scrollem).
- Audit návratu focusu po zavření každé vrstvy.

### Fáze E — Craft eventu

- Container queries: podle výšky `title` → `+ čas` → `+ místo/status`.
- Kompletní stavy z R11, včetně `pending`, `error`, `read_only`.
- Barva + ikona/text (R9).

### Fáze F — Responzivita

- Breakpointy: <600 (sheet místo popoveru, FAB, overlay drawer),
  600–1023, 1024–1439, ≥1440.
- Priorita zmenšování z R12.

### Vědomě odloženo

Year view, 3-day/custom range, right utility rail, suggested times / find-a-time,
tasks / focus time / OOO / appointment schedules. Žádné z toho nemá cenu, dokud
neběží B a C.

## 7. Checklist na každý UI ticket

```yaml
ticket:
  user_goal: ""
  entry_points: []          # slot, event, toolbar, klávesnice, mobil
  ui_layer: ""              # slot | quick_create | preview | editor | dialog
  preserved_context: []     # datum, view, scroll, focus, vybraný objekt
  state_machine: ""         # nebo "netřeba" + proč
  keyboard_path: ""
  narrow_path: ""
  shared_geometry: true
  optimistic_error_undo: ""
  a11y: ""                  # focus, název pro SR, kontrast, redukovaný motion
  tests: []
  own_identity: true        # nekopíruje cizí značku
```

Po dokončení dolož: co je hotové, jaké invarianty zůstaly zachované, jak funguje
klávesnice a screen reader, jak se řeší loading/pending/error/undo, jaké testy, a
**každou odchylku od těchto pravidel i s důvodem**.

## 8. Anti-patterny (červené vlajky v review)

- Klik na event otevře plný formulář.
- Každé smazání má modal, i když je Undo spolehlivé.
- Popover uprostřed obrazovky bez vztahu k anchoru.
- Po zavření editoru skok na dnešek nebo nahoru.
- Barva je jediný rozdíl mezi stavem nebo typem.
- Změna filtru resetuje datum nebo scroll.
- Grid, event layout a hit-testing počítají každý po svém.
- Drag zapisuje na server při každém pointer move.
- All-day jako půlnoční timestamp místo date range.
- Refetch zavře otevřený popover.
