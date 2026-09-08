import styles from "./styles/event-delivery.module.css";
import type {
  EventDeliveryConflict,
  EventDeliveryContent,
  ResolveEventDeliveryRequest,
} from "@musubi/types";
import {
  eventDeliveryActions,
  eventDeliveryExplanation,
  eventDeliveryLabel,
  providerReminderDescription,
  providerRsvpNotice,
  providerRsvpResponseLabel,
} from "@musubi/calendar";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { ApiError } from "~/api/http";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import {
  getEventDelivery,
  getEventDeliveryConflict,
  resolveEventDelivery,
  retryEventDelivery,
} from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import {
  ConfirmationDialog,
  ConfirmationNotice,
} from "~/ui/ConfirmationDialog";
import { InlineError } from "~/ui/InlineError";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";

type Props = {
  eventId: string;
  userId: string;
  connectionId?: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
};

// Mount only while open and key by server/user/connection/event at the caller.
// Preview is deliberate local state: SSE never replaces a comparison mid-read.
export function EventDeliveryDialog({
  eventId,
  userId,
  connectionId,
  onClose,
  returnFocus,
}: Props) {
  const client = useQueryClient();
  const prefix = queryKeys.delivery(getServerOrigin(), userId, connectionId);
  const query = useQuery({
    queryKey: [...prefix, "event", eventId],
    queryFn: ({ signal }) => getEventDelivery(eventId, signal, connectionId),
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 15_000,
  });
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [comparison, setComparison] = useState<{
    preview: EventDeliveryConflict;
    request: ResolveEventDeliveryRequest;
    trigger: HTMLElement;
  }>();
  const [reviewTarget, setReviewTarget] = useState<{
    id: string;
    trigger: HTMLElement;
  }>();

  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not reach the server. Try again; the saved operation will keep its identity.",
      );
      if (cause instanceof ApiError && cause.status === 409) {
        setComparison(undefined);
        setError(
          "The delivery state changed or cannot be resolved safely. Load a fresh comparison before trying again.",
        );
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
      void client.invalidateQueries({ queryKey: prefix });
    }
  }

  function review(id: string, trigger: HTMLElement) {
    setReviewTarget({ id, trigger });
    void run(async () => {
      const preview = await getEventDeliveryConflict(
        eventId,
        id,
        undefined,
        connectionId,
      );
      setComparison({
        preview,
        trigger,
        request: {
          mutationId: crypto.randomUUID(),
          expectedLocalRevision: preview.localRevision,
          expectedLatestOperationId: preview.latestOperationId,
          expectedRemoteExists: preview.remote !== null,
          expectedRemoteEtag: preview.remoteEtag,
          ...(preview.rsvpResolution ? { expectedRsvpBaselineVersion: preview.rsvpResolution.baselineVersion } : {}),
          ...(preview.reminderResolution ? { expectedReminderStateVersion: preview.reminderResolution.stateVersion } : {}),
          ...(preview.masterRevision !== undefined
            ? { expectedMasterRevision: preview.masterRevision }
            : {}),
        },
      });
    });
  }

  return (
    <div
      className={styles.layerBoundary}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !busyRef.current) onClose();
        }}
        title="Delivery"
        description="Status of saved changes. Unsaved edits in a form are not included."
        closeLabel="Close delivery"
        bodyLayout="flush"
        returnFocus={returnFocus}
        footer={
          <Button
            variant="secondary"
            disabled={busy || query.isFetching}
            onClick={() => void query.refetch()}
          >
            Refresh status
          </Button>
        }
      >
        <SettingsSection
          title="Destinations"
          description={
            query.data?.localRevision != null
              ? "Saved version in Musubi"
              : "Retained delivery records"
          }
        >
          {query.isPending ? <Row label="Checking delivery…" /> : null}
          {query.isError ? (
            <InlineError>
              Could not verify delivery. Refresh when the connection is
              available.
            </InlineError>
          ) : null}
          {error ? <InlineError>{error}</InlineError> : null}
          {notice ? <Row role="status" label={notice} /> : null}
          {!query.isError && query.data?.targets.length === 0 ? (
            <Row
              label="No external destinations are visible"
              detail="This does not confirm writes to any other destination."
            />
          ) : null}
          {!query.isError
            ? query.data?.targets.map((target) => {
                const actions = eventDeliveryActions(target);
                return (
                  <Row
                    key={target.targetId}
                    label={`${target.calendarName ?? "Former calendar"} · ${target.provider}`}
                    detail={
                      <>
                        {eventDeliveryLabel(target)}.{" "}
                        {eventDeliveryExplanation(target)}
                        {target.latestRevision !== target.revision
                          ? " A newer saved change is waiting behind this operation."
                          : ""}
                        {target.updatedAt
                          ? ` Record updated ${target.updatedAt.toLocaleString()}.`
                          : ""}
                        {target.retryAt
                          ? ` Next attempt no earlier than ${target.retryAt.toLocaleString()}.`
                          : ""}
                        {!target.owned
                          ? " Only the connection owner can retry or resolve it."
                          : ""}
                      </>
                    }
                    trailing={
                      <>
                        {actions.retry ? (
                          <Button
                            size="compact"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await retryEventDelivery(
                                  eventId,
                                  target.operationId!,
                                  connectionId,
                                );
                                setNotice(
                                  "Retry requested. Provider confirmation is still pending.",
                                );
                              })
                            }
                          >
                            Retry
                          </Button>
                        ) : null}
                        {actions.review ? (
                          <Button
                            size="compact"
                            variant="secondary"
                            disabled={busy}
                            onClick={(event) =>
                              review(target.operationId!, event.currentTarget)
                            }
                          >
                            Review changes
                          </Button>
                        ) : null}
                      </>
                    }
                  />
                );
              })
            : null}
          {reviewTarget && !comparison ? (
            <Row
              label="Review saved and remote versions"
              trailing={
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() => review(reviewTarget.id, reviewTarget.trigger)}
                >
                  Load comparison
                </Button>
              }
            />
          ) : null}
        </SettingsSection>
      </Dialog>
      {comparison ? (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open && !busyRef.current) {
              setComparison(undefined);
              setReviewTarget(undefined);
            }
          }}
          title="Review remote changes"
          description={comparison.preview.rsvpResolution ? "Compare your saved response with your current response in Google Calendar." : comparison.preview.reminderResolution ? "Compare your saved reminder settings with your current settings in Google Calendar." : "Compare the current remote copy with the version saved in Musubi."}
          closeLabel="Close comparison"
          returnFocus={comparison.trigger}
          confirmLabel={
            comparison.preview.rsvpResolution ? "Send saved response" : comparison.preview.reminderResolution ? "Apply saved reminders" : comparison.preview.action === "delete"
              ? "Delete remote copy"
              : comparison.preview.action === "create"
                ? "Recreate remote copy"
                : "Apply saved changes"
          }
          confirmDisabled={!comparison.preview.canResolve}
          loading={busy}
          onConfirm={() =>
            void run(async () => {
              await resolveEventDelivery(
                eventId,
                comparison.preview.operationId,
                comparison.request,
                connectionId,
              );
              setComparison(undefined);
              setReviewTarget(undefined);
              setNotice(
                comparison.preview.rsvpResolution ? "Saved response queued. Google confirmation is still pending; email delivery cannot be verified." : "Saved changes queued. Provider confirmation is still pending.",
              );
            })
          }
        >
          <ConfirmationNotice icon={<AlertTriangle size={18} />}>
            {comparison.preview.rsvpResolution ? `This applies only your saved response and preserves the other current Google fields. ${providerRsvpNotice}` : comparison.preview.reminderResolution ? "This replaces your personal Google Calendar reminders. Event time, participants and Musubi reminders stay unchanged. Google Calendar sends these notifications; other apps may notify separately." : comparison.preview.action === "delete"
              ? "This removes the remote copy. The saved deletion in Musubi remains."
              : "This applies the saved version to the remote copy. Remote differences may be replaced; unsaved form edits are not sent."}
          </ConfirmationNotice>
          {comparison.preview.rsvpResolution ? <>
            <Row label="Saved Google response" detail={providerRsvpResponseLabel(comparison.preview.rsvpResolution.desired)} />
            <Row label="Current Google response" detail={providerRsvpResponseLabel(comparison.preview.rsvpResolution.remote)} />
          </> : comparison.preview.reminderResolution ? (
            <>
              <Row label="Saved Google reminders" detail={providerReminderDescription({ provider: "google", overrides: [], ...comparison.preview.reminderResolution.desired })} />
              <Row label="Current Google reminders" detail={providerReminderDescription(comparison.preview.reminderResolution.remote)} />
            </>
          ) : <>
          <DeliveryContent
            title="Saved in Musubi"
            content={comparison.preview.local}
            absent="Saved deletion / no local copy"
          />
          <DeliveryContent
            title="Remote copy"
            content={comparison.preview.remote}
            absent="Not found at the provider"
          />
          </>}
          {!comparison.preview.canResolve ? (
            <InlineError>
              {comparison.preview.reason === "reconnect-required"
                ? "Reconnect this account in Connections, then load a new comparison."
                : "The provider state or write permission does not allow a safe resolution. Check the connection and load a new comparison."}
            </InlineError>
          ) : null}
          {error ? <InlineError>{error}</InlineError> : null}
        </ConfirmationDialog>
      ) : null}
    </div>
  );
}

function DeliveryContent({
  title,
  content,
  absent,
}: {
  title: string;
  content: EventDeliveryContent | null;
  absent: string;
}) {
  return (
    <section aria-label={title} tabIndex={0}>
      <Row label={title} detail={content?.title ?? absent} />
      {content ? (
        <>
          {content.originalStart ? (
            <Row
              size="compact"
              label="Scope"
              detail={`One occurrence · original ${content.originalStart.value}`}
            />
          ) : null}
          {content.isCanceled !== undefined ? (
            <Row
              size="compact"
              label="Status"
              detail={content.isCanceled ? "Cancelled" : "Active"}
            />
          ) : null}
          {content.timeModel?.kind === "zoned" ? (
            <Row
              size="compact"
              label="Series time zone"
              detail={`${content.timeModel.timeZone} · ${content.timeModel.startLocal} – ${content.timeModel.endLocal}`}
            />
          ) : null}
          <Row
            size="compact"
            label={content.isAllDay ? "All day" : "Time"}
            detail={
              content.isAllDay
                ? `${content.start.toISOString().slice(0, 10)} – ${content.end.toISOString().slice(0, 10)}`
                : `${content.start.toLocaleString()} – ${content.end.toLocaleString()}`
            }
          />
          <Row
            size="compact"
            label="Location"
            detail={content.location || "None"}
          />
          <Row
            size="compact"
            label="Description"
            detail={content.description || "None"}
          />
          <Row
            size="compact"
            label="Recurrence"
            detail={
              content.originalStart
                ? "Occurrence of a series"
                : content.recurrence || "Does not repeat"
            }
          />
        </>
      ) : null}
    </section>
  );
}
