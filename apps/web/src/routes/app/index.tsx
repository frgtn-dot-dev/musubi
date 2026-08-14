import { createFileRoute, redirect } from "@tanstack/react-router";
import { toDateKey } from "~/calendar/date-key";

// `/app` is an entry point people type, bookmark and link to from outside —
// the marketing site's "Open Musubi" among them. Without this it matches the
// layout and nothing else, which signs-in fine and then renders an empty
// outlet: a blank page rather than a calendar.
export const Route = createFileRoute("/app/")({
  beforeLoad: () => {
    throw redirect({
      to: "/app/p/$pageId/$view",
      params: {
        // Sentinel: the workspace route resolves it to the user's real default
        // Page (a server UUID) once pages load.
        pageId: "default",
        view: "month",
      },
      search: {
        date: toDateKey(new Date()),
      },
    });
  },
});
