import { OutlookMoveRequestSchema, type OutlookMoveOptions, type OutlookMoveRequest, type OutlookMoveResult } from "@musubi/types";

/** Only these local messages are safe to display for a rejected transport request. */
export class OutlookMoveRequestError extends Error {
  constructor(status: number) {
    super(status === 400 ? "This selection or shift is not supported. Change the selection or minutes and preview again."
      : status === 409 ? "The series changed. Refresh its status, then review a new preview."
      : status === 403 || status === 404 ? "This Outlook series is no longer available to edit."
      : "Could not verify this move. Refresh its status before making another change.");
  }
}
export type OutlookMoveClient = {
  getLatestOutlookMove(eventID: string, signal?: AbortSignal): Promise<OutlookMoveResult | null>;
  getOutlookMoveOptions(eventID: string, signal?: AbortSignal): Promise<OutlookMoveOptions>;
  getOutlookMove(operationID: string, signal?: AbortSignal): Promise<OutlookMoveResult>;
  previewOutlookMove(request: OutlookMoveRequest, signal?: AbortSignal): Promise<OutlookMoveResult>;
  startOutlookMove(operationID: string, signal?: AbortSignal): Promise<OutlookMoveResult>;
};
export type OutlookMoveState = {
  phase: "loading" | "ready" | "previewing" | "starting" | "error";
  options?: OutlookMoveOptions; result?: OutlookMoveResult;
  request?: OutlookMoveRequest; error?: string;
};
/** A mounted, home-account-bound view of the server journal. Never writes on reopen/poll. */
export class OutlookMoveSession {
  state: OutlookMoveState = { phase: "loading" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private read?: AbortController;
  private write?: AbortController;
  private disposed = false;
  private suspended = false;
  private refreshPending = false;
  private frozen?: OutlookMoveRequest;
  private operation?: OutlookMoveResult;
  constructor(private api: OutlookMoveClient, private eventID: string, private makeID: () => string) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.state;
  get busy() { return !!this.write; }
  private update(state: OutlookMoveState) { if (!this.disposed) { this.state = state; this.listeners.forEach(listener => listener()); } }
  private accept(result: OutlookMoveResult, operationID?: string) {
    if (result.eventID !== this.eventID || (operationID && result.operationID !== operationID)) throw new Error("Move identity changed.");
    this.operation = result;
    this.update({ phase: "ready", result, request: this.frozen });
  }
  private clear() { this.read?.abort(); this.read = undefined; this.generation++; this.update({ phase: "loading" }); }
  suspend() { this.suspended = true; this.refreshPending = false; this.clear(); }
  dispose() { this.suspend(); this.write?.abort(); this.frozen = undefined; this.operation = undefined; this.disposed = true; this.listeners.clear(); }
  start() { this.disposed = false; this.suspended = false; return this.refresh(); }
  /** Clear sensitive observations immediately on canonical revision/access changes. */
  async refresh() {
    if (this.disposed || this.suspended) return;
    this.clear();
    if (this.write) { this.refreshPending = true; return; }
    await this.readState("latest");
  }
  resume() { this.suspended = false; return this.refresh(); }
  async poll() {
    if (this.disposed || this.suspended || this.read || this.write || this.operation?.status !== "running") return;
    await this.readState("operation");
  }
  async changeSelection() {
    if (this.disposed || this.suspended || this.read || this.write || this.state.phase !== "ready"
      || this.state.result?.status === "running" || this.state.result?.items.some(item => item.status === "unconfirmed")) return;
    this.clear();
    await this.readState("options");
  }
  private async readState(kind: "latest" | "operation" | "options") {
    const controller = this.read = new AbortController(), generation = this.generation;
    const current = () => !this.disposed && !this.suspended && !controller.signal.aborted && generation === this.generation;
    try {
      if (kind !== "options") {
        const result = kind === "operation" && this.operation
          ? await this.api.getOutlookMove(this.operation.operationID, controller.signal)
          : await this.api.getLatestOutlookMove(this.eventID, controller.signal);
        if (!current()) return;
        if (result) { this.accept(result, kind === "operation" ? this.operation?.operationID : undefined); return; }
      }
      const options = await this.api.getOutlookMoveOptions(this.eventID, controller.signal);
      if (!current()) return;
      if (options.eventID !== this.eventID) throw new Error("Series identity changed.");
      if (kind === "options") this.frozen = undefined;
      this.operation = undefined;
      this.update({ phase: "ready", options, request: this.frozen });
    } catch {
      if (current()) this.update({ phase: "error", error: "Could not verify the series or its progress. Refresh to try again. A started move may still be running." });
    } finally { if (this.read === controller) this.read = undefined; }
  }
  async preview(eventIDs: string[], offsetMinutes: number) {
    const options = this.state.options;
    if (!options || this.state.phase !== "ready" || this.write || this.read || this.disposed || this.suspended) return;
    if (!this.frozen) {
      const parsed = OutlookMoveRequestSchema.safeParse({ operationID: this.makeID(), eventID: this.eventID, calendarID: options.calendarID, expectedVersion: options.version, eventIDs: [...eventIDs], offsetMinutes });
      if (!parsed.success || eventIDs.some(id => !options.occurrences.some(item => item.eventID === id))) {
        this.update({ ...this.state, error: "Choose 1–20 occurrences and a shift of 1–720 minutes." }); return;
      }
      this.frozen = parsed.data;
    }
    const request = this.frozen;
    await this.mutate("previewing", signal => this.api.previewOutlookMove(request, signal), request.operationID);
  }
  async confirm() {
    const result = this.state.result;
    if (this.state.phase !== "ready" || !result || result.status !== "preview" || this.write || this.read || this.disposed || this.suspended) return;
    if (Date.parse(result.expiresAt) <= Date.now()) { this.update({ ...this.state, error: "This preview expired. Choose Change selection to review fresh times." }); return; }
    await this.mutate("starting", signal => this.api.startOutlookMove(result.operationID, signal), result.operationID);
  }
  private async mutate(phase: "previewing" | "starting", action: (signal: AbortSignal) => Promise<OutlookMoveResult>, operationID: string) {
    const controller = this.write = new AbortController(), generation = this.generation;
    const prior = this.state;
    const current = () => !this.disposed && !this.suspended && generation === this.generation;
    this.update({ ...prior, phase, request: this.frozen, error: undefined });
    try { const result = await action(controller.signal); if (current()) this.accept(result, operationID); }
    catch (cause) { if (current()) this.update({ phase: "error", error: cause instanceof OutlookMoveRequestError ? cause.message : phase === "starting" ? "Start could not be confirmed. Refresh the saved status; it may already be running." : "Preview could not be confirmed. Refresh its saved status before trying again." }); }
    finally {
      if (this.write === controller) this.write = undefined;
      if (this.refreshPending && !this.disposed && !this.suspended) { this.refreshPending = false; await this.refresh(); }
      // React may consume the result synchronously, before finally releases the
      // write lock. Publish that release too so dismiss controls cannot stay locked.
      else if (current()) this.update({ ...this.state });
    }
  }
}
