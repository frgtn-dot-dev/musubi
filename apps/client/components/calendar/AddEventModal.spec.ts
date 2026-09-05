import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { Calendar, Event } from "@musubi/types";

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
const mocks = vi.hoisted(() => ({ request: vi.fn(), close: vi.fn(), alert: vi.fn(), reminder: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(), useEffect: () => {},
  useMemo: (fn: () => unknown) => fn(), useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial;
    return [state.values[index], (value: unknown) => { state.values[index] = value; }];
  },
}));
vi.mock("react-native-get-random-values", () => ({}));
vi.mock("react-native", () => ({ Text: "Text", TextInput: "TextInput", Switch: "Switch", Pressable: "Pressable", ScrollView: "ScrollView", View: "View", ActivityIndicator: "ActivityIndicator", Alert: { alert: mocks.alert }, Keyboard: { dismiss: vi.fn() }, Platform: { OS: "android" }, StyleSheet: { create: (value: unknown) => value }, useWindowDimensions: () => ({ width: 390, height: 800 }) }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {}, activeScheme: () => "light" }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: "https://home.example.test", authClient: { $fetch: mocks.request, useSession: () => ({ data: { user: { id: "owner" } } }) } }) }));
vi.mock("@/hooks/useModalAnimation", () => ({ useModalAnimation: () => ({ handleClose: mocks.close }) }));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("react-native-gesture-handler", () => {
  const chain: unknown = new Proxy(() => {}, { get: () => chain, apply: () => chain });
  return { GestureDetector: "GestureDetector", GestureHandlerRootView: "GestureHandlerRootView", Gesture: { Pan: () => chain } };
});
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" }, useSharedValue: (value: unknown) => ({ value }), useAnimatedStyle: () => ({}), withSpring: (value: unknown) => value, withTiming: (value: unknown) => value, runOnJS: (fn: unknown) => fn }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0, top: 0 }) }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon", Feather: "Icon" }));
vi.mock("@expo/ui/community/datetime-picker", () => ({ DateTimePicker: "DateTimePicker" }));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/ui/OptionPicker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("@/components/SettingRow", () => ({ SettingRowAction: "SettingRowAction" }));
vi.mock("@/components/ui/Toast", () => ({ showToast: vi.fn() }));
vi.mock("@/lib/haptics", () => ({ success: vi.fn(), warn: vi.fn() }));
vi.mock("@/store/useSettingsStore", () => ({ useSettingsStore: () => ({ timeFormat: "24h", dateFormat: "dmy", calendarOrder: [], tabBarLabels: false }) }));
vi.mock("@/services/federation", () => ({ setHomeRequester: vi.fn(), remoteForCalendar: vi.fn(), fedFetch: vi.fn() }));
vi.mock("@/services/notifications", () => ({ setReminderWriter: vi.fn(), setEventReminderRule: mocks.reminder, effectiveReminderRule: vi.fn(), inheritedReminderRule: vi.fn(), requestEventNotificationPermission: vi.fn(async () => false) }));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));

const { AddEventModal } = await import("./AddEventModal");
const { useApi } = await import("@/services/api");
type Props = { label?: string; onPress?: () => Promise<void>; children?: ReactNode };
function saveButton(node: ReactNode): Props | undefined {
  if (Array.isArray(node)) return node.map(saveButton).find(Boolean);
  if (!isValidElement<Props>(node)) return;
  if (node.props.label === "Save") return node.props;
  return saveButton(node.props.children);
}
beforeEach(() => {
  vi.clearAllMocks();
  state.index = 0;
  state.values = ["Keep native draft", "", new Date("2026-07-06T09:00:00Z"), new Date("2026-07-06T10:00:00Z")];
});
it.each(["denied", "unknown", "unsupported"])("native form displays %s from real useApi without closing or clearing its draft", async (reason) => {
  const message = `Event writing is ${reason}. No changes were saved.`;
  mocks.request.mockResolvedValue({ error: { status: 403, error: message, reason, capability: "event-write" }, data: null });
  const api = useApi();
  const tree = AddEventModal({
    visible: true, onClose: mocks.close, event: { id: "event" } as Event,
    calendars: [{ id: "calendar", creatorID: "owner", role: "owner", name: "Calendar", color: "#7A8BA3" }] as Calendar[],
    onSave: vi.fn(), onEdit: async (event) => { await api.updateEvent(event); },
  });
  const button = saveButton(tree);
  expect(button).toBeDefined();
  await button!.onPress!();
  expect(mocks.request).toHaveBeenCalledOnce();
  expect(mocks.alert).toHaveBeenCalledWith("Failed to save", message);
  expect(mocks.close).not.toHaveBeenCalled();
  expect(mocks.reminder).not.toHaveBeenCalled();
  expect(state.values[0]).toBe("Keep native draft");
});
