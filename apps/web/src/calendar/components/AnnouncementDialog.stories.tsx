import type { Announcement } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, screen, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { AnnouncementDialogView } from "./AnnouncementDialog";

const SINGLE: Announcement[] = [
  {
    id: "2026-08-20",
    title: "Shared availability polls",
    body: "Propose a few times and let attendees pick the ones that work — no more back-and-forth in chat.",
  },
];

const MULTIPLE: Announcement[] = [
  {
    id: "2026-08-20",
    title: "Shared availability polls",
    body: "Propose a few times and let attendees pick the ones that work — no more back-and-forth in chat.\n\nJoin the conversation at https://discord.gg/example if you have feedback.",
  },
  {
    id: "2026-08-10",
    title: "Faster recurring events",
    body: "Repeating events now render instantly, even months out.",
  },
  {
    id: "2026-07-28",
    title: "Dark mode for the calendar grid",
    body: "The week and month grids now follow your system theme.",
  },
];

const meta = {
  args: {
    onClose: () => undefined,
  },
  component: AnnouncementDialogView,
  parameters: {
    layout: "fullscreen",
  },
  title: "Calendar/Announcement dialog",
} satisfies Meta<typeof AnnouncementDialogView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SingleAnnouncement: Story = {
  args: {
    announcements: SINGLE,
  },
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async () => {
    const dialog = await screen.findByRole("dialog", {
      name: "Shared availability polls",
    });
    await waitFor(() => expect(dialog).toBeVisible());
    within(dialog).getByText(
      "Propose a few times and let attendees pick the ones that work — no more back-and-forth in chat.",
    );
  },
};

export const MultipleAnnouncements: Story = {
  args: {
    announcements: MULTIPLE,
  },
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "What's new" });
    await waitFor(() => expect(dialog).toBeVisible());
    const scoped = within(dialog);
    scoped.getByText("Faster recurring events");
    const link = scoped.getByRole("link", {
      name: "https://discord.gg/example",
    });
    expect(link).toHaveAttribute("target", "_blank");
  },
};

export const NarrowSheet: Story = {
  args: {
    announcements: MULTIPLE,
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
