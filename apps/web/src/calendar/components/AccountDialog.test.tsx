import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { uploadAvatar } from "~/api/resources";
import { AccountDialog } from "./AccountDialog";

vi.mock("~/api/resources", () => ({
  deleteAccount: vi.fn(),
  uploadAvatar: vi.fn(),
}));

vi.mock("~/auth/auth-client", () => ({
  authClient: {
    useSession: () => ({
      data: { user: { name: "Aki", email: "aki@example.com", image: null } },
      refetch: vi.fn(),
    }),
  },
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens the photo chooser from the avatar with the keyboard and restores focus on cancel", async () => {
  const user = userEvent.setup();
  render(<AccountDialog open onNotice={vi.fn()} onOpenChange={vi.fn()} />);

  const avatar = screen.getByRole("button", { name: "Change photo" });
  const input = screen.getByLabelText("Change profile photo");
  const openPicker = vi.spyOn(input, "click").mockImplementation(() => {});

  expect(avatar.querySelector('[aria-hidden="true"]')).not.toBeNull();
  expect(screen.queryByText("Change photo")).toBeNull();
  avatar.focus();
  await user.keyboard("{Enter}");
  expect(openPicker).toHaveBeenCalledTimes(1);
  await user.keyboard(" ");
  expect(openPicker).toHaveBeenCalledTimes(2);

  screen.getByRole("button", { name: "Close account" }).focus();
  fireEvent(input, new Event("cancel", { bubbles: true }));
  expect(document.activeElement).toBe(avatar);
  expect(uploadAvatar).not.toHaveBeenCalled();
});
