import { createFileRoute } from "@tanstack/react-router";
import { Smartphone } from "lucide-react";
import { useState } from "react";
import { SessionGate } from "~/auth/SessionGate";
import { useNarrowViewport } from "~/design/use-narrow-viewport";
import { SnapshotProvider } from "~/offline/SnapshotProvider";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";

export const Route = createFileRoute("/app")({
  component: AppRoute,
});

const MOBILE_APP_URL =
  "https://play.google.com/store/apps/details?id=dev.frgtn.musubi";
const MOBILE_NOTICE_KEY = "musubi-mobile-web-notice-dismissed";

function AppRoute() {
  const narrow = useNarrowViewport();
  const [noticeDismissed, setNoticeDismissed] = useState(
    () =>
      typeof sessionStorage !== "undefined" &&
      sessionStorage.getItem(MOBILE_NOTICE_KEY) === "true",
  );
  const dismissNotice = () => {
    sessionStorage.setItem(MOBILE_NOTICE_KEY, "true");
    setNoticeDismissed(true);
  };

  // Above the gate on purpose: the restore has to be in flight while the gate
  // decides, or an offline start redirects to login before the snapshot is read.
  return (
    <SnapshotProvider>
      <SessionGate />
      <Dialog
        closeLabel="Close mobile notice"
        description="The web app is not fully optimized for phones yet."
        footer={
          <>
            <Button variant="secondary" onClick={dismissNotice}>
              Continue on the web
            </Button>
            <Button onClick={() => window.location.assign(MOBILE_APP_URL)}>
              Get the Android app
            </Button>
          </>
        }
        onOpenChange={(open) => {
          if (!open) dismissNotice();
        }}
        open={narrow && !noticeDismissed}
        size="compact"
        title="Musubi on mobile"
      >
        <Empty
          description="Download the app for the best experience, or continue with the limited mobile web version."
          icon={<Smartphone size={20} />}
          title="The Android app is ready for you"
        />
      </Dialog>
    </SnapshotProvider>
  );
}
