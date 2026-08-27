import { createFileRoute, redirect } from "@tanstack/react-router";
import { toDateKey } from "~/calendar/date-key";
import { eventEditorSearchSchema } from "~/calendar/event-editor-search";

/** See the sibling `event.new` route: the editor moved under its view. */
export const Route = createFileRoute("/app/p/$pageId/event/$eventId")({
  validateSearch: eventEditorSearchSchema,
  beforeLoad: ({ params, search }) => {
    throw redirect({
      params: {
        eventId: params.eventId,
        pageId: params.pageId,
        view: search.view,
      },
      replace: true,
      search: {
        ...search,
        date: search.date ?? search.returnDate ?? toDateKey(new Date()),
      },
      to: "/app/p/$pageId/$view/event/$eventId",
    });
  },
});
