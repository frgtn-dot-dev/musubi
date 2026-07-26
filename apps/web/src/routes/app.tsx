import { createFileRoute } from "@tanstack/react-router";
import { SessionGate } from "~/auth/SessionGate";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  return <SessionGate />;
}
