import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { Disclosure } from "~/ui/Disclosure";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { AccountMark } from "./ProviderIcon";
import { fixtureCalendars } from "../fixtures";

const providers = [
  { flavor: "google", label: "Google Calendar", account: "haruki@example.com" },
  { flavor: "microsoft", label: "Outlook", account: "haruki@studio.example" },
  { flavor: "apple", label: "iCloud", account: "Haruki’s personal account" },
  { flavor: "caldav", label: "CalDAV", account: "Team calendar server" },
] as const;

const meta = {
  component: AccountMark,
  tags: ["autodocs"],
  title: "Calendar/Provider marks",
  args: { flavor: "google" },
} satisfies Meta<typeof AccountMark>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AccountAndInspectorRows: Story = {
  parameters: { chromatic: { modes: { ...DESKTOP_MODES, ...MOBILE_MODES } } },
  render: () => <div className="sb-settings-preview">
    <SettingsSection title="Connected accounts">
      {providers.map(provider => <Row key={provider.flavor} icon={<AccountMark flavor={provider.flavor} />} label={provider.label} detail={provider.account} />)}
    </SettingsSection>
    <SettingsSection title="Event provider details">
      {providers.map(provider => <Disclosure key={provider.flavor} density="compact" icon={<AccountMark flavor={provider.flavor} size="compact" />} label={`${provider.label} details`}>
        <Row size="compact" label="Account" value={provider.account} />
      </Disclosure>)}
    </SettingsSection>
  </div>,
};

export const CalendarPigments: Story = {
  parameters: { chromatic: { modes: { ...DESKTOP_MODES, ...MOBILE_MODES } } },
  render: () => <div className="sb-settings-preview">
    <SettingsSection title="Calendar colours">
      {providers.map((provider, index) => <Row
        key={provider.flavor}
        icon={<AccountMark flavor={provider.flavor} size="compact" color={fixtureCalendars[index].color} />}
        label={fixtureCalendars[index].name}
        detail={provider.label}
      />)}
    </SettingsSection>
  </div>,
};
