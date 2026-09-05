import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";

const state = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));
const { request, linkSocial, alert, close } = vi.hoisted(() => ({
  request: vi.fn(), linkSocial: vi.fn(), alert: vi.fn(), close: vi.fn(),
}));
// Shallow native host boundary: execute the real component's button callbacks
// and the real useApi transport, without booting Expo or an animation runtime.
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => {},
  useState: (value: unknown) => {
    const index = state.index++;
    if (!(index in state.values)) state.values[index] = value;
    return [state.values[index], (next: unknown) => { state.values[index] = next; }];
  },
}));
vi.mock("react-native", () => ({ Text: "Text", Pressable: "Pressable", ScrollView: "ScrollView", View: "View", TextInput: "TextInput", Alert: { alert }, Linking: {} }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: "https://home.example.test", authClient: { $fetch: request, linkSocial } }) }));
vi.mock("@/hooks/useModalAnimation", () => ({ useModalAnimation: () => ({ handleClose: close }) }));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("react-native-gesture-handler", () => ({ GestureDetector: "GestureDetector", GestureHandlerRootView: "GestureHandlerRootView" }));
vi.mock("react-native-reanimated", () => ({ default: { View: "AnimatedView" } }));
vi.mock("@expo/vector-icons", () => ({ Ionicons: "Icon" }));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/SettingRow", () => ({ SettingRowToggle: "SettingRowToggle" }));
vi.mock("@/components/auth/SocialAuthButtons", () => ({ GoogleG: "GoogleG" }));
vi.mock("@/lib/haptics", () => ({ success: vi.fn(), warn: vi.fn() }));
vi.mock("@/lib/googleDisclosure", () => ({ hasSeenGoogleDisclosure: vi.fn(), markGoogleDisclosureSeen: vi.fn() }));
vi.mock("expo-router", () => ({ router: {} }));
vi.mock("@/store/useCalendarsStore", () => ({ useCalendarsStore: () => [] }));
vi.mock("@/services/federation", () => ({ setHomeRequester: vi.fn(), remoteForCalendar: vi.fn(), fedFetch: vi.fn() }));
vi.mock("@/services/notifications", () => ({ setReminderWriter: vi.fn() }));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));

const { default: SyncCalendarModal } = await import("./SyncCalendarModal");
const { useApi } = await import("@/services/api");
function outlookButton(node: ReactNode): (() => Promise<void>) | undefined {
  if (Array.isArray(node)) return node.map(outlookButton).find(Boolean);
  if (!isValidElement<{ label?: string; onPress?: () => Promise<void>; children?: ReactNode }>(node)) return;
  if (node.props.label === "Outlook") return node.props.onPress;
  return outlookButton(node.props.children);
}
beforeEach(() => {
  state.values = [];
  state.index = 0;
  vi.clearAllMocks();
  linkSocial.mockResolvedValue({ error: null });
  request.mockResolvedValue({ error: null });
});

it.each([false, true])("native Outlook callback awaits provider-scoped import; failure=%s", async (fails) => {
  const onConnected = vi.fn();
  let complete!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  const button = outlookButton(SyncCalendarModal({ visible: true, onClose: vi.fn(), onConnected }));
  expect(button).toBeDefined();
  const pending = button!();
  await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  expect(request).toHaveBeenCalledWith("https://home.example.test/api/v1/users/connections/sync", expect.objectContaining({ method: "POST", body: { provider: "microsoft" } }));
  expect(onConnected).not.toHaveBeenCalled();
  complete({ error: fails ? { status: 400, message: "Import failed" } : null });
  await pending;
  if (fails) {
    expect(onConnected).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalled();
  } else {
    expect(onConnected).toHaveBeenCalledWith("microsoft");
    expect(close).toHaveBeenCalledOnce();
  }
});

it("native explicit account scope and manual all-provider refresh keep their request bodies", async () => {
  const api = useApi();
  await api.syncProviderCalendars({ provider: "google", accountId: "work" });
  await api.syncProviderCalendars();
  expect(request.mock.calls.map(([, options]) => options.body)).toEqual([{ provider: "google", accountId: "work" }, {}]);
});

type ControlProps = { label?: string; toggle?: boolean; onToggle?: () => void; onPress?: () => unknown; children?: ReactNode };
function control(node: ReactNode, label: string): ControlProps | undefined {
  if (Array.isArray(node)) return node.map((child) => control(child, label)).find(Boolean);
  if (!isValidElement<ControlProps>(node)) return;
  if (node.props.label === label) return node.props;
  return control(node.props.children, label);
}
it.each([
  ["google", true], ["google", false], ["microsoft", true], ["microsoft", false],
] as const)("native %s connection sends optional Tasks=%s through real callbacks", async (provider, includeTasks) => {
  const onConnected = vi.fn();
  const render = () => {
    state.index = 0;
    return SyncCalendarModal({ visible: true, onClose: vi.fn(), onConnected, callbackURL: "/onboarding/connect" });
  };
  let tree = render();
  expect(control(tree, "Include Tasks (optional)")?.toggle).toBe(true);
  if (!includeTasks) {
    control(tree, "Include Tasks (optional)")!.onToggle!();
    tree = render();
    expect(control(tree, "Include Tasks (optional)")?.toggle).toBe(false);
  }
  if (provider === "google") {
    control(tree, "Google Calendar")!.onPress!();
    expect(linkSocial).not.toHaveBeenCalled(); // disclosure remains first
    tree = render();
    await control(tree, "Continue to Google")!.onPress!();
  } else {
    await control(tree, "Outlook")!.onPress!();
  }
  const options = linkSocial.mock.lastCall![0];
  expect(options.provider).toBe(provider);
  expect(options.callbackURL).toBe("/onboarding/connect");
  expect(options.scopes.includes(provider === "google" ? "https://www.googleapis.com/auth/tasks" : "Tasks.ReadWrite")).toBe(includeTasks);
  expect(options.scopes).toContain(provider === "google" ? "https://www.googleapis.com/auth/calendar.events" : "Calendars.ReadWrite");
  expect(request).toHaveBeenCalledWith("https://home.example.test/api/v1/users/connections/sync", expect.objectContaining({ body: { provider } }));
  expect(onConnected).toHaveBeenCalledWith(provider);
  expect(close).toHaveBeenCalledOnce();
});
