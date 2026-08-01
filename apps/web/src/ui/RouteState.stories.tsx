import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Button } from "./Button";
import { RouteState } from "./RouteState";

const meta = {
  args: {
    eyebrow: "Calendar unavailable",
    title: "Musubi could not open this view.",
  },
  component: RouteState,
  parameters: {
    layout: "fullscreen",
  },
  title: "Patterns/Route state",
} satisfies Meta<typeof RouteState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    actions: (
      <>
        <Button>Try again</Button>
        <Button variant="secondary">Back to calendar</Button>
      </>
    ),
    description:
      "Your calendar is still safe. Check the server connection and try again.",
    requestId: "req_8F2K1",
  },
};

export const States: Story = {
  args: {
    busy: true,
    description: "Fetching Pages, calendars, and events from your server.",
    eyebrow: "Preparing workspace",
    title: "Opening your calendar…",
  },
};
