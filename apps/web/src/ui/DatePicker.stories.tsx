import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES } from "../../.storybook/modes";
import { DatePicker } from "./DatePicker";
import styles from "./PickerStories.module.css";

const INITIAL_DATE = "2026-08-01";

type DatePickerExampleProps = {
  disabled?: boolean;
  max?: string;
  min?: string;
  title: string;
};

function DatePickerExample({ disabled, max, min, title }: DatePickerExampleProps) {
  const [value, setValue] = useState(INITIAL_DATE);

  return (
    <article className={styles.card}>
      <div className={styles.copy}>
        <h3>{title}</h3>
        <p>Calendar recognition plus exact YYYY-MM-DD entry.</p>
      </div>
      <div className={styles.controlRow}>
        <label>Date</label>
        <DatePicker
          disabled={disabled}
          label="Date"
          max={max}
          min={min}
          onChange={setValue}
          value={value}
          weekStartsOn="monday"
        />
      </div>
      <output className={styles.value}>{value}</output>
    </article>
  );
}

const meta = {
  args: {
    label: "Date",
    onChange: () => undefined,
    value: INITIAL_DATE,
    weekStartsOn: "monday",
  },
  component: DatePicker,
  tags: ["autodocs"],
  title: "Primitives/DatePicker",
} satisfies Meta<typeof DatePicker>;

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
      canvas.getByRole("button", { name: /^Date:/ }),
    );
    const calendar = await screen.findByRole("region", {
      name: "Choose date",
    });
    await waitFor(() => expect(calendar).toBeVisible());
  },
  render: () => <DatePickerExample title="Event date" />,
};

export const RangeAndDisabled: Story = {
  render: () => (
    <div className={styles.grid}>
      <DatePickerExample
        max="2026-08-31"
        min="2026-08-01"
        title="August only"
      />
      <DatePickerExample disabled title="Unavailable date" />
    </div>
  ),
};
