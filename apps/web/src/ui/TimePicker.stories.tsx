import type { Settings } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import styles from "./PickerStories.module.css";
import { TimePicker } from "./TimePicker";

const INITIAL_TIME = "09:30";

type TimePickerExampleProps = {
  disabled?: boolean;
  format: Settings["timeFormat"];
  max?: string;
  min?: string;
  relativeTo?: string;
  title: string;
};

function TimePickerExample({
  disabled,
  format,
  max,
  min,
  relativeTo,
  title,
}: TimePickerExampleProps) {
  const [value, setValue] = useState(INITIAL_TIME);

  return (
    <article className={styles.card}>
      <div className={styles.copy}>
        <h3>{title}</h3>
        <p>Type directly or use the snapped keyboard-navigable list.</p>
      </div>
      <div className={styles.controlRow}>
        <label>Time</label>
        <TimePicker
          disabled={disabled}
          label="Time"
          max={max}
          min={min}
          onChange={setValue}
          relativeTo={relativeTo}
          timeFormat={format}
          value={value}
        />
      </div>
      <output className={styles.value}>{value}</output>
    </article>
  );
}

const meta = {
  args: {
    label: "Time",
    onChange: () => undefined,
    timeFormat: "24h",
    value: INITIAL_TIME,
  },
  component: TimePicker,
  tags: ["autodocs"],
  title: "Primitives/TimePicker",
} satisfies Meta<typeof TimePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Formats: Story = {
  render: () => (
    <div className={styles.grid}>
      <TimePickerExample format="24h" title="24-hour" />
      <TimePickerExample format="12h" title="12-hour" />
    </div>
  ),
};

export const RangeAndDuration: Story = {
  render: () => (
    <TimePickerExample
      format="24h"
      max="18:00"
      min="09:00"
      relativeTo="08:30"
      title="Bounded end time"
    />
  ),
};

export const Disabled: Story = {
  render: () => (
    <TimePickerExample disabled format="24h" title="Unavailable time" />
  ),
};
