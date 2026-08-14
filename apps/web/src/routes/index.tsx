import { createFileRoute, redirect } from "@tanstack/react-router";
import { toDateKey } from "~/calendar/date-key";

export const Route = createFileRoute("/")({
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
