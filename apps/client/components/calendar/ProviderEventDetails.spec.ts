import { ProviderEventDetails, ProviderEventDetailsBody } from "./ProviderEventDetails";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema } from "@musubi/types";
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[], fetch: vi.fn() }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useState: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial; return [h.slots[index], (value: any) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }]; },
  useRef: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = { current: initial }; return h.slots[index]; },
  useEffect: (effect: () => void, deps: any[]) => { const index = h.index++; if (!(index in h.slots)) { h.slots[index] = deps; h.effects.push(effect); } },
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("./ProviderRsvpEditor", () => ({ ProviderRsvpEditor: "ProviderRsvpEditor" }));
vi.mock("./ProviderReminderEditor", () => ({ ProviderReminderEditor: "ProviderReminderEditor" }));
vi.mock("@/services/api", () => ({ useApi: () => ({ getProviderEventState: h.fetch }) }));
vi.mock("@/services/federation", () => ({ remoteForCalendar: () => null }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: "https://example.test" }) }));
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 7, title: "Meeting", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, organizer: "owner", creatorID: "owner", color: "red", calendars: ["source"], hasAttendees: false, isCanceled: false });
const observation = { version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 }, state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: true, overrides: [] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] } };
function render(value = event) { h.index = 0; const result = ProviderEventDetailsBody({ event: value, userId: "owner" }); for (const effect of h.effects.splice(0)) effect(); return result; }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const props = node.props as any; return [{ type: node.type, props }, ...nodes(props.children)]; }
async function settle() { for (let i = 0; i < 8; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.index = 0; h.effects = []; vi.clearAllMocks(); });
it("reloads native settings on every open and does not open from a failed refresh", async () => {
  h.fetch.mockResolvedValueOnce(observation).mockResolvedValueOnce({ ...observation, version: "b".repeat(64) }).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...observation, version: "c".repeat(64), state: { ...observation.state, reminders: { provider: "google", useDefault: false, overrides: [] } } });
  render(); await settle();
  let tree = render(); nodes(tree).find(node => node.type === "Btn")!.props.onPress(); await settle();
  tree = render(); let editor = nodes(tree).find(node => node.type === "ProviderReminderEditor")!;
  expect(editor.props.observation.version).toBe("b".repeat(64)); editor.props.onClose();
  tree = render(); nodes(tree).find(node => node.type === "Btn")!.props.onPress(); await settle();
  tree = render(); expect(nodes(tree).some(node => node.type === "ProviderReminderEditor")).toBe(false);
  nodes(tree).find(node => node.type === "Btn")!.props.onPress(); await settle();
  editor = nodes(render()).find(node => node.type === "ProviderReminderEditor")!;
  expect(editor.props.observation.version).toBe("c".repeat(64)); expect(editor.props.observation.state.reminders.useDefault).toBe(false);
});

it("targets the existing child UUID when opening a scoped native response", async () => {
  const child = { ...event, seriesID: "00000000-0000-4000-8000-000000000002", originalStart: { kind: "instant" as const, value: "2026-09-10T08:00:00.000Z" } };
  h.fetch.mockResolvedValue({ ...observation, reminderEdit: undefined, rsvpEdit: { provider: "google", expectedRevision: 7 } });
  render(child); await settle();
  const action = nodes(render(child)).find(node => node.type === "Btn" && node.props.label === "Respond to this occurrence")!;
  action.props.onPress(); await settle();
  const editor = nodes(render(child)).find(node => node.type === "ProviderRsvpEditor")!;
  expect(editor.props.event.id).toBe(child.id);
  expect(editor.props.event.seriesID).toBe(child.seriesID);
  expect(h.fetch.mock.calls[1][0].id).toBe(child.id);
  expect(nodes(render(child)).some(node => node.type === "ProviderReminderEditor")).toBe(false);
});

it("refreshes the child reminder capability and passes its exact UUID to the native editor", async () => {
  const child = { ...event, seriesID: "00000000-0000-4000-8000-000000000002", originalStart: { kind: "instant" as const, value: "2026-09-10T08:00:00.000Z" } };
  h.fetch.mockResolvedValueOnce(observation).mockResolvedValueOnce({ ...observation, version: "b".repeat(64) }).mockResolvedValueOnce({ ...observation, reminderEdit: undefined });
  render(child); await settle();
  const action = () => nodes(render(child)).find(node => node.type === "Btn" && node.props.label === "Edit reminders for this occurrence")!;
  action().props.onPress(); await settle();
  const editor = nodes(render(child)).find(node => node.type === "ProviderReminderEditor")!;
  expect(editor.props.event.id).toBe(child.id); expect(editor.props.event.seriesID).toBe(child.seriesID);
  expect(editor.props.observation.version).toBe("b".repeat(64));
  editor.props.onClose(); action().props.onPress(); await settle();
  expect(nodes(render(child)).some(node => node.type === "ProviderReminderEditor")).toBe(false);
});


it("invalidates a cached native editor from canonical observation revision without rebasing a known occurrence", async () => {
  const known = { ...event, recurrence: "FREQ=DAILY", timeModel: { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } };
  const before = ProviderEventDetails({ event: known, userId: "owner", observationRevision: 7 });
  const after = ProviderEventDetails({ event: { ...known, title: "Busy" }, userId: "owner", observationRevision: 8 });
  expect(after.key).not.toBe(before.key);
  expect(after.props.event.revision).toBe(7);
  expect(after.props.event.timeModel).toBe(known.timeModel);
  h.fetch.mockResolvedValueOnce(observation).mockResolvedValueOnce(observation).mockResolvedValueOnce({ state: null });
  // A one-off permits opening its native editor; a new wrapper key unmounts it.
  render(); await settle();
  nodes(render()).find(node => node.type === "Btn")!.props.onPress(); await settle();
  expect(nodes(render()).some(node => node.type === "ProviderReminderEditor")).toBe(true);
  h.slots = []; h.index = 0; h.effects = [];
  render({ ...event, title: "Busy" }); await settle();
  expect(render({ ...event, title: "Busy" })).toBeNull();
});
