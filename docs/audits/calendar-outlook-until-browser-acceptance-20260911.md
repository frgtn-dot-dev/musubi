# Outlook celodenní UNTIL — browser acceptance 2026-09-11

Na vývojovém localhostu prošlo vytvoření osobní konečné celodenní série
s `FREQ=DAILY;UNTIL=20260930`, dohledání nepotvrzeného vytvoření a následný
úklid. Test použil již připojený vlastní osobní Outlook kalendář bez účastníků.
Nepřebírá sdílené kalendáře, private-read delegaci, zoned UNTIL ani produkční
aktivaci. Testovaná implementace odpovídala `2a2d4ef`.

## Skutečný vstup a hranice UI

Výchozí draft vznikl přes Musubi quick form a More options. Celodenní rozsah
28. září a recurrence byly obnovené podporovaným URL draftem plného editoru;
kalendář byl následně vybraný jeho skutečným home radio ovladačem a uložený
přes Create. Editor správně ukázal, že pokročilé pravidlo zachová beze změny.

Toto je důkaz browser admission obnoveného URL draftu, **nikoliv** důkaz
vytvoření UNTIL přes recurrence picker: nový picker nabízí Never/After a tuto
pokročilou variantu sám neautorizuje. Nebyla použita přímá API admission ani
ruční tvorba či změna outbox journalu.

## Průběh a výsledky

- Musubi před odesláním zobrazilo tři výskyty 28.–30. září a stav Waiting to
  send. Lokální scheduler byl vypnutý; přesný UI receipt zpracoval standardní
  worker. Guard helperu připustil jediný POST přesně zmrazeného create body;
  v této invokaci byl pozorovaný jeden Graph POST.
- První pokus skončil `unconfirmed`, `provider-write-failed`, attempts=1,
  zachovaným attempted markerem a bez result reference. Nativní Outlook už
  zobrazoval správné tři celodenní výskyty. Nebyl odeslaný nový create požadavek.
- Pozdější diagnostika pouze přes SELECT/GET našla jedinou přesnou transaction,
  ověřila nezměněný master a kompletní rodinu tří výskytů. Nativní `endDate`
  byl `2026-09-30`; inverse recurrence a zpětná serializace souhlasily.
  Původní fázi selhání nelze zpětně určit bez tehdejší HTTP diagnostiky. Tento
  výsledek sám nedokazuje chybu UNTIL ani konkrétní příčinu prvního nepotvrzení.
- Skutečné tlačítko **Check creation** vyžádalo kontrolu původní operace.
  Handler sám probudil standardní worker i při vypnutém periodickém scheduleru.
  Musubi následně ukázalo **Delivery confirmed**. Připravený samostatný recovery
  helper se zastavil na vstupní podmínce již dokončeného receipt a worker
  podruhé nespustil.
- Finální důkaz potvrdil jeden completed receipt s attempts=2, jeden master,
  tři uložené děti a čtyři unikátní mapování. Původní payload obou snapshotů,
  recurrence, identita a revision journalu zůstaly shodné se soukromým snímkem
  pořízeným před prvním pokusem. Běžná synchronizace tyto důkazy nezměnila.

Nativní API vrátilo přesně 28→29, 29→30 a 30. září→1. října, vždy UTC půlnoc
s `isAllDay=true`, bez účastníků, výjimek a zrušených výskytů. Nativní Outlook
browser nezávisle zobrazil všechny tři dny a detail posledního dne jako
celodenní 30. září. Musubi po potvrzení zobrazilo importované provider details
výskytu a oddělené series/occurrence delivery details.

Dva worker attempts neznamenají dva POSTy. První invokace měla měřený jeden
POST; druhá běžela v API procesu přes UI wakeup, mimo HTTP observer helperu.
Read-only recovery vyplývá ze stávající uncertain větve implementace a jejích
regresí. Tento živý test **necertifikuje celoživotní počet HTTP POSTů** pouze
z databázových attempts. Dokládá jedinou nalezenou transaction a žádné duplicitní
lokální řádky v ověřené rodině.

## Úklid

V nativním Outlooku byla přes Odstranit → Všechny události v řadě a potvrzení
odstraněna pouze tato osobní QA série. Následný přesný native lookup potvrdil
neexistenci masteru. Standardní sync bez resetu cursoru vytvořil čtyři tombstones:
aktivní master=0, aktivní děti=0, zachovaná mapování=4, completed receipt=1,
attempts=2 a původní journal beze změny. Readback helper nepovoloval Graph zápisy.

Nezměnil se aplikační kód, produkční flagy ani release policy. Soukromé účtové
identifikátory, tokeny, payload snapshot a jednorázový QA helper nejsou součástí
repozitářové evidence. Sdílený Graph private-read test zůstává podle rozhodnutí
vlastníka odložený; tato sada jej nenahrazuje.
