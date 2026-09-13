import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { useRef, useState } from "react";
import { TaskSchema } from "@musubi/types";
import { expect, screen, userEvent, waitFor } from "storybook/test";
import { fixtureCalendars, fixtureEvents } from "../fixtures";
import { SearchDialog } from "./SearchDialog";

function Example() {
  const [query, setQuery] = useState("Review");
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return <SearchDialog activeView="month" canCreateEvents canCreateTasks canCreateMeetings open query={query} setQuery={setQuery} inputRef={input} returnFocus={trigger}
    calendars={fixtureCalendars} visibleCalendarIds={[fixtureCalendars[0]!.id]}
    events={[{ ...fixtureEvents[0]!, title: "Review release details", calendars: [fixtureCalendars[0]!.id] }]}
    tasks={[TaskSchema.parse({ id: "review-task", creatorID: "owner", title: "Review project notes", calendarID: fixtureCalendars[1]!.id })]}
    onCreateMeeting={() => {}} onCreateEvent={() => {}} onCreateTask={() => {}} onEventSelect={() => {}} onTaskSelect={() => {}} onOpenChange={() => {}} onToday={() => {}} onViewChange={() => {}} />;
}
const meta = { title: "Calendar/SearchDialog", component: Example } satisfies Meta<typeof Example>;
export default meta;
export const Overview: StoryObj<typeof meta> = {
  play: async () => {
    await waitFor(() => expect(screen.getByRole("region", { name: "Visible events" })).toBeVisible());
    await expect(screen.getByRole("region", { name: "Elsewhere in your account" })).toBeVisible();
    await userEvent.keyboard("{ArrowDown}");
    await expect(screen.getByRole("button", { name: /Review project notes/ })).toHaveAttribute("data-active");
  },
};
