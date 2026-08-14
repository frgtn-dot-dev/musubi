import type { ErrorComponentProps } from "@tanstack/react-router";
import { Link, useRouter } from "@tanstack/react-router";
import { Button, buttonClassName } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";

export function AppErrorBoundary({ error }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <RouteState
      actions={
        <>
          <Button onClick={() => void router.invalidate()}>
            Try again
          </Button>
          <Link
            className={buttonClassName({ variant: "secondary" })}
            to="/"
          >
            Return home
          </Link>
        </>
      }
      description={
        error.message || "An unexpected error interrupted the workspace."
      }
      eyebrow="Something came untied"
      title="Musubi could not open this view."
    />
  );
}
