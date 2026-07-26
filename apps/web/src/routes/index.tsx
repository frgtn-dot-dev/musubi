import { createFileRoute, redirect } from "@tanstack/react-router";
import { toDateKey } from "~/calendar/date-key";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({
      to: "/app/p/$pageId/$view",
      params: {
        pageId: "my-calendar",
        view: "month",
      },
      search: {
        date: toDateKey(new Date()),
      },
    });
  },
});
