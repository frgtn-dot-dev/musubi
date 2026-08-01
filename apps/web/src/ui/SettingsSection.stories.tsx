import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { ExternalLink, UserRound } from "lucide-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../.storybook/modes";
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
  const [kanji, setKanji] = useState(true);
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
          checked={kanji}
          detail="Display Japanese day labels in the mini calendar"
          disabled={disabled}
          label="Show kanji"
          onCheckedChange={setKanji}
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

export const Overview: Story = {
  parameters: {
    chromatic: {
      modes: DESKTOP_MODES,
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("switch", { name: /^Show kanji/ });
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
  render: () => <SettingsExample />,
};
