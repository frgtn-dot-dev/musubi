import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <main className="route-state" aria-labelledby="not-found-title">
      <p className="route-state__code">404</p>
      <h1 id="not-found-title">This page is not part of your workspace.</h1>
      <p>The link may be old, or the Page may have moved.</p>
      <Link to="/">Open Musubi</Link>
    </main>
  );
}
