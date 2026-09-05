import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema, DEFAULT_REMINDER_RULE } from "@musubi/types";

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => void)[],
  collectEffects: false,
}));
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  close: vi.fn(),
  alert: vi.fn(),
  reminder: vi.fn(),
  reconcile: vi.fn(),
  cache: vi.fn(),
  stream: {} as Record<string, (event: { data: string }) => void>,
  refresh: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useEffect: (effect: () => void) => {
    if (state.collectEffects) state.effects.push(effect);
  },
  useMemo: (fn: () => unknown) => fn(),
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values))
      state.values[index] = typeof initial === "function" ? initial() : initial;
    return [
      state.values[index],
      (value: unknown) => {
        state.values[index] =
          typeof value === "function" ? value(state.values[index]) : value;
      },
    ];
  },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native", () => ({
  Text: "Text",
  TextInput: "TextInput",
  Switch: "Switch",
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  View: "View",
  ActivityIndicator: "ActivityIndicator",
  Alert: { alert: mocks.alert },
  Keyboard: { dismiss: vi.fn() },
  Platform: { OS: "android" },
  StyleSheet: { create: (value: unknown) => value },
  useWindowDimensions: () => ({ width: 390, height: 800 }),
}));
vi.mock("@/constants/theme", () => ({
  colors: {},
  fonts: {},
  styles: {},
  activeScheme: () => "light",
}));
vi.mock("@/contexts/ServerContext", () => ({
  useServer: () => ({
    apiUrl: "https://home.example.test",
    authClient: {
      $fetch: mocks.request,
      getSession: async () => ({
        data: { session: { token: "test-session" } },
      }),
      useSession: () => ({ data: { user: { id: "owner" } } }),
    },
  }),
}));
vi.mock("@/hooks/useModalAnimation", () => ({
  useModalAnimation: (_visible: boolean, close: () => void) => ({
    handleClose: () => {
      mocks.close();
      close();
    },
  }),
}));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("react-native-gesture-handler", () => {
  const chain: unknown = new Proxy(() => {}, {
    get: () => chain,
    apply: () => chain,
  });
  return {
    GestureDetector: "GestureDetector",
    GestureHandlerRootView: "GestureHandlerRootView",
    Gesture: { Pan: () => chain },
  };
});
vi.mock("react-native-reanimated", () => ({
  default: { View: "AnimatedView" },
  useSharedValue: (value: unknown) => ({ value }),
  useAnimatedStyle: () => ({}),
  withSpring: (value: unknown) => value,
  withTiming: (value: unknown) => value,
  runOnJS: (fn: unknown) => fn,
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, top: 0 }),
}));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", Feather: "Icon" }));
vi.mock("@expo/ui/community/datetime-picker", () => ({
  DateTimePicker: "DateTimePicker",
}));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/ui/OptionPicker", () => ({
  OptionPicker: "OptionPicker",
}));
vi.mock("@/components/SettingRow", () => ({
  SettingRowAction: "SettingRowAction",
}));
vi.mock("@/components/ui/Toast", () => ({ showToast: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ success: vi.fn(), warn: vi.fn() }));
vi.mock("@/store/useSettingsStore", () => ({
  useSettingsStore: () => ({
    timeFormat: "24h",
    dateFormat: "dmy",
    calendarOrder: [],
    tabBarLabels: false,
  }),
}));
vi.mock("@/services/federation", () => ({
  setHomeRequester: vi.fn(),
  remoteForCalendar: vi.fn(),
  fedFetch: vi.fn(),
}));
vi.mock("@/services/notifications", () => ({
  setReminderWriter: vi.fn(),
  setEventReminderRule: mocks.reminder,
  syncScheduledReminders: mocks.reconcile,
  cancelEventNotification: vi.fn(),
  reminderRules: () => ({ events: { event: DEFAULT_REMINDER_RULE } }),
  effectiveReminderRule: () => DEFAULT_REMINDER_RULE,
  inheritedReminderRule: () => DEFAULT_REMINDER_RULE,
  requestEventNotificationPermission: vi.fn(async () => true),
}));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));

vi.mock("react-native-sse", () => ({
  default: class {
    addEventListener(name: string, fn: (event: { data: string }) => void) {
      mocks.stream[name] = fn;
    }
    close() {}
  },
}));
vi.mock("expo-network", () => ({
  addNetworkStateListener: () => ({ remove() {} }),
}));
vi.mock("@/lib/serverDiagnostics", () => ({ recordServerDiagnostic: vi.fn() }));
vi.mock("@/hooks/useRefreshData", () => ({
  useRefreshData: () => mocks.refresh,
}));
vi.mock("@/store/useAttendeesStore", () => ({
  useAttendeesStore: () => vi.fn(),
}));
const { useConnectToEventStream } = await import("@/hooks/useEventsStream");
function StreamHost() {
  useConnectToEventStream();
  return null;
}
async function receiveEvent(event: typeof master) {
  state.effects = [];
  state.collectEffects = true;
  StreamHost();
  state.collectEffects = false;
  for (const effect of state.effects) effect();
  await vi.waitFor(() => expect(mocks.stream.message).toBeTypeOf("function"));
  mocks.stream.message({
    data: JSON.stringify({ type: "event_updated", payload: event }),
  });
  await vi.waitFor(() =>
    expect(
      useEventsStore.getState().events.find((e) => e.id === event.id)?.revision,
    ).toBe(event.revision),
  );
}

const { AddEventModal } = await import("./AddEventModal");
vi.mock("./EventDetailModal", () => ({ default: "EventDetailModal" }));
vi.mock("@/services/eventsCache", () => ({
  cacheDeleteEvents: mocks.cache,
  cacheUpsertEvents: mocks.cache,
}));
vi.mock("@/store/useCalendarsStore", () => ({
  useCalendarsStore: () => ({
    calendars: [
      {
        id: "calendar",
        creatorID: "owner",
        role: "owner",
        name: "Calendar",
        color: "#7A8BA3",
      },
    ],
  }),
}));
vi.mock("@/store/useEventsStore", async (original) => {
  const actual = await original<typeof import("@/store/useEventsStore")>();
  return {
    useEventsStore: Object.assign(
      () => actual.useEventsStore.getState(),
      actual.useEventsStore,
    ),
  };
});
vi.mock("@/store/useEventDetailStore", async (original) => {
  const actual = await original<typeof import("@/store/useEventDetailStore")>();
  return {
    ...actual,
    useEventDetailStore: Object.assign(
      () => actual.useEventDetailStore.getState(),
      actual.useEventDetailStore,
    ),
    useEditComposerStore: Object.assign(
      () => actual.useEditComposerStore.getState(),
      actual.useEditComposerStore,
    ),
  };
});
const { GlobalEventModals } = await import("./GlobalEventModals");
const { useEventsStore } = await import("@/store/useEventsStore");
const { useEditComposerStore } = await import("@/store/useEventDetailStore");
const master = EventSchema.parse({
  revision: 1,
  id: "event",
  creatorID: "owner",
  organizer: "owner",
  title: "Standup",
  color: "#7A8BA3",
  start: "2026-07-06T09:00:00Z",
  end: "2026-07-06T10:00:00Z",
  isAllDay: false,
  isCanceled: false,
  calendars: ["calendar"],
  originCalendarID: "calendar",
  recurrence: "FREQ=WEEKLY",
});
const occurrence = {
  ...master,
  start: new Date("2026-07-20T09:00:00Z"),
  end: new Date("2026-07-20T10:00:00Z"),
};

// Execute the real host-provided props, not a stand-in boolean callback. Native
// hosts/animation are the seam; the form effects, scope helper, stores and API run.
function renderComposer(mount = false) {
  const host = GlobalEventModals();
  const composer = host.props.children.find(
    (child: { type: unknown }) => child.type === AddEventModal,
  );
  state.index = 0;
  state.collectEffects = mount;
  const tree = AddEventModal(composer.props);
  state.collectEffects = false;
  if (mount) {
    state.effects.splice(0).forEach((effect) => effect());
    return renderComposer();
  }
  return tree;
}
function titleInput(
  node: ReactNode,
): { value: string; onChangeText: (value: string) => void } | undefined {
  if (Array.isArray(node)) return node.map(titleInput).find(Boolean);
  if (
    !isValidElement<{
      value: string;
      onChangeText: (value: string) => void;
      children?: ReactNode;
    }>(node)
  )
    return;
  if (node.type === "TextInput") return node.props;
  return titleInput(node.props.children);
}
function scopeAnswer(label: string) {
  expect(mocks.alert.mock.lastCall![0]).toBe("Change recurring event");
  const options = mocks.alert.mock.lastCall![2] as {
    text: string;
    onPress: () => void;
  }[];
  options.find((option) => option.text === label)!.onPress();
}
type Props = {
  label?: string;
  onPress?: () => Promise<void>;
  children?: ReactNode;
};
function saveButton(node: ReactNode): Props | undefined {
  if (Array.isArray(node)) return node.map(saveButton).find(Boolean);
  if (!isValidElement<Props>(node)) return;
  if (node.props.label === "Save") return node.props;
  return saveButton(node.props.children);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.stream = {};
  mocks.request.mockReset();
  mocks.cache.mockResolvedValue(undefined);
  mocks.reconcile.mockResolvedValue(undefined);
  mocks.reminder.mockImplementation(async () => {
    await mocks.reconcile();
  });
  state.index = 0;
  state.values = [];
  state.effects = [];
  state.collectEffects = false;
  useEventsStore.setState({ events: [master] });
  useEditComposerStore.getState().open(occurrence);
});

it("GlobalEventModals scope Cancel retains the actual draft and reminders, then a successful retry saves and closes", async () => {
  const tree = renderComposer(true);
  titleInput(tree)!.onChangeText("Keep native draft");
  const mutations = vi.fn();
  const unsubscribe = useEventsStore.subscribe(mutations);
  const cancelled = saveButton(renderComposer())!.onPress!();
  await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
  scopeAnswer("Cancel");
  await cancelled;
  expect(useEditComposerStore.getState().visible).toBe(true);
  expect(titleInput(renderComposer())!.value).toBe("Keep native draft");
  expect(useEditComposerStore.getState().prefilled).toEqual(occurrence);
  expect(state.values[7]).toEqual(DEFAULT_REMINDER_RULE);
  expect(useEventsStore.getState().events).toEqual([master]);
  expect(mutations).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
  expect(mocks.reminder).not.toHaveBeenCalled();
  expect(mocks.reconcile).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  unsubscribe();

  let complete!: (value: unknown) => void;
  mocks.request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const saved = saveButton(renderComposer())!.onPress!();
  await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledTimes(2));
  scopeAnswer("All events");
  await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.reminder).not.toHaveBeenCalled();
  const options = mocks.request.mock.lastCall![1];
  expect(options.method).toBe("PATCH");
  const { scopeEdit, ...update } = JSON.parse(options.body);
  expect(update.expectedRevision).toBe(1);
  expect(update.patch).toEqual({ title: "Keep native draft" });
  expect(scopeEdit).toEqual({ updates: [update], creates: [] });
  expect(useEventsStore.getState().events[0]).not.toHaveProperty("scopeEdit");
  complete({ error: null, data: { ...master, ...update.patch, revision: 2 } });
  await saved;
  expect(mocks.reminder).toHaveBeenCalledOnce();
  expect(mocks.reconcile).toHaveBeenCalledTimes(2);
  expect(mocks.close).toHaveBeenCalledOnce();
  expect(useEditComposerStore.getState().visible).toBe(false);
  expect(titleInput(renderComposer())!.value).toBe("");
  expect(useEventsStore.getState().events[0]).toMatchObject({
    title: "Keep native draft",
    start: master.start,
    end: master.end,
  });
  expect(useEventsStore.getState().events[0]).not.toHaveProperty("scopeEdit");
});

it.each(["denied", "unknown", "unsupported", "network"])(
  "GlobalEventModals form keeps draft and reminders after real scoped %s",
  async (reason) => {
    const message = `Event writing is ${reason}. No changes were saved.`;
    mocks.request.mockImplementation(async () => {
      if (reason === "network") throw new Error(message);
      return {
        error: {
          status: 403,
          error: message,
          reason,
          capability: "event-write",
        },
        data: null,
      };
    });
    titleInput(renderComposer(true))!.onChangeText("Keep native draft");
    const pending = saveButton(renderComposer())!.onPress!();
    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
    scopeAnswer("This event");
    await pending;
    expect(mocks.request).toHaveBeenCalledOnce();
    const { scopeEdit } = JSON.parse(mocks.request.mock.lastCall![1].body);
    expect(scopeEdit.creates[0]).toMatchObject({
      title: "Keep native draft",
      start: occurrence.start.toISOString(),
      end: occurrence.end.toISOString(),
    });
    expect(mocks.alert).toHaveBeenLastCalledWith("Failed to save", message);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(useEditComposerStore.getState().visible).toBe(true);
    expect(titleInput(renderComposer())!.value).toBe("Keep native draft");
    expect(state.values[7]).toEqual(DEFAULT_REMINDER_RULE);
    expect(useEventsStore.getState().events).toEqual([master]);
  },
);

it.each([
  "event-revision-conflict",
  "provider-conflict",
  "network",
  "401",
  "426",
])(
  "K06 real composer keeps frozen master and newer SSE across %s",
  async (code) => {
    titleInput(renderComposer(true))!.onChangeText("Second draft title");
    const newer = {
      ...master,
      revision: 3,
      title: "Inbound title",
      start: new Date("2026-07-06T12:00:00Z"),
      end: new Date("2026-07-06T13:00:00Z"),
    };
    await useEventsStore.getState().localUpdateEvent(newer);
    mocks.reconcile.mockClear();
    mocks.cache.mockClear();
    mocks.request.mockImplementation(async (_url, options) => {
      const body = JSON.parse(options.body);
      expect(body.expectedRevision).toBe(1);
      expect(body.patch).toEqual({ title: "Second draft title" });
      expect(useEventsStore.getState().events[0]).toEqual(newer);
      if (code === "network") throw new TypeError("Network failed");
      if (["401", "426"].includes(code))
        return {
          error: { status: Number(code), message: "Upgrade or sign in" },
          data: null,
        };
      return {
        error: {
          status: 409,
          error:
            code === "provider-conflict"
              ? "Saved locally. Remote delivery unconfirmed. Refresh and reconcile."
              : "Event changed. Refresh and reconcile.",
          code,
          localCommitted: code === "provider-conflict",
          current: { ...newer, revision: 2 },
        },
        data: null,
      };
    });
    const pending = saveButton(renderComposer())!.onPress!();
    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
    scopeAnswer("All events");
    await pending;
    expect(mocks.request).toHaveBeenCalledOnce();
    expect(useEditComposerStore.getState().visible).toBe(true);
    expect(titleInput(renderComposer())!.value).toBe("Second draft title");
    expect(useEventsStore.getState().events[0]).toEqual(newer);
    expect(useEditComposerStore.getState().master?.revision).toBe(1);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.reminder).not.toHaveBeenCalled();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
  },
);

it("K06 revisionless native cache is nonwritable without mutating cache or reminders", async () => {
  const old = { ...occurrence, revision: undefined };
  useEventsStore.setState({ events: [{ ...master, revision: undefined }] });
  useEditComposerStore.getState().open(old);
  titleInput(renderComposer(true))!.onChangeText("Keep old cache draft");
  const pending = saveButton(renderComposer())!.onPress!();
  await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
  scopeAnswer("All events");
  await pending;
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.cache).not.toHaveBeenCalled();
  expect(mocks.reminder).not.toHaveBeenCalled();
  expect(mocks.close).not.toHaveBeenCalled();
  expect(titleInput(renderComposer())!.value).toBe("Keep old cache draft");
  expect(mocks.alert).toHaveBeenLastCalledWith(
    "Failed to save",
    expect.stringContaining("revision is unavailable"),
  );
});

it.each(["network", "provider-conflict"])(
  "K06 in-flight %s never rolls back over a later SSE",
  async (code) => {
    titleInput(renderComposer(true))!.onChangeText("Pending draft");
    let complete!: (value: unknown) => void;
    let fail!: (error: Error) => void;
    mocks.request.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          complete = resolve;
          fail = reject;
        }),
    );
    const pending = saveButton(renderComposer())!.onPress!();
    await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
    scopeAnswer("All events");
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledOnce());
    expect(useEventsStore.getState().events[0].title).toBe("Pending draft");
    const inbound = {
      ...master,
      revision: 4,
      title: "Later inbound",
      start: new Date("2026-07-06T14:00:00Z"),
    };
    await receiveEvent(inbound);
    mocks.cache.mockClear();
    mocks.reconcile.mockClear();
    if (code === "network") fail(new TypeError("Network failed"));
    else
      complete({
        error: {
          status: 409,
          code,
          error:
            "Saved locally. Remote delivery unconfirmed. Refresh and reconcile.",
          localCommitted: true,
          current: { ...master, title: "Pending draft", revision: 2 },
        },
        data: null,
      });
    await pending;
    expect(useEventsStore.getState().events[0]).toEqual(inbound);
    expect(titleInput(renderComposer())!.value).toBe("Pending draft");
    expect(useEditComposerStore.getState().master?.revision).toBe(1);
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.reminder).not.toHaveBeenCalled();
  },
);

it("K06 actual native SSE removal respects revisions and reconciles an unversioned access-loss frame", async () => {
  renderComposer(true);
  const inbound = { ...master, revision: 3 };
  await receiveEvent(inbound);
  const { serializeEventRefresh } = await import("@/lib/eventSync");
  mocks.stream.message({
    data: JSON.stringify({
      type: "event_removed",
      payload: { id: master.id, revision: 2 },
    }),
  });
  await serializeEventRefresh(async () => undefined);
  expect(useEventsStore.getState().events[0].revision).toBe(3);
  mocks.stream.message({
    data: JSON.stringify({ type: "event_removed", payload: { id: master.id } }),
  });
  expect(mocks.refresh).toHaveBeenCalledWith({
    providerSync: false,
    full: true,
  });
  expect(useEventsStore.getState().events[0].revision).toBe(3);
  mocks.stream.message({
    data: JSON.stringify({
      type: "event_removed",
      payload: { id: master.id, revision: 3 },
    }),
  });
  await serializeEventRefresh(async () => undefined);
  expect(useEventsStore.getState().events).toEqual([]);
  expect(useEditComposerStore.getState().master?.revision).toBe(1);
});

it("K06 postcommit failure accepts server truth without closing or advancing the draft baseline", async () => {
  titleInput(renderComposer(true))!.onChangeText("Locally committed draft");
  mocks.request.mockResolvedValueOnce({
    data: null,
    error: {
      status: 409,
      code: "provider-conflict",
      error:
        "Saved locally. Remote delivery unconfirmed. Refresh and reconcile.",
      localCommitted: true,
      currentRevision: 2,
      current: { ...master, title: "Locally committed draft", revision: 2 },
    },
  });
  const pending = saveButton(renderComposer())!.onPress!();
  await vi.waitFor(() => expect(mocks.alert).toHaveBeenCalledOnce());
  scopeAnswer("All events");
  await pending;
  expect(useEventsStore.getState().events[0]).toMatchObject({
    title: "Locally committed draft",
    revision: 2,
  });
  expect(mocks.cache).toHaveBeenLastCalledWith([
    expect.objectContaining({ revision: 2 }),
  ]);
  expect(mocks.reconcile).toHaveBeenCalledOnce();
  expect(titleInput(renderComposer())!.value).toBe("Locally committed draft");
  expect(useEditComposerStore.getState().master?.revision).toBe(1);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.reminder).not.toHaveBeenCalled();
});
