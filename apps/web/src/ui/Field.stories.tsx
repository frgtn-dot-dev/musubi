import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Field } from "./Field";

const meta = {
  component: Field,
  decorators: [
    (Story) => (
      <div className="sb-field-width">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  title: "Primitives/Field",
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    children: <input defaultValue="Design review" />,
    description: "Visible to everyone with access to this calendar.",
    label: "Event title",
  },
};

export const Error: Story = {
  args: {
    children: <input defaultValue="" />,
    error: "Enter a title before saving.",
    label: "Event title",
  },
};

export const Inline: Story = {
  args: {
    children: <input defaultValue="Europe/Prague" />,
    label: "Time zone",
    layout: "inline",
  },
};
