import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Checkbox } from "./Checkbox";

const meta = {
  args: {
    label: "All day",
  },
  component: Checkbox,
  tags: ["autodocs"],
  title: "Primitives/Checkbox",
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const WithDescription: Story = {
  args: {
    defaultChecked: true,
    description: "Guests can respond to this event.",
    label: "Allow attendance",
  },
};

export const States: Story = {
  render: () => (
    <div className="sb-stack">
      <Checkbox label="Unchecked calendar" />
      <Checkbox defaultChecked label="Visible calendar" />
      <Checkbox disabled label="Unavailable calendar" />
      <Checkbox defaultChecked disabled label="Required calendar" />
    </div>
  ),
};
