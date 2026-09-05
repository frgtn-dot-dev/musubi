import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema } from "@musubi/types";

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  toast: vi.fn(),
  choose: vi.fn(),
  confirm: vi.fn(),
  reminders: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: () => {},
  useState: (value: unknown) => [value, vi.fn()],
}));
vi.mock("react-native", () => ({
  Text: "Text",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  Linking: {},
  Platform: { OS: "android" },
}));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/contexts/ServerContext", () => ({
  useServer: () => ({
    apiUrl: "https://home.example.test",
    authClient: {
      $fetch: mocks.request,
      useSession: () => ({ data: { user: { id: "owner" } } }),
    },
  }),
}));
vi.mock("@/hooks/useModalAnimation", () => ({
  useModalAnimation: () => ({ handleClose: mocks.close }),
}));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("react-native-gesture-handler", () => ({
  GestureDetector: "GestureDetector",
  GestureHandlerRootView: "GestureHandlerRootView",
}));
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", Feather: "Icon" }));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
vi.mock("@/components/Avatar", () => ({ Avatar: "Avatar" }));
vi.mock("./CalendarPickerModal", () => ({ default: "CalendarPickerModal" }));
vi.mock("@/components/ui/Toast", () => ({ showToast: mocks.toast }));
vi.mock("@/lib/confirm", () => ({
  chooseOption: mocks.choose,
  confirm: mocks.confirm,
}));
vi.mock("@/store/useCalendarsStore", () => ({
  useCalendarsStore: () => ({
    calendars: [
      { id: "calendar", creatorID: "owner", role: "owner", name: "Calendar" },
    ],
  }),
}));
vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: () => ({ timeFormat: "24h", dateFormat: "dmy" }),
}));
vi.mock("@/store/useAttendeesStore", () => ({
  useAttendeesStore: () => ({ byEvent: {}, setAttendees: vi.fn() }),
}));
vi.mock("@/services/eventsCache", () => ({
  cacheDeleteEvents: vi.fn(async () => {}),
  cacheUpsertEvents: vi.fn(async () => {}),
}));
vi.mock("@/services/federation", () => ({
  setHomeRequester: vi.fn(),
  remoteForCalendar: vi.fn(),
  fedFetch: vi.fn(),
}));
vi.mock("@/services/notifications", () => ({
  setReminderWriter: vi.fn(),
  cancelEventNotification: vi.fn(async () => {}),
  syncScheduledReminders: mocks.reminders,
}));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));
vi.mock("@/store/useEventsStore", async (original) => {
  const actual = await original<typeof import("@/store/useEventsStore")>();
  return {
    useEventsStore: Object.assign(
      () => actual.useEventsStore.getState(),
      actual.useEventsStore,
    ),
  };
});

const { default: EventDetailModal } = await import("./EventDetailModal");
const { useEventsStore } = await import("@/store/useEventsStore");
const { useApi } = await import("@/services/api");
const { applySeriesEdit } = await import("@/lib/seriesEdit");
const master = EventSchema.parse({
  revision: 1,
  id: "event",
  creatorID: "owner",
  organizer: "owner",
  title: "Keep detail",
  color: "#7A8BA3",
  start: "2026-07-06T09:00:00Z",
  end: "2026-07-06T10:00:00Z",
  isAllDay: false,
  isCanceled: false,
  calendars: ["calendar"],
  originCalendarID: "calendar",
  recurrence: "RRULE:FREQ=WEEKLY",
});
const occurrence = {
  ...master,
  start: new Date("2026-07-20T09:00:00Z"),
  end: new Date("2026-07-20T10:00:00Z"),
};
function text(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(text).join("");
  return isValidElement<{ children?: ReactNode }>(node)
    ? text(node.props.children)
    : "";
}
function deleteButton(node: ReactNode): (() => void) | undefined {
  if (Array.isArray(node)) return node.map(deleteButton).find(Boolean);
  if (!isValidElement<{ onPress?: () => void; children?: ReactNode }>(node))
    return;
  if (node.props.onPress && text(node) === "Delete") return node.props.onPress;
  return deleteButton(node.props.children);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.choose.mockReset();
  mocks.request.mockReset();
  useEventsStore.setState({ events: [master] });
  mocks.reminders.mockResolvedValue(undefined);
});
it.each(["denied", "unknown", "unsupported"])(
  "native scope callback serializes all steps but never persists intent after %s",
  async (reason) => {
    const api = useApi();
    const message = `This recurrence operation is ${reason}. No changes were saved.`;
    mocks.choose.mockImplementation((_title, _message, options) =>
      options[0].onPress(),
    );
    mocks.request.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(options.method).toBe("PATCH");
      expect(body.scopeEdit.updates).toHaveLength(1);
      expect(body.scopeEdit.creates[0].title).toBe("Draft survives refusal");
      expect(useEventsStore.getState().events[0]).not.toHaveProperty(
        "scopeEdit",
      );
      return { error: { status: 403, error: message, reason }, data: null };
    });
    const edited = { ...occurrence, title: "Draft survives refusal" };
    await expect(
      applySeriesEdit({
        edited,
        master,
        occurrence,
        addEvent: (event) => useEventsStore.getState().addEvent(event, api),
        updateEvent: (event) =>
          useEventsStore.getState().updateEvent(event, api),
      }),
    ).rejects.toThrow(message);
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(edited.title).toBe("Draft survives refusal");
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.reminders).not.toHaveBeenCalled();
    expect(useEventsStore.getState().events).toEqual([master]);
  },
);

for (const scope of [
  "This event only",
  "This and following events",
  "All events",
  "plain",
]) {
  it.each(["denied", "unknown", "unsupported", "success"])(
    `real native ${scope} callback awaits save and preserves detail on %s`,
    async (reason) => {
      let complete!: (value: unknown) => void;
      mocks.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      );
      const button = deleteButton(
        EventDetailModal({
          visible: true,
          event:
            scope === "plain"
              ? { ...occurrence, recurrence: null }
              : occurrence,
          onClose: mocks.close,
          onEdit: vi.fn(),
        }),
      );
      expect(button).toBeDefined();
      button!();
      const callback =
        scope === "plain"
          ? mocks.confirm.mock.lastCall![1]
          : mocks.choose.mock.lastCall![2].find(
              (option: { label: string }) => option.label === scope,
            ).onPress;
      const pending = callback();
      await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
      expect(mocks.close).not.toHaveBeenCalled();
      expect(mocks.reminders).not.toHaveBeenCalled();
      const message = `Event writing is ${reason}. No changes were saved.`;
      const deletion = ["plain", "All events"].includes(scope);
      const options = mocks.request.mock.lastCall![1];
      const { scopeEdit, ...update } = JSON.parse(options.body);
      expect(options.method).toBe(deletion ? "DELETE" : "PATCH");
      if (deletion) expect(scopeEdit).toBeUndefined();
      else {
        expect(scopeEdit).toEqual({ updates: [update], creates: [] });
        expect(useEventsStore.getState().events[0]).not.toHaveProperty(
          "scopeEdit",
        );
      }
      complete(
        reason === "success"
          ? {
              error: null,
              data: deletion
                ? { id: master.id, calendars: [], removed: true }
                : master,
            }
          : {
              error: {
                status: 403,
                error: message,
                reason,
                capability: "event-write",
              },
              data: null,
            },
      );
      await pending;
      if (reason === "success") {
        expect(mocks.close).toHaveBeenCalledOnce();
        expect(mocks.toast).not.toHaveBeenCalled();
        expect(mocks.reminders).toHaveBeenCalledTimes(deletion ? 0 : 2);
      } else {
        expect(mocks.close).not.toHaveBeenCalled();
        expect(mocks.reminders).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenCalledWith({ message });
        expect(useEventsStore.getState().events[0]?.title).toBe(master.title);
      }
    },
  );
}

for (const reconciliation of [
  "other-removal",
  "full-unchanged-target",
] as const) {
  it(`confirmed B deletion closes detail only after applying cache/reminder cleanup despite ${reconciliation} of A`, async () => {
    const { cacheDeleteEvents } = await import("@/services/eventsCache");
    const { cancelEventNotification } = await import(
      "@/services/notifications"
    );
    const target = { ...master, recurrence: null };
    const other = { ...target, id: "other" };
    useEventsStore.setState({ events: [other, target] });
    let complete!: (value: unknown) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    deleteButton(
      EventDetailModal({
        visible: true,
        event: target,
        onClose: mocks.close,
        onEdit: vi.fn(),
      }),
    )!();
    const pending = mocks.confirm.mock.lastCall![1]();
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    if (reconciliation === "other-removal")
      await useEventsStore
        .getState()
        .localRemoveEvent({ ...other, revision: 3 });
    else useEventsStore.getState().loadEvents([target]);
    vi.mocked(cacheDeleteEvents).mockClear();
    vi.mocked(cancelEventNotification).mockClear();
    expect(mocks.close).not.toHaveBeenCalled();
    complete({
      data: { id: target.id, removed: true, calendars: [], revision: 2 },
      error: null,
    });
    await pending;
    expect(useEventsStore.getState().events).toEqual([]);
    expect(cacheDeleteEvents).toHaveBeenCalledWith([target.id]);
    expect(cancelEventNotification).toHaveBeenCalledWith(target.id);
    expect(mocks.close).toHaveBeenCalledOnce();
  });
}
