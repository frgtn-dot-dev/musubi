import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import styles from "./styles/settings.module.css";

type Section = {
  id: string;
  label: string;
  rows: ReadonlyArray<{ label: string; value: string }>;
};

const sections: readonly Section[] = [
  {
    id: "appearance",
    label: "Appearance",
    rows: [
      { label: "Theme", value: "System" },
      { label: "Default view", value: "Month" },
      { label: "Week starts on", value: "Monday" },
    ],
  },
  {
    id: "reminders",
    label: "Reminders",
    rows: [
      { label: "Default reminder", value: "30 minutes before" },
      { label: "All-day events", value: "1 day before" },
    ],
  },
  {
    id: "notifications",
    label: "Email notifications",
    rows: [
      { label: "New invitations", value: "On" },
      { label: "Changed events", value: "On" },
      { label: "Cancelled events", value: "On" },
    ],
  },
  {
    id: "about",
    label: "Help & About",
    rows: [
      { label: "Keyboard shortcuts", value: "View" },
      { label: "Version", value: "Musubi preview" },
    ],
  },
  {
    id: "account",
    label: "Account",
    rows: [
      { label: "Account settings", value: "Manage" },
      { label: "Sign out", value: "Sign out" },
    ],
  },
  {
    id: "diagnostics",
    label: "Diagnostics",
    rows: [
      { label: "System status", value: "All checks passed" },
      { label: "Test notification", value: "Send" },
      { label: "Full report", value: "View" },
    ],
  },
  {
    id: "administration",
    label: "Administration",
    rows: [
      { label: "New announcement", value: "Create" },
      { label: "Published announcements", value: "Manage" },
    ],
  },
];

function SettingsSidebarProposal() {
  const [activeId, setActiveId] = useState(sections[0].id);
  const [open, setOpen] = useState(true);
  const active = sections.find(({ id }) => id === activeId) ?? sections[0];
  const standardSections = sections.slice(0, -1);
  const administration = sections.at(-1);

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open settings proposal</Button>
      <Dialog
        bodyLayout="flush"
        closeLabel="Close settings"
        description="Preferences sync across your Musubi devices."
        onOpenChange={setOpen}
        open={open}
        size="spacious"
        title="Settings"
      >
        <div className={styles.settingsLayout}>
          <nav aria-label="Settings sections" className={styles.settingsNav}>
            <div className={styles.settingsNavPrimary}>
              {standardSections.map((section) => (
                <Button
                  aria-current={active.id === section.id ? "page" : undefined}
                  className={styles.settingsNavButton}
                  key={section.id}
                  onClick={() => setActiveId(section.id)}
                  size="compact"
                  variant="ghost"
                >
                  {section.label}
                </Button>
              ))}
            </div>
            {administration ? (
              <div className={styles.settingsNavAdmin}>
                <Button
                  aria-current={
                    active.id === administration.id ? "page" : undefined
                  }
                  className={styles.settingsNavButton}
                  onClick={() => setActiveId(administration.id)}
                  size="compact"
                  variant="ghost"
                >
                  {administration.label}
                </Button>
              </div>
            ) : null}
          </nav>
          <section className={styles.settingsPanel} key={active.id}>
            <SettingsSection title={active.label}>
              {active.rows.map((row) => (
                <Row key={row.label} label={row.label} value={row.value} />
              ))}
            </SettingsSection>
          </section>
        </div>
      </Dialog>
    </>
  );
}

const meta = {
  args: {
    children: null,
    closeLabel: "Close settings",
    onOpenChange: () => undefined,
    open: true,
    title: "Settings",
  },
  component: Dialog,
  parameters: {
    layout: "fullscreen",
  },
  tags: ["autodocs"],
  title: "Calendar/Settings dialog",
} satisfies Meta<typeof Dialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SidebarProposal: Story = {
  parameters: {
    chromatic: { modes: DESKTOP_MODES },
  },
  render: () => <SettingsSidebarProposal />,
};

export const SidebarProposalNarrow: Story = {
  parameters: {
    chromatic: { modes: MOBILE_MODES },
  },
  render: () => <SettingsSidebarProposal />,
};
