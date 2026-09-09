import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[], request: vi.fn(), userId: "owner", apiUrl: "https://home.example.test", appState: undefined as ((state: string) => void) | undefined }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial; return [h.slots[index], (value: any) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }]; },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => { const index = h.index++; const previous = h.slots[index]; if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) { const slot = h.slots[index] = { deps, cleanup: previous?.cleanup }; h.effects.push(() => { slot.cleanup?.(); slot.cleanup = effect(); }); } },
}));
vi.mock("react-native", () => ({ View: "View", Text: "Text", TextInput: "TextInput", ScrollView: "ScrollView", Pressable: "Pressable", AppState: { currentState: "active", addEventListener: (_event: string, listener: (state: string) => void) => { h.appState = listener; return { remove: vi.fn() }; } } }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: h.apiUrl, authClient: { $fetch: h.request, useSession: () => ({ data: { user: { id: h.userId } } }) } }) }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/SettingRow", () => ({ SettingRowToggle: "Toggle" }));
vi.mock("@/services/federation", () => ({ setHomeRequester: vi.fn(), remoteForCalendar: vi.fn() }));
vi.mock("@/services/notifications", () => ({ setReminderWriter: vi.fn() }));
vi.mock("@/lib/signOut", () => ({ notifySessionExpired: vi.fn() }));
const { default: AvailabilityModal, AvailabilityBody } = await import("./AvailabilityModal");
const { useDeliveryRefreshStore } = await import("@/store/useDeliveryRefreshStore");
const { useApi } = await import("@/services/api");
const id = "00000000-0000-4000-8000-000000000001";
let enabled = false, generation = 1, mode = "unavailable";
const props = { visible: true, onClose: vi.fn(), onReconnect: vi.fn() };
const sources = () => ({ sources: [{ id, generation, enabled, label: "Work", accountLabel: "Google work", reconnectRequired: mode === "reconnect-required" }] });
function unmount() { for (const slot of h.slots) slot?.cleanup?.(); h.slots = []; h.index = 0; }
beforeEach(() => {
  vi.clearAllMocks(); h.slots = []; h.index = 0; h.effects = []; h.userId = "owner"; h.apiUrl = "https://home.example.test"; enabled = false; generation = 1; mode = "unavailable";
  h.request.mockImplementation(async (url: string, options: any) => {
    if (url.endsWith("/availability")) { const range = JSON.parse(options.body); return { data: { start: range.start, end: range.end, observedAt: range.start, sources: [{ sourceId: id, generation, status: mode, ...(mode === "available" ? { intervals: [] } : {}) }] } }; }
    if (options.method === "PUT") { const body = JSON.parse(options.body); expect(body.expectedGeneration).toBe(generation); enabled = body.enabled; generation++; }
    return { data: sources() };
  });
});
afterEach(unmount);
function render() { h.index = 0; const tree = AvailabilityBody(props); for (const effect of h.effects.splice(0)) effect(); return tree; }
function control(node: ReactNode, label: string): any { if (Array.isArray(node)) return node.map(item => control(item, label)).find(Boolean); if (!isValidElement<any>(node)) return; if ((node.props as any).label === label || (node.props as any).accessibilityLabel === label) return node.props; return control((node.props as any).children, label); }
function text(node: ReactNode): string { if (typeof node === "string" || typeof node === "number") return String(node); if (Array.isArray(node)) return node.map(text).join(" "); if (isValidElement<any>(node)) return text((node.props as any).children); return ""; }
it("real native callbacks select sources, submit home reads and distinguish unknown from confirmed empty", async () => {
  render(); await vi.waitFor(() => expect(control(render(), "Use Work for availability")).toBeDefined());
  expect(control(render(), "Read busy intervals").disabled).toBe(true); control(render(), "Use Work for availability").onToggle();
  await vi.waitFor(() => expect(control(render(), "Read busy intervals").disabled).toBe(false));
  control(render(), "From (UTC, YYYY-MM-DD)").onChangeText("2026-10-25"); control(render(), "Until (UTC, exclusive, YYYY-MM-DD)").onChangeText("2026-10-26");
  control(render(), "Read busy intervals").onPress(); await vi.waitFor(() => expect(text(render())).toContain("Unavailable — free time is unknown")); expect(text(render())).not.toContain("No busy intervals");
  mode = "available"; control(render(), "Read busy intervals").onPress(); await vi.waitFor(() => expect(text(render())).toContain("No busy intervals in the requested range"));
  expect(h.request.mock.calls.every(([url]) => url.startsWith("https://home.example.test/api/v1/availability"))).toBe(true);
  const [, request] = h.request.mock.calls.find(([url]) => url.endsWith("/availability"))!;
  expect(JSON.parse(request.body)).toEqual({ start: "2026-10-25T00:00:00Z", end: "2026-10-26T00:00:00Z", sourceIds: [id] }); expect(control(render(), "Edit event")).toBeUndefined();
  useDeliveryRefreshStore.getState().refresh(); expect(text(render())).not.toContain("No busy intervals");
  await vi.waitFor(() => expect(control(render(), "Read busy intervals").disabled).toBe(false));
  h.appState!("background"); expect(text(render())).not.toContain("No busy intervals");
});
it("close aborts authenticated reads and server/account remounts cannot expose old replies", async () => {
  enabled = true; render(); await vi.waitFor(() => expect(control(render(), "Read busy intervals").disabled).toBe(false)); const oldKey = AvailabilityModal(props)?.key;
  let resolve!: (value: unknown) => void; h.request.mockImplementationOnce(() => new Promise(done => { resolve = done; })); control(render(), "Read busy intervals").onPress();
  const signal = h.request.mock.lastCall![1].signal as AbortSignal; control(render(), "Close availability").onPress(); expect(signal.aborted).toBe(true); expect(props.onClose).toHaveBeenCalledOnce();
  unmount(); h.apiUrl = "https://other.example.test"; h.userId = "another"; expect(AvailabilityModal(props)?.key).not.toBe(oldKey);
  render(); resolve({ data: { start: "2026-10-25T00:00:00Z", end: "2026-10-26T00:00:00Z", observedAt: "2026-10-24T00:00:00Z", sources: [{ sourceId: id, generation, status: "available", intervals: [] }] } });
  await vi.waitFor(() => expect(control(render(), "Use Work for availability")).toBeDefined()); expect(text(render())).not.toContain("No busy intervals"); expect(h.request.mock.lastCall![0]).toBe("https://other.example.test/api/v1/availability/sources");
  h.userId = ""; expect(AvailabilityModal(props)).toBeNull();
});
it("reconnect is an explicit existing connection action", async () => { mode = "reconnect-required"; render(); await vi.waitFor(() => expect(control(render(), "Reconnect Google for availability")).toBeDefined()); control(render(), "Reconnect Google for availability").onPress(); expect(props.onClose).toHaveBeenCalledOnce(); expect(props.onReconnect).toHaveBeenCalledOnce(); });
it("transport rejects private extras and propagates cancellation without offline fallback", async () => { const api = useApi(); h.request.mockResolvedValueOnce({ data: { ...sources(), privateDescription: "secret" } }); await expect(api.getAvailabilitySources()).rejects.toThrow(); const abort = new AbortController(); abort.abort(); await api.getAvailabilitySources(abort.signal); expect(h.request.mock.lastCall![1].signal.aborted).toBe(true); expect(h.request.mock.lastCall![1].headers["Cache-Control"]).toBe("no-store"); });

it("coalesces SSE during a source PUT instead of reading old selection before commit", async () => {
  enabled = true; render(); await vi.waitFor(() => expect(control(render(), "Use Work for availability")).toBeDefined());
  let commit!: () => void; const calls: string[] = [];
  h.request.mockImplementation(async (_url: string, options: any) => {
    calls.push(options.method);
    if (options.method === "PUT") return new Promise(resolve => { commit = () => { enabled = false; generation++; resolve({ data: sources() }); }; });
    // A GET before commit would legitimately return the old enabled selection.
    return { data: sources() };
  });
  control(render(), "Use Work for availability").onToggle();
  const putSignal = h.request.mock.lastCall![1].signal as AbortSignal;
  useDeliveryRefreshStore.getState().refresh(); useDeliveryRefreshStore.getState().refresh();
  expect(putSignal.aborted).toBe(false); expect(calls).toEqual(["PUT"]);
  commit(); await vi.waitFor(() => expect(calls).toEqual(["PUT", "GET"]));
  await vi.waitFor(() => expect(control(render(), "Use Work for availability").toggle).toBe(false));
  expect(control(render(), "Read busy intervals").disabled).toBe(true);
});

it("identity reset still aborts a pending selection and retires its queued refresh", async () => {
  enabled = true; render(); await vi.waitFor(() => expect(control(render(), "Use Work for availability")).toBeDefined());
  let commit!: () => void;
  h.request.mockImplementationOnce(() => new Promise(resolve => { commit = () => resolve({ data: { sources: [{ ...sources().sources[0], enabled: false, generation: 2 }] } }); }));
  control(render(), "Use Work for availability").onToggle(); const signal = h.request.mock.lastCall![1].signal as AbortSignal;
  useDeliveryRefreshStore.getState().refresh(); unmount(); expect(signal.aborted).toBe(true);
  h.userId = "next-owner"; h.apiUrl = "https://next.example.test"; render(); commit();
  await vi.waitFor(() => expect(control(render(), "Use Work for availability")).toBeDefined());
  expect(control(render(), "Use Work for availability").toggle).toBe(true);
  expect(h.request.mock.lastCall![0]).toBe("https://next.example.test/api/v1/availability/sources");
});
