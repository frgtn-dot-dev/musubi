import type { Calendar } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import {
	CalendarTransferDialog,
	type CalendarTransferDialogProps,
} from "./CalendarTransferDialog";

const CALENDARS: Calendar[] = [
	{
		color: "#D4A574",
		creatorID: "user-1",
		id: "personal",
		isDefault: true,
		members: [],
		name: "Personal",
		role: "owner",
	},
	{
		accountId: "google-work",
		accountLabel: "work@example.com",
		color: "#7A8BA3",
		creatorID: "user-1",
		id: "studio",
		members: [],
		name: "Studio",
		provider: "google",
		role: "owner",
	},
];

const meta: Meta<typeof CalendarTransferDialog> = {
	args: {
		calendars: CALENDARS,
		onCreate: async ({ color, name }) => ({
			...CALENDARS[0]!,
			color,
			id: "new-calendar",
			isDefault: false,
			name,
		}),
		onDisconnect: async () => undefined,
		onExport: async () => "BEGIN:VCALENDAR\nEND:VCALENDAR",
		onImport: async ({ color, name }) => ({
			...CALENDARS[0]!,
			color,
			id: "imported-calendar",
			imported: 0,
			isDefault: false,
			name,
		}),
		onManageMembers: () => undefined,
		onNotice: () => undefined,
		onOpenChange: () => undefined,
		onRemove: async (calendar) => calendar,
		onUpdate: async (calendar) => calendar,
		open: true,
	} satisfies CalendarTransferDialogProps,
	component: CalendarTransferDialog,
	parameters: {
		chromatic: { modes: DESKTOP_MODES },
		layout: "fullscreen",
	},
	title: "Calendar/Calendar management",
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
	play: async () => {
		const dialog = await screen.findByRole("dialog", { name: "Calendars" });
		await waitFor(() => expect(dialog).toBeVisible());
		expect(
			within(dialog).getByRole("button", { name: "Stop syncing Studio" }),
		).toBeVisible();
		await userEvent.click(within(dialog).getByText("New calendar", { exact: true }));
		const account = within(dialog).getByRole("combobox", { name: "Account" });
		expect(account).toBeVisible();
		await userEvent.click(account);
		await waitFor(() =>
			expect(
				screen.getByRole("option", { name: /work@example\.com/ }),
			).toBeVisible(),
		);
	},
};

export const ImportIntoConnectedAccount: Story = {
	play: async () => {
		const dialog = await screen.findByRole("dialog", { name: "Calendars" });
		await userEvent.click(within(dialog).getByText("Import calendar", { exact: true }));
		const destination = within(dialog).getByRole("combobox", {
			name: "Import into account",
		});
		await userEvent.click(destination);
		await userEvent.click(
			await screen.findByRole("option", { name: /work@example\.com/ }),
		);
		expect(destination).toHaveTextContent("work@example.com");
	},
};

export const ExternalDisconnectConfirmation: Story = {
	play: async () => {
		const dialog = await screen.findByRole("dialog", { name: "Calendars" });
		await userEvent.click(
			within(dialog).getByRole("button", { name: "Stop syncing Studio" }),
		);
		const confirmation = await screen.findByRole("dialog", {
			name: "Stop syncing “Studio”?",
		});
		await waitFor(() => expect(confirmation).toBeVisible());
		expect(
			within(confirmation).getByText(
				"Your Google Calendar account stays connected.",
			),
		).toBeVisible();
	},
};

export const Narrow: Story = {
  args: {
    calendars: [...CALENDARS, {
      ...CALENDARS[1]!,
      id: "studio-planning",
      name: "Studio planning and team commitments",
    }],
  },
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Calendars" });
    await waitFor(() => expect(dialog).toBeVisible());
    expect(within(dialog).getByRole("button", { name: "Settings for Studio planning and team commitments" })).toBeVisible();
    await userEvent.click(within(dialog).getByText("New calendar", { exact: true }));
    expect(within(dialog).getByRole("textbox", { name: "New calendar name" })).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeVisible();
    const summary = within(dialog).getByText("Import calendar", { exact: true }).closest("summary")!;
    await userEvent.click(summary);
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Import into account" })).toBeVisible());
  },
};

export const Export: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Calendars" });
    await userEvent.click(within(dialog).getByText("Export calendar", { exact: true }));
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Calendar to export" })).toBeVisible());
    expect(within(dialog).getByRole("button", { name: "Export .ics" })).toBeVisible();
  },
};
