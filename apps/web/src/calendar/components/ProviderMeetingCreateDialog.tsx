import { organizerNotificationNotice, organizerRequest, type OrganizerDraft } from "@musubi/calendar";
import { providerDisplayName, providerFlavor, type Calendar, type ProviderOrganizerRequest } from "@musubi/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { editProviderOrganizer, getOrganizerCalendar } from "~/api/resources";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import { Empty } from "~/ui/Empty";
import { Field } from "~/ui/Field";
import { InlineError } from "~/ui/InlineError";
import { Select } from "~/ui/Select";
import { AccountMark } from "./ProviderIcon";
import { ProviderOrganizerFields } from "./ProviderOrganizerEditor";
import { initialMeetingDraft, meetingDraftAllDay, meetingDraftForProvider, type MeetingProvider } from "./provider-meeting-draft";
import styles from "./styles/event-delivery.module.css";

type MeetingCalendar = Calendar & { provider: MeetingProvider };

/** Capability success is checked separately; this predicate never grants write access. */
export function isMeetingCalendarCandidate(calendar: Calendar): calendar is MeetingCalendar {
  return calendar.role === "owner" && calendar.supportsEvents !== false &&
    (calendar.provider === "google" || calendar.provider === "caldav" || calendar.provider === "microsoft");
}

export type ProviderMeetingCreateDialogProps = {
  calendars: Calendar[];
  initialCalendarID?: string;
  returnFocus?: HTMLElement | null;
  onClose: () => void;
  initialDate?: string;
};

export function ProviderMeetingCreateDialog({ calendars, initialCalendarID, returnFocus, onClose, initialDate }: ProviderMeetingCreateDialogProps) {
  const candidates = useMemo(() => calendars.filter(isMeetingCalendarCandidate), [calendars]);
  const [retry, setRetry] = useState(0);
  const [checked, setChecked] = useState<{ candidates: MeetingCalendar[]; retry: number; approved: MeetingCalendar[] } | null>(null);
  const approved = checked?.approved ?? [];
  const loading = checked?.candidates !== candidates || checked?.retry !== retry;
  const [selected, setSelected] = useState<MeetingCalendar | null>(null);
  const [draft, setDraft] = useState<OrganizerDraft>(() => initialMeetingDraft("google", initialDate));
  const initialized = useRef(false);
  const initial = useRef({ calendarID: initialCalendarID, date: initialDate });
  const identity = useRef({ eventID: crypto.randomUUID(), operationID: crypto.randomUUID() });
  const frozen = useRef<ProviderOrganizerRequest | null>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void Promise.allSettled(candidates.map(async (calendar) => {
      const capability = await getOrganizerCalendar(calendar.id, controller.signal);
      if (capability.calendarID !== calendar.id || capability.provider !== calendar.provider) return null;
      return calendar;
    })).then((results) => {
      if (controller.signal.aborted) return;
      const available = results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
      setChecked({ candidates, retry, approved: available });
      if (!initialized.current && available.length) {
        const target = initial.current.calendarID
          ? available.find(calendar => calendar.id === initial.current.calendarID)
          : available[0];
        initialized.current = true;
        if (target) {
          setSelected(target);
          setDraft(initialMeetingDraft(target.provider, initial.current.date));
        } else {
          setError("This calendar is not available for meetings. Choose another calendar.");
        }
      }
    });
    return () => controller.abort();
  }, [candidates, retry]);

  const currentAvailable = selected && approved.some(calendar => calendar.id === selected.id && calendar.provider === selected.provider);
  const locked = busy || submitted;

  function chooseCalendar(calendarID: string) {
    if (pending.current || frozen.current || loading) return;
    const target = approved.find(calendar => calendar.id === calendarID);
    if (!target || target.id === selected?.id) return;
    try {
      const nextDraft = selected
        ? meetingDraftForProvider(draft, target.provider)
        : initialMeetingDraft(target.provider, initial.current.date);
      initialized.current = true;
      setSelected(target);
      setDraft(nextDraft);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch calendars. Your draft has been kept.");
    }
  }

  function patch<Key extends keyof OrganizerDraft>(key: Key, value: OrganizerDraft[Key]) {
    if (pending.current || frozen.current) return;
    setDraft(current => key === "allDay" && typeof value === "boolean"
      ? meetingDraftAllDay(current, value)
      : { ...current, [key]: value });
  }

  async function send() {
    if (pending.current || notice || !selected || (!frozen.current && (loading || !currentAvailable))) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      frozen.current ??= organizerRequest("create", draft, [], {
        ...identity.current,
        calendarID: selected.id,
        color: selected.color,
        provider: selected.provider,
      });
      setSubmitted(true);
      await editProviderOrganizer(frozen.current);
      setNotice(`Meeting change saved. Check Delivery details for ${selected.provider === "caldav" ? "the CalDAV server’s" : selected.provider === "microsoft" ? "Outlook's" : "Google's"} result. Guest notification delivery remains unknown.`);
    } catch (cause) {
      if (cause instanceof Error && "organizerAdmissionRejected" in cause && cause.organizerAdmissionRejected === true) {
        frozen.current = null;
        identity.current.operationID = crypto.randomUUID();
        setSubmitted(false);
      }
      setError(cause instanceof Error ? cause.message : "Could not save this meeting action. Retry keeps the same request.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  // A submitted request retains its named destination even if a refresh removes
  // that calendar from the current list; retry can only replay that same request.
  const options = submitted && selected ? [selected] : approved;
  return <div className={styles.layerBoundary} onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <Dialog
      elevated
      open
      closeLabel="Close meeting editor"
      title="Create meeting"
      description={selected ? organizerNotificationNotice(selected.provider) : "Choose a connected calendar to invite guests."}
      returnFocus={returnFocus}
      onOpenChange={open => { if (!open && !pending.current) onClose(); }}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={onClose}>{notice ? "Close" : "Cancel"}</Button>
        {!notice && selected ? <Button disabled={!submitted && (loading || !currentAvailable)} loading={busy} onClick={() => void send()}>
          {submitted ? "Retry saved meeting action" : "Create and send invitations"}
        </Button> : null}
      </>}
    >
      <Field label="Calendar">
        <Select
          label="Calendar"
          value={selected?.id ?? ""}
          placeholder={loading ? "Loading calendars…" : "Choose a calendar"}
          disabled={locked || loading || approved.length === 0}
          options={options.map(calendar => ({
            value: calendar.id,
            label: calendar.name,
            description: [calendar.accountLabel?.trim(), providerDisplayName(calendar)].filter(Boolean).join(" · "),
            icon: <AccountMark flavor={providerFlavor(calendar)} />,
          }))}
          onChange={chooseCalendar}
        />
      </Field>
      {notice ? <p role="status">{notice}</p> : <>
        {loading ? <p role="status">Checking calendars…</p> : null}
        {!loading && approved.length === 0 ? <Empty
          title="No calendars available for meetings"
          description={candidates.length ? "Meeting access could not be confirmed. Try again or check your connections." : "Connect an account with an event calendar you own."}
          action={candidates.length ? <Button variant="secondary" onClick={() => setRetry(current => current + 1)}>Retry</Button> : undefined}
        /> : null}
        {!loading && selected && !currentAvailable && approved.length > 0 && !submitted ? <InlineError>Choose an available calendar. Your meeting draft has been kept.</InlineError> : null}
        {selected ? <ProviderOrganizerFields draft={draft} provider={selected.provider} locked={locked} onChange={patch} /> : null}
      </>}
      {error ? <InlineError>{error}</InlineError> : null}
    </Dialog>
  </div>;
}
