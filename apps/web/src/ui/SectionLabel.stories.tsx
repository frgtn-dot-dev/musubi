import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { SectionLabel } from "./SectionLabel";

const meta = {
  args: {
    children: "Appearance",
  },
  component: SectionLabel,
  tags: ["autodocs"],
  title: "Primitives/SectionLabel",
} satisfies Meta<typeof SectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const HeadingLevels: Story = {
  render: () => (
    <div className="sb-stack">
      <SectionLabel level={2}>Calendar settings</SectionLabel>
      <SectionLabel level={3}>Notifications</SectionLabel>
    </div>
  ),
};
