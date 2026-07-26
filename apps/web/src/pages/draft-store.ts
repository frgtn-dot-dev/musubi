import { create } from "zustand";

type PageDraft = {
  calendarIds: string[];
  persistedCalendarIds: string[];
};

type PageDraftState = {
  drafts: Record<string, PageDraft>;
  discard: (pageId: string) => void;
  save: (pageId: string) => void;
  toggleCalendar: (pageId: string, calendarId: string) => void;
};

const allCalendars = ["personal", "studio", "client-work", "family-calendar"];

const initialDrafts: Record<string, PageDraft> = {
  "my-calendar": {
    calendarIds: allCalendars,
    persistedCalendarIds: allCalendars,
  },
  work: {
    calendarIds: ["studio", "client-work"],
    persistedCalendarIds: ["studio", "client-work"],
  },
  family: {
    calendarIds: ["personal", "family-calendar"],
    persistedCalendarIds: ["personal", "family-calendar"],
  },
  planning: {
    calendarIds: allCalendars,
    persistedCalendarIds: allCalendars,
  },
};

function getDraft(drafts: Record<string, PageDraft>, pageId: string): PageDraft {
  return drafts[pageId] ?? initialDrafts["my-calendar"]!;
}

export const usePageDraftStore = create<PageDraftState>((set) => ({
  drafts: initialDrafts,
  discard: (pageId) =>
    set((state) => {
      const draft = getDraft(state.drafts, pageId);

      return {
        drafts: {
          ...state.drafts,
          [pageId]: {
            ...draft,
            calendarIds: draft.persistedCalendarIds,
          },
        },
      };
    }),
  save: (pageId) =>
    set((state) => {
      const draft = getDraft(state.drafts, pageId);

      return {
        drafts: {
          ...state.drafts,
          [pageId]: {
            ...draft,
            persistedCalendarIds: draft.calendarIds,
          },
        },
      };
    }),
  toggleCalendar: (pageId, calendarId) =>
    set((state) => {
      const draft = getDraft(state.drafts, pageId);
      const contains = draft.calendarIds.includes(calendarId);
      const calendarIds = contains
        ? draft.calendarIds.filter((id) => id !== calendarId)
        : [...draft.calendarIds, calendarId];

      return {
        drafts: {
          ...state.drafts,
          [pageId]: {
            ...draft,
            calendarIds,
          },
        },
      };
    }),
}));

export function selectCalendarIds(pageId: string) {
  return (state: PageDraftState) => getDraft(state.drafts, pageId).calendarIds;
}

export function selectPageDirty(pageId: string) {
  return (state: PageDraftState) => {
    const draft = getDraft(state.drafts, pageId);
    return (
      draft.calendarIds.length !== draft.persistedCalendarIds.length ||
      draft.calendarIds.some(
        (calendarId) => !draft.persistedCalendarIds.includes(calendarId),
      )
    );
  };
}
