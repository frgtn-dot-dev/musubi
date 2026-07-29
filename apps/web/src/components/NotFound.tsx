import { Link } from "@tanstack/react-router";
import { buttonClassName } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";

export function NotFound() {
  return (
    <RouteState
      actions={
        <Link className={buttonClassName()} to="/">
          Open Musubi
        </Link>
      }
      description="The link may be old, or the page may have moved."
      eyebrow="404"
      title="This page is not part of your workspace."
    />
  );
}
