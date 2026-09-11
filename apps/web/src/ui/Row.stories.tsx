import type { Meta, StoryObj } from "@storybook/tanstack-react";
import {
  Bell,
  ChevronRight,
  Moon,
  Palette,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Row, RowAction, RowOptions, RowToggle } from "./Row";
import { SettingsSection } from "./SettingsSection";

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

function InteractiveRows() {
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");

  return (
    <div className="sb-settings-preview">
      <SettingsSection title="Preferences">
        <RowToggle
          checked={notifications}
          detail="Reminders for upcoming events"
          icon={<Bell size={18} />}
          label="Notifications"
          onCheckedChange={setNotifications}
        />
        <RowOptions
          icon={<Moon size={18} />}
          label="Appearance"
          onChange={setTheme}
          options={THEME_OPTIONS}
          value={theme}
        />
        <RowAction
          data-testid="profile-row"
          detail="haruki@example.com"
          icon={<Avatar name="Haruki Tanaka" size="default" />}
          label="Haruki Tanaka"
          showChevron={false}
        />
        <RowAction
          detail="Removes every calendar you own"
          icon={<Trash2 size={18} />}
          label="Delete account"
          tone="destructive"
        />
      </SettingsSection>
    </div>
  );
}

const meta = {
  args: {
    label: "Setting",
  },
  component: Row,
  tags: ["autodocs"],
  title: "Primitives/Row",
} satisfies Meta<typeof Row>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  args: {
    detail: "Inter Tight and Noto Serif",
    icon: <Palette size={18} />,
    label: "Typography",
    value: "Musubi",
  },
  decorators: [
    (Story) => (
      <div className="sb-settings-preview">
        <SettingsSection title="Presentation">
          <Story />
        </SettingsSection>
      </div>
    ),
  ],
};

export const Variants: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  render: () => (
    <div className="sb-settings-preview">
      <SettingsSection title="Row variants">
        <Row label="Read-only value" value="Week" />
        <RowAction detail="Profile, theme, and preferences" label="Settings" />
        <RowAction
          label="Custom trailing content"
          showChevron={false}
          trailing={<ChevronRight size={17} />}
        />
        <RowToggle
          checked
          label="Notifications"
          onCheckedChange={() => undefined}
        />
        <RowOptions
          label="Theme"
          options={THEME_OPTIONS}
          value="system"
          onChange={() => undefined}
        />
      </SettingsSection>
    </div>
  ),
};

export const States: Story = {
  render: () => (
    <div className="sb-settings-preview">
      <SettingsSection title="States">
        <RowAction
          aria-current="page"
          detail="The page currently shown in the calendar"
          label="Selected page"
          selected
        />
        <RowAction
          detail="This action is unavailable while settings are saved"
          disabled
          label="Disabled action"
        />
        <RowAction
          detail="Requires an email confirmation before anything is removed"
          icon={<Trash2 size={17} strokeWidth={1.7} />}
          label="Delete account"
          tone="destructive"
        />
        <Row
          detail="A deliberately long explanation verifies that rows grow without clipping or losing the trailing value."
          label="Long content wraps naturally"
          value="Synced"
        />
      </SettingsSection>
    </div>
  ),
};

export const Interactive: Story = {
  /* The ring has to sit inside the row: every consumer puts rows in something
     that clips or scrolls. */
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByRole("button", { name: /Delete account/ });

    await userEvent.tab();
    row.focus();

    await expect(
      Number.parseFloat(getComputedStyle(row).outlineOffset),
    ).toBeLessThan(0);

    /* An avatar is bigger than the glyph column, and it must widen its slot
       rather than spill out of it. */
    const slot = canvas
      .getByTestId("profile-row")
      .querySelector<HTMLElement>("[class*=rowIcon]")!;
    const avatar = slot.firstElementChild!;

    await expect(
      slot.getBoundingClientRect().left,
    ).toBeLessThanOrEqual(avatar.getBoundingClientRect().left);
  },
  render: () => <InteractiveRows />,
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
  render: () => <InteractiveRows />,
};

/** Delivery recovery can expose several independent actions for the same target. */
export const MultipleActions: Story = {
  parameters: { chromatic: { modes: { ...DESKTOP_MODES, ...MOBILE_MODES } } },
  render: () => <div className="sb-settings-preview">
    <SettingsSection title="Saved event deliveries">
      <Row layout="responsive-actions" data-testid="delivery-actions-row"
        label="Team calendar · changes need attention"
        detail="The saved event differs from the remote version. Review the changes before retrying. Provider confirmation is still pending."
        trailing={<>
          <Button size="compact" variant="secondary">Retry delivery</Button>
          <Button size="compact" variant="secondary">Discard saved alarm change</Button>
          <Button size="compact" variant="secondary">Review changes</Button>
        </>}
      />
    </SettingsSection>
  </div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const row = canvas.getByTestId("delivery-actions-row");
    const buttons = canvas.getAllByRole("button");
    const copy = row.querySelector<HTMLElement>('[data-slot="copy"]')!;
    if (matchMedia("(max-width: 599px)").matches) {
      await expect(buttons[0].getBoundingClientRect().top).toBeGreaterThan(copy.getBoundingClientRect().bottom);
    }
    await expect(row.scrollWidth - row.clientWidth).toBeLessThanOrEqual(1);
    for (let index = 1; index < buttons.length; index++) {
      await expect(buttons[index].getBoundingClientRect().top).toBeGreaterThan(buttons[index - 1].getBoundingClientRect().bottom);
    }
  },
};

export const MultipleActionsNarrow: Story = {
  ...MultipleActions,
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
};
