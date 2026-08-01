import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { CalendarX2, Plus } from "lucide-react";
import { Button } from "./Button";
import { Empty } from "./Empty";

const meta = {
  args: {
    description: "Events in this range will appear here.",
    icon: <CalendarX2 size={24} />,
    title: "No events yet",
  },
  component: Empty,
  decorators: [
    (Story) => (
      <div className="sb-panel">
        <Story />
      </div>
    ),
  ],
  tags: ["autodocs"],
  title: "Primitives/Empty",
} satisfies Meta<typeof Empty>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const WithRecoveryAction: Story = {
  args: {
    action: (
      <Button icon={<Plus size={16} />} size="compact">
        Create event
      </Button>
    ),
    description: "Create the first event or change the active calendar filters.",
    title: "Nothing scheduled",
  },
};

export const TitleOnly: Story = {
  args: {
    description: undefined,
    icon: undefined,
    title: "No pending invitations",
  },
};
