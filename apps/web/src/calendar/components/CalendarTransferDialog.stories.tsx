import type { Calendar } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES } from "../../../.storybook/modes";
import {
  CalendarTransferDialog,
  type CalendarTransferDialogProps,
} from "./CalendarTransferDialog";

const CALENDARS: Calendar[] = [
  {
    color: "#D4A574",
    creatorID: "user-1",
    id: "personal",
    isDefault: true,
    members: [],
    name: "Personal",
    role: "owner",
  },
  {
    accountId: "google-work",
    accountLabel: "work@example.com",
    color: "#7A8BA3",
    creatorID: "user-1",
    id: "studio",
    members: [],
    name: "Studio",
    provider: "google",
    role: "owner",
  },
];

const meta = {
  args: {
    calendars: CALENDARS,
    onCreate: async ({ color, name }) => ({
      ...CALENDARS[0]!,
      color,
      id: "new-calendar",
      isDefault: false,
      name,
    }),
    onDisconnect: async () => undefined,
    onExport: async () => "BEGIN:VCALENDAR\nEND:VCALENDAR",
    onImport: async ({ color, name }) => ({
      ...CALENDARS[0]!,
      color,
      id: "imported-calendar",
      imported: 0,
      isDefault: false,
      name,
    }),
    onManageMembers: () => undefined,
    onNotice: () => undefined,
    onOpenChange: () => undefined,
    onRemove: async (calendar) => calendar,
    onUpdate: async (calendar) => calendar,
    open: true,
  } satisfies CalendarTransferDialogProps,
  component: CalendarTransferDialog,
  parameters: {
    chromatic: { modes: DESKTOP_MODES },
    layout: "fullscreen",
  },
  title: "Calendar/Calendar management",
} satisfies Meta<typeof CalendarTransferDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Calendars" });
    await waitFor(() => expect(dialog).toBeVisible());
    expect(
      within(dialog).getByRole("button", { name: "Stop syncing Studio" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("combobox", { name: "Account" }),
    ).toBeVisible();
  },
};

export const ExternalDisconnectConfirmation: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Calendars" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Stop syncing Studio" }),
    );
    const confirmation = await screen.findByRole("dialog", {
      name: "Stop syncing “Studio”?",
    });
    await waitFor(() => expect(confirmation).toBeVisible());
    expect(
      within(confirmation).getByText(
        "Your Google Calendar account stays connected.",
      ),
    ).toBeVisible();
  },
};
