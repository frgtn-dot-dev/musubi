import { ProviderOrganizerEditor } from "./ProviderOrganizerEditor";
import { beforeEach, expect, it, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { EventSchema, type ProviderEventStateResponse } from "@musubi/types";
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
vi.mock("react-native", () => ({
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
  button(tree, "Save and notify guests").onPress();
  await settle();
  tree = render();
  expect(
    nodes(tree).find((node) => node.type === "TextInput")!.props.editable,
  ).toBe(false);
  button(tree, "Retry saved meeting action").onPress();
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
  button(render(), "Close meeting editor").onPress();
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
        node.type === "TextInput" && node.props.accessibilityLabel === label,
    )!.props;
  }
  field(create(), "Title").onChangeText("Planning");
  field(create(), "Guest email addresses").onChangeText("owner@example.test");
  button(create(), "Create and send invitations").onPress();
  await settle();
  expect(field(create(), "Guest email addresses").editable).toBe(true);
  field(create(), "Guest email addresses").onChangeText("guest@example.test");
  button(create(), "Create and send invitations").onPress();
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
        node.type === "TextInput" && node.props.accessibilityLabel === label,
    )!.props;
  }
  field("Start (YYYY-MM-DDTHH:mm:ss)").onChangeText("2026-03-29T02:45:00");
  field("End (YYYY-MM-DDTHH:mm:ss)").onChangeText("2026-03-29T03:15:00");
  field("Event time zone").onChangeText("Europe/Prague");
  button(render(), "Save and notify guests").onPress();
  await settle();
  expect(field("Start (YYYY-MM-DDTHH:mm:ss)").editable).toBe(true);
  field("Start (YYYY-MM-DDTHH:mm:ss)").onChangeText("2026-03-29T03:00:00");
  button(render(), "Save and notify guests").onPress();
  await settle();
  expect(h.save.mock.calls[1][0].patch.time.startLocal).toBe(
    "2026-03-29T03:00:00.000",
  );
});
