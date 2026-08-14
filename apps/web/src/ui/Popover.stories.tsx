import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "./Popover";
import styles from "./PopoverStories.module.css";

function PopoverExample() {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="secondary">Open summary</Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-labelledby="popover-story-title"
        className={styles.summary}
        role="dialog"
        side="bottom"
      >
        <header className={styles.header}>
          <span aria-hidden="true" className={styles.icon}>
            <CalendarDays size={18} strokeWidth={1.5} />
          </span>
          <div>
            <h2 id="popover-story-title">Saturday plans</h2>
            <p>Three events across two calendars.</p>
          </div>
        </header>
        <div className={styles.body}>
          <p>
            The feature owns this content. The shared primitive owns its
            anchored surface and narrow sheet geometry.
          </p>
          <PopoverClose asChild>
            <Button size="compact">Done</Button>
          </PopoverClose>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const meta = {
  component: PopoverContent,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  title: "Primitives/Popover",
} satisfies Meta<typeof PopoverContent>;

export default meta;
type Story = StoryObj<typeof meta>;

const openPopover: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Open summary" }));
  const popover = await screen.findByRole("dialog", {
    name: "Saturday plans",
  });
  await waitFor(() => expect(popover).toBeVisible());
};

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: openPopover,
  render: () => <PopoverExample />,
};

export const NarrowSheet: Story = {
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
  play: openPopover,
  render: () => <PopoverExample />,
};
