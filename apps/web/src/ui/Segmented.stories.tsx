import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import {
  Segmented,
  type SegmentedOption,
  type SegmentedSize,
} from "./Segmented";

const VIEW_OPTIONS = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "agenda" },
] as const;

const AVAILABILITY_OPTIONS = [
  { label: "Working hours", value: "work" },
  { label: "Full week", value: "full" },
] as const;

const PARTIAL_OPTIONS = [
  { label: "Day", value: "day" },
  { disabled: true, label: "Week", value: "week" },
  { label: "Month", value: "month" },
] as const;

function SegmentedExample({
  disabled = false,
  initialValue,
  label,
  options,
  size = "compact",
}: {
  disabled?: boolean;
  initialValue: string;
  label: string;
  options: ReadonlyArray<SegmentedOption<string>>;
  size?: SegmentedSize;
}) {
  const [value, setValue] = useState(initialValue);

  return (
    <Segmented
      disabled={disabled}
      label={label}
      options={options}
      size={size}
      value={value}
      onChange={setValue}
    />
  );
}

const meta = {
  args: {
    label: "Calendar view",
    onChange: () => undefined,
    options: VIEW_OPTIONS,
    value: "week",
  },
  component: Segmented,
  tags: ["autodocs"],
  title: "Primitives/Segmented",
} satisfies Meta<typeof Segmented>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const week = canvas.getByRole("radio", { name: "Week" });
    week.focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect(
      canvas.getByRole("radio", { name: "Month" }),
    ).toHaveAttribute("aria-checked", "true");
  },
  render: () => (
    <SegmentedExample
      initialValue="week"
      label="Calendar view"
      options={VIEW_OPTIONS}
    />
  ),
};

export const Variants: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  render: () => (
    <div className="sb-stack">
      <SegmentedExample
        initialValue="work"
        label="Availability range"
        options={AVAILABILITY_OPTIONS}
      />
      <SegmentedExample
        initialValue="week"
        label="Calendar view, control height"
        options={VIEW_OPTIONS.slice(0, 3)}
        size="control"
      />
      <SegmentedExample
        initialValue="week"
        label="Calendar view, four options"
        options={VIEW_OPTIONS}
      />
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="sb-stack">
      <SegmentedExample
        initialValue="day"
        label="Partially available views"
        options={PARTIAL_OPTIONS}
      />
      <SegmentedExample
        disabled
        initialValue="week"
        label="Disabled calendar view"
        options={VIEW_OPTIONS.slice(0, 3)}
      />
    </div>
  ),
};

export const Narrow: Story = {
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
    const control = canvas.getByRole("radiogroup", {
      name: "Narrow calendar view",
    });
    const agenda = canvas.getByRole("radio", { name: "Agenda" });

    await expect(agenda.getBoundingClientRect().right).toBeLessThanOrEqual(
      control.getBoundingClientRect().right,
    );
    await expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
  },
  render: () => (
    <div className="sb-control-width">
      <SegmentedExample
        initialValue="week"
        label="Narrow calendar view"
        options={VIEW_OPTIONS}
      />
    </div>
  ),
};
