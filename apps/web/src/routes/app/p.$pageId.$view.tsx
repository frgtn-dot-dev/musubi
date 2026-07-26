import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { toDateKey } from "~/calendar/date-key";
import { Workspace } from "~/calendar/components/Workspace";
import {
  isCalendarView,
  type CalendarViewId,
} from "~/calendar/view-registry";

const searchSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .catch(() => toDateKey(new Date())),
});

export const Route = createFileRoute("/app/p/$pageId/$view")({
  validateSearch: searchSchema,
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { pageId, view } = Route.useParams();
  const { date } = Route.useSearch();
  const navigate = Route.useNavigate();
  const activeView: CalendarViewId =
    isCalendarView(view) && view === "month" ? view : "month";

  return (
    <Workspace
      activeView={activeView}
      date={date}
      pageId={pageId}
      onDateChange={(nextDate) =>
        void navigate({
          search: { date: nextDate },
        })
      }
      onPageChange={(nextPageId) =>
        void navigate({
          params: { pageId: nextPageId, view: activeView },
          search: { date },
          to: "/app/p/$pageId/$view",
        })
      }
      onViewChange={(nextView) =>
        void navigate({
          params: { pageId, view: nextView },
          search: { date },
          to: "/app/p/$pageId/$view",
        })
      }
    />
  );
}
