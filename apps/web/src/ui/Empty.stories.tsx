import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
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

export const PageHeading: Story = {
  args: {
    headingLevel: 2,
    title: "No tasks yet",
    description: "Add a task for one of the calendars on this Page.",
    icon: undefined,
    action: <Button icon={<Plus size={16} />}>Create task</Button>,
  },
  parameters: { chromatic: { modes: { ...DESKTOP_MODES, ...MOBILE_MODES } } },
  play: async ({ canvasElement }) => {
    const heading = within(canvasElement).getByRole("heading", { level: 2, name: "No tasks yet" });
    const style = getComputedStyle(heading);
    await expect(style.marginBlockStart).toBe("0px");
    await expect(style.marginBlockEnd).toBe("0px");
    await expect(style.fontSize).toBe("19px");
    await expect(style.fontWeight).toBe("400");
  },
};
