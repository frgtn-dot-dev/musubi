import { AVAILABILITY_SOURCE_LIMIT, AvailabilityRequestSchema, type AvailabilityRequest, type AvailabilityResponse, type AvailabilitySource } from "@musubi/types";
export type AvailabilityClient = {
  getAvailabilitySources(signal?: AbortSignal): Promise<{ sources: AvailabilitySource[] }>;
  selectAvailabilitySource(id: string, enabled: boolean, expectedGeneration: number, signal?: AbortSignal): Promise<{ sources: AvailabilitySource[] }>;
  getAvailability(range: AvailabilityRequest, signal?: AbortSignal): Promise<AvailabilityResponse>;
};
export type AvailabilityState = { sources: AvailabilitySource[]; phase: "loading" | "ready" | "selecting" | "reading" | "error"; result?: AvailabilityResponse; error?: string };
/** One mounted home account only. No event/offline store or persistent cache. */
export class AvailabilitySession {
  state: AvailabilityState = { sources: [], phase: "loading" };
  private sequence = 0;
  private controller?: AbortController;
  private disposed = false;
  private refreshPending = false;
  private listeners = new Set<() => void>();
  constructor(private readonly api: AvailabilityClient) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  private update(value: AvailabilityState) { if (!this.disposed) { this.state = value; this.listeners.forEach(listener => listener()); } }
  private begin(phase: AvailabilityState["phase"]) {
    this.controller?.abort(); const controller = this.controller = new AbortController(); const sequence = ++this.sequence;
    this.update({ sources: this.state.sources, phase });
    return { signal: controller.signal, current: () => !this.disposed && sequence === this.sequence && !controller.signal.aborted };
  }
  invalidate() { this.refreshPending = false; this.controller?.abort(); this.sequence++; this.update({ sources: [], phase: "loading" }); }
  dispose() { this.invalidate(); this.disposed = true; this.listeners.clear(); }
  start() { this.disposed = false; return this.refresh(); }
  async refresh() {
    if (this.disposed) return;
    if (this.state.phase === "selecting") { this.refreshPending = true; return; }
    const request = this.begin("loading");
    try { const value = await this.api.getAvailabilitySources(request.signal); if (request.current()) this.update({ sources: value.sources, phase: "ready" }); }
    catch { if (request.current()) this.update({ sources: [], phase: "error", error: "Availability sources could not be verified. Refresh to try again." }); }
  }
  async select(id: string, enabled: boolean) {
    if (this.disposed || this.state.phase === "selecting") return;
    const source = this.state.sources.find(item => item.id === id);
    if (!source) return;
    if (enabled && this.state.sources.filter(item => item.enabled).length >= AVAILABILITY_SOURCE_LIMIT) {
      this.update({ ...this.state, result: undefined, error: `Select up to ${AVAILABILITY_SOURCE_LIMIT} sources. Turn a source off before adding another.` }); return;
    }
    const request = this.begin("selecting");
    try {
      const value = await this.api.selectAvailabilitySource(id, enabled, source.generation, request.signal);
      if (request.current()) this.update({ sources: value.sources, phase: "ready" });
    } catch {
      if (!request.current()) return;
      try {
        const value = await this.api.getAvailabilitySources(request.signal);
        if (request.current()) this.update({ sources: value.sources, phase: "ready", error: "The selection changed or could not be saved. Review its refreshed status and try again." });
      } catch { if (request.current()) this.update({ sources: [], phase: "error", error: "Selection could not be verified. Refresh before choosing again." }); }
    } finally {
      // A sync notification does not undo a server-side PUT. Consume its response
      // first, then coalesce any notifications into one fresh source read.
      if (request.current() && this.refreshPending) { this.refreshPending = false; await this.refresh(); }
    }
  }
  async read(start: string, end: string) {
    if (this.disposed || this.state.phase !== "ready") return;
    const selected = this.state.sources.filter(source => source.enabled);
    const parsed = AvailabilityRequestSchema.safeParse({ start: `${start}T00:00:00Z`, end: `${end}T00:00:00Z`, sourceIds: selected.map(source => source.id) });
    if (!parsed.success) { this.update({ ...this.state, result: undefined, error: selected.length > AVAILABILITY_SOURCE_LIMIT ? `Select up to ${AVAILABILITY_SOURCE_LIMIT} sources before reading.` : "Choose an end after the start, up to 42 days, and at least one source." }); return; }
    const request = this.begin("reading");
    try {
      const result = await this.api.getAvailability(parsed.data, request.signal);
      if (!request.current()) return;
      if (Date.parse(result.start) !== Date.parse(parsed.data.start) || Date.parse(result.end) !== Date.parse(parsed.data.end) || result.sources.length !== selected.length || new Set(result.sources.map(item => item.sourceId)).size !== selected.length || result.sources.some(item => !selected.some(source => source.id === item.sourceId && source.generation === item.generation))) {
        const refreshing = this.refresh(); const refreshSequence = this.sequence;
        await refreshing;
        if (!this.disposed && this.sequence === refreshSequence) this.update({ ...this.state, result: undefined, error: "Availability sources changed. Review their status and read again." });
        return;
      }
      this.update({ sources: this.state.sources, phase: "ready", result });
    } catch { if (request.current()) this.update({ sources: this.state.sources, phase: "ready", error: "Availability could not be verified. No free time is confirmed." }); }
  }
  clearResult() { if (this.state.phase === "reading") { this.controller?.abort(); this.sequence++; } this.update({ ...this.state, phase: this.state.phase === "reading" ? "ready" : this.state.phase, result: undefined, error: undefined }); }
}
