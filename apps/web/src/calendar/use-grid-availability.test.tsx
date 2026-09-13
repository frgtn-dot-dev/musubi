import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useGridAvailability } from "./use-grid-availability";
import { shouldPersistQuery } from "~/offline/snapshot";
const clients: QueryClient[] = [];
afterEach(() => { cleanup(); for (const client of clients) client.clear(); clients.length = 0; vi.unstubAllGlobals(); });
const id = "00000000-0000-4000-8000-000000000001";
const defaults = { userId: "owner", pageId: "page", anchor: new Date(2026, 6, 26), view: "day", weekStartsOn: "monday" as const, showWeekend: true, offline: false, listOpen: false };
function Harness(props: Partial<typeof defaults>) { const grid = useGridAvailability({ ...defaults, ...props }); return <><button disabled={!grid.available} onClick={grid.toggle}>Toggle</button><span data-testid="shown">{String(grid.shown)}</span><span data-testid="intervals">{grid.intervals.map(item => item.sourceId).join(",")}</span><span data-testid="ranges">{grid.intervals.map(item => item.start).join(",")}</span><span>{grid.notice}</span></>; }
function mount() { const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client); return { client, ...render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>), show: (props: Partial<typeof defaults>) => <QueryClientProvider client={client}><Harness {...props} /></QueryClientProvider> }; }
function mockReads() {
  let generation = 1, mode = "available"; const bodies: any[] = [];
  const fetcher = vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/server")) return Response.json({ email: true, pushPublicKey: null, socials: [], socialsWeb: [], syncProviders: ["google"], googleAvailability: true });
    if (url.endsWith("/sources")) return Response.json({ sources: [{ id, generation, enabled: true, label: "Work", accountLabel: "Google", reconnectRequired: false }] });
    const body = JSON.parse(String(options?.body)); bodies.push(body);
    return Response.json({ start: body.start, end: body.end, observedAt: body.start, sources: [{ sourceId: id, generation, status: mode, ...(mode === "available" ? { intervals: [{ start: body.start, end: body.end }] } : {}) }] });
  });
  vi.stubGlobal("fetch", fetcher); return { fetcher, bodies, generation: (value: number) => { generation = value; }, mode: (value: string) => { mode = value; } };
}
it("starts off per page/account, requests only selected sources/current range, and never persists", async () => {
  const fixture = mockReads(); const view = mount(); await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false));
  expect(fixture.bodies).toHaveLength(0); fireEvent.click(screen.getByText("Toggle"));
  await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id));
  expect(fixture.bodies[0]).toEqual({ start: "2026-07-25T22:00:00.000Z", end: "2026-07-26T22:00:00.000Z", sourceIds: [id] });
  view.rerender(view.show({ pageId: "other-page" })); expect(screen.getByTestId("shown").textContent).toBe("false"); expect(screen.getByTestId("intervals").textContent).toBe("");
  view.rerender(view.show({ userId: "other-owner" })); expect(screen.getByTestId("shown").textContent).toBe("false");
  expect(shouldPersistQuery({ queryKey: ["availability", "origin", "owner", "intervals", "grid"], state: { status: "success", data: {} } })).toBe(false);
});
it("hides old observations on range/stream/offline/list changes and keeps unknown distinct", async () => {
  const fixture = mockReads(); const view = mount(); await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByText("Toggle"));
  await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id));
  view.rerender(view.show({ listOpen: true })); expect(screen.getByTestId("intervals").textContent).toBe("");
  fixture.mode("unavailable"); view.rerender(view.show({ anchor: new Date(2026, 6, 27) })); expect(screen.getByTestId("intervals").textContent).toBe("");
  await screen.findByText(/Some availability sources are unavailable/);
  fixture.generation(2); fixture.mode("available"); await act(async () => { await view.client.resetQueries({ queryKey: ["availability"] }); });
  await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id));
  view.rerender(view.show({ offline: true })); expect(screen.getByTestId("intervals").textContent).toBe(""); expect(screen.getByText(/unavailable offline/)).toBeTruthy();
});
it("shows verified intervals on DST days without the obsolete exclusion", async () => {
  mockReads(); const view = mount(); view.rerender(view.show({ anchor: new Date(2026, 9, 25) })); await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByText("Toggle")); await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id)); expect(screen.queryByText(/cannot be shown/)).toBeNull();
});

it("aborts old range requests and cannot display late intervals after navigation", async () => {
  const fixture = mockReads(); const normal = fixture.fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void; let oldSignal: AbortSignal | undefined; let oldBody: any;
  fixture.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/availability") && !oldBody) { oldBody = JSON.parse(String(options?.body)); oldSignal = options?.signal ?? undefined; return new Promise<Response>(resolve => { finish = resolve; }); }
    return normal(url, options);
  });
  const view = mount(); await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false)); fireEvent.click(screen.getByText("Toggle"));
  await waitFor(() => expect(finish).toBeDefined());
  view.rerender(view.show({ anchor: new Date(2026, 6, 27) }));
  await waitFor(() => expect(screen.getByTestId("ranges").textContent).toBe("2026-07-26T22:00:00.000Z"));
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => { finish(Response.json({ start: oldBody.start, end: oldBody.end, observedAt: oldBody.start, sources: [{ sourceId: id, generation: 1, status: "available", intervals: [{ start: oldBody.start, end: oldBody.end }] }] })); });
  expect(screen.getByTestId("ranges").textContent).toBe("2026-07-26T22:00:00.000Z");
});

it.each([false, true])("keeps selection suspended across close/reopen and retires an older GET (initial enabled %s)", async initialEnabled => {
  const { AvailabilitySection } = await import("./components/AvailabilitySection");
  const { useState } = await import("react");
  let oldRead!: (response: Response) => void, commit!: () => void;
  let generation = 1, enabled = initialEnabled, sourceReads = 0;
  const sourceResponse = () => ({ sources: [{ id, generation, enabled, label: "Work", accountLabel: "Google", reconnectRequired: false }] });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/server")) return Response.json({ email: true, pushPublicKey: null, socials: [], socialsWeb: [], syncProviders: ["google"], googleAvailability: true });
    if (url.endsWith(`/sources/${id}`)) return new Promise<Response>(resolve => { commit = () => { enabled = !initialEnabled; generation = 2; resolve(Response.json(sourceResponse())); }; });
    if (url.endsWith("/sources")) {
      sourceReads++;
      if (sourceReads === 2) return new Promise<Response>(resolve => { oldRead = resolve; });
      return Response.json(sourceResponse());
    }
    const body = JSON.parse(String(options?.body));
    return Response.json({ start: body.start, end: body.end, observedAt: body.start, sources: [{ sourceId: id, generation, status: "available", intervals: [{ start: body.start, end: body.end }] }] });
  }));
  function Combined() { const [open, setOpen] = useState(false); return <><Harness listOpen={open} /><button onClick={() => setOpen(!open)}>Connections</button>{open ? <AvailabilitySection userId="owner" onReconnect={() => {}} onRefresh={async () => {}} /> : null}</>; }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><Combined /></QueryClientProvider>);
  await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Toggle"));
  if (initialEnabled) await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id)); else await screen.findByText(/No availability sources selected/);
  fireEvent.click(screen.getByText("Connections")); await waitFor(() => expect(oldRead).toBeDefined());
  fireEvent.click(screen.getByRole("switch", { name: "Use Work for availability" })); await waitFor(() => expect(commit).toBeDefined());
  fireEvent.click(screen.getByText("Connections"));
  expect(screen.getByText(/Availability selection is changing/)).toBeTruthy();
  await act(async () => { await client.resetQueries({ queryKey: ["availability"] }); });
  expect(sourceReads).toBe(2); expect(screen.getByTestId("intervals").textContent).toBe("");
  fireEvent.click(screen.getByText("Connections")); expect(sourceReads).toBe(2);
  fireEvent.click(screen.getByText("Connections"));
  await act(async () => { commit(); });
  if (initialEnabled) await screen.findByText(/No availability sources selected/); else await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id));
  await act(async () => { oldRead(Response.json({ sources: [{ id, generation: 1, enabled: initialEnabled, label: "Work", accountLabel: "Google", reconnectRequired: false }] })); });
  expect(screen.getByTestId("intervals").textContent).toBe(initialEnabled ? "" : id);
  fireEvent.click(screen.getByText("Connections"));
  await waitFor(() => expect(screen.getByRole("switch", { name: "Use Work for availability" }).getAttribute("aria-checked")).toBe(String(!initialEnabled)));
});

it("suspends the grid through a manual refresh even after Connections closes", async () => {
  const { useConnections } = await import("./connections");
  const { useState } = await import("react");
  const fixture = mockReads();
  const normal = fixture.fetcher.getMockImplementation()!;
  let finish!: () => void;
  fixture.fetcher.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url.endsWith("/connections/sync")) return new Promise<Response>(resolve => {
      finish = () => { fixture.generation(2); fixture.mode("unavailable"); resolve(new Response("OK")); };
    });
    return normal(url, options);
  });
  function Combined() {
    const connections = useConnections("owner");
    const [open, setOpen] = useState(false);
    return <><Harness listOpen={open} /><button onClick={() => setOpen(!open)}>Connections</button>{open ? <button onClick={() => void connections.refreshConnectedCalendars()}>Refresh</button> : null}</>;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); clients.push(client);
  render(<QueryClientProvider client={client}><Combined /></QueryClientProvider>);
  await waitFor(() => expect((screen.getByText("Toggle") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText("Toggle"));
  await waitFor(() => expect(screen.getByTestId("intervals").textContent).toBe(id));
  fireEvent.click(screen.getByText("Connections"));
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() => expect(finish).toBeDefined());
  fireEvent.click(screen.getByText("Connections"));
  expect(screen.getByTestId("intervals").textContent).toBe("");
  expect(screen.getByText(/Connected calendars are refreshing/)).toBeTruthy();
  const reads = fixture.bodies.length;
  await act(async () => { await client.resetQueries({ queryKey: ["availability"] }); });
  expect(fixture.bodies).toHaveLength(reads);
  await act(async () => { finish(); });
  await screen.findByText(/Some availability sources are unavailable/);
  expect(screen.getByTestId("intervals").textContent).toBe("");
});
