import {
  Outlet,
  useLocation,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useRef } from "react";
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
      <main className="route-state" id="main-content" aria-busy="true">
        <p className="route-state__code">Musubi</p>
        <h1>Opening your calendar…</h1>
        <p>Checking the session on this server.</p>
      </main>
    );
  }

  if (!session.data) {
    return (
      <main className="route-state" id="main-content" aria-busy="true">
        <p className="route-state__code">Session required</p>
        <h1>Taking you to sign in…</h1>
      </main>
    );
  }

  return <Outlet />;
}
