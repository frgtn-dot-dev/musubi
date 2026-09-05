import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Onboarding } from "./Onboarding";

const { linkSocial, getServerCapabilities } = vi.hoisted(() => ({ linkSocial: vi.fn(), getServerCapabilities: vi.fn() }));
vi.mock("~/auth/auth-client", () => ({ authClient: { linkSocial } }));
vi.mock("~/api/resources", () => ({ getServerCapabilities }));
beforeEach(() => {
  linkSocial.mockReset().mockResolvedValue({});
  getServerCapabilities.mockResolvedValue({ syncProviders: ["google", "microsoft"] });
  window.sessionStorage.clear();
});

it.each(["google", "microsoft"] as const)("Onboarding sends optional Tasks choice and finishes before linking %s", async (provider) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const patch = vi.fn().mockResolvedValue({});
  const done = vi.fn();
  render(<QueryClientProvider client={client}><Onboarding calendars={[]} onDone={done} onGetSettingsDocument={vi.fn().mockResolvedValue({ revision: 1 })} onPatchSettings={patch} onUpdateCalendar={vi.fn()} userName="Owner" /></QueryClientProvider>);
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  await waitFor(() => expect(screen.getByLabelText("Calendar name")).toBeDefined());
  fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
  const checkbox = await screen.findByRole("checkbox", { name: /Include Tasks/ });
  expect((checkbox as HTMLInputElement).checked).toBe(true);
  const button = screen.getByRole("button", { name: provider === "google" ? "Connect Google Calendar" : "Connect Outlook" });
  for (const includeTasks of [true, false]) {
    if (!includeTasks) fireEvent.click(checkbox);
    fireEvent.click(button);
    await waitFor(() => expect(linkSocial).toHaveBeenCalledTimes(includeTasks ? 1 : 2));
    const options = linkSocial.mock.lastCall![0];
    expect(options.provider).toBe(provider);
    expect(options.callbackURL).toBe(window.location.href);
    expect(options.scopes.includes(provider === "google" ? "https://www.googleapis.com/auth/tasks" : "Tasks.ReadWrite")).toBe(includeTasks);
    expect(options.scopes).toContain(provider === "google" ? "https://www.googleapis.com/auth/calendar.events" : "Calendars.ReadWrite");
    expect(window.sessionStorage.getItem("musubi:linking-provider")).toBe(provider);
    expect(patch).toHaveBeenCalledWith({ baseRevision: 1, patch: { onboarded: true } });
    expect(done.mock.invocationCallOrder.at(-1)!).toBeLessThan(linkSocial.mock.invocationCallOrder.at(-1)!);
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  }
  client.clear();
});
