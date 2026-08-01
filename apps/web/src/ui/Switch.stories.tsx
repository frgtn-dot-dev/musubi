import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { Switch } from "./Switch";

function InteractiveSwitch() {
  const [checked, setChecked] = useState(true);

  return (
    <Switch
      checked={checked}
      label="Event notifications"
      onCheckedChange={setChecked}
    />
  );
}

const meta = {
  args: {
    checked: false,
    label: "Event notifications",
    onCheckedChange: () => undefined,
  },
  component: Switch,
  tags: ["autodocs"],
  title: "Primitives/Switch",
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  render: () => <InteractiveSwitch />,
};

export const States: Story = {
  render: () => (
    <div className="sb-row">
      <Switch
        checked={false}
        label="Notifications off"
        onCheckedChange={() => undefined}
      />
      <Switch
        checked
        label="Notifications on"
        onCheckedChange={() => undefined}
      />
      <Switch
        checked={false}
        disabled
        label="Notifications unavailable"
        onCheckedChange={() => undefined}
      />
    </div>
  ),
};
