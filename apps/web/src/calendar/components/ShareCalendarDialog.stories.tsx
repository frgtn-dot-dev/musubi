import type { Calendar } from "@musubi/types";
import type { Meta, StoryObj } from "@storybook/tanstack-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { DESKTOP_MODES, MOBILE_MODES } from "../../../.storybook/modes";
import { ShareCalendarDialog } from "./ShareCalendarDialog";

const calendar: Calendar = {
  color: "#D4A574",
  creatorID: "haruki",
  id: "studio",
  members: [],
  name: "Studio",
  role: "owner",
};
const memberName = "Alexandra Montgomery-Rivers";

function SharingStory() {
  const [client] = useState(() => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    const origin = getServerOrigin();
    queryClient.setQueryData(queryKeys.members(origin, "haruki", "home:studio"), [
      { id: "haruki", image: null, name: "Haruki", role: "owner" },
      { id: "alexandra", image: null, name: memberName, role: "viewer" },
    ]);
    queryClient.setQueryData(queryKeys.invites(origin, "haruki", "home:studio"), []);
    return queryClient;
  });
  return <QueryClientProvider client={client}>
    <ShareCalendarDialog calendar={calendar} onNotice={() => undefined} onOpenChange={() => undefined} userId="haruki" />
  </QueryClientProvider>;
}

const meta = {
  args: { calendar, onNotice: () => undefined, onOpenChange: () => undefined, userId: "haruki" },
  component: ShareCalendarDialog,
  parameters: { layout: "fullscreen", chromatic: { modes: DESKTOP_MODES } },
  render: () => <SharingStory />,
  title: "Calendar/Calendar sharing",
} satisfies Meta<typeof ShareCalendarDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Share Studio" });
    await waitFor(() => expect(dialog).toBeVisible());
    expect(within(dialog).getByText(memberName)).toBeVisible();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Email an invitation" }), "studio.planning@example.com");
    expect(within(dialog).getByRole("button", { name: "Send" })).toBeEnabled();
  },
};

export const OwnershipConfirmation: Story = {
  play: async () => {
    const dialog = await screen.findByRole("dialog", { name: "Share Studio" });
    const trigger = within(dialog).getByRole("button", { name: `Actions for ${memberName}` });
    await userEvent.click(trigger);
    await userEvent.click(await screen.findByRole("menuitem", { name: "Make owner" }));
    const confirmation = await screen.findByRole("dialog", { name: `Make ${memberName} the owner?` });
    await waitFor(() => expect(confirmation).toBeVisible());
    await userEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  },
};

export const Narrow: Story = {
  ...Overview,
  globals: { viewport: { isRotated: false, value: "mobile1" } },
  parameters: { chromatic: { modes: MOBILE_MODES } },
};
