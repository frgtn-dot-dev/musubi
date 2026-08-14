import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, fn, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Toast } from "./Toast";

const meta = {
  args: {
    message: "Calendar updated.",
  },
  component: Toast,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Primitives/Toast",
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    action: {
      label: "Undo",
      onClick: fn(),
    },
    message: "Event moved to tomorrow.",
  },
  play: async ({ args, canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole("button", { name: "Undo" }));
    await expect(args.action?.onClick).toHaveBeenCalledOnce();
  },
};

export const Variants: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    const messages = [
      ...body.getAllByRole("status"),
      body.getByRole("alert"),
    ];

    for (const message of messages) {
      const toast = message.parentElement;
      const region = toast?.parentElement;
      if (!toast || !region) throw new Error("Toast anatomy is incomplete.");

      const toastRect = toast.getBoundingClientRect();
      const regionRect = region.getBoundingClientRect();
      await expect(
        Math.round(toastRect.left + toastRect.width / 2),
      ).toBe(Math.round(regionRect.left + regionRect.width / 2));
      await expect(toastRect.width).toBeLessThanOrEqual(regionRect.width);
    }
  },
  render: () => (
    <>
      <Toast
        className="sb-toast-preview-top"
        message="Calendar updated."
      />
      <Toast
        action={{ label: "Undo", onClick: () => undefined }}
        className="sb-toast-preview-middle"
        message="Event moved to tomorrow."
      />
      <Toast
        className="sb-toast-preview-bottom"
        message="The event could not be saved."
        tone="error"
      />
    </>
  ),
};

export const States: Story = {
  args: {
    message:
      "The event could not be saved. The original time was restored.",
    tone: "error",
  },
};

export const Narrow: Story = {
  args: {
    action: {
      label: "Undo",
      onClick: fn(),
    },
    message: "Event moved to Personal calendar on tomorrow's agenda.",
  },
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
    const body = within(canvasElement.ownerDocument.body);
    const message = body.getByRole("status");
    const toast = message.parentElement;
    const region = toast?.parentElement;

    if (!toast || !region) throw new Error("Toast anatomy is incomplete.");

    const toastRect = toast.getBoundingClientRect();
    const regionRect = region.getBoundingClientRect();
    const toastMidpoint = Math.round(toastRect.left + toastRect.width / 2);
    const regionMidpoint = Math.round(regionRect.left + regionRect.width / 2);

    await expect(toastMidpoint).toBe(regionMidpoint);
    await expect(toastRect.width).toBeLessThanOrEqual(regionRect.width);
  },
};
