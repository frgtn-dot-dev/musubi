import { BrandMark } from "./BrandMark";

type WorkspaceDataStateProps = {
  detail: string;
  kind: "error" | "loading" | "offline";
  onRetry?: () => void;
  requestId?: string;
  title: string;
};

export function WorkspaceDataState({
  detail,
  kind,
  onRetry,
  requestId,
  title,
}: WorkspaceDataStateProps) {
  return (
    <main
      className="route-state"
      id="main-content"
      aria-busy={kind === "loading"}
    >
      <BrandMark aria-hidden="true" />
      <p className="route-state__code">
        {kind === "loading" ? "Loading workspace" : "Calendar unavailable"}
      </p>
      <h1>{title}</h1>
      <p>{detail}</p>
      {requestId ? (
        <p className="route-state__request">Request ID: {requestId}</p>
      ) : null}
      {onRetry ? (
        <div className="route-state__actions">
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
    </main>
  );
}
