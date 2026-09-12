import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { ExternalLink, UserRound } from "lucide-react";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Field } from "./Field";
import { Row, RowAction, RowOptions, RowToggle } from "./Row";
import { SettingsSection } from "./SettingsSection";

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] as const;

const VIEW_OPTIONS = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "agenda" },
] as const;

function SettingsExample({ disabled = false }: { disabled?: boolean }) {
  const [weekNumbers, setWeekNumbers] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");
  const [view, setView] = useState<"agenda" | "day" | "month" | "week">(
    "week",
  );

  return (
    <div className="sb-settings-preview">
      <SettingsSection title="Appearance">
        <RowOptions
          disabled={disabled}
          label="Theme"
          options={THEME_OPTIONS}
          value={theme}
          onChange={setTheme}
        />
        <RowToggle
          checked={weekNumbers}
          detail="Display Japanese day labels in the mini calendar"
          disabled={disabled}
          label="Show week numbers"
          onCheckedChange={setWeekNumbers}
        />
        <RowOptions
          disabled={disabled}
          label="Default view"
          options={VIEW_OPTIONS}
          value={view}
          onChange={setView}
        />
      </SettingsSection>
      <SettingsSection title="Help & About">
        <RowAction
          detail="Suggest ideas, vote, and see what is planned"
          disabled={disabled}
          label="Feedback & Roadmap"
          showChevron={false}
          trailing={<ExternalLink aria-hidden="true" size={15} />}
        />
        <Row label="Version" value="0.11.2" />
      </SettingsSection>
      <SettingsSection title="Account">
        <RowAction
          detail="Profile, avatar, and account deletion"
          disabled={disabled}
          icon={<UserRound size={18} strokeWidth={1.6} />}
          label="Manage account"
        />
      </SettingsSection>
    </div>
  );
}

function PaddedDialogExample() {
  const [open, setOpen] = useState(false);
  const [weekNumbers, setWeekNumbers] = useState(true);
  return <Dialog open={open} onOpenChange={setOpen} title="Calendar settings" closeLabel="Close calendar settings"
    trigger={<Button variant="secondary">Open calendar settings</Button>}>
    <Field label="Calendar name"><input defaultValue="Family" /></Field>
    <SettingsSection inset={false} title="Display">
      <RowToggle label="Show week numbers" checked={weekNumbers} onCheckedChange={setWeekNumbers} />
    </SettingsSection>
    <SettingsSection inset={false} title="About">
      <Row label="Owner" value="Alex" />
    </SettingsSection>
  </Dialog>;
}

const meta = {
  args: {
    children: null,
    title: "Appearance",
  },
  component: SettingsSection,
  tags: ["autodocs"],
  title: "Patterns/Settings Section",
} satisfies Meta<typeof SettingsSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PageSection: Story = {
  args: { headingLevel: 2, title: "Published announcements", children: <Row label="Upcoming maintenance" detail="Everyone on this server" /> },
};

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("switch", { name: /^Show week numbers/ });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    const dark = canvas.getByRole("radio", { name: "Dark" });
    await userEvent.click(dark);
    await expect(dark).toHaveAttribute("aria-checked", "true");
  },
  render: () => <SettingsExample />,
};

export const Disabled: Story = {
  render: () => <SettingsExample disabled />,
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
    const control = canvas.getByRole("radiogroup", {
      name: "Default view",
    });
    const lastOption = canvas.getByRole("radio", { name: "Agenda" });
    const controlEdge = control.getBoundingClientRect().right;
    const optionEdge = lastOption.getBoundingClientRect().right;

    await expect(optionEdge).toBeLessThanOrEqual(controlEdge);
    await expect(control.scrollWidth).toBeLessThanOrEqual(control.clientWidth);
  },
  render: () => <SettingsExample />,
};

export const PaddedDialog: Story = {
  parameters: { chromatic: { modes: DESKTOP_MODES } },
  render: () => <PaddedDialogExample />,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "Open calendar settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Calendar settings" });
    await waitFor(() => expect(dialog).toBeVisible());
    const content = within(dialog);
    const fieldLeft = content.getByRole("textbox", { name: "Calendar name" }).getBoundingClientRect().left;
    const titleLeft = content.getByRole("heading", { name: "Calendar settings" }).getBoundingClientRect().left;
    for (const name of ["Display", "About"]) {
      const section = content.getByRole("region", { name });
      await expect(section.getBoundingClientRect().left).toBeCloseTo(titleLeft, 0);
      await expect(within(section).getByRole("heading", { name }).getBoundingClientRect().left).toBeCloseTo(fieldLeft, 0);
      await expect(getComputedStyle(section).paddingTop).toBe("0px");
    }
    const toggle = content.getByRole("switch", { name: "Show week numbers" });
    await expect(Number.parseFloat(getComputedStyle(toggle).paddingLeft)).toBeGreaterThan(0);
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  },
};

export const NarrowPaddedDialog: Story = {
  ...PaddedDialog,
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
};
