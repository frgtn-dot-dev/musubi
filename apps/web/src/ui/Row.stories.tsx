import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { Bell, ChevronRight, Moon, Palette } from "lucide-react";
import { useState } from "react";
import { Row, RowAction, RowOptions, RowToggle } from "./Row";

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
] as const;

function InteractiveRows() {
  const [notifications, setNotifications] = useState(true);
  const [theme, setTheme] = useState<"dark" | "light" | "system">("system");

  return (
    <div className="sb-panel">
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
      <div className="sb-panel">
        <Story />
      </div>
    ),
  ],
};

export const Variants: Story = {
  render: () => (
    <div className="sb-panel">
      <Row label="Read-only value" value="Week" />
      <RowAction detail="Profile, theme, and preferences" label="Settings" />
      <RowAction
        label="Custom trailing content"
        showChevron={false}
        trailing={<ChevronRight size={17} />}
      />
    </div>
  ),
};

export const Interactive: Story = {
  render: () => <InteractiveRows />,
};
