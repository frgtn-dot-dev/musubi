import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EventDeliveryDialog } from "./EventDeliveryDialog";
import { EventDeliveryInboxDialog } from "./EventDeliveryInboxDialog";
import { getServerOrigin, queryKeys } from "~/api/query-keys";

const eventId = "00000000-0000-4000-8000-000000000001";
const operationId = "00000000-0000-4000-8000-000000000002";
const calendarId = "00000000-0000-4000-8000-000000000003";
const targetId = "00000000-0000-4000-8000-000000000004";
const content = {
  title: "Saved title",
  start: "2026-09-07T10:00:00Z",
  end: "2026-09-07T11:00:00Z",
  isAllDay: false,
  description: "Saved notes",
  location: null,
  recurrence: null,
};
const target = {
  targetId,
  calendarId,
  calendarName: "Work",
  provider: "google",
  owned: true,
  connected: true,
  operationId,
  action: "update",
  status: "conflict",
  revision: 2,
  latestRevision: 2,
  updatedAt: "2026-09-07T11:00:00Z",
  retryAt: null,
  issue: "conflict",
};
const receipt = { eventId, localRevision: 2, targets: [target] };
const preview = {
  eventId,
  operationId,
  latestOperationId: operationId,
  localRevision: 2,
  local: content,
  remote: { ...content, title: "Remote title" },
  remoteEtag: '"remote-2"',
  action: "update",
  canResolve: true,
  reason: null,
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.unstubAllGlobals();
});
function mount(connectionId?: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const result = render(
    <QueryClientProvider client={client}>
      <EventDeliveryDialog
        eventId={eventId}
        userId="owner"
        connectionId={connectionId}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return { ...result, client };
}

it("renders mixed destination receipts, and never lends owner actions to a collaborator", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      json({
        ...receipt,
        targets: [
          { ...target, status: "completed", issue: null },
          {
            ...target,
            targetId: "00000000-0000-4000-8000-000000000005",
            calendarName: "Shared",
            owned: false,
          },
          {
            ...target,
            targetId: "00000000-0000-4000-8000-000000000006",
            calendarName: "Unknown",
            status: "unknown",
            operationId: null,
            issue: null,
          },
        ],
      }),
    ),
  );
  mount();
  await screen.findByText(/Delivery confirmed/);
  expect(screen.getByText(/Remote changes need review/)).toBeTruthy();
  expect(screen.getByText(/No delivery receipt/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
});

it("holds the explicit preview across SSE invalidation and reuses its mutation identity after a lost reply", async () => {
  const bodies: unknown[] = [];
  let reads = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/conflict")) return json(preview);
      if (url.endsWith("/resolve")) {
        bodies.push(JSON.parse(String(init?.body)));
        if (bodies.length === 1) throw new TypeError("lost response");
        return json(
          {
            ...receipt,
            targets: [{ ...target, status: "pending", issue: null }],
          },
          202,
        );
      }
      reads++;
      return json(receipt);
    }),
  );
  const { client } = mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Review changes" }),
  );
  const comparison = await screen.findByRole("dialog", {
    name: "Review remote changes",
  });
  expect(within(comparison).getByText("Saved title")).toBeTruthy();
  expect(within(comparison).getByText("Remote title")).toBeTruthy();
  await client.invalidateQueries({
    queryKey: queryKeys.delivery(getServerOrigin(), "owner"),
  });
  expect(reads).toBeGreaterThan(1);
  fireEvent.click(
    within(comparison).getByRole("button", { name: "Apply saved changes" }),
  );
  await within(comparison).findByText(/Could not reach the server/);
  fireEvent.click(
    within(comparison).getByRole("button", { name: "Apply saved changes" }),
  );
  await screen.findByText(/Saved changes queued/);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[0]).toMatchObject({
    expectedLocalRevision: 2,
    expectedLatestOperationId: operationId,
    expectedRemoteExists: true,
    expectedRemoteEtag: '"remote-2"',
  });
  expect(Object.keys(bodies[0] as object).sort()).toEqual([
    "expectedLatestOperationId",
    "expectedLocalRevision",
    "expectedRemoteEtag",
    "expectedRemoteExists",
    "mutationId",
  ]);
});

it("requires a fresh comparison after a stale-state rejection", async () => {
  let previews = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.endsWith("/conflict")) {
        previews++;
        return json(preview);
      }
      if (url.endsWith("/resolve")) return json({ error: "changed" }, 409);
      return json(receipt);
    }),
  );
  mount();
  fireEvent.click(
    await screen.findByRole("button", { name: "Review changes" }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Apply saved changes" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Review remote changes" }),
    ).toBeNull(),
  );
  expect(
    screen.queryByRole("button", { name: "Apply saved changes" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load comparison" }));
  await screen.findByRole("dialog", { name: "Review remote changes" });
  expect(previews).toBe(2);
});

it("routes retry through the chosen federation connection without claiming remote success", async () => {
  const requests: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    requests.push(url);
    if (init?.method === "POST") expect(init.body).toBe("{}");
    return json({
      ...receipt,
      targets: [{ ...target, status: "retry", issue: "delivery-failed" }],
    });
  });
  vi.stubGlobal("fetch", fetch);
  const { client } = mount("remote");
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await screen.findByText(
    /Retry requested. Provider confirmation is still pending/,
  );
  expect(
    requests.every((url) => url.startsWith("/api/v1/federation/s/remote/")),
  ).toBe(true);
  expect(
    client.getQueryData([
      ...queryKeys.delivery(getServerOrigin(), "owner"),
      "event",
      eventId,
    ]),
  ).toBeUndefined();
});

it("discovers retained deletions from the server, including the next page", async () => {
  const next = "00000000-0000-4000-8000-000000000009";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("?cursor="))
        return json({
          items: [{ eventId: next, savedTitle: "Deleted appointment" }],
          nextCursor: null,
        });
      if (url.endsWith("/event-deliveries"))
        return json({
          items: [{ eventId, savedTitle: "Queued event" }],
          nextCursor: eventId,
        });
      return json({
        ...receipt,
        eventId: next,
        localRevision: null,
        targets: [
          {
            ...target,
            action: "delete",
            status: "unconfirmed",
            issue: "unconfirmed",
          },
        ],
      });
    }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <EventDeliveryInboxDialog
        userId="owner"
        returnFocus={null}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  fireEvent.click(
    await screen.findByRole("button", { name: /Deleted appointment/ }),
  );
  await screen.findByText(/Delivery unconfirmed/);
  expect(screen.getByText("Retained delivery records")).toBeTruthy();
});

it("hides cached receipts and actions when refreshed authorization is refused", async () => {
  let revoked = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      revoked ? json({ error: "Access removed" }, 403) : json(receipt),
    ),
  );
  mount();
  await screen.findByRole("button", { name: "Review changes" });
  revoked = true;
  fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
  await screen.findByText(/Could not verify delivery/);
  expect(screen.queryByRole("button", { name: "Review changes" })).toBeNull();
  expect(screen.queryByText(/Work · google/)).toBeNull();
});
