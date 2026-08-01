import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { Segmented } from "./Segmented";

const VIEW_OPTIONS = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
] as const;

function ViewPicker({ disabled = false }: { disabled?: boolean }) {
  const [view, setView] = useState<"day" | "month" | "week">("week");

  return (
    <Segmented
      disabled={disabled}
      label="Calendar view"
      onChange={setView}
      options={VIEW_OPTIONS}
      value={view}
    />
  );
}

const meta = {
  component: Segmented,
  tags: ["autodocs"],
  title: "Primitives/Segmented",
} satisfies Meta<typeof Segmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    label: "Calendar view",
    onChange: () => undefined,
    options: VIEW_OPTIONS,
    value: "week",
  },
  render: () => <ViewPicker />,
};

export const Disabled: Story = {
  args: {
    disabled: true,
    label: "Calendar view",
    onChange: () => undefined,
    options: VIEW_OPTIONS,
    value: "week",
  },
  render: () => <ViewPicker disabled />,
};
