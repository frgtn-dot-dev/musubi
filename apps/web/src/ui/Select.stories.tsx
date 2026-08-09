import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { BriefcaseBusiness, House, UsersRound } from "lucide-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES } from "../../.storybook/modes";
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
