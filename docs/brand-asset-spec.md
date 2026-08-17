# What the DAM has to hold

Every asset Musubi needs, with the numbers to produce it at. Safe areas are
given in pixels at the export size — no fractions to convert.

Sources are linked per section. Where a platform publishes no safe area, the
row says so rather than inventing one.

## Masters — vector

SVG, square canvas, artwork converted to outlines, no embedded rasters.

| Master | Canvas | Safe area | Notes |
| --- | --- | --- | --- |
| `mark` | 1:1 | Full bleed | The knot alone, transparent |
| `mark-on-dark` / `mark-on-light` | 1:1 | Full bleed | Colour-adjusted per ground |
| `mark-plated-dark` / `mark-plated-light` | 1:1 | Full bleed | With an opaque background plate |
| `mark-mono` | 1:1 | Full bleed | **One flat colour, shape carried by alpha.** Android tints it |
| `lockup-wide-dark` / `-light` | ~2:1 | Full bleed | Mark + "Musubi" wordmark |

## Mobile app — the files `app.config.ts` reads

[Expo](https://docs.expo.dev/develop/user-interface/splash-screen-and-app-icon/) ·
[Android adaptive icons](https://developer.android.com/develop/ui/views/launch/icon_design_adaptive)

| File | Size | Format | Alpha | Safe area at that size |
| --- | --- | --- | --- | --- |
| `icon.png` | 1024 × 1024 | PNG | No | Full bleed. Do not round the corners — the system masks them |
| `icon-light.png` | 1024 × 1024 | PNG | No | Full bleed |
| `android-icon-foreground.png` | 1024 × 1024 | PNG | Yes | **626 × 626 centred.** 171 px cut on every side. Mark 455–626 px |
| `android-icon-background.png` | 1024 × 1024 | PNG | No | Full bleed, no shadow around the mark |
| `android-icon-monochrome.png` | 1024 × 1024 | PNG | Yes | **626 × 626 centred.** 171 px cut on every side. Flat silhouette only |
| `splash-icon.png` | 1024 × 1024 | PNG | Yes | Centred; scaled by `imageWidth`, so leave margin |
| `splash-icon-light.png` | 1024 × 1024 | PNG | Yes | Same. **Currently 1024 × 512** — normalise it |
| `favicon.png` (Expo web) | 48 × 48 | PNG | Yes | Full bleed |

The 626/171 figures are Android's 66 dp visible area inside a 108 dp canvas,
scaled to 1024. Supply layers unmasked, clean-edged, no drop shadow.

## iOS icon

[Apple HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons)

| Asset | Size | Format | Alpha | Safe area |
| --- | --- | --- | --- | --- |
| App icon layers | 1024 × 1024 | SVG or PDF preferred, PNG for raster | Foreground yes, background no | Full bleed. Apple publishes no safe-zone figure; the mask is a rounded rectangle, so keep fine detail out of the corners |

Six appearances: default, dark, clear light, clear dark, tinted light, tinted
dark. Foreground layers come **without** a background — that is defined in Icon
Composer. An imported background must be full-bleed and opaque. No soft or
feathered edges, or the system's highlights sit badly on them.

## Google Play listing

[Play Console](https://support.google.com/googleplay/android-developer/answer/9866151) ·
[asset guidance](https://support.google.com/googleplay/android-developer/answer/16386748)

| Asset | Size | Format | Alpha | Safe area at that size |
| --- | --- | --- | --- | --- |
| Store icon | 512 × 512 | 32-bit PNG | Yes | Full bleed. Max file 1024 KB |
| Feature graphic | 1024 × 500 | JPEG or 24-bit PNG | **No** | **819 × 325 centred** — 102 px left, 102 px right, 75 px top, 100 px bottom. No text or logo in the image at all |
| Phone screenshots | 1080 × 1920 | JPEG or 24-bit PNG | **No** | None published. Min side 320 px, max 3840 px, long side ≤ 2× short side. Two minimum to publish |

## App Store listing

[App Store Connect](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/) —
**none of these exist today**; the repo's screenshots are Play-sized.

| Asset | Size | Format | Alpha | Safe area |
| --- | --- | --- | --- | --- |
| iPhone 6.9" screenshots | 1320 × 2868 | PNG or JPEG | **No** | None published. 1–10 shots. Required if the app runs on iPhone |
| iPhone 6.5" screenshots | 1284 × 2778 | PNG or JPEG | **No** | Only needed if 6.9" is absent |
| iPad 13" screenshots | 2064 × 2752 | PNG or JPEG | **No** | None published. Required if the app runs on iPad |
| App Store icon | 1024 × 1024 | PNG | No | Same file as the app icon above |

Smaller device sizes are optional — Apple scales them from the largest given.

## Web

[W3C manifest](https://w3c.github.io/manifest/) ·
[web.dev](https://web.dev/articles/icons-and-browser-colors)

| Asset | Size | Format | Alpha | Safe area at that size |
| --- | --- | --- | --- | --- |
| `favicon.svg` | square viewBox, any | SVG | Yes | Full bleed |
| `favicon.ico` | 32 × 32 | ICO | Yes | Full bleed |
| `apple-touch-icon.png` | 180 × 180 | PNG | **No** | Full bleed, square, no rounded corners. One size only, not several |
| Manifest icon | 192 × 192 | PNG | Yes | Full bleed |
| Manifest icon | 512 × 512 | PNG | Yes | Full bleed |
| Manifest maskable | 512 × 512 | PNG | Yes | **410 px circle, centred.** 51 px band on every side is background only |
| `og.png` | 1200 × 630 | PNG or JPEG | No | None published. Keep near 1.91:1 or feeds crop it. Under 8 MB ([Meta](https://developers.facebook.com/docs/sharing/webmasters/images)) |

`apple-touch-icon` and the manifest do not exist in Musubi today.

## Email

| Asset | Size | Format | Alpha | Safe area |
| --- | --- | --- | --- | --- |
| `logo.png` | 128 × 128 | PNG | Yes | Full bleed. Shown at 44 px, so ~3× for retina |

PNG and not SVG because Gmail drops SVG. Derived — re-render on every change:

```sh
rsvg-convert -w 128 -h 128 <mark-plated-dark>.svg -o packages/emails/assets/logo.png
```

## README and GitHub

| Asset | Size | Format | Alpha | Safe area |
| --- | --- | --- | --- | --- |
| `icon.png` | 1024 × 1024 | PNG | Yes | Full bleed |
| `banner.svg` | 1200 × 320 | SVG | — | Full bleed. Currently drawn as SVG primitives with live text; needs redrawing as an asset if the DAM is to own it |

---

## Missing from the DAM today

| # | Asset | Size | Safe area |
| --- | --- | --- | --- |
| 1 | `mark-mono` | vector | Full bleed, one flat colour |
| 2 | Wide lockup, dark + light | vector ~2:1 | Full bleed |
| 3 | `android-icon-foreground` | 1024 × 1024 | 626 × 626 centred |
| 4 | `android-icon-background` | 1024 × 1024 | Full bleed |
| 5 | `android-icon-monochrome` | 1024 × 1024 | 626 × 626 centred |
| 6 | `splash-icon-light` | 1024 × 1024 | Centred |
| 7 | `apple-touch-icon` | 180 × 180 | Full bleed, opaque |
| 8 | Manifest icon | 192 × 192 | Full bleed |
| 9 | Manifest maskable | 512 × 512 | 410 px circle |
| 10 | Play feature graphic | 1024 × 500 | 819 × 325 centred |
| 11 | App Store screenshots | 1320 × 2868 and 2064 × 2752 | None published |
