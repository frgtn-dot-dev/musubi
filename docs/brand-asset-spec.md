# What the DAM has to hold

The asset list Musubi needs, with format, pixel size and safe area for each, so
one source on S3 can feed every place in `brand-assets.md`.

Every number here is from current platform documentation, cited per section. Where
a platform states a safe area in `dp` or a fraction, the pixel equivalent for our
export size is given alongside it.

## Masters — vector, whatever the DAM stores natively

These are what everything else is cut from. SVG, square canvas, artwork
converted to outlines (no live text), no embedded rasters.

| Master | Canvas | Notes |
| --- | --- | --- |
| `mark` | 1:1 | The knot alone, transparent background |
| `mark-on-dark` / `mark-on-light` | 1:1 | Colour-adjusted for each ground, since the cream reads as black on light (the current DAM set already splits this way) |
| `mark-plated-dark` / `mark-plated-light` | 1:1 | Same with an opaque background plate |
| `mark-mono` | 1:1 | **Flat single-colour silhouette.** Android tints this itself, so it must carry no colour of its own and no internal shading |
| `lockup-wide-dark` / `-light` | ~2:1 | Mark plus the "Musubi" wordmark, for site nav, footer and hero |

`mark-mono` and the wide lockup are the two the current DAM folder does not have,
and neither can be derived from the eight files in it.

## Mobile app — the five files `app.config.ts` consumes

PNG, and the size Expo asks for is **1024×1024**, "exactly square" with no
rounded corners and no transparent pixels for the main icon. iOS accepts down to
512×512 but 1024 is the recommendation. Android layers must share one size.
([Expo](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/))

| File | Size | Alpha | Safe area |
| --- | --- | --- | --- |
| `icon.png` | 1024×1024 | **No** | Full bleed. The system masks the corners — do not round them yourself |
| `icon-light.png` | 1024×1024 | No | Same, for the iOS light appearance |
| `android-icon-foreground.png` | 1024×1024 | Yes | See the adaptive grid below |
| `android-icon-background.png` | 1024×1024 | No | Full bleed, no shadow around the mark |
| `android-icon-monochrome.png` | 1024×1024 | Yes | Same grid; flat silhouette only |
| `splash-icon.png` | 1024×1024 | Yes (transparent recommended) | Centred, generous margin — it is scaled by `imageWidth` |
| `splash-icon-light.png` | 1024×1024 | Yes | Currently **1024×512**, which is inconsistent with the dark one. Worth normalising while assets are being redrawn |

### The Android adaptive grid

Android sizes every layer to a **108×108 dp** canvas and shows only the centre
**66×66 dp**; the outer **18 dp on each of the four sides** is reserved for
masking, parallax and pulsing. The logo itself should be **48–66 dp** — no
smaller, and never larger than the safe zone.
([Android](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive))

Scaled to a 1024 px export:

```
1024 × 1024 canvas
├─ 171 px margin on every side   (18/108)  — assume it will be cut
└─ 626 px centred safe zone      (66/108)  — everything that must be seen
   └─ mark between 455 px and 626 px       (48–66 dp)
```

Provide the layers **unmasked, with clean edges and no drop shadow around the
outline** — the system draws its own.

The monochrome layer exists so Android 13+ can tint the icon from the user's
wallpaper. It must be the same silhouette, in one flat colour, with the shape
carried entirely by alpha.

## iOS icon, the current way

Apple's layout size is **1024×1024 px**, square, and the system masks it to a
rounded rectangle. Icons are now **layered**, assembled in Icon Composer, with
appearances for *default, dark, clear light, clear dark, tinted light and tinted
dark*. ([Apple HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons))

What that means for the DAM:

- Prefer **SVG or PDF** for the foreground layers — Apple asks for vector so
  layers stay crisp at every size, with text converted to outlines
- Supply foreground layers **without a background**; a background is defined in
  Icon Composer, and only needs importing if it is more than a colour or gradient
- Any imported background must be **full-bleed and opaque**
- **Avoid soft or feathered edges** on foreground shapes, or the system's
  highlights and shadows sit badly on them
- Provide square, **unmasked** layers

Expo SDK 54+ accepts an Icon Composer `.icon` directory, so this is reachable
without leaving the current pipeline — but the flattened `icon.png` above is
still what the config uses today.

## Google Play listing

([Play Console](https://support.google.com/googleplay/android-developer/answer/9866151))

| Asset | Size | Format | Notes |
| --- | --- | --- | --- |
| Store icon | 512×512 | 32-bit PNG **with** alpha | ≤ 1024 KB |
| Feature graphic | 1024×500 | JPEG or 24-bit PNG, **no alpha** | Play-only format |
| Phone screenshots | 1080×1920 portrait recommended | JPEG or 24-bit PNG, no alpha | Min dimension 320 px, max 3840 px, and the long side may not exceed twice the short side. **Two minimum** to publish |

Safe area for rectangular store images: **20% bottom, 10% sides, 15% top**, with
critical elements centred, because the image is cropped to fit some devices and
form factors. Play also asks for **no text, slogans or logos inside the image** —
the message belongs in the tagline.
([Play](https://support.google.com/googleplay/android-developer/answer/16386748))

On a 1024×500 feature graphic that is a usable box of roughly **819 × 325 px**,
centred, with the mark inside it.

## App Store listing

**These do not exist today.** The eight screenshots in the repo are 1080×1920,
which is Play's format; Apple accepts none of them.

1–10 per display size, `.png`/`.jpg`, **no alpha channel or transparency**.
([App Store Connect](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/))

| Where | Portrait | Required |
| --- | --- | --- |
| iPhone 6.9" | 1320×2868 | Yes, if the app runs on iPhone |
| iPhone 6.5" | 1284×2778 | Only needed if 6.9" is not provided |
| iPad 13" | 2064×2752 | Yes, if the app runs on iPad |

Smaller sizes are optional — Apple scales them down from the largest provided.
The 1024×1024 app icon above doubles as the App Store icon.

## Web

| Asset | Size | Format | Safe area |
| --- | --- | --- | --- |
| `favicon.svg` | any, square viewBox | SVG | Full bleed |
| `favicon.ico` | 32×32 (16×16 too if multi-size) | ICO | Full bleed |
| `apple-touch-icon.png` | **180×180** | PNG, **non-transparent** | Full bleed, square, no rounded corners. Provide one size, not several |
| manifest `icons` | 192×192 and 512×512 | PNG | Full bleed |
| manifest maskable icon | 512×512 | PNG | See the circle below |

The maskable safe zone is defined as "a centrally positioned circle, with radius
**2/5 (40%)** of the minimum of the icon's width and height" — so an 80%-diameter
circle. Anything outside it may be masked away.
([W3C](https://w3c.github.io/manifest/)) On 512 px that is a **410 px circle**,
leaving a 51 px band on each side that must be background only.

Chrome asks for icon sizes in multiples of 48 (48, 96, 144, 192); Safari wants
180 or 192 and specifically a **non-transparent** PNG.
([web.dev](https://web.dev/articles/icons-and-browser-colors))

`apple-touch-icon` and the manifest are both missing from Musubi today.

## Social preview

`og.png` — recommended **at least 1200×630**, as close to **1.91:1** as possible
to avoid cropping in feeds, absolute minimum 200×200, file **under 8 MB**.
([Meta](https://developers.facebook.com/docs/sharing/webmasters/images))

Ours is already 1200×630. Its URL is cached by every platform that has unfurled
a musubi.pro link, so replacing it is a re-share, not a swap.

## Email

`logo.png` — **128×128 PNG**, displayed at 44 px, so roughly 3× for retina. PNG
and not SVG because Gmail drops SVG entirely. Ships as a `cid:` attachment.

Derived, not authored: re-render from the master on every change.

```sh
rsvg-convert -w 128 -h 128 <mark-plated-dark>.svg -o packages/emails/assets/logo.png
```

## README and GitHub

`icon.png` at 1024×1024 for the README header. `banner.svg` builds the mark and
wordmark from SVG primitives with live Georgia text — if the DAM is to own it,
it needs redrawing as an asset rather than markup.

---

## The short version

Eleven things the DAM needs that the current folder does not have:

1. `mark-mono` — flat silhouette for the Android themed icon
2. Wide lockup, dark and light — nav, footer, hero
3. `android-icon-foreground` on the 108/66 dp grid
4. `android-icon-background`
5. `android-icon-monochrome`
6. `splash-icon-light` at 1024×1024, matching the dark one
7. `apple-touch-icon` 180×180, opaque
8. Manifest icons 192 and 512
9. Maskable 512 with the 410 px safe circle
10. Play feature graphic 1024×500 within the 819×325 safe box
11. App Store screenshots at 1320×2868 and 2064×2752
