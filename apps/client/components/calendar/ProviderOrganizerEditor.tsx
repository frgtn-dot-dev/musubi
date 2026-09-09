import { useServer } from "@/contexts/ServerContext";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { uuidv7 } from "uuidv7";
import { spacing } from "@musubi/design-system";
import {
  organizerDraft,
  organizerRequest,
  organizerNotificationNotice,
  type OrganizerDraft,
} from "@musubi/calendar";
import type {
  Event,
  ProviderEventStateResponse,
  ProviderOrganizerRequest,
} from "@musubi/types";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { ModalPortal } from "@/components/ui/ModalPortal";
import { useApi } from "@/services/api";
import { confirm } from "@/lib/confirm";
export function ProviderOrganizerCreateAction(props: {
  calendarID: string;
  color: string;
}) {
  const { apiUrl, authClient } = useServer();
  const actorID = authClient.useSession().data?.user.id;
  return (
    <OrganizerCreateActionBody
      key={JSON.stringify([props.calendarID, apiUrl, actorID])}
      {...props}
    />
  );
}
function OrganizerCreateActionBody({
  calendarID,
  color,
}: {
  calendarID: string;
  color: string;
}) {
  const api = useApi(),
    apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const [available, setAvailable] = useState<"google" | "caldav" | null>(null),
    [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    apiRef.current
      .getOrganizerCalendar(calendarID)
      .then((result) => {
        if (active) setAvailable(result.provider);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [calendarID]);
  return available ? (
    <>
      <Btn
        label={`Create ${available === "caldav" ? "CalDAV" : "Google"} meeting`}
        variant="secondary"
        onPress={() => setOpen(true)}
      />
      {open && (
        <ProviderOrganizerEditor
          provider={available}
          calendarID={calendarID}
          color={color}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  ) : null;
}
export function ProviderOrganizerEditor({
  calendarID,
  color,
  event,
  observation,
  provider = observation?.organizerEdit?.provider ?? "google",
  onClose,
}: {
  calendarID: string;
  color: string;
  event?: Event;
  observation?: ProviderEventStateResponse;
  provider?: "google" | "caldav";
  onClose: () => void;
}) {
  const api = useApi(),
    insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(() => organizerDraft(event, provider)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [submitted, setSubmitted] = useState(false),
    [frozenAction, setFrozenAction] = useState<ProviderOrganizerRequest["action"] | null>(null);
  const pending = useRef(false),
    frozen = useRef<ProviderOrganizerRequest | null>(null),
    changed = useRef<(keyof OrganizerDraft)[]>([]),
    identity = useRef({
      operationID: uuidv7(),
      provider,
      eventID: event?.id ?? uuidv7(),
      calendarID,
      color,
    });
  function close() {
    if (!pending.current) onClose();
  }
  function patch<K extends keyof OrganizerDraft>(
    key: K,
    value: OrganizerDraft[K],
  ) {
    if (frozen.current) return;
    changed.current = [...new Set([...changed.current, key])];
    setDraft((previous) => ({ ...previous, [key]: value }));
  }
  const canUpdate =
    !event ||
    provider !== "caldav" ||
    observation?.organizerEdit?.actions?.includes("update") === true;
  const canDelete =
    !!event &&
    (provider !== "caldav" ||
      observation?.organizerEdit?.actions?.includes("delete") === true);
  const canSubmit = frozenAction === "delete" ? canDelete : canUpdate;
  async function send(action: ProviderOrganizerRequest["action"]) {
    if (
      (action === "update" && !canUpdate) ||
      (action === "delete" && !canDelete)
    )
      return;
    if (pending.current || notice) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      frozen.current ??= organizerRequest(
        action,
        draft,
        changed.current,
        identity.current,
        observation,
      );
      setFrozenAction(frozen.current.action);
      setSubmitted(true);
      await api.editProviderOrganizer(frozen.current);
      setNotice(
        `Meeting change saved. Check Delivery details for ${provider === "caldav" ? "the CalDAV server’s" : "Google's"} result. Guest notification delivery remains unknown.`,
      );
    } catch (cause) {
      if (
        cause instanceof Error &&
        "organizerAdmissionRejected" in cause &&
        cause.organizerAdmissionRejected === true
      ) {
        frozen.current = null;
        setFrozenAction(null);
        identity.current.operationID = uuidv7();
        setSubmitted(false);
      }
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not save this meeting action. Retry keeps the same request.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const occurrence = provider === "google" && observation?.organizerEdit?.scope === "occurrence";
  const locked = busy || submitted || !canUpdate,
    copy = { fontFamily: fonts.sans, color: colors.fg2 };
  const fields: [keyof OrganizerDraft, string][] = [
    ["title", "Title"],
    ["description", "Notes"],
    ["location", "Location"],
    ...(!event
      ? [["guests", "Guest email addresses"] as [keyof OrganizerDraft, string]]
      : []),
    ...(provider === "caldav" && event
      ? []
      : ([
          [
            "start",
            draft.allDay
              ? "Start date (YYYY-MM-DD)"
              : "Start (YYYY-MM-DDTHH:mm:ss)",
          ],
          [
            "end",
            draft.allDay
              ? "End date (YYYY-MM-DD)"
              : "End (YYYY-MM-DDTHH:mm:ss)",
          ],
          ...(!draft.allDay
            ? [
                ["timeZone", "Event time zone"] as [
                  keyof OrganizerDraft,
                  string,
                ],
              ]
            : []),
        ] as [keyof OrganizerDraft, string][])),
  ];
  return (
    <ModalPortal visible onRequestClose={close}>
      <View style={styles.modalOverlay}>
        <Pressable style={{ flex: 1 }} onPress={close} accessible={false} />
      </View>
      <View
        pointerEvents="box-none"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          paddingTop: insets.top,
          justifyContent: "flex-end",
        }}
      >
        <View
          style={[
            styles.modalSheet,
            { position: "relative", minHeight: 0, maxHeight: "100%" },
          ]}
        >
          <View style={styles.modalHandle} />
          <View style={styles.modalTitleRow}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              {occurrence ? "Manage this occurrence" : `${event ? "Manage" : "Create"} ${provider === "caldav" ? "CalDAV" : "Google"} meeting`}
            </Text>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={{
              padding: spacing[4],
              paddingBottom: spacing[4] + insets.bottom,
              gap: spacing[3],
            }}
          >
            <Text style={copy}>{organizerNotificationNotice(provider)}</Text>
            {notice ? (
              <Text accessibilityLiveRegion="polite" style={copy}>
                {notice}
              </Text>
            ) : (
              <>
                {fields.filter(([key]) => !occurrence || ["title", "description", "location"].includes(key)).map(([key, label]) => (
                  <View key={key}>
                    <Text style={copy}>{label}</Text>
                    <TextInput
                      accessibilityLabel={label}
                      style={styles.textInput}
                      editable={
                        !locked &&
                        !(provider === "caldav" && key === "timeZone")
                      }
                      value={String(draft[key])}
                      onChangeText={(value) => patch(key, value)}
                    />
                  </View>
                ))}
                {(provider === "caldav" && event) || occurrence ? (
                  <Text style={copy}>
                    {occurrence ? "Only this occurrence will change. Series timing and guests stay unchanged." : "Meeting time and guests are preserved."}
                  </Text>
                ) : (
                  <>
                    {provider === "caldav" && !draft.allDay ? (
                      <Text style={copy}>
                        New timed CalDAV meetings use UTC.
                      </Text>
                    ) : null}
                    <Btn
                      variant="secondary"
                      label={`All day: ${draft.allDay ? "yes" : "no"}`}
                      disabled={locked}
                      onPress={() => patch("allDay", !draft.allDay)}
                    />
                  </>
                )}
                {canSubmit && (
                  <Btn
                    label={
                      submitted
                        ? "Retry saved meeting action"
                        : event
                          ? "Save and notify guests"
                          : "Create and send invitations"
                    }
                    loading={busy}
                    onPress={() =>
                      void send(
                        frozen.current?.action ?? (event ? "update" : "create"),
                      )
                    }
                  />
                )}
                {canDelete && !submitted && (
                  <Btn
                    variant="secondary"
                    label={occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests"}
                    onPress={() =>
                      confirm(
                        {
                          title: occurrence ? "Cancel this occurrence" : `Cancel ${provider === "caldav" ? "CalDAV" : "Google"} meeting`,
                          message: `${provider === "caldav" ? "The CalDAV server" : "Google"} will be asked to cancel ${occurrence ? "only this occurrence" : "this meeting"} and notify all guests. Guest notification delivery cannot be verified.`,
                          confirmLabel: occurrence ? "Cancel this occurrence and notify guests" : "Cancel meeting and notify guests",
                        },
                        () => {
                          void send("delete");
                        },
                      )
                    }
                  />
                )}
              </>
            )}
            {error && (
              <Text accessibilityRole="alert" style={copy}>
                {error}
              </Text>
            )}
            <Btn
              variant="secondary"
              label={notice ? "Close meeting action" : "Close meeting editor"}
              disabled={busy}
              onPress={close}
            />
          </ScrollView>
        </View>
      </View>
    </ModalPortal>
  );
}
