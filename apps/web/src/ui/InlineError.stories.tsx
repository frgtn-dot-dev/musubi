import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { InlineError } from "./InlineError";

const meta = {
  args: {
    children: "The calendar could not be shared.",
  },
  component: InlineError,
  tags: ["autodocs"],
  title: "Primitives/InlineError",
} satisfies Meta<typeof InlineError>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByRole("alert")).toHaveTextContent(
      "The calendar could not be shared.",
    );
  },
};

export const Variants: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  render: () => (
    <div className="sb-stack">
      <InlineError>The calendar could not be shared.</InlineError>
      <InlineError requestId="request-8f21">
        Ownership could not be transferred to Haruki.
      </InlineError>
      <InlineError requestId="request-3c07">
        This event repeats every second Tuesday, and the occurrence you edited
        no longer exists on the server. Reload the calendar to see the series as
        it stands now, then make the change again.
      </InlineError>
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
    const alert = canvas.getByRole("alert");

    await expect(alert.scrollWidth).toBeLessThanOrEqual(alert.clientWidth);
  },
  render: () => (
    <InlineError requestId="request-3c07">
      This event repeats every second Tuesday, and the occurrence you edited no
      longer exists on the server.
    </InlineError>
  ),
};
