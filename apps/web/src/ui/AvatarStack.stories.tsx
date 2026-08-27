import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { AvatarStack, type AvatarStackPerson } from "./AvatarStack";

const GUESTS: readonly AvatarStackPerson[] = [
  { id: "1", name: "Haruki Tanaka" },
  { id: "2", name: "Mika Novak" },
  { id: "3", name: "Sam Rivers" },
  { id: "4", name: "Lena Fischer" },
  { id: "5", name: "Oscar Lind" },
  { id: "6", name: "Priya Raman" },
  { id: "7", name: "Tomas Cerny" },
  { id: "8", name: "Yuki Sato" },
  { id: "9", name: "Ana Duarte" },
];

const meta = {
  args: {
    label: "Show every answer",
    people: GUESTS.slice(0, 4),
  },
  component: AvatarStack,
  tags: ["autodocs"],
  title: "Primitives/AvatarStack",
} satisfies Meta<typeof AvatarStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(
      canvas.getByRole("button", { name: "Show every answer" }),
    ).toBeVisible();
  },
};

/* Past the limit the faces stop and a count takes over, because a row of
   twenty circles says less than "+13". */
export const Overflow: Story = {
  args: {
    limit: 4,
    people: GUESTS,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const stack = canvas.getByRole("button", { name: "Show every answer" });

    await expect(stack).toHaveTextContent("+5");
    // Five faces on the row: four guests and the count that replaces the rest.
    await expect(stack.children).toHaveLength(5);
  },
};

/* A page with its own palette overrides the three colours rather than
   restating the anatomy. */
export const OnItsOwnPalette: Story = {
  args: {
    limit: 4,
    people: GUESTS,
  },
  render: (args) => (
    <div
      style={{
        background: "#2b2622",
        borderRadius: 12,
        padding: 20,
        // @ts-expect-error -- custom properties are the documented seam
        "--avatar-stack-more-fill": "#413a33",
        "--avatar-stack-more-text": "#cfc4b6",
        "--avatar-stack-ring": "#2b2622",
      }}
    >
      <AvatarStack {...args} />
    </div>
  ),
};

export const Interactive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const stack = canvas.getByRole("button", { name: "Show every answer" });

    await userEvent.click(stack);

    await expect(stack).toHaveFocus();
  },
};

export const Narrow: Story = {
  args: {
    limit: 4,
    people: GUESTS,
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
};
