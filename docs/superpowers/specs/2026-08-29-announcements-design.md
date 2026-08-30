# Announcements — zprávy o novinkách od majitele serveru

- Stav: approved (design), implementace nezačala
- Datum: 2026-08-29
- Kontext: Není žádný způsob, jak uživatelům říct, co je v Musubi nového.
  Majitel serveru (my i každý self-hoster) potřebuje umět publikovat zprávu,
  která se každému uživateli ukáže jednou a která se váže na verzi, jíž se týká.

## Rozhodnutí

Zprávy žijí v DB, píšou se v admin panelu ve webové aplikaci, a klientům se
ukazují jako **modal se seznamem všech nevyřízených zpráv**, ne jako lišta.
„Už viděl" je **jedno pole v uživatelském nastavení**, ne seznam ID.

Vědomě zamítnuté alternativy:

- **JSON soubor v repu / env proměnná.** Levnější, ale majitel serveru by musel
  mít přístup k souborovému systému a redeploy. Product owner chce psát zprávy
  z prohlížeče.
- **Pole viděných ID (`seenAnnouncements: string[]`).** Zvládlo by i zprávy
  přeskočené kvůli `minVersion` (viz Výhrada níže), ale roste bez konce a
  potřebuje ořezávání. Product owner zvolil jedno pole.
- **Tlačítka s odkazy a ikonami jako datová struktura.** Zrušena — odkazy jsou
  prostě URL v textu a autolinkují se. Discord je tím pádem jen odkaz, který
  autor napíše do zprávy, a nemá v kódu žádné zvláštní zacházení.
- **Markdown.** Vyžádal by si renderer zvlášť pro web a zvlášť pro React Native
  (dvě nové závislosti) plus sanitizaci jako bezpečnostní hranici. Formát je
  prostý text, prázdný řádek dělí odstavce.

## Autorizace admina

V repu dosud **neexistuje pojem admina serveru**. `user` nemá roli; `role` v
`packages/db/src/schema.ts:521` je členství v kalendáři (owner/editor/viewer).

Zavádí se nejmenší dostatečné primitivum:

```
ADMIN_EMAILS=a@example.com,b@example.com
```

→ `config.security.adminEmails: string[]` v `packages/config/src/index.ts`,
vedle `caldavEncKey` a `requireEmailVerification`. Prázdná hodnota znamená
„tento server nemá admina" a admin endpointy pak odmítají všechny.

Middleware `requireAdmin` běží **za** `requireAuth` a porovná `req.user.email`
proti seznamu (case-insensitive, ořezané mezery). Není to nová tabulka ani
migrace a bootstrapuje se to samo: majitel serveru už svůj `.env` vlastní.

Až bude adminů víc a budou se měnit za běhu, přijde na řadu sloupec v `user` —
ne dřív.

## Datový model

```
announcements
  id          text PRIMARY KEY   -- "2026-08-29", při druhé zprávě téhož dne "2026-08-29-2"
  title       text NOT NULL
  body        text NOT NULL      -- prostý text, prázdný řádek = nový odstavec
  min_version text               -- NULL = pro všechny klienty
  created_at  timestamptz NOT NULL DEFAULT now()
  updated_at  timestamptz NOT NULL DEFAULT now()
```

`id` nese datum a je **zároveň řazení**. Formát `YYYY-MM-DD[-N]` se lexikograficky
řadí správně, takže „novější než poslední viděná" je prosté porovnání řetězců a
tabulka nepotřebuje druhý sloupec na pořadí.

Přípona `-N` řeší dvě zprávy v jeden den. Přiděluje ji server při vytvoření, ne
autor: klient by musel znát existující ID, aby uhodl volné.

### Nastavení uživatele

`packages/types/src/settings.ts` — nové **volitelné** pole v obou schématech:

```ts
// SettingsSchema
lastSeenAnnouncement: z.string().max(64).optional(),
// SettingsPatchSchema
lastSeenAnnouncement: z.string().max(64).optional(),
```

Volitelné z téhož důvodu jako `onboarded` a `timezone`: starší klient, který
uloží celý dokument, nesmí značku shodit zpátky.

## API

| metoda | cesta | kdo | co |
| --- | --- | --- | --- |
| GET | `/api/v1/announcements` | auth | `{ isAdmin, announcements[] }` — jen ty s `id` větším než `lastSeenAnnouncement` volajícího |
| GET | `/api/v1/admin/announcements` | admin | všechny, včetně už publikovaných |
| POST | `/api/v1/admin/announcements` | admin | vytvoří (server přidělí `id` z dnešního data) |
| PATCH | `/api/v1/admin/announcements/:id` | admin | opraví překlep; `id` se nemění |
| DELETE | `/api/v1/admin/announcements/:id` | admin | smaže |

`isAdmin` jede v odpovědi `GET /api/v1/announcements`, protože to je dokument,
který si každý přihlášený klient stahuje při startu tak jako tak — web podle něj
ukáže nebo skryje odkaz na panel bez dalšího requestu. Autoritou zůstávají admin
endpointy samy; ten příznak jen řídí, co se vykreslí.

**Označení „viděl" nemá vlastní endpoint.** Klient pošle existující settings
PATCH s `lastSeenAnnouncement`, čímž zdarma získá i synchronizaci mezi webem a
telefonem a řešení konfliktů, které settings dokument už umí.

### První pohled: nikdy záplava

Uživatel bez `lastSeenAnnouncement` — nově registrovaný, i každý existující
v okamžiku nasazení této featury — **modal nedostane**. Klient jen tiše uloží
značku na nejnovější existující zprávu.

Bez tohoto pravidla by nový účet dostal modal se všemi novinkami za celou
historii produktu, ke kterým se nemá jak vztáhnout, a den nasazení by ho dostal
každý stávající uživatel naráz. Nasazení je tím pádem tiché a první skutečnou
zprávu uvidí až tu, která přijde potom.

Zprávy nemají koncept draftu: vytvoření v panelu znamená publikaci. `id` se
přiděluje z data na serveru, takže zprávu nelze napsat dopředu ani zpětně
datovat — až to bude potřeba, je to samostatné rozhodnutí.

Editace zprávy, kterou uživatel už viděl, se mu znovu neukáže — `id` se nemění.
Je to zamýšlené: PATCH je na překlepy, nová informace je nová zpráva.

## Verzování

Filtrování podle `minVersion` dělá **klient, ne server**. Server neví, komu
odpovídá; svoji verzi zná jen klient. Web i appka ji čtou z `package.json` v
rootu (`apps/web/src/api/use-newer-server.ts:6`, `apps/client/app.config.ts:31`),
takže obě porovnávají proti témuž `PRODUCT_VERSION`. Porovnání používá
`compareVersions` z `packages/types/src/version.ts` — číselně, protože jako
řetězce se „0.1.10" řadí před „0.1.9".

Po zavření modalu se `lastSeenAnnouncement` posune na nejnovější **skutečně
zobrazenou** zprávu. Co bylo odfiltrováno kvůli `minVersion`, zůstává nevyřízené
a vyskočí až po aktualizaci klienta. To je požadované chování „aktualizace se
propagují při aktualizování verze": kdo sedí na 0.1.6, novinky k 0.1.7 nevidí,
značka se mu neposune, a po updatu je dostane.

### Výhrada, kterou vědomě neřešíme

Protože je značka jediná horní mez, zpráva s **vyšším** `minVersion` než má
nějaká **pozdější** zpráva se ztratí: značka přeskočí přes ni. Nastane to jen
tehdy, když autor napíše novější zprávu s nižším `minVersion` než starší —
v praxi ne, novinky k verzi se píšou při jejím vydání. Ošetření by vyžadovalo
pole viděných ID, které bylo zamítnuto. Admin panel na to upozorní v textu u
pole `minVersion`.

## Klientské UI

Modal je **jeden**, se všemi nevyřízenými zprávami pod sebou, seřazenými od
nejnovější. Zavírá se křížkem, Esc i tlačítkem — modal, který nejde zavřít
obvyklými způsoby, je přístupnostní vada. Zavření je to, co posune značku.

Ukazuje se **jen přihlášeným**, protože `lastSeenAnnouncement` žije v nastavení.

Odkazy: čistá funkce, která rozseká text na úseky `{ type: "text" | "link" }`,
bydlí v `packages/types/src/announcement.ts` vedle schématu — je to formát té
zprávy, ne obecná utilita — a používají ji obě aplikace. Rozpoznává `http://` a
`https://`; nic jiného se neotvírá.

- **Web** — `AnnouncementDialog` složený z existujícího `Dialog`
  (`apps/web/src/ui/Dialog.tsx`), volaný z app shellu. Nová primitiva do
  `apps/web/src/ui` nepřibývají.
- **Client** — `AnnouncementModal` přes `ModalPortal`
  (`apps/client/components/ui/ModalPortal.tsx`), vizuálně podle
  `UpdateRequiredModal`. Odkazy přes `Linking.openURL`.

## Admin panel

Route `apps/web/src/routes/app/admin.tsx`. Rozsah je **jen announcements** —
„obecné nastavení serveru" je samostatný návrh, protože většina toho, co je dnes
v env (SMTP, OAuth, VAPID), se za běhu měnit nedá bez restartu, a rozhodnout,
co smí žít v DB, je vlastní úkol.

Obsah: seznam zpráv, formulář (title, body jako textarea, minVersion), mazání.
Skládá se z `SettingsSection`, `Field`, `Button`, `Row` a `ConfirmationDialog` —
nic nového do `apps/web/src/ui` nepřibude. Odkaz na panel se v navigaci
vykreslí jen při `isAdmin`.

## Co to dluží release procesu

Podle `docs/releasing.md`:

- `Announcement` se přidá do `packages/types/contracts/wire.json` jako **read**
  dokument (`pnpm wire:snapshot`).
- `lastSeenAnnouncement` je volitelné v `SettingsSchema` i `SettingsPatchSchema`
  → aditivní v obou směrech, `MIN_CLIENT_VERSION` se **nezvedá**.
- Nové cesty se registrují v `apps/api/src/index.ts`, aby prošel
  `scripts/check-routes.mjs`.
- Žádné nové realtime frame typy, takže `scripts/check-realtime.mjs` se netýká.
  Zpráva se objeví při dalším startu klienta, ne okamžitě — publikovat novinku
  lidem pod rukama je horší než počkat.

## Testy

- `packages/types` — schéma announcementu a splitter odkazů (text bez URL, URL
  na začátku/konci, URL v závorce, `javascript:` se nelinkuje).
- `apps/api` — filtrování podle `lastSeenAnnouncement`, přidělení `id` s příponou
  při druhé zprávě téhož dne, 403 pro nepřihlášeného i pro přihlášeného
  ne-admina, 403 když je `ADMIN_EMAILS` prázdné.
- `apps/api` / klient — uživatel bez `lastSeenAnnouncement` nedostane žádnou
  zprávu k zobrazení a značka se mu nastaví na nejnovější.
- `apps/web` — dialog vykreslí odkazy jako odkazy, zavření pošle patch s
  nejnovějším zobrazeným `id`; admin route při `isAdmin: false` nepustí dál.
- `apps/client` — filtrování podle `minVersion` proti verzi buildu.
