/// <reference types="vite/client" />

import type { QueryClient } from "@tanstack/react-query";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { AppErrorBoundary } from "~/components/AppErrorBoundary";
import { NotFound } from "~/components/NotFound";
import globalCss from "~/design/global.css?url";
import tokensCss from "~/design/tokens.css?url";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  head: () => ({
    links: [
      { rel: "stylesheet", href: tokensCss },
      { rel: "stylesheet", href: globalCss },
    ],
    meta: [
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
    title: "Musubi",
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

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          // Theme is applied before the body is painted to avoid a light flash.
          dangerouslySetInnerHTML={{
            __html:
              "try{const t=localStorage.getItem('musubi-theme');const d=t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.dataset.theme=d?'dark':'light'}catch{document.documentElement.dataset.theme='light'}",
          }}
        />
      </head>
      <body>
        <a className="skip-link" href="#main-content">
          Skip to calendar
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
