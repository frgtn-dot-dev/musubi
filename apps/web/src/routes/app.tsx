import { createFileRoute } from "@tanstack/react-router";
import { SessionGate } from "~/auth/SessionGate";
import { SnapshotProvider } from "~/offline/SnapshotProvider";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

function AppRoute() {
  // Above the gate on purpose: the restore has to be in flight while the gate
  // decides, or an offline start redirects to login before the snapshot is read.
  return (
    <SnapshotProvider>
      <SessionGate />
    </SnapshotProvider>
  );
}
