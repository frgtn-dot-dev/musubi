import {
  defaultPageConfig,
  type Calendar,
  type CreatePageRequest,
  type PageConfigV1,
  type PageDocument,
  type PageViewId,
  type SavePageRequest,
} from "@musubi/types";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "~/api/http";
import { createPage, deletePage, savePage } from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

type CalendarVisibility = PageConfigV1["calendarVisibility"];

// Which of the user's calendars a visibility config resolves to. `include`
// lists the shown ones; `all` shows everything except the explicitly hidden.
// Both intersect with the calendars that still exist, so an id the user lost
// access to just drops out of the view instead of erroring.
export function calendarIdsForVisibility(
  visibility: CalendarVisibility,
  calendars: Calendar[],
): string[] {
  const existing = calendars.map((calendar) => calendar.id);
  if (visibility.mode === "include") {
    return existing.filter((id) => visibility.calendarIds.includes(id));
  }
  return existing.filter((id) => !visibility.hiddenCalendarIds.includes(id));
}

// Flip one calendar's visibility while keeping the config's current mode, so a
// default "all" page stays "all" (new calendars keep appearing) and a curated
// "include" page stays "include".
export function toggleCalendarVisibility(
  visibility: CalendarVisibility,
  calendarId: string,
  calendars: Calendar[],
): CalendarVisibility {
  const visible = new Set(calendarIdsForVisibility(visibility, calendars));
  if (visible.has(calendarId)) {
    visible.delete(calendarId);
  } else {
    visible.add(calendarId);
  }
  const existing = calendars.map((calendar) => calendar.id);

  if (visibility.mode === "include") {
    return {
      calendarIds: existing.filter((id) => visible.has(id)),
      mode: "include",
    };
  }
  return {
    hiddenCalendarIds: existing.filter((id) => !visible.has(id)),
    mode: "all",
  };
}

export function visibilityEquals(
  left: CalendarVisibility,
  right: CalendarVisibility,
): boolean {
  if (left.mode !== right.mode) return false;
  const leftIds =
    left.mode === "include" ? left.calendarIds : left.hiddenCalendarIds;
  const rightIds =
    right.mode === "include" ? right.calendarIds : right.hiddenCalendarIds;
  if (leftIds.length !== rightIds.length) return false;
  const sortedRight = [...rightIds].sort();
  return [...leftIds].sort().every((id, index) => id === sortedRight[index]);
}

/**
 * The config a brand-new Page starts from: whatever the user is looking at.
 *
 * Visibility is written as an explicit `include` list, not `all` — a curated
 * page must not silently pick up every calendar added later (12-open-decisions).
 * The view keeps its presentation options when the current view matches the one
 * being branched off, so "new page from this compact week" stays compact.
 */
export function newPageConfig(
  view: PageViewId,
  currentView: PageConfigV1["view"],
  visibleCalendarIds: string[],
): PageConfigV1 {
  const base = defaultPageConfig(view);

  return {
    ...base,
    calendarVisibility: { calendarIds: visibleCalendarIds, mode: "include" },
    view: view === currentView.id ? currentView : base.view,
  };
}

export type SavePageResult =
  | { status: "saved"; page: PageDocument }
  | { status: "conflict" };

export function usePageMutations(userId: string) {
  const queryClient = useQueryClient();
  const pagesKey = queryKeys.pages(getServerOrigin(), userId);

  const replaceInCache = (page: PageDocument) => {
    queryClient.setQueryData<PageDocument[]>(pagesKey, (current) => {
      const list = current ?? [];
      return list.some((item) => item.id === page.id)
        ? list.map((item) => (item.id === page.id ? page : item))
        : [...list, page];
    });
  };

  return {
    createPage: async (request: CreatePageRequest) => {
      const page = await createPage(request);
      replaceInCache(page);
      return page;
    },
    deletePage: async (id: string) => {
      await deletePage(id);
      // Drop it locally first: the sidebar loses the row and the route's
      // unknown-page fallback redirects immediately, without waiting on a
      // refetch. The refetch then brings whichever page the server promoted to
      // default. Both match what the `page_removed` SSE frame does, so the echo
      // is a no-op.
      queryClient.setQueryData<PageDocument[]>(pagesKey, (current) =>
        (current ?? []).filter((page) => page.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: pagesKey });
    },
    savePage: async (input: {
      baseRevision: number;
      config: PageConfigV1;
      id: string;
      name: string;
    }): Promise<SavePageResult> => {
      const request: SavePageRequest = {
        baseRevision: input.baseRevision,
        config: input.config,
        name: input.name,
      };
      try {
        const page = await savePage(input.id, request);
        replaceInCache(page);
        return { page, status: "saved" };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          // Someone else moved the revision. Pull the latest so the read view
          // is current; the editor offers discard or save-as-copy.
          await queryClient.invalidateQueries({ queryKey: pagesKey });
          return { status: "conflict" };
        }
        throw error;
      }
    },
  };
}
