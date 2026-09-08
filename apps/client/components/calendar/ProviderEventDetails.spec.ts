import { ProviderEventDetailsBody } from "./ProviderEventDetails";
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
vi.mock("./ProviderReminderEditor", () => ({ ProviderReminderEditor: "ProviderReminderEditor" }));
vi.mock("@/services/api", () => ({ useApi: () => ({ getProviderEventState: h.fetch }) }));
vi.mock("@/services/federation", () => ({ remoteForCalendar: () => null }));
vi.mock("@/contexts/ServerContext", () => ({ useServer: () => ({ apiUrl: "https://example.test" }) }));
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 7, title: "Meeting", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, organizer: "owner", creatorID: "owner", color: "red", calendars: ["source"], hasAttendees: false, isCanceled: false });
const observation = { version: "a".repeat(64), reminderEdit: { provider: "google", expectedRevision: 7 }, state: { provider: "google", organizer: null, isOrganizer: false, attendees: [], attendeesComplete: true, ownResponse: null, reminders: { provider: "google", useDefault: true, overrides: [] }, availability: null, privacy: null, status: null, eventType: null, conferenceURLs: [] } };
function render() { h.index = 0; const result = ProviderEventDetailsBody({ event, userId: "owner" }); for (const effect of h.effects.splice(0)) effect(); return result; }
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
