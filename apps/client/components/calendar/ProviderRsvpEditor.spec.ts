import { ProviderRsvpEditor } from "./ProviderRsvpEditor";
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
vi.mock("@/services/api", () => ({ useApi: () => ({ editProviderRsvp: h.save }) }));
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 7, title: "Meeting", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, organizer: "owner", creatorID: "owner", color: "red", calendars: ["source"], hasAttendees: false, isCanceled: false });
const observation: ProviderEventStateResponse = { version: "a".repeat(64), rsvpEdit: { provider: "google", expectedRevision: 7 }, state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: false, overrides: [{ method: "email", minutes: 30 }] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] } };
function render(value = event) { h.index = 0; return ProviderRsvpEditor({ event: value, observation, onClose: h.close }); }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const props = node.props as any; return [{ type: node.type, props }, ...nodes(props.children)]; }
function button(tree: ReactNode, label: string) { return nodes(tree).find(node => node.type === "Btn" && node.props.label === label)!.props; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.index = 0; vi.clearAllMocks(); });
it("requires an explicit native choice and retries the same frozen RSVP after connection loss", async () => {
  h.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  let tree = render(); expect(button(tree, "Send response").disabled).toBe(true);
  button(tree, "Send response").onPress(); await settle(); expect(h.save).not.toHaveBeenCalled();
  nodes(tree).find(node => node.type === "OptionPicker")!.props.onSelect("tentative");
  tree = render(); button(tree, "Send response").onPress(); await settle();
  tree = render(); button(tree, "Send response").onPress(); await settle();
  expect(h.save).toHaveBeenCalledTimes(2); expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
  expect(h.save.mock.calls[0][1]).toMatchObject({ response: "tentative", sendUpdates: "all", expectedRevision: 7, expectedStateVersion: "a".repeat(64) });
  expect(nodes(render()).some(node => typeof node.props.children === "string" && node.props.children.includes("confirmation is still pending"))).toBe(true);
});
it("cancelling a native response performs no write", () => {
  button(render(), "Cancel Google response").onPress(); expect(h.close).toHaveBeenCalledOnce(); expect(h.save).not.toHaveBeenCalled();
});

it("describes an instance-only response and submits the child's frozen identity", async () => {
  const child = { ...event, seriesID: "00000000-0000-4000-8000-000000000002", originalStart: { kind: "instant" as const, value: "2026-09-10T08:00:00.000Z" } };
  h.save.mockResolvedValue({ status: "pending" });
  let tree = render(child);
  expect(nodes(tree).some(node => node.props.children === "Respond to this occurrence")).toBe(true);
  nodes(tree).find(node => node.type === "OptionPicker")!.props.onSelect("accepted");
  tree = render(child); button(tree, "Send response").onPress(); await settle();
  expect(h.save.mock.calls[0][0].id).toBe(child.id);
  expect(h.save.mock.calls[0][0].seriesID).toBe(child.seriesID);
});
