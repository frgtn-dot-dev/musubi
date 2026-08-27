import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { BriefcaseBusiness, House, UsersRound } from "lucide-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Dialog } from "./Dialog";
import { Select, type SelectOption } from "./Select";

const CALENDAR_OPTIONS: readonly SelectOption[] = [
  {
    description: "Your personal calendar",
    icon: <House size={16} />,
    label: "Personal",
    value: "personal",
  },
  {
    description: "Shared with the product team",
    icon: <BriefcaseBusiness size={16} />,
    label: "Work",
    value: "work",
  },
  {
    description: "Read-only external calendar",
    disabled: true,
    icon: <UsersRound size={16} />,
    label: "Community",
    value: "community",
  },
];

function CalendarSelect({ compact = false }: { compact?: boolean }) {
  const [value, setValue] = useState("work");

  return (
    <Select
      label="Calendar"
      onChange={setValue}
      options={CALENDAR_OPTIONS}
      size={compact ? "compact" : "default"}
      value={value}
    />
  );
}

const LONG_OPTIONS: readonly SelectOption[] = Array.from(
  { length: 20 },
  (_, index) => ({
    label: `Calendar ${index + 1}`,
    value: `calendar-${index + 1}`,
  }),
);

const meta = {
  args: {
    label: "Calendar",
    onChange: () => undefined,
    options: CALENDAR_OPTIONS,
    value: "work",
  },
  component: Select,
  tags: ["autodocs"],
  title: "Primitives/Select",
} satisfies Meta<typeof Select>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(
      canvas.getByRole("combobox", { name: "Calendar" }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: "Calendar options",
    });
    await waitFor(() => expect(listbox).toBeVisible());
  },
  render: () => <CalendarSelect />,
};

export const Compact: Story = {
  render: () => <CalendarSelect compact />,
};

export const LongList: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Calendar" }));
    const listbox = await screen.findByRole("listbox", {
      name: "Calendar options",
    });
    await waitFor(() => {
      expect(listbox.scrollHeight).toBeGreaterThan(listbox.clientHeight);
    });
  },
  render: () => (
    <Select
      label="Calendar"
      onChange={() => undefined}
      options={LONG_OPTIONS}
      value="calendar-1"
    />
  ),
};

export const InsideDialog: Story = {
  play: async () => {
    await userEvent.click(
      screen.getByRole("combobox", { name: "Calendar" }),
    );
    const listbox = await screen.findByRole("listbox", {
      name: "Calendar options",
    });
    listbox.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 200 }),
    );
    await waitFor(() => expect(listbox.scrollTop).toBeGreaterThan(0));
  },
  render: () => (
    <Dialog
      closeLabel="Close calendars"
      description="Select wheel regression"
      onOpenChange={() => undefined}
      open
      title="Calendar export"
    >
      <Select
        label="Calendar"
        onChange={() => undefined}
        options={LONG_OPTIONS}
        value="calendar-1"
      />
    </Dialog>
  ),
};

export const States: Story = {
  render: () => (
    <div className="sb-row">
      <Select
        label="Empty calendar selection"
        onChange={() => undefined}
        options={CALENDAR_OPTIONS}
        placeholder="Choose a calendar"
        value=""
      />
      <Select
        disabled
        label="Locked calendar"
        onChange={() => undefined}
        options={CALENDAR_OPTIONS}
        value="personal"
      />
    </div>
  ),
};

/* Narrow turns the popover into a bottom sheet, and the label that is
   screen-reader-only on a laptop becomes the sheet's visible heading. */
export const NarrowSheet: Story = {
  globals: {
    viewport: {
      isRotated: false,
      value: "mobile1",
    },
  },
  parameters: {
    chromatic: {
      modes: MOBILE_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await userEvent.click(canvas.getByRole("combobox", { name: "Calendar" }));

    const title = await screen.findByRole("heading", { name: "Calendar" });

    await waitFor(() =>
      expect(title.getBoundingClientRect().height).toBeGreaterThan(1),
    );
  },
  render: () => <CalendarSelect />,
};
