import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_EXPIRED_EVENT } from "./auth-client";
import { SessionGate } from "./SessionGate";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invalidate: vi.fn(),
  navigate: vi.fn(),
  queryClient: {},
  refetch: vi.fn(),
  signOutAndReset: vi.fn(),
}));

vi.mock("./auth-client", () => ({
  AUTH_EXPIRED_EVENT: "musubi:auth-expired",
  authClient: {
    getSession: mocks.getSession,
    useSession: () => ({
      data: { user: { id: "signed-in-user" } },
      isPending: false,
      refetch: mocks.refetch,
    }),
  },
}));
vi.mock("./use-session-user", () => ({
  useSessionUser: () => ({ fromSnapshot: false }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mocks.queryClient,
}));
vi.mock("@tanstack/react-router", () => ({
  Outlet: () => <div>Calendar workspace</div>,
  useLocation: () => ({ pathname: "/app", searchStr: "" }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ invalidate: mocks.invalidate }),
}));
vi.mock("~/calendar/components/AnnouncementDialog", () => ({
  AnnouncementGate: () => null,
}));
vi.mock("~/offline/sign-out", () => ({
  signOutAndReset: mocks.signOutAndReset,
}));

beforeEach(() => vi.clearAllMocks());

async function checkSession() {
  render(<SessionGate />);
  act(() => window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT)));
  // Wait for the entire check, including its sign-out/refetch decision.
  await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
  expect(mocks.getSession).toHaveBeenCalledTimes(1);
}

describe("SessionGate auth-expired confirmation", () => {
  it.each([0, 429, 500, 503])(
    "keeps local session state when the check resolves with HTTP error %s",
    async (status) => {
      mocks.getSession.mockResolvedValue({ data: null, error: { status } });
      await checkSession();
      expect(mocks.signOutAndReset).not.toHaveBeenCalled();
      expect(mocks.refetch).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(screen.getByText("Calendar workspace")).toBeTruthy();
    },
  );

  it("keeps local session state when the check rejects", async () => {
    mocks.getSession.mockRejectedValue(new TypeError("Failed to fetch"));
    await checkSession();
    expect(mocks.signOutAndReset).not.toHaveBeenCalled();
    expect(mocks.refetch).not.toHaveBeenCalled();
  });

  it.each([null, { status: 401 }])(
    "clears local state for a confirmed missing session (error: %j)",
    async (error) => {
      mocks.getSession.mockResolvedValue({ data: null, error });
      await checkSession();
      expect(mocks.signOutAndReset).toHaveBeenCalledExactlyOnceWith({
        queryClient: mocks.queryClient,
      });
      expect(mocks.refetch).not.toHaveBeenCalled();
    },
  );

  it("refreshes a session that is still valid", async () => {
    mocks.getSession.mockResolvedValue({
      data: { user: { id: "signed-in-user" } },
      error: null,
    });
    await checkSession();
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.signOutAndReset).not.toHaveBeenCalled();
  });
});
