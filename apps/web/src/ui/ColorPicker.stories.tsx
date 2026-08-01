import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { ColorPicker } from "./ColorPicker";
import styles from "./PickerStories.module.css";

const INITIAL_COLOR = "#7A8BA3";

type ColorPickerExampleProps = {
  disabled?: boolean;
  provider?: string;
  title: string;
};

function ColorPickerExample({ disabled, provider, title }: ColorPickerExampleProps) {
  const [value, setValue] = useState(INITIAL_COLOR);

  return (
    <article className={styles.card}>
      <div className={styles.copy}>
        <h3>{title}</h3>
        <p>
          {provider === "microsoft"
            ? "Constrained to the Outlook calendar palette."
            : "Named Musubi pigments plus an explicit custom hex path."}
        </p>
      </div>
      <div className={styles.controlRow}>
        <label>Calendar color</label>
        <ColorPicker
          disabled={disabled}
          label="Calendar color"
          onChange={setValue}
          provider={provider}
          value={value}
        />
      </div>
      <output className={styles.value}>{value}</output>
    </article>
  );
}

const meta = {
  args: {
    label: "Calendar color",
    onChange: () => undefined,
    value: INITIAL_COLOR,
  },
  component: ColorPicker,
  tags: ["autodocs"],
  title: "Primitives/ColorPicker",
} satisfies Meta<typeof ColorPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Palettes: Story = {
  render: () => (
    <div className={styles.grid}>
      <ColorPickerExample title="Musubi calendar" />
      <ColorPickerExample provider="microsoft" title="Outlook calendar" />
    </div>
  ),
};

export const Disabled: Story = {
  render: () => <ColorPickerExample disabled title="Locked calendar color" />,
};
