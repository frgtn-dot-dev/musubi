/// <reference types="vite/client" />

import type { QueryClient } from "@tanstack/react-query";
import { Agentation } from "agentation";
import {
  ClientOnly,
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { type ReactNode, useSyncExternalStore } from "react";
import { AppErrorBoundary } from "~/components/AppErrorBoundary";
import { NotFound } from "~/components/NotFound";
import { useFocusMode } from "~/design/focus-mode";
import globalCss from "~/design/global.css?url";
import {
  getAppliedTheme,
  subscribeToTheme,
  THEME_BOOTSTRAP_SCRIPT,
} from "~/design/theme";
import tokensCss from "~/design/tokens.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    links: [
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
      { rel: "stylesheet", href: tokensCss },
      { rel: "stylesheet", href: globalCss },
    ],
    meta: [
      { title: "Musubi" },
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      {
        name: "theme-color",
        content: "#f4f1e8",
      },
      {
        name: "description",
        content: "Musubi — the open, self-hostable shared calendar.",
      },
    ],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <AppErrorBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: NotFound,
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function ThemeSynchronizer() {
  useSyncExternalStore(subscribeToTheme, getAppliedTheme, () => "light");
  return null;
}

function FocusMode() {
  useFocusMode();
  return null;
}

function SkipLink() {
  return (
    <a className="skip-link" href="#main-content">
      Skip to calendar
    </a>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        {/* Theme is applied before the body is painted to avoid a light flash. */}
        <script>{THEME_BOOTSTRAP_SCRIPT}</script>
      </head>
      <body>
        <ThemeSynchronizer />
        <FocusMode />
        <SkipLink />
        {children}
        {import.meta.env.DEV ? (
          <ClientOnly>
            {typeof navigator !== "undefined" && !navigator.webdriver ? (
              <Agentation />
            ) : null}
          </ClientOnly>
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
