import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { RouteState } from "~/ui/RouteState";
import { AUTH_EXPIRED_EVENT, authClient } from "./auth-client";
import { useSessionUser } from "./use-session-user";

export function SessionGate() {
  const session = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const redirecting = useRef(false);
  // The session cannot be confirmed with no network, and treating that as "not
  // signed in" would send someone with a perfectly good cookie to the login
  // page — where there is nothing to log in against either. The last known
  // account stands in; the server decides again the moment it can be reached.
  const { fromSnapshot } = useSessionUser();
  const offlineSession = !session.data && fromSnapshot;

  useEffect(() => {
    function refreshSession() {
      void session.refetch().finally(() => router.invalidate());
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, refreshSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, refreshSession);
  }, [router, session]);

  useEffect(() => {
    if (
      session.isPending ||
      session.data ||
      offlineSession ||
      redirecting.current
    ) {
      return;
    }

    redirecting.current = true;
    void navigate({
      replace: true,
      search: { redirect: `${location.pathname}${location.searchStr}` },
      to: "/login",
    });
  }, [
    location.pathname,
    location.searchStr,
    navigate,
    offlineSession,
    session.data,
    session.isPending,
  ]);

  if (session.isPending) {
    return (
      <RouteState
        busy
        description="Checking the session on this server."
        eyebrow="Musubi"
        title="Opening your calendar…"
      />
    );
  }

  // Offline with a known account: the calendar renders from its snapshot rather
  // than a dead end.
  if (offlineSession) {
    return <Outlet />;
  }

  if (!session.data) {
    return (
      <RouteState
        busy
        eyebrow="Session required"
        title="Taking you to sign in…"
      />
    );
  }

  return <Outlet />;
}
