import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { RouteState } from "~/ui/RouteState";
import { AUTH_EXPIRED_EVENT, authClient } from "./auth-client";

export function SessionGate() {
  const session = authClient.useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const router = useRouter();
  const redirecting = useRef(false);

  useEffect(() => {
    function refreshSession() {
      void session.refetch().finally(() => router.invalidate());
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, refreshSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, refreshSession);
  }, [router, session]);

  useEffect(() => {
    if (session.isPending || session.data || redirecting.current) {
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
