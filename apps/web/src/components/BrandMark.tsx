import type { SVGProps } from "react";

export function BrandMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 92 56"
      fill="none"
      role="img"
      aria-label="Musubi"
      {...props}
    >
      <circle cx="31" cy="28" r="21" stroke="currentColor" strokeWidth="2.4" />
      <circle
        cx="58"
        cy="28"
        r="21"
        stroke="var(--accent-primary)"
        strokeWidth="2.4"
      />
      <path
        d="M41 9.5a21 21 0 0 1 5.5 3.9"
        stroke="currentColor"
        strokeWidth="2.4"
      />
    </svg>
  );
}
