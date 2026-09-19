import { ProviderOrganizerEditor } from "./ProviderOrganizerEditor";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema, type ProviderEventStateResponse } from "@musubi/types";
vi.mock("./TimeZonePicker", () => ({ TimeZonePicker: "TimeZonePicker" }));
vi.mock("@/components/ui/DateTimePicker", () => ({ DateTimePicker: "DateTimePicker" }));
vi.mock("@/store/useSettingsStore", () => ({ useSettingsStore: (select: any) => select({ dateFormat: "dmy", timeFormat: "24h" }) }));
vi.mock("@/hooks/useModalAnimation", () => ({ useModalAnimation: (_visible: boolean, close: () => void) => ({ handleClose: close }) }));
vi.mock("@/components/ui/BottomSheetFrame", () => ({ BottomSheetFrame: "BottomSheetFrame" }));
const h = vi.hoisted(() => ({
  slots: [] as any[],
  index: 0,
  save: vi.fn(),
  close: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: any) => {
    const index = h.index++;
    if (!(index in h.slots))
      h.slots[index] = typeof initial === "function" ? initial() : initial;
    return [
      h.slots[index],
      (value: any) => {
        h.slots[index] =
          typeof value === "function" ? value(h.slots[index]) : value;
      },
    ];
  },
  useRef: (initial: any) => {
    const index = h.index++;
    if (!(index in h.slots)) h.slots[index] = { current: initial };
    return h.slots[index];
  },
}));
vi.mock("@expo/vector-icons", () => ({ Feather: "Icon" }));
vi.mock("@/components/ui/Tap", () => ({ Tap: "Tap" }));
vi.mock("react-native", () => ({
  Alert: { alert: vi.fn() },
  Platform: { OS: "android" },
  Switch: "Switch",
  KeyboardAvoidingView: "KeyboardAvoidingView",
  Keyboard: { dismiss: vi.fn() },
  Pressable: "Pressable",
  ScrollView: "ScrollView",
  Text: "Text",
  TextInput: "TextInput",
  View: "View",
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0 }),
}));
vi.mock("@/constants/theme", () => ({ colors: {}, fonts: {}, styles: {} }));
vi.mock("@/components/ui/Btn", () => ({ Btn: "Btn" }));
vi.mock("@/components/ui/ModalPortal", () => ({ ModalPortal: "Modal" }));
vi.mock("@/components/ui/OptionPicker", () => ({
  OptionPicker: "OptionPicker",
}));
vi.mock("@/contexts/ServerContext", () => ({
  useServer: () => ({
    apiUrl: "https://fixture.test",
    authClient: { useSession: () => ({ data: { user: { id: "owner" } } }) },
  }),
}));
vi.mock("@/services/api", () => ({
  useApi: () => ({ editProviderOrganizer: h.save }),
}));
vi.mock("@/lib/confirm", () => ({ confirm: h.confirm }));
const event = EventSchema.parse({
  id: "00000000-0000-4000-8000-000000000001",
  revision: 7,
  title: "Meeting",
  start: new Date("2026-09-10T09:00:00Z"),
  end: new Date("2026-09-10T10:00:00Z"),
  isAllDay: false,
  organizer: "owner",
  creatorID: "owner",
  color: "red",
  calendars: ["source"],
  hasAttendees: false,
  isCanceled: false,
});
const observation: ProviderEventStateResponse = {
  version: "a".repeat(64),
  organizerEdit: {
    provider: "google",
    calendarID: "00000000-0000-4000-8000-000000000004",
    expectedRevision: 7,
  },
  state: {
    provider: "google",
    organizer: null,
    isOrganizer: false,
    attendees: [],
    attendeesComplete: true,
    ownResponse: null,
    reminders: {
      provider: "google",
      useDefault: false,
      overrides: [{ method: "email", minutes: 30 }],
    },
    availability: null,
    privacy: null,
    status: null,
    eventType: null,
    conferenceURLs: [],
  },
};
function render(value = event, observed = observation) {
  h.index = 0;
  return ProviderOrganizerEditor({
    event: value,
    observation: observed,
    calendarID: "00000000-0000-4000-8000-000000000004",
    color: "red",
    onClose: h.close,
  });
}
function nodes(node: ReactNode): any[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!isValidElement(node)) return [];
  const props = node.props as any;
  return [{ type: node.type, props }, ...nodes(props.children)];
}
function chooseTime(key: string, value: string, draw = () => render()) {
  const [day, clock] = value.split("T");
  const [year, month, date] = day.split("-").map(Number);
  const [hours, minutes] = clock.split(":").map(Number);
  nodes(draw()).find(node => node.props.accessibilityLabel === `${key} date`)!.props.onPress();
  nodes(draw()).find(node => node.type === "DateTimePicker")!.props.onValueChange({}, new Date(year, month - 1, date, 12));
  nodes(draw()).find(node => node.props.accessibilityLabel === `${key} time`)!.props.onPress();
  nodes(draw()).find(node => node.type === "DateTimePicker")!.props.onValueChange({}, new Date(2000, 0, 15, hours, minutes));
}
function button(tree: ReactNode, label: string) {
  return nodes(tree).find(
    (node) => node.type === "Btn" && node.props.label === label,
  )!.props;
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
beforeEach(() => {
  h.slots = [];
  h.index = 0;
  vi.clearAllMocks();
});
it("sends only a changed native note and freezes it after offline admission", async () => {
  h.save
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue({ status: "pending" });
  let tree = render();
  nodes(tree)
    .find(
      (node) =>
        node.type === "TextInput" && node.props.accessibilityLabel === "Notes",
    )!
    .props.onChangeText("Typed note");
  tree = render();
  button(tree, "Save & notify").onPress();
  await settle();
  tree = render();
  expect(
    nodes(tree).find((node) => node.type === "TextInput")!.props.editable,
  ).toBe(false);
  button(tree, "Retry").onPress();
  await settle();
  expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
  expect(h.save.mock.calls[0][0]).toMatchObject({
    action: "update",
    sendUpdates: "all",
    patch: { description: "Typed note" },
  });
  expect(h.save.mock.calls[0][0].patch).not.toHaveProperty("time");
});
it("does not cancel or notify until the native confirmation is accepted", async () => {
  h.save.mockResolvedValue({ status: "pending" });
  button(render(), "Cancel meeting and notify guests").onPress();
  expect(h.save).not.toHaveBeenCalled();
  expect(h.confirm).toHaveBeenCalledOnce();
  h.confirm.mock.calls[0][1]();
  await settle();
  expect(h.save.mock.calls[0][0]).toMatchObject({
    action: "delete",
    sendUpdates: "all",
    expectedRevision: 7,
  });
});
it("closing an untouched native organizer draft does not write", () => {
  button(render(), "Close").onPress();
  expect(h.close).toHaveBeenCalledOnce();
  expect(h.save).not.toHaveBeenCalled();
});

it("allows correcting a guest after explicit native pre-admission rejection", async () => {
  h.save
    .mockRejectedValueOnce(
      Object.assign(new Error("Choose external guests"), {
        organizerAdmissionRejected: true,
      }),
    )
    .mockResolvedValue({ status: "pending" });
  function create() {
    h.index = 0;
    return ProviderOrganizerEditor({
      calendarID: "00000000-0000-4000-8000-000000000004",
      color: "red",
      onClose: h.close,
    });
  }
  function field(tree: ReactNode, label: string) {
    return nodes(tree).find(
      (node) =>
        (node.type === "TextInput" || node.type === "TimeZonePicker") && node.props.accessibilityLabel === label,
    )!.props;
  }
  field(create(), "Title").onChangeText("Planning");
  field(create(), "Guest email addresses").onChangeText("owner@example.test");
  button(create(), "Send invitations").onPress();
  await settle();
  expect(field(create(), "Guest email addresses").editable).toBe(true);
  field(create(), "Guest email addresses").onChangeText("guest@example.test");
  button(create(), "Send invitations").onPress();
  await settle();
  expect(h.save.mock.calls[1][0].guests[0].email).toBe("guest@example.test");
  expect(h.save.mock.calls[1][0].operationID).not.toBe(
    h.save.mock.calls[0][0].operationID,
  );
});

it("can correct a native DST-invalid time after explicit admission rejection", async () => {
  h.save
    .mockRejectedValueOnce(
      Object.assign(new Error("Check meeting time"), {
        organizerAdmissionRejected: true,
      }),
    )
    .mockResolvedValue({ status: "pending" });
  function field(label: string) {
    return nodes(render()).find(
      (node) =>
        (node.type === "TextInput" || node.type === "TimeZonePicker") && node.props.accessibilityLabel === label,
    )!.props;
  }
  chooseTime("start", "2026-03-29T02:45:00");
  chooseTime("end", "2026-03-29T03:15:00");
  field("Event time zone").onChange("Europe/Prague");
  button(render(), "Save & notify").onPress();
  await settle();
  expect(nodes(render()).find(node => node.props.accessibilityLabel === "start time")!.props.disabled).toBe(false);
  chooseTime("start", "2026-03-29T03:00:00");
  button(render(), "Save & notify").onPress();
  await settle();
  expect(h.save.mock.calls[1][0].patch.time.startLocal).toBe(
    "2026-03-29T03:00:00.000",
  );
});
it("keeps CalDAV native time out of content editing and sends the explicit server policy", async () => {
  h.save.mockResolvedValue({ status: "pending" });
  const observed = { ...observation, organizerEdit: { ...observation.organizerEdit!, provider: "caldav" as const, actions: ["update", "delete"] as ("update" | "delete")[] } };
  const tree = render(event, observed);
  const fields = nodes(tree).filter(node => node.type === "TextInput" || node.type === "TimeZonePicker");
  expect(fields.map(node => node.props.accessibilityLabel)).toEqual(["Title", "Notes", "Location"]);
  fields.find(node => node.props.accessibilityLabel === "Location")!.props.onChangeText("Changed room");
  button(render(event, observed), "Save & notify").onPress();
  await settle();
  expect(h.save.mock.calls[0][0]).toMatchObject({ provider: "caldav", notificationPolicy: "server-invite", patch: { location: "Changed room" } });
  expect(h.save.mock.calls[0][0].patch).not.toHaveProperty("time");
});
for (const action of ["update", "delete"] as const) it(`shows only the proven CalDAV ${action} control`, () => {
 const tree = render(event, { ...observation, organizerEdit: { ...observation.organizerEdit!, provider: "caldav", actions: [action] } });
 const buttons = nodes(tree).filter(node => node.type === "Btn").map(node => node.props.label);
 expect(buttons.includes("Save & notify")).toBe(action === "update");
 expect(buttons.includes("Cancel meeting and notify guests")).toBe(action === "delete");
 expect(nodes(tree).find(node => node.type === "TextInput")!.props.editable).toBe(action === "update");
});
it("keeps exact cancellation-only retry available after an ambiguous response", async () => {
  h.save.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({ status: "pending" });
  const observed = { ...observation, organizerEdit: { ...observation.organizerEdit!, provider: "caldav" as const, actions: ["delete"] as ("delete")[] } };
  button(render(event, observed), "Cancel meeting and notify guests").onPress();
  h.confirm.mock.calls[0][1](); await settle();
  const tree = render(event, observed);
  expect(nodes(tree).filter(node => node.type === "Btn").map(node => node.props.label)).not.toContain("Save & notify");
  button(tree, "Retry").onPress(); await settle();
  expect(h.save).toHaveBeenCalledTimes(2);
  expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
  expect(h.save.mock.calls[1][0]).toMatchObject({ action: "delete", provider: "caldav", notificationPolicy: "server-invite" });
});

it("uses explicit bound-occurrence content scope and omits time controls", async () => {
  h.save.mockResolvedValue({ status: "pending" });
  const child = { ...event, seriesID: "00000000-0000-4000-8000-000000000002", originalStart: { kind: "instant" as const, value: "2026-09-09T09:00:00.000Z" } };
  const observed = { ...observation, organizerEdit: { ...observation.organizerEdit!, scope: "occurrence" as const, instanceVersion: "b".repeat(64) } };
  let tree = render(child, observed);
  expect(nodes(tree).filter(node => node.type === "TextInput").map(node => node.props.accessibilityLabel)).toEqual(["Title", "Notes", "Location"]);
  nodes(tree).find(node => node.type === "TextInput" && node.props.accessibilityLabel === "Title")!.props.onChangeText("Changed occurrence");
  tree = render(child, observed);
  button(tree, "Save & notify").onPress(); await settle();
  expect(h.save.mock.calls[0][0]).toMatchObject({ eventID: child.id, expectedRevision: 7, scope: "occurrence", expectedInstanceVersion: "b".repeat(64), patch: { title: "Changed occurrence" } });
  expect(h.save.mock.calls[0][0].patch).not.toHaveProperty("time");
});
it("confirms cancellation of only this occurrence before dispatching its bound request", async () => {
  h.save.mockResolvedValue({ status: "pending" });
  const observed = { ...observation, organizerEdit: { ...observation.organizerEdit!, scope: "occurrence" as const, instanceVersion: "b".repeat(64) } };
  button(render(event, observed), "Cancel this occurrence and notify guests").onPress();
  expect(h.save).not.toHaveBeenCalled();
  expect(h.confirm.mock.calls[0][0].title).toBe("Cancel this occurrence");
  h.confirm.mock.calls[0][1](); await settle();
  expect(h.save.mock.calls[0][0]).toMatchObject({ action: "delete", scope: "occurrence", expectedInstanceVersion: "b".repeat(64) });
});
it("reschedules only within the observed zone and freezes the exact time request", async () => {
 h.save.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue({ status: "pending" });
 const observed = { ...observation, organizerEdit: { ...observation.organizerEdit!, provider: "caldav" as const, actions: ["update"] as ("update")[], timeEdit: true as const } };
 const source = { ...event, timeModel: { kind: "zoned" as const, timeZone: "Europe/Prague", startLocal: "2026-09-10T11:00:00.000", endLocal: "2026-09-10T12:00:00.000" } };
 const tree = render(source, observed);
 const fields = nodes(tree).filter(node => node.type === "TextInput" || node.type === "TimeZonePicker");
 expect(fields.find(node => node.props.accessibilityLabel === "Event time zone")!.props.disabled).toBe(true);
 chooseTime("start", "2026-09-11T11:00:00", () => render(source, observed));
 chooseTime("end", "2026-09-11T12:00:00", () => render(source, observed));
 button(render(source, observed), "Save & notify").onPress(); await settle();
 button(render(source, observed), "Retry").onPress(); await settle();
 expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
 expect(h.save.mock.calls[0][0].patch.time).toMatchObject({ kind: "zoned", timeZone: "Europe/Prague", startLocal: "2026-09-11T11:00:00.000" });
});

it("creates Outlook with explicit server invitation policy and freezes retry identity", async () => {
  h.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  function create() {
    h.index = 0;
    return ProviderOrganizerEditor({ provider: "microsoft", calendarID: "00000000-0000-4000-8000-000000000004", color: "red", onClose: h.close });
  }
  const field = (tree: ReactNode, label: string) => nodes(tree).find(node => (node.type === "TextInput" || node.type === "TimeZonePicker") && node.props.accessibilityLabel === label)!.props;
  expect(field(create(), "Event time zone").value).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  expect(field(create(), "Event time zone").disabled).toBe(false);
  field(create(), "Title").onChangeText("Planning");
  field(create(), "Guest email addresses").onChangeText("guest@example.test");
  button(create(), "Send invitations").onPress(); await settle();
  const saved = h.save.mock.calls[0][0];
  expect(saved).toMatchObject({ provider: "microsoft", action: "create", notificationPolicy: "server-invite", time: { timeZone: "UTC" } });
  expect(saved).not.toHaveProperty("sendUpdates");
  button(create(), "Retry").onPress(); await settle();
  expect(h.save.mock.calls[1][0]).toEqual(saved);
});

it("requires a verified iCloud alias and preserves it through a frozen retry", async () => {
  h.save.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "pending" });
  function create() {
    h.index = 0;
    return ProviderOrganizerEditor({ provider: "caldav", organizerAddresses: ["mailto:first@example.test", "mailto:second@example.test"], calendarID: "00000000-0000-4000-8000-000000000004", color: "red", onClose: h.close });
  }
  const field = (label: string) => nodes(create()).find(node => node.type === "TextInput" && node.props.accessibilityLabel === label)!.props;
  field("Title").onChangeText("Planning"); field("Guest email addresses").onChangeText("guest@example.test");
  button(create(), "Send invitations").onPress(); await settle();
  expect(h.save).not.toHaveBeenCalled();
  nodes(create()).find(node => node.type === "Tap" && node.props.accessibilityLabel === "Organizer address")!.props.onPress();
  nodes(create()).find(node => node.type === "OptionPicker")!.props.onSelect("mailto:second@example.test");
  button(create(), "Send invitations").onPress(); await settle();
  expect(h.save.mock.calls[0][0]).toMatchObject({ provider: "caldav", organizerAddress: "mailto:second@example.test" });
  button(create(), "Retry").onPress(); await settle();
  expect(h.save.mock.calls[1]).toEqual(h.save.mock.calls[0]);
});
