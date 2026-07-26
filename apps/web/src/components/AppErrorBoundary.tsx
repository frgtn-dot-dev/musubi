import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";

export function AppErrorBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <main className="route-state" aria-labelledby="route-error-title">
      <p className="route-state__code">Something came untied</p>
      <h1 id="route-error-title">Musubi could not open this view.</h1>
      <p>{error.message || "An unexpected error interrupted the workspace."}</p>
      <div className="route-state__actions">
        <button type="button" onClick={() => void router.invalidate()}>
          Try again
        </button>
        <Link to="/">Return home</Link>
      </div>
    </main>
  );
}
