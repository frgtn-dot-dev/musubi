import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { Button } from "~/ui/Button";
import { fixtureCalendars } from "../fixtures";
import { QuickCreate } from "./QuickCreate";

function CreateEventPreview({ allDay = false }: { allDay?: boolean }) {
  const [target, setTarget] = useState<HTMLElement>();
  return <>
    <Button onClick={event => setTarget(event.currentTarget)}>New event</Button>
    {target ? <QuickCreate
      anchor={{ returnFocus: target, x: 0, y: 0 }} calendars={fixtureCalendars}
      date="2026-09-11" endDate={allDay ? "2026-09-11" : undefined} isAllDay={allDay}
      email="alex@example.com" userId="alex" timeFormat="24h" weekStartsOn="monday"
      onCreate={async event => event} onCreated={() => {}} open
      onOpenChange={open => { if (!open) setTarget(undefined); }}
    /> : null}
  </>;
}

const meta = {
  title: "Calendar/Event creation panel",
  component: CreateEventPreview,
  parameters: { layout: "fullscreen", chromatic: { modes: { ...DESKTOP_MODES, ...MOBILE_MODES } } },
  args: { allDay: false },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole("button", { name: "New event" }));
    const body = within(document.body);
    await expect(body.getByRole("dialog", { name: "Create event" })).toBeVisible();
    await expect(body.getByRole("textbox", { name: "Event title" })).toHaveFocus();
    await expect(body.getByPlaceholderText("Add notes")).toBeInTheDocument();
  },
} satisfies Meta<typeof CreateEventPreview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Timed: Story = {};
export const AllDay: Story = { args: { allDay: true } };
