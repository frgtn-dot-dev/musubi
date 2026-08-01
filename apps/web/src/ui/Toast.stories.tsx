import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { DESKTOP_MODES } from "../../.storybook/modes";
import { Toast } from "./Toast";

const meta = {
  args: {
    message: "Calendar updated.",
  },
  component: Toast,
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Primitives/Toast",
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MessageOnly: Story = {};

export const WithUndo: Story = {
  args: {
    actionLabel: "Undo",
    message: "Event moved to tomorrow.",
    onAction: () => undefined,
  },
};

export const Error: Story = {
  args: {
    message: "The event could not be saved. Your changes were restored.",
    tone: "error",
  },
};
