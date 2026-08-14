import { createFileRoute } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";
import { SessionGate } from "~/auth/SessionGate";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { SnapshotProvider } from "~/offline/SnapshotProvider";
import { Button } from "~/ui/Button";
import { Empty } from "~/ui/Empty";
import styles from "./app.module.css";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

const MOBILE_APP_URL =
  "https://play.google.com/store/apps/details?id=dev.frgtn.musubi";
const MOBILE_WEB_TEST_BYPASS = "musubi-mobile-web-test-bypass";

function AppRoute() {
  const narrow = useNarrowViewport();
  const testBypass =
    typeof sessionStorage !== "undefined" &&
    sessionStorage.getItem(MOBILE_WEB_TEST_BYPASS) === "true";

  // Above the gate on purpose: the restore has to be in flight while the gate
  // decides, or an offline start redirects to login before the snapshot is read.
  return (
    <SnapshotProvider>
      {narrow && !testBypass ? (
        <main className={styles.mobileBlocker}>
          <Empty
            action={
              <Button onClick={() => window.location.assign(MOBILE_APP_URL)}>
                Get the Android app
              </Button>
            }
            aria-label="Musubi on mobile"
            aria-modal="true"
            description="The web app is not fully optimized for phones yet. Download the app for the full Musubi experience."
            icon={<Smartphone size={20} />}
            role="dialog"
            title="Musubi works best in the app"
          />
        </main>
      ) : (
        <SessionGate />
      )}
    </SnapshotProvider>
  );
}
