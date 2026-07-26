import type {
  Calendar,
  CreatePageRequest,
  PageConfigV1,
  PageDocument,
  SavePageRequest,
} from "@musubi/types";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "~/api/http";
import { createPage, savePage } from "~/api/resources";
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
