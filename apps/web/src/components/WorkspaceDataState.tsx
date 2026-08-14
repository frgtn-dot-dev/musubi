import { Button } from "~/ui/Button";
import { RouteState } from "~/ui/RouteState";

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
    <RouteState
      actions={
        onRetry ? <Button onClick={onRetry}>Try again</Button> : undefined
      }
      busy={kind === "loading"}
      description={detail}
      eyebrow={
        kind === "loading" ? "Loading workspace" : "Calendar unavailable"
      }
      requestId={requestId}
      title={title}
    />
  );
}
