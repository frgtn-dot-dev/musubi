import { MoveContent } from "./OutlookMoveSheet";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import type { OutlookMoveResult, OutlookMoveOptions } from "@musubi/types";
import { OutlookMoveSession } from "@/lib/outlookMoveSession";
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0 }));
vi.mock("react", async original => ({ ...await original<typeof import("react")>(),
  useState: (initial: any) => { const n = h.index++; if (!(n in h.slots)) h.slots[n] = typeof initial === "function" ? initial() : initial; return [h.slots[n], (v: any) => { h.slots[n] = typeof v === "function" ? v(h.slots[n]) : v; }]; },
  useMemo: (fn: () => unknown) => fn(),
}));
vi.mock("react-native", () => ({ FlatList: "FlatList", View: "View", Text: "Text", TextInput: "TextInput", Keyboard: { dismiss: vi.fn() } }));
vi.mock("@expo/vector-icons", () => ({ Feather: "Icon" }));
vi.mock("react-native-safe-area-context", () => ({}));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/services/api", () => ({}));
vi.mock("@/store/useSettingsStore", () => ({ useSettingsStore: (s: any) => s({ timeFormat: "24h", dateFormat: "dmy" }) }));
vi.mock("@/store/useDeliveryRefreshStore", () => ({}));
vi.mock("@/hooks/useModalAnimation", () => ({}));
vi.mock("@/components/ui/BottomSheetFrame", () => ({}));
vi.mock("@/components/ui/ModalPortal", () => ({}));
vi.mock("@/components/ui/OptionPicker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
const options: OutlookMoveOptions = { eventID: "series", calendarID: "calendar", title: "Walk", version: "version", meeting: true, timeZone: "Asia/Kathmandu", preserved: { edited: 0, cancelled: 0, unavailable: 0 }, occurrences: Array.from({ length: 22 }, (_, n) => ({ eventID: String(n), start: "2099-10-01T12:00:00Z", end: "2099-10-01T13:00:00Z" })) };
const result: OutlookMoveResult = { operationID: "operation", eventID: "series", title: "Walk", timeZone: options.timeZone, meeting: true, expiresAt: "2099-01-01T00:00:00Z", status: "preview", offsetMinutes: 30, items: [{ ...options.occurrences[0], newStart: "2099-10-01T12:30:00Z", newEnd: "2099-10-01T13:30:00Z", status: "pending" }] };
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const props = node.props as any; return [{ type: node.type, props }, ...nodes(props.children), ...nodes(props.ListHeaderComponent), ...nodes(props.ListFooterComponent), ...(node.type === "FlatList" ? props.data.flatMap((item: any) => nodes(props.renderItem({ item }))) : [])]; }
const api = { previewOutlookMove: vi.fn(), getLatestOutlookMove: vi.fn(), getOutlookMoveOptions: vi.fn(), startOutlookMove: vi.fn(), getOutlookMove: vi.fn() };
let session: OutlookMoveSession;
let close = vi.fn();
beforeEach(() => { h.slots = []; h.index = 0; vi.clearAllMocks(); session = new OutlookMoveSession(api, "series", () => "op"); close = vi.fn(); });
function render(state: Parameters<typeof MoveContent>[0]["state"] = { phase: "ready", options }) { h.index = 0; return nodes(MoveContent({ state, session, close, bottomInset: 20 })); }
it("lets a person select dates, choose direction and preview before any start", () => {
  const preview = vi.spyOn(session, "preview").mockResolvedValue();
  let tree = render(); expect(tree.find(n => n.props.label === "Preview selected occurrences").props.disabled).toBe(true);
  tree.find(n => n.type === "Tap" && n.props.accessibilityRole === "checkbox").props.onPress();
  tree = render(); tree.find(n => n.props.label === "Later").props.onPress();
  tree = render(); tree.find(n => n.type === "OptionPicker").props.onSelect("earlier");
  tree = render(); tree.find(n => n.type === "TextInput").props.onChangeText("45");
  tree = render(); tree.find(n => n.props.label === "Preview 1 occurrence").props.onPress();
  expect(preview).toHaveBeenCalledWith(["0"], -45); expect(api.startOutlookMove).not.toHaveBeenCalled();
});
it("caps selection at twenty and keeps selected dates deselectable", () => {
  render().find(n => n.props.label === "Select next 20").props.onPress();
  const checkboxes = render().filter(n => n.props.accessibilityRole === "checkbox");
  expect(checkboxes.filter(n => n.props.accessibilityState.checked)).toHaveLength(20);
  expect(checkboxes[20].props.disabled).toBe(true); expect(checkboxes[0].props.disabled).toBe(false);
});
it("renders exact old/new zone times and makes guest notification explicit at confirmation", () => {
  const confirm = vi.spyOn(session, "confirm").mockResolvedValue();
  const tree = render({ phase: "ready", result });
  const text = tree.filter(n => n.type === "Text").flatMap(n => n.props.children).join(" ");
  expect(text).toContain("17:45–18:45"); expect(text).toContain("18:15–19:15"); expect(text).toContain("notify guests");
  tree.find(n => n.props.label === "Move 1 occurrence & notify guests").props.onPress(); expect(confirm).toHaveBeenCalledOnce();
});
it("allows closing a running move but never offers another confirmation", () => {
  const tree = render({ phase: "ready", result: { ...result, status: "running" } });
  expect(tree.some(n => n.props.label?.startsWith("Move 1"))).toBe(false);
  tree.find(n => n.props.label === "Close").props.onPress(); expect(close).toHaveBeenCalledOnce();
});
it("distinguishes partial results and hides the new-preview action for uncertainty", () => {
  const tree = render({ phase: "ready", result: { ...result, status: "stopped", items: ["completed", "unconfirmed", "not-started"].map((status, n) => ({ ...result.items[0], eventID: String(n), status: status as OutlookMoveResult["items"][number]["status"] })) } });
  const text = tree.filter(n => n.type === "Text").flatMap(n => n.props.children).join(" ");
  expect(text).toContain("Unconfirmed"); expect(text).toContain("Not started"); expect(text).toContain("Delivery details");
  expect(tree.some(n => n.props.label === "New preview")).toBe(false);
});
