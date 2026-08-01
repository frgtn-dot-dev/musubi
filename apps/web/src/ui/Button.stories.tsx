import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Plus, Settings } from "lucide-react";
import { Button, IconButton } from "./Button";

const meta = {
  args: {
    children: "Create event",
  },
  component: Button,
  tags: ["autodocs"],
  title: "Primitives/Button",
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const Variants: Story = {
  render: () => (
    <div className="sb-stack">
      <div className="sb-row">
        <Button icon={<Plus size={16} />}>Create event</Button>
        <Button variant="secondary">Cancel</Button>
        <Button variant="text">More options</Button>
        <Button variant="destructive">Delete event</Button>
      </div>
      <div className="sb-row">
        <Button size="compact">Save</Button>
        <Button size="compact" variant="secondary">
          Dismiss
        </Button>
        <IconButton label="Open settings">
          <Settings size={17} />
        </IconButton>
      </div>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="sb-row">
      <Button loading>Saving</Button>
      <Button disabled variant="secondary">
        Unavailable
      </Button>
      <IconButton label="Loading settings" loading>
        <Settings size={17} />
      </IconButton>
    </div>
  ),
};
