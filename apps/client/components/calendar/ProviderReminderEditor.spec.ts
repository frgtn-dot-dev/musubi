import { ProviderReminderEditor } from "./ProviderReminderEditor";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema, type ProviderEventStateResponse } from "@musubi/types";
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0, save: vi.fn(), close: vi.fn() }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useState: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial; return [h.slots[index], (value: any) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }]; },
  useRef: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = { current: initial }; return h.slots[index]; },
}));
vi.mock("react-native", () => ({ KeyboardAvoidingView: "KeyboardAvoidingView", Keyboard: { dismiss: vi.fn() }, Pressable: "Pressable", ScrollView: "ScrollView", Text: "Text", TextInput: "TextInput", View: "View" }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("@/components/ui/OptionPicker", () => ({ OptionPicker: "OptionPicker" }));
vi.mock("@/services/api", () => ({ useApi: () => ({ editProviderReminders: h.save }) }));
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 7, title: "Meeting", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, organizer: "owner", creatorID: "owner", color: "red", calendars: ["source"], hasAttendees: false, isCanceled: false });
const observation: ProviderEventStateResponse = { version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 }, state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] } };
function render(value = event) { h.index = 0; return ProviderReminderEditor({ event: value, observation, onClose: h.close }); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const props = node.props as any; return [{ type: node.type, props }, ...nodes(props.children)]; }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => node.type === "Btn" && node.props.label === label)!.props; }
function input(tree: ReactNode) { return nodes(tree).find(node => node.type === "TextInput")!.props; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.index = 0; vi.clearAllMocks(); });
it("preserves invalid native input and retries the exact personal intent after a network failure", async () => {
  h.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  let tree = render(); input(tree).onChangeText("1.5"); tree = render(); button(tree, "Save Google reminders").onPress(); await settle();
  expect(h.save).not.toHaveBeenCalled(); tree = render(); expect(input(tree).value).toBe("1.5");
  input(tree).onChangeText("15"); tree = render(); button(tree, "Save Google reminders").onPress(); await settle();
  tree = render(); expect(input(tree).value).toBe("15"); button(tree, "Save Google reminders").onPress(); await settle();
  expect(h.save).toHaveBeenCalledTimes(2); expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
  expect(h.save.mock.calls[0][1]).toMatchObject({ expectedRevision: 7, expectedStateVersion: "a".repeat(64), reminders: { useDefault: false, overrides: [{ method: "email", minutes: 15 }] } });
  expect(nodes(render()).some(node => typeof node.props.children === "string" && node.props.children.includes("Google confirmation is still pending"))).toBe(true);
});
it("native off choice sends no overrides and cancellation performs no write", async () => {
  let tree = render(); button(tree, "Cancel Google reminders").onPress(); expect(h.close).toHaveBeenCalledOnce(); expect(h.save).not.toHaveBeenCalled();
  button(tree, "Reminder mode: Custom").onPress(); tree = render(); nodes(tree).find(node => node.type === "OptionPicker")!.props.onSelect("off");
  h.save.mockResolvedValue({ status: "completed" }); tree = render(); button(tree, "Save Google reminders").onPress(); await settle();
  expect(h.save.mock.calls[0][1].reminders).toEqual({ useDefault: false, overrides: [] });
});

it("keeps the native occurrence UUID and request across a failed reminder save", async () => {
  const child = { ...event, seriesID: "00000000-0000-4000-8000-000000000002", originalStart: { kind: "instant" as const, value: "2026-09-10T08:00:00.000Z" } };
  h.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  let tree = render(child);
  expect(nodes(tree).some(node => node.props.children === "Google reminders for this occurrence")).toBe(true);
  input(tree).onChangeText("15"); tree = render(child); button(tree, "Save Google reminders").onPress(); await settle();
  tree = render(child); button(tree, "Save Google reminders").onPress(); await settle();
  expect(h.save.mock.calls[0][0].id).toBe(child.id);
  expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
  expect(h.save.mock.calls[0][1]).not.toHaveProperty("seriesID");
  expect(h.save.mock.calls[0][1]).not.toHaveProperty("originalStart");
});
