import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Copy, MoreHorizontal, Star, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { IconButton } from "./Button";
import { Dialog } from "./Dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
} from "./Menu";
import styles from "./MenuStories.module.css";

function PageActionsMenu() {
  const [notice, setNotice] = useState("No command selected.");

  return (
    <div className={styles.example}>
      <div className={styles.pageRow}>
        <div>
          <strong>Work</strong>
          <span>4 calendars</span>
        </div>
        <Menu>
          <MenuTrigger asChild>
            <IconButton label="Open Work page actions" size="compact">
              <MoreHorizontal size={17} strokeWidth={1.7} />
            </IconButton>
          </MenuTrigger>
          <MenuContent align="end" label="Work page actions">
            <MenuItem
              icon={<Copy size={16} strokeWidth={1.6} />}
              shortcut="⌘D"
              onSelect={() => setNotice("Work page duplicated.")}
            >
              Duplicate page
            </MenuItem>
            <MenuItem
              icon={<Star size={16} strokeWidth={1.6} />}
              onSelect={() => setNotice("Work is now the default page.")}
            >
              Set as default
            </MenuItem>
            <MenuItem disabled icon={<Upload size={16} strokeWidth={1.6} />}>
              Export page
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              icon={<Trash2 size={16} strokeWidth={1.6} />}
              tone="destructive"
              onSelect={() => setNotice("Delete confirmation requested.")}
            >
              Delete page
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <output aria-live="polite">{notice}</output>
    </div>
  );
}

const meta = {
  args: {
    label: "Page actions",
  },
  component: MenuContent,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
  title: "Primitives/Menu",
} satisfies Meta<typeof MenuContent>;

export default meta;
type Story = StoryObj<typeof meta>;

const openMenu: NonNullable<Story["play"]> = async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  const trigger = canvas.getByRole("button", {
    name: "Open Work page actions",
  });
  trigger.focus();
  await userEvent.keyboard("{Enter}");
  const menu = await screen.findByRole("menu", {
    name: "Work page actions",
  });
  await waitFor(() => expect(menu).toBeVisible());
  await waitFor(() =>
    expect(
      screen.getByRole("menuitem", { name: /Duplicate page/ }),
    ).toHaveFocus(),
  );
};

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: openMenu,
  render: () => <PageActionsMenu />,
};

export const InsideElevatedDialog: Story = {
  render: () => (
    <Dialog elevated open title="Page settings" closeLabel="Close page settings" onOpenChange={() => undefined}>
      <PageActionsMenu />
    </Dialog>
  ),
  play: async () => {
    const trigger = screen.getByRole("button", { name: "Open Work page actions" });
    await userEvent.click(trigger);
    const item = await screen.findByRole("menuitem", { name: /Duplicate page/ });
    await waitFor(() => {
      const box = item.getBoundingClientRect();
      expect(item.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))).toBe(true);
    });
    await userEvent.click(item);
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.getByText("Work page duplicated.")).toBeVisible();
  },
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
  play: openMenu,
  render: () => <PageActionsMenu />,
};
