import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { AppErrorBoundary } from "~/components/AppErrorBoundary";
import { CACHE_MAX_AGE_MS } from "~/offline/cache-version";
import { NotFound } from "~/components/NotFound";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Matched to how long a snapshot is allowed to live: a restored entry
        // that React Query garbage-collects on the way to the first paint would
        // make the persister pointless.
        gcTime: CACHE_MAX_AGE_MS,
        retry: 1,
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: "intent",
    defaultErrorComponent: AppErrorBoundary,
    defaultNotFoundComponent: NotFound,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ queryClient, router });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
