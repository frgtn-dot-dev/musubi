/**
 * Where the brand art is served from.
 *
 * The bucket rather than `public/`, so redrawing the mark reaches a running
 * deployment without one. Object names are stable; only their bytes change.
 *
 * Link the bucket directly and not the Zipline URL in front of it — Zipline
 * serves the same objects with `cache-control: max-age=14400`, so a swapped
 * file would take four hours to appear.
 *
 * One constant on purpose: when self-hosters can upload their own mark, this is
 * the single thing that has to become configurable.
 */
export const BRAND_ASSETS = "https://frgtn-assets.fsn1.your-objectstorage.com";
