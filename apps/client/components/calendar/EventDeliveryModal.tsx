import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEffect, useRef, useState } from "react";
import { AppState, Pressable, ScrollView, Text, View } from "react-native";
import { uuidv7 } from "uuidv7";
import { spacing, typeSizes } from "@musubi/design-system";
import {
  eventDeliveryActions,
  eventDeliveryExplanation,
  eventDeliveryLabel,
  providerReminderDescription,
  providerRsvpNotice,
  providerRsvpResponseLabel,
} from "@musubi/calendar";
import type {
  EventDelivery,
  EventDeliveryConflict,
  EventDeliveryContent,
  EventDeliveryInbox,
  ResolveEventDeliveryRequest,
} from "@musubi/types";
import { useServer } from "@/contexts/ServerContext";
import { colors, fonts, styles } from "@/constants/theme";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { Btn } from "@/components/ui/Btn";
import { EventDeliveryRequestError, useApi } from "@/services/api";
import { confirm } from "@/lib/confirm";
import { useDeliveryRefreshStore } from "@/store/useDeliveryRefreshStore";

export type EventDeliveryModalProps = {
  visible: boolean;
  eventId?: string;
  connectionId?: string;
  onClose: () => void;
};

export default function EventDeliveryModal(props: EventDeliveryModalProps) {
  const { apiUrl, authClient } = useServer();
  const { data: session } = authClient.useSession();
  if (!props.visible || !apiUrl || !session?.user.id) return null;
  return (
    <DeliveryBody
      key={`${apiUrl}:${session.user.id}:${props.connectionId ?? "home"}:${props.eventId ?? "inbox"}`}
      {...props}
    />
  );
}

// Remounting on identity changes discards every receipt and comparison. Nothing
// is written to the event cache or composer; each open starts with a server read.
export function DeliveryBody({
  eventId,
  connectionId,
  onClose,
}: EventDeliveryModalProps) {
  const api = useApi();
  const insets = useSafeAreaInsets();
  const version = useDeliveryRefreshStore((state) => state.version);
  const [selectedId, setSelectedId] = useState(eventId);
  const [receipt, setReceipt] = useState<EventDelivery>();
  const [inbox, setInbox] = useState<EventDeliveryInbox>();
  const [readError, setReadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const readKey = JSON.stringify([
    selectedId ?? null,
    connectionId ?? null,
    version,
  ]);
  const [settledRead, setSettledRead] = useState<{
    key: string;
    scope: string;
  } | null>(null);
  const readScope = JSON.stringify([selectedId ?? null, connectionId ?? null]);
  const loading = settledRead?.scope !== readScope;
  const [busy, setBusy] = useState(false);
  const [comparison, setComparison] = useState<{
    preview: EventDeliveryConflict;
    request: ResolveEventDeliveryRequest;
  }>();
  const active = useRef(true);
  const busyRef = useRef(false);
  const sequence = useRef(0);
  const inFlightScope = useRef<string | null>(null);
  const loadedPages = useRef(1);
  const refresh = () => useDeliveryRefreshStore.getState().refresh();
  useEffect(() => {
    active.current = true;
    const timer = setInterval(() => {
      if (
        AppState.currentState === "active" &&
        !inFlightScope.current &&
        !busyRef.current
      )
        refresh();
    }, 15_000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => {
      active.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, []);
  useEffect(() => {
    // Coalesce invalidations until the whole read (including inbox pages) settles.
    // A slow response must still finish even when another poll arrives.
    if (inFlightScope.current === readScope) return;
    if (!inFlightScope.current && settledRead?.key === readKey) return;
    const current = ++sequence.current;
    inFlightScope.current = readScope;
    void (async () => {
      try {
        if (selectedId) {
          const value = await api.getEventDelivery(selectedId, connectionId);
          if (active.current && current === sequence.current) setReceipt(value);
        } else {
          let cursor: string | undefined;
          const items: EventDeliveryInbox["items"] = [];
          const pagesToRead = loadedPages.current;
          for (let page = 0; page < pagesToRead; page++) {
            const value = await api.getEventDeliveryInbox(cursor, connectionId);
            if (!active.current || current !== sequence.current) return;
            items.push(...value.items);
            cursor = value.nextCursor ?? undefined;
            if (!cursor) break;
          }
          setInbox({
            items: [
              ...new Map(items.map((item) => [item.eventId, item])).values(),
            ],
            nextCursor: cursor ?? null,
          });
        }
        if (active.current && current === sequence.current) setReadError("");
      } catch {
        if (active.current && current === sequence.current) {
          setReceipt(undefined);
          setInbox(undefined);
          setReadError(
            "Could not verify delivery. Refresh when the connection is available.",
          );
        }
      } finally {
        if (active.current && current === sequence.current) {
          inFlightScope.current = null;
          setSettledRead({ key: readKey, scope: readScope });
        }
      }
    })();
    // useApi is a new facade every render; capture the facade for this scoped read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, connectionId, version, readKey, readScope, settledRead]);

  async function run(action: () => Promise<void>, invalidate = true) {
    if (!active.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      if (!active.current) return;
      if (cause instanceof EventDeliveryRequestError && cause.status === 409) {
        setComparison(undefined);
        setError(
          "The delivery state changed or cannot be resolved safely. Review a fresh comparison before trying again.",
        );
      } else
        setError(
          "Could not verify this request. Try again; the saved operation will keep its identity.",
        );
    } finally {
      busyRef.current = false;
      if (active.current) {
        setBusy(false);
        if (invalidate) refresh();
      }
    }
  }

  function close() {
    if (!busyRef.current) onClose();
  }
  const confirmLabel =
    comparison?.preview.scopeResolution ? (comparison.preview.scopeResolution.kind === "following-delete" ? "Delete following occurrences" : comparison.preview.scopeResolution.kind === "following-create" ? "Finish future series" : comparison.preview.scopeResolution.kind === "following-update" ? "Apply following changes" : "Delete entire series") : comparison?.preview.rsvpResolution ? "Send saved response" : comparison?.preview.reminderResolution ? "Apply saved reminders" : comparison?.preview.action === "delete"
      ? "Delete remote copy"
      : comparison?.preview.action === "create"
        ? "Recreate remote copy"
        : "Apply saved changes";
  function submitComparison() {
    if (!comparison || !comparison.preview.canResolve || ((comparison.preview.scopeResolution?.kind === "following-update" && !comparison.preview.splitFuture) || (comparison.preview.scopeResolution?.kind === "following-create" && !comparison.preview.local)) || busyRef.current)
      return;
    const saved = comparison;
    confirm(
      {
        title: confirmLabel,
        confirmLabel,
        message: saved.preview.scopeResolution ? (saved.preview.scopeResolution.kind === "following-delete" ? `Delete the occurrence originally starting ${saved.preview.scopeResolution.originalStart.value} and all later occurrences from the remote series? Earlier occurrences remain. The saved deletion in Musubi remains.` : saved.preview.scopeResolution.kind === "following-create" ? "Finish only the saved future series at its original destination? The earlier series is already saved. An already present matching future series is confirmed without another write." : saved.preview.scopeResolution.kind === "following-update" ? "Apply the saved following changes in two steps: shorten the earlier series, then create the saved future series? Delivery may finish one step at a time; retry keeps the same future series identity." : "Delete the entire remote series, including all occurrences and exceptions? The saved deletion in Musubi remains.") : saved.preview.rsvpResolution ? `Apply only your saved response and preserve the other current Google fields? ${providerRsvpNotice}` : saved.preview.reminderResolution ? "Replace your personal Google Calendar reminders with the saved settings? Event time, participants and Musubi reminders stay unchanged." :
          "Apply the version shown in this comparison? Remote differences may be replaced. Unsaved form edits are not sent.",
      },
      () => {
        // Native confirmation may outlive the modal or an account switch.
        if (!active.current) return;
        void run(async () => {
          await api.resolveEventDelivery(
            saved.preview.eventId,
            saved.preview.operationId,
            saved.request,
            connectionId,
          );
          if (active.current) {
            setComparison(undefined);
            setNotice(
              saved.preview.rsvpResolution ? "Saved response queued. Google confirmation is still pending; email delivery cannot be verified." : "Saved changes queued. Provider confirmation is still pending.",
            );
          }
        });
      },
    );
  }

  const copy = {
    fontFamily: fonts.sans,
    fontSize: typeSizes[12],
    color: colors.fg2,
  };
  return (
    <ModalPortal visible onRequestClose={close}>
      <View style={styles.modalOverlay}>
        <Pressable style={{ flex: 1 }} onPress={close} accessible={false} />
      </View>
      <View style={styles.modalSheet}>
        <View style={styles.modalHandle} />
        <View style={styles.modalTitleRow}>
          <Text accessibilityRole="header" style={styles.modalTitle}>
            {comparison
              ? "Review remote changes"
              : selectedId
                ? "Delivery"
                : "Unfinished deliveries"}
          </Text>
        </View>
        <ScrollView
          contentContainerStyle={{
            padding: spacing[4],
            paddingBottom: spacing[4] + insets.bottom,
            gap: spacing[3],
          }}
        >
          <Text style={copy}>
            Status of saved changes. Unsaved edits in a form are not included.
          </Text>
          {error ? (
            <Text accessibilityRole="alert" style={copy}>
              {error}
            </Text>
          ) : null}
          {notice ? (
            <Text accessibilityLiveRegion="polite" style={copy}>
              {notice}
            </Text>
          ) : null}
          {comparison ? (
            <>
              {comparison.preview.scopeResolution?.kind === "following-create" ? <Text style={copy}>Finish future series · original start {comparison.preview.scopeResolution.originalStart.value}. The earlier series is already saved.</Text> : comparison.preview.scopeResolution?.kind === "following-delete" ? <Text style={copy}>Delete this and following · original start {comparison.preview.scopeResolution.originalStart.value}. Earlier occurrences remain.</Text> : comparison.preview.scopeResolution?.kind === "following-update" ? <Text style={copy}>Change this and following · original start {comparison.preview.scopeResolution.originalStart.value}. Delivery uses two steps and keeps the saved future series identity.</Text> : comparison.preview.scopeResolution?.kind === "series-delete" ? <Text style={copy}>Entire series · all occurrences and exceptions.</Text> : null}
              {comparison.preview.rsvpResolution ? <>
                <Text style={copy}>{providerRsvpNotice}</Text>
                <Text style={copy}>Saved Google response: {providerRsvpResponseLabel(comparison.preview.rsvpResolution.desired)}</Text>
                <Text style={copy}>Current Google response: {providerRsvpResponseLabel(comparison.preview.rsvpResolution.remote)}</Text>
              </> : comparison.preview.reminderResolution ? (
                <>
                  <Text style={copy}>Google Calendar sends these notifications; other apps may notify separately.</Text>
                  <Text style={copy}>Saved Google reminders: {providerReminderDescription({ provider: "google", overrides: [], ...comparison.preview.reminderResolution.desired })}</Text>
                  <Text style={copy}>Current Google reminders: {providerReminderDescription(comparison.preview.reminderResolution.remote)}</Text>
                </>
              ) : <>
              {comparison.preview.splitFuture ? <DeliveryContent title="Saved future series" content={comparison.preview.splitFuture} absent="Future series unavailable" /> : null}
              <DeliveryContent
                title={comparison.preview.scopeResolution?.kind === "following-create" ? "Saved future series" : comparison.preview.splitFuture ? "Saved earlier series" : "Saved in Musubi"}
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
                <Text accessibilityRole="alert" style={copy}>
                  {comparison.preview.reason === "reconnect-required"
                    ? "Reconnect this account, then load a new comparison."
                    : "The provider state or write permission does not allow a safe resolution."}
                </Text>
              ) : null}
              <Btn
                label="Cancel comparison"
                disabled={busy}
                variant="secondary"
                onPress={() => {
                  setComparison(undefined);
                  setError("");
                }}
              />
              <Btn
                label={confirmLabel}
                variant="destructive"
                loading={busy}
                disabled={!comparison.preview.canResolve || ((comparison.preview.scopeResolution?.kind === "following-update" && !comparison.preview.splitFuture) || (comparison.preview.scopeResolution?.kind === "following-create" && !comparison.preview.local))}
                onPress={submitComparison}
              />
            </>
          ) : (
            <>
              {loading ? <Text style={copy}>Checking delivery…</Text> : null}
              {readError && !loading ? (
                <Text accessibilityRole="alert" style={copy}>
                  {readError}
                </Text>
              ) : null}
              {receipt && receipt.eventId === selectedId ? (
                <>
                  <Text style={copy}>
                    {receipt.localRevision !== null
                      ? "Saved version in Musubi"
                      : "Retained delivery records"}
                  </Text>
                  {receipt.targets.length === 0 ? (
                    <Text style={copy}>
                      No external destinations are visible. This does not
                      confirm other writes.
                    </Text>
                  ) : null}
                  {receipt.targets.map((target) => {
                    const actions = eventDeliveryActions(target);
                    return (
                      <View key={target.targetId} style={{ gap: spacing[2] }}>
                        <Text
                          accessibilityRole="header"
                          style={[copy, { fontFamily: fonts.sansMedium }]}
                        >
                          {target.calendarName ?? "Former calendar"} ·{" "}
                          {target.provider}
                        </Text>
                        <Text style={copy}>
                          {eventDeliveryLabel(target)}.{" "}
                          {eventDeliveryExplanation(target)}
                          {target.latestRevision !== target.revision
                            ? " A newer saved change is waiting behind this operation."
                            : ""}
                        </Text>
                        {target.updatedAt ? (
                          <Text style={copy}>
                            Record updated {target.updatedAt.toLocaleString()}
                          </Text>
                        ) : null}
                        {target.retryAt ? (
                          <Text style={copy}>
                            Next attempt no earlier than{" "}
                            {target.retryAt.toLocaleString()}
                          </Text>
                        ) : null}
                        {!target.owned ? (
                          <Text style={copy}>
                            Only the connection owner can retry or resolve this
                            operation.
                          </Text>
                        ) : null}
                        {actions.retry ? (
                          <Btn
                            label="Retry"
                            variant="secondary"
                            disabled={busy || loading}
                            onPress={() =>
                              void run(async () => {
                                await api.retryEventDelivery(
                                  receipt.eventId,
                                  target.operationId!,
                                  connectionId,
                                );
                                if (active.current)
                                  setNotice(
                                    "Retry requested. Provider confirmation is still pending.",
                                  );
                              })
                            }
                          />
                        ) : null}
                        {actions.review ? (
                          <Btn
                            label="Review changes"
                            variant="secondary"
                            disabled={busy || loading}
                            onPress={() =>
                              void run(async () => {
                                const preview =
                                  await api.getEventDeliveryConflict(
                                    receipt.eventId,
                                    target.operationId!,
                                    connectionId,
                                  );
                                if (active.current)
                                  setComparison({
                                    preview,
                                    request: {
                                      mutationId: uuidv7(),
                                      expectedLocalRevision:
                                        preview.localRevision,
                                      expectedLatestOperationId:
                                        preview.latestOperationId,
                                      expectedRemoteExists:
                                        preview.remote !== null,
                                      expectedRemoteEtag: preview.remoteEtag,
                                      ...(preview.scopeResolution ? { expectedScopeResolution: preview.scopeResolution } : {}),
                                      ...(preview.rsvpResolution ? { expectedRsvpBaselineVersion: preview.rsvpResolution.baselineVersion } : {}),
                                      ...(preview.reminderResolution ? { expectedReminderStateVersion: preview.reminderResolution.stateVersion } : {}),
                                      ...(preview.masterRevision !== undefined
                                        ? {
                                            expectedMasterRevision:
                                              preview.masterRevision,
                                          }
                                        : {}),
                                    },
                                  });
                              })
                            }
                          />
                        ) : null}
                      </View>
                    );
                  })}
                </>
              ) : null}
              {!selectedId && inbox?.items.length === 0 ? (
                <Text style={copy}>
                  No unfinished deliveries found for your account on this
                  server. This does not certify every connected calendar.
                </Text>
              ) : null}
              {!selectedId
                ? inbox?.items.map((item) => (
                    <Btn
                      key={item.eventId}
                      label={item.savedTitle || "Untitled event"}
                      variant="secondary"
                      disabled={busy}
                      onPress={() => {
                        setSelectedId(item.eventId);
                        setError("");
                        setNotice("");
                      }}
                    />
                  ))
                : null}
              {!selectedId && inbox?.nextCursor ? (
                <Btn
                  label="Load more"
                  variant="secondary"
                  disabled={busy || settledRead?.key !== readKey}
                  onPress={() => {
                    if (inFlightScope.current) return;
                    const current = sequence.current;
                    void run(async () => {
                      const page = await api.getEventDeliveryInbox(
                        inbox.nextCursor!,
                        connectionId,
                      );
                      if (active.current && current === sequence.current) {
                        loadedPages.current++;
                        setInbox({
                          items: [
                            ...new Map(
                              [...inbox.items, ...page.items].map((item) => [
                                item.eventId,
                                item,
                              ]),
                            ).values(),
                          ],
                          nextCursor: page.nextCursor,
                        });
                      }
                    }, false);
                  }}
                />
              ) : null}
              <Btn
                label="Refresh status"
                variant="secondary"
                disabled={busy || loading}
                onPress={refresh}
              />
              {selectedId && !eventId ? (
                <Btn
                  label="Back to saved deliveries"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    setSelectedId(undefined);
                    setError("");
                    setNotice("");
                  }}
                />
              ) : null}
            </>
          )}
          <Btn
            label="Close delivery"
            variant="secondary"
            disabled={busy}
            onPress={close}
          />
        </ScrollView>
      </View>
    </ModalPortal>
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
  const copy = {
    fontFamily: fonts.sans,
    fontSize: typeSizes[12],
    color: colors.fg2,
  };
  return (
    <View style={{ gap: spacing[2] }}>
      <Text
        accessibilityRole="header"
        style={[copy, { fontFamily: fonts.sansMedium }]}
      >
        {title}
      </Text>
      <Text style={copy}>{content?.title ?? absent}</Text>
      {content ? (
        <>
          {content.originalStart ? (
            <Text style={copy}>
              One occurrence · original {content.originalStart.value}
            </Text>
          ) : null}
          {content.isCanceled !== undefined ? (
            <Text style={copy}>
              Status: {content.isCanceled ? "Cancelled" : "Active"}
            </Text>
          ) : null}
          {content.timeModel?.kind === "zoned" ? (
            <Text style={copy}>
              Series time zone: {content.timeModel.timeZone} ·{" "}
              {content.timeModel.startLocal} – {content.timeModel.endLocal}
            </Text>
          ) : null}
          <Text style={copy}>
            {content.isAllDay
              ? `All day: ${content.start.toISOString().slice(0, 10)} – ${content.end.toISOString().slice(0, 10)}`
              : `${content.start.toLocaleString()} – ${content.end.toLocaleString()}`}
          </Text>
          <Text style={copy}>Location: {content.location || "None"}</Text>
          <Text style={copy}>Description: {content.description || "None"}</Text>
          <Text style={copy}>
            Recurrence:{" "}
            {content.originalStart
              ? "Occurrence of a series"
              : content.recurrence || "Does not repeat"}
          </Text>
        </>
      ) : null}
    </View>
  );
}
