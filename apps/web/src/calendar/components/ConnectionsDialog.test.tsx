import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { ConnectionsDialog } from "./ConnectionsDialog";
import type * as Connections from "~/calendar/connections";

const { linkSocial } = vi.hoisted(() => ({ linkSocial: vi.fn() }));
vi.mock("~/auth/auth-client", () => ({ authClient: { linkSocial } }));
vi.mock("~/calendar/connections", async (original) => ({
  ...await original<typeof Connections>(),
  useConnections: () => ({ capabilities: { data: { syncProviders: ["google", "microsoft"] } } }),
}));
vi.mock("~/calendar/federated-workspace", () => ({ useFederatedWorkspace: () => ({ data: { servers: [] } }) }));
beforeEach(() => { linkSocial.mockReset().mockResolvedValue({}); window.sessionStorage.clear(); });

it.each([["google", false], ["microsoft", false], ["google", true], ["microsoft", true]] as const)("ConnectionsDialog sends explicit optional Tasks choice to %s; reconnect=%s", async (provider, reconnect) => {
  render(<ConnectionsDialog calendars={reconnect ? [{ id: "tasks", name: "Tasks", color: "#7A8BA3", creatorID: "owner", role: "owner", members: [], accountId: "account", provider, supportsTasks: true, supportsEvents: false, syncStatus: "reconnect_required" }] : []} open onNotice={vi.fn()} onOpenChange={vi.fn()} userId="owner" />);
  const checkbox = screen.getByRole("checkbox", { name: /Include Tasks/ });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  const button = screen.getByRole("button", { name: reconnect ? "Reconnect" : provider === "google" ? "Google Calendar" : "Outlook" });
  const tasks = provider === "google" ? "https://www.googleapis.com/auth/tasks" : "Tasks.ReadWrite";
  for (const includeTasks of [true, false]) {
    if (!includeTasks) fireEvent.click(checkbox);
    fireEvent.click(button);
    await waitFor(() => expect(linkSocial).toHaveBeenCalledTimes(includeTasks ? 1 : 2));
    const options = linkSocial.mock.lastCall![0];
    expect(options.provider).toBe(provider);
    expect(options.callbackURL).toBe(window.location.href);
    expect(options.scopes.includes(tasks)).toBe(includeTasks);
    expect(options.scopes).toContain(provider === "google" ? "https://www.googleapis.com/auth/calendar.events" : "Calendars.ReadWrite");
    expect(window.sessionStorage.getItem("musubi:linking-provider")).toBe(provider);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  }
});
