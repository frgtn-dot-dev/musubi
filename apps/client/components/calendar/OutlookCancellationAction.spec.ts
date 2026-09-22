import { OutlookCancellationAction } from "./OutlookCancellationAction";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema } from "@musubi/types";
const h = vi.hoisted(() => ({ slots: [] as any[], index: 0, effects: [] as (() => void)[], fetch: vi.fn(), save: vi.fn(), choose: vi.fn() }));
vi.mock("react", async original => ({ ...(await original<typeof import("react")>()),
  useState: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = typeof initial === "function" ? initial() : initial; return [h.slots[index], (value: any) => { h.slots[index] = typeof value === "function" ? value(h.slots[index]) : value; }]; },
  useRef: (initial: any) => { const index = h.index++; if (!(index in h.slots)) h.slots[index] = { current: initial }; return h.slots[index]; },
  useEffect: (effect: () => void, deps: any[]) => { const index = h.index++; if (!(index in h.slots)) { h.slots[index] = deps; h.effects.push(effect); } },
}));
vi.mock("react-native", () => ({ Text: "Text", View: "View" }));

vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {} }));
vi.mock("@/lib/confirm", () => ({ chooseOption: h.choose }));
vi.mock("@/services/api", () => ({ useApi: () => ({ getProviderEventState: h.fetch, editProviderOrganizer: h.save }) }));
const calendarID = "00000000-0000-4000-8000-000000000003";
const event = EventSchema.parse({ id: "00000000-0000-4000-8000-000000000001", revision: 7, title: "Weekly meeting", start: new Date("2026-09-10T09:00:00Z"), end: new Date("2026-09-10T10:00:00Z"), isAllDay: false, organizer: "owner", creatorID: "owner", color: "red", calendars: [calendarID], originCalendarID: calendarID, hasAttendees: false, isCanceled: false });
const observation = { version: "a".repeat(64), state: { provider: "microsoft", isOrganizer: true }, outlookCancellation: { calendarID, expectedRevision: 7, seriesVersion: "b".repeat(64), scopes: ["occurrence", "series"] } };
function render() { h.index = 0; const result = OutlookCancellationAction({ event }); for (const effect of h.effects.splice(0)) effect(); return result; }
function nodes(node: ReactNode): any[] { if (Array.isArray(node)) return node.flatMap(nodes); if (!isValidElement(node)) return []; const props = node.props as any; return [{ type: node.type, props }, ...nodes(props.children)]; }
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
beforeEach(() => { h.slots = []; h.index = 0; h.effects = []; vi.clearAllMocks(); });
it("refreshes before the scope choice, explicitly notifies guests, and never changes a lost request on retry", async () => {
  h.fetch.mockResolvedValue(observation);
  h.save.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValueOnce({});
  nodes(render()).find(n => n.type === "Btn").props.onPress(); await settle();
  expect(h.choose).toHaveBeenCalledOnce(); expect(h.save).not.toHaveBeenCalled();
  const [, message, choices] = h.choose.mock.calls[0];
  expect(message).toContain("notify their guests"); expect(choices.map((c: any) => c.label)).toEqual(["This occurrence", "Entire series"]);
  choices[1].onPress(); await settle();
  const retry = nodes(render()).find(n => n.type === "Btn"); expect(retry.props.label).toBe("Retry cancellation");
  retry.props.onPress(); await settle();
  expect(h.fetch).toHaveBeenCalledOnce(); expect(h.choose).toHaveBeenCalledOnce();
  expect(h.save.mock.calls[1][0]).toEqual(h.save.mock.calls[0][0]);
  expect(h.save.mock.calls[0][0]).toMatchObject({ provider: "microsoft", eventID: event.id, scope: "series", expectedSeriesVersion: "b".repeat(64) });
  expect(nodes(render()).some(n => n.type === "Btn")).toBe(false);
});
it("dismissing the native scope choice sends no mutation", async () => {
  h.fetch.mockResolvedValue(observation);
  nodes(render()).find(n => n.type === "Btn").props.onPress(); await settle();
  h.choose.mock.calls[0][4](); await settle();
  expect(h.save).not.toHaveBeenCalled(); expect(nodes(render()).find(n => n.type === "Btn").props.loading).toBe(false);
});
it("a revoked capability cannot open the destructive chooser", async () => {
  h.fetch.mockResolvedValue({ state: null });
  nodes(render()).find(n => n.type === "Btn").props.onPress(); await settle();
  expect(h.choose).not.toHaveBeenCalled(); expect(h.save).not.toHaveBeenCalled();
});
it("a revision changed during selection cannot be submitted", async () => {
  h.fetch.mockResolvedValue({ ...observation, outlookCancellation: { ...observation.outlookCancellation, expectedRevision: 8 } });
  nodes(render()).find(n => n.type === "Btn").props.onPress(); await settle();
  h.choose.mock.calls[0][2][0].onPress(); await settle();
  expect(h.save).not.toHaveBeenCalled();
});
