import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, within } from "storybook/test";
import { CoverageBanner } from "./StaleBanner";

const meta = {
  title: "Patterns/Calendar coverage",
  component: CoverageBanner,
  args: { message: "Outlook sync covers a limited date range. Older and far-future events may not be loaded." },
} satisfies Meta<typeof CoverageBanner>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Bounded: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("status")).toHaveTextContent("Older and far-future events may not be loaded.");
  },
};
