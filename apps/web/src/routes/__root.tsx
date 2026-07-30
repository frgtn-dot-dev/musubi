/// <reference types="vite/client" />

import type { QueryClient } from "@tanstack/react-query";
import {
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

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          // Theme is applied before the body is painted to avoid a light flash.
          dangerouslySetInnerHTML={{
            __html: THEME_BOOTSTRAP_SCRIPT,
          }}
        />
      </head>
      <body>
        <ThemeSynchronizer />
        <FocusMode />
        <a className="skip-link" href="#main-content">
          Skip to calendar
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
