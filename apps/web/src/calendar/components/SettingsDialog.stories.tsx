import { SettingsSchema, type SettingsDocument } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useRef, useState, type ComponentProps } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { Button } from "~/ui/Button";
import { SettingsDialog } from "./SettingsDialog";

const INITIAL_SETTINGS: SettingsDocument = {
  revision: 1,
  updatedAt: new Date("2026-09-12T08:00:00.000Z"),
  value: SettingsSchema.parse({
    dateFormat: "dmy",
    defaultCalendarView: "week",
    notificationsOnByDefault: true,
    timeFormat: "24h",
    defaultReminder: {
      allDay: { atMinute: 1080, daysBefore: 1 },
      minutesBefore: 10,
    },
    weekStartsOn: "monday",
  }),
};

function SettingsExample(props: ComponentProps<typeof SettingsDialog>) {
  const [open, setOpen] = useState(true);
  const document = useRef(INITIAL_SETTINGS);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Open settings
      </Button>
      <SettingsDialog
        {...props}
        onLoad={async () => document.current}
        onOpenChange={setOpen}
        onPatch={async ({ patch }) => {
          document.current = {
            ...document.current,
            revision: document.current.revision + 1,
            value: { ...document.current.value, ...patch },
          };
          return document.current;
        }}
        open={open}
      />
    </>
  );
}

const meta = {
  args: {
    onAdopt: () => undefined,
    onLoad: async () => INITIAL_SETTINGS,
    onManageAccount: () => undefined,
    onNotice: () => undefined,
    onOpenChange: () => undefined,
    onPatch: async () => INITIAL_SETTINGS,
    open: true,
  },
  component: SettingsDialog,
  parameters: { layout: "fullscreen" },
  title: "Calendar/Settings dialog",
} satisfies Meta<typeof SettingsDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const expectSettings: NonNullable<Story["play"]> = async () => {
  const dialog = await screen.findByRole("dialog", { name: "Settings" });
  await waitFor(() => expect(dialog).toBeVisible());
  await within(dialog).findByRole("radiogroup", { name: "Theme" });
  expect(
    within(dialog).getByRole("heading", { name: "Date & time" }),
  ).toBeVisible();
};

export const Overview: Story = {
  parameters: { chromatic: { modes: DESKTOP_MODES } },
  play: expectSettings,
  render: (args) => <SettingsExample {...args} />,
};

export const NarrowSheet: Story = {
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
  play: expectSettings,
  render: (args) => <SettingsExample {...args} />,
};

export const ReminderChoices: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await userEvent.click(
      await within(dialog).findByRole("button", {
        name: "Reminders",
      }),
    );
    const timed = within(dialog).getByRole("combobox", {
      name: "Timed events",
    });
    await userEvent.click(timed);
    await userEvent.click(
      await screen.findByRole("option", { name: "30 min" }),
    );
    await waitFor(() => expect(timed).toHaveTextContent("30 min"));
    await waitFor(() => expect(timed).toHaveFocus());
  },
  render: (args) => <SettingsExample {...args} />,
};
