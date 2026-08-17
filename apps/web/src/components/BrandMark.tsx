import type { SVGProps } from "react";

/**
 * The Musubi knot, drawn rather than loaded.
 *
 * Inline SVG and not the file from the asset bucket, because this one has to
 * take its colour from where it sits: the cream arm is `currentColor`, so it
 * follows the text around it and works on either theme, and the other is the
 * accent. A bucket asset has its colours baked in and would go invisible on the
 * light theme.
 *
 * The trade is that a redrawn mark means editing this file — the paths below
 * are the two arms, exported from the same master the bucket serves.
 */
export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Musubi"
      {...props}
    >
      <path fill="currentColor" d="M21.984 39.22a15.8 15.8 0 0 1-4.196.564c-8.708 0-15.778-7.07-15.778-15.778S9.08 8.228 17.788 8.228c1.138 0 2.248.121 3.318.35a18 18 0 0 0-6.58 6.79 18 18 0 0 0-1.032 2.219c-2.068 1.386-3.43 3.745-3.43 6.42s1.362 5.032 3.43 6.419a7.7 7.7 0 0 0 2.912 1.181 8 8 0 0 0 1.382.123 7.72 7.72 0 0 0 6.223-3.149 7.7 7.7 0 0 0 1.148-2.26c.23-.731.354-1.509.354-2.315s-.124-1.583-.354-2.314a5.6 5.6 0 0 1 .581-.987 5.57 5.57 0 0 1 4.494-2.275 5.6 5.6 0 0 1 1 .089 5.5 5.5 0 0 1 1.533.518c.518 1.563.8 3.233.8 4.97s-.282 3.406-.8 4.969a15.7 15.7 0 0 1-1.151 2.631 15.86 15.86 0 0 1-7.605 6.9 16 16 0 0 1-2.027.712" />
      <path fill="var(--accent-primary)" d="M26.038 8.793a15.8 15.8 0 0 1 4.196-.565c8.708 0 15.778 7.07 15.778 15.778s-7.07 15.778-15.778 15.778a15.8 15.8 0 0 1-3.318-.35 18 18 0 0 0 6.58-6.79 18 18 0 0 0 1.032-2.218c2.068-1.387 3.43-3.745 3.43-6.42s-1.362-5.033-3.43-6.42a7.7 7.7 0 0 0-2.912-1.18 8 8 0 0 0-1.382-.124 7.72 7.72 0 0 0-6.223 3.15 7.7 7.7 0 0 0-1.148 2.26 7.7 7.7 0 0 0-.354 2.314c0 .806.124 1.584.354 2.315a5.6 5.6 0 0 1-.581.986 5.57 5.57 0 0 1-5.493 2.187 5.5 5.5 0 0 1-1.534-.518c-.518-1.563-.8-3.234-.8-4.97s.282-3.406.8-4.969a15.7 15.7 0 0 1 1.151-2.631 15.86 15.86 0 0 1 7.605-6.901 16 16 0 0 1 2.027-.712" />
    </svg>
  );
}
