import type { Meta, StoryObj } from "@storybook/tanstack-react";
import {
  CalendarPlus,
  MoreHorizontal,
  Settings,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { expect, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button, IconButton } from "./Button";

function ToggleIconButton() {
  const [pressed, setPressed] = useState(false);

  return (
    <IconButton
      aria-pressed={pressed}
      label="Toggle calendar settings"
      variant="ghost"
      onClick={() => setPressed((current) => !current)}
    >
      <Settings size={17} strokeWidth={1.7} />
    </IconButton>
  );
}

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

export const Overview: Story = {
  render: () => (
    <div className="sb-row">
      <Button variant="secondary">Cancel</Button>
      <Button icon={<CalendarPlus size={16} strokeWidth={1.7} />}>
        Create event
      </Button>
    </div>
  ),
};

export const Variants: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  render: () => (
    <div className="sb-matrix">
      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Control</h2>
        <div className="sb-row">
          <Button icon={<CalendarPlus size={16} strokeWidth={1.7} />}>
            Create event
          </Button>
          <Button variant="secondary">Edit details</Button>
          <Button variant="ghost">More options</Button>
          <Button
            icon={<Trash2 size={16} strokeWidth={1.7} />}
            variant="destructive"
          >
            Delete event
          </Button>
        </div>
      </section>

      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Compact</h2>
        <div className="sb-row">
          <Button size="compact">Save</Button>
          <Button size="compact" variant="secondary">
            Dismiss
          </Button>
          <Button size="compact" variant="ghost">
            Today
          </Button>
          <Button size="compact" variant="destructive">
            Remove
          </Button>
        </div>
      </section>

      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Icon only</h2>
        <div className="sb-row">
          <IconButton label="Create event" variant="primary">
            <CalendarPlus size={17} strokeWidth={1.7} />
          </IconButton>
          <IconButton label="Open settings" variant="secondary">
            <Settings size={17} strokeWidth={1.7} />
          </IconButton>
          <IconButton label="More options">
            <MoreHorizontal size={17} strokeWidth={1.7} />
          </IconButton>
          <IconButton label="Delete event" variant="destructive">
            <Trash2 size={17} strokeWidth={1.7} />
          </IconButton>
        </div>
      </section>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="sb-matrix">
      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Pending</h2>
        <div className="sb-row">
          <Button loading>Saving changes</Button>
          <Button loading variant="secondary">
            Refreshing calendars
          </Button>
          <IconButton label="Loading settings" loading>
            <Settings size={17} strokeWidth={1.7} />
          </IconButton>
        </div>
      </section>

      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Disabled</h2>
        <div className="sb-row">
          <Button disabled>Save changes</Button>
          <Button disabled variant="secondary">
            Cancel
          </Button>
          <Button disabled variant="ghost">
            More options
          </Button>
          <Button disabled variant="destructive">
            Delete event
          </Button>
        </div>
      </section>

      <section className="sb-sample-group">
        <h2 className="sb-sample-label">Pressed</h2>
        <div className="sb-row">
          <Button aria-pressed="true" variant="secondary">
            Weekends visible
          </Button>
          <ToggleIconButton />
        </div>
      </section>
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
    const primary = canvas.getByRole("button", {
      name: "Save and notify members",
    });
    const compact = canvas.getByRole("button", { name: "Add reminder" });

    await expect(primary.getBoundingClientRect().height).toBe(48);
    await expect(compact.getBoundingClientRect().height).toBe(44);
  },
  render: () => (
    <div className="sb-control-width sb-action-stack">
      <Button>Save and notify members</Button>
      <Button size="compact" variant="secondary">
        Add reminder
      </Button>
      <Button variant="ghost">Keep editing</Button>
    </div>
  ),
};
