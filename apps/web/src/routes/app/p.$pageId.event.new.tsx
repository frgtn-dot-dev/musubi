import { createFileRoute, redirect } from "@tanstack/react-router";
import { toDateKey } from "~/calendar/date-key";
import { eventEditorSearchSchema } from "~/calendar/event-editor-search";

/**
 * The editor used to be a page of its own. It is a layer over the calendar now,
 * so its URL carries the view it sits on — and every link written before that
 * still opens it, because the old shape kept the view in its search.
 */
export const Route = createFileRoute("/app/p/$pageId/event/new")({
  validateSearch: eventEditorSearchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      params: { pageId: params.pageId, view: search.view },
      replace: true,
      search: {
        ...search,
        date: search.date ?? search.returnDate ?? toDateKey(new Date()),
      },
      to: "/app/p/$pageId/$view/event/new",
    });
  },
});
