import type { Event, EventPageContent, EventPageTheme } from "@musubi/types";
import { defaultEventPageContent, defaultEventPageTheme } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, Lock, MapPin } from "lucide-react";
import { useState, type RefObject } from "react";
import { getServerOrigin } from "~/api/query-keys";
import {
  getEventShare,
  publishEvent,
  unpublishEvent,
  uploadEventCover,
} from "~/api/resources";
import type { EventShare } from "~/api/contracts";
import {
  eventFormValues,
  updateEventFromForm,
  validateEventForm,
  type EventFormValues,
} from "~/calendar/event-form";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { RowAction } from "~/ui/Row";
import {
  EventPageSettings,
  validateEventPageContent,
} from "./EventPageSettings";
import pageStyles from "~/routes/event-page.module.css";
import styles from "./styles/share-event.module.css";

type Mode = "link" | "private" | "public";

type Draft = {
  attendeeVisibility: EventShare["attendeeVisibility"];
  content: EventPageContent;
  indexable: boolean;
  mode: Mode;
  theme: EventPageTheme;
};

const MODES: Array<{
  detail: string;
  icon: typeof Lock;
  label: string;
  value: Mode;
}> = [
  {
    detail: "Only people you share the calendar with can see it",
    icon: Lock,
    label: "Private",
    value: "private",
  },
  {
    detail: "Anyone holding the link can open the page. Search engines cannot.",
    icon: Link2,
    label: "Anyone with the link",
    value: "link",
  },
  {
    detail:
      "A page you can put anywhere. You choose whether search may list it.",
    icon: Globe,
    label: "Public",
    value: "public",
  },
];

const VISIBILITIES: Array<{
  detail: string;
  label: string;
  value: EventShare["attendeeVisibility"];
}> = [
  {
    detail: "Readers see how many people are coming",
    label: "Show how many",
    value: "counts",
  },
  {
    detail: "Readers see names of people who said yes",
    label: "Show names",
    value: "names",
  },
  {
    detail: "Readers learn nothing about who answered",
    label: "Show nothing",
    value: "hidden",
  },
];

function draftFrom(current: EventShare | null): Draft {
  return {
    attendeeVisibility: current?.attendeeVisibility ?? "counts",
    content: current?.content ?? defaultEventPageContent,
    indexable: current?.indexable ?? false,
    mode: current?.mode ?? "private",
    theme: current?.theme ?? defaultEventPageTheme,
  };
}

/** One workspace for public-page settings and details readers actually see. */
export function ShareEventDialog({
  event,
  onNotice,
  onOpenChange,
  onSaveEvent,
  returnFocus,
}: {
  event: Event;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onSaveEvent: (event: Event) => Promise<unknown>;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const shareKey = ["event-share", getServerOrigin(), event.id];
  const [copied, setCopied] = useState(false);
  const [draftOverride, setDraftOverride] = useState<Draft>();
  const [eventDraft, setEventDraft] = useState<EventFormValues>(() =>
    eventFormValues(event),
  );
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<null | string>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saveError, setSaveError] = useState("");

  const share = useQuery({
    queryFn: ({ signal }) => getEventShare(event.id, signal),
    queryKey: shareKey,
  });
  const current = share.data ?? null;
  // Keep server settings as the source until first local edit. This avoids an
  // effect that can overwrite a click while the query is resolving.
  const draft =
    draftOverride ?? (share.isSuccess ? draftFrom(current) : undefined);
  const setDraft = setDraftOverride;

  const publish = useMutation({
    mutationFn: (input: Draft) =>
      publishEvent({
        attendeeVisibility: input.attendeeVisibility,
        content: input.content,
        eventId: event.id,
        indexable: input.indexable,
        mode: input.mode as "link" | "public",
        theme: input.theme,
      }),
    onSuccess: (result) => queryClient.setQueryData(shareKey, result),
  });
  const unpublish = useMutation({
    mutationFn: () => unpublishEvent(event.id),
    onSuccess: () => queryClient.setQueryData(shareKey, null),
  });
  const busy = publish.isPending || unpublish.isPending;

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      onNotice("Could not copy — select the link and copy it yourself.");
    }
  }

  async function save() {
    if (!draft) return;
    const eventError = validateEventForm(eventDraft);
    const pageError = validateEventPageContent(draft.content);
    if (eventError || pageError) {
      setSaveError(eventError ?? pageError ?? "");
      return;
    }

    setSaveError("");
    try {
      await onSaveEvent(updateEventFromForm(event, eventDraft));
      if (draft.mode === "private") {
        if (current) await unpublish.mutateAsync();
      } else {
        await publish.mutateAsync(draft);
      }
      onNotice("Event and page saved.");
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : "Could not save changes.",
      );
    }
  }

  if (!draft) {
    return (
      <Dialog
        closeLabel="Close sharing"
        description={`Preparing “${event.title}”.`}
        elevated
        open
        returnFocus={returnFocus}
        size="workspace"
        title="Share event"
        onOpenChange={onOpenChange}
      >
        <p className={styles.loading}>Loading sharing settings…</p>
      </Dialog>
    );
  }

  const coverUrl = coverPreviewUrl ?? current?.coverUrl ?? null;
  const error = saveError || publish.error?.message || unpublish.error?.message;

  return (
    <>
      <Dialog
        bodyLayout="flush"
        bodyScroll="panels"
        closeLabel="Close sharing"
        description="Edit what readers see, then save every change together."
        elevated
        footer={
          <div className={styles.footer}>
            {error ? (
              <p className={styles.footerError} role="alert">
                {error}
              </p>
            ) : null}
            <DialogClose>
              <Button variant="secondary">Done</Button>
            </DialogClose>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => setPreviewOpen(true)}
            >
              Preview draft
            </Button>
            <Button loading={busy} onClick={() => void save()}>
              Save changes
            </Button>
          </div>
        }
        open
        returnFocus={returnFocus}
        size="workspace"
        title="Share event"
        onOpenChange={onOpenChange}
      >
        <div aria-busy={busy || undefined} className={styles.workspace}>
          <section className={styles.column} aria-labelledby="sharing-title">
            <div className={styles.columnHeading}>
              <h3 id="sharing-title">Sharing</h3>
              <p>Choose who can open this page.</p>
            </div>
            <div
              className={styles.modes}
              role="radiogroup"
              aria-label="Who can open this page"
            >
              {MODES.map((option) => {
                const Icon = option.icon;
                return (
                  <RowAction
                    aria-checked={draft.mode === option.value}
                    detail={option.detail}
                    disabled={busy}
                    icon={<Icon size={17} strokeWidth={1.7} />}
                    key={option.value}
                    label={option.label}
                    role="radio"
                    selected={draft.mode === option.value}
                    showChevron={false}
                    value={draft.mode === option.value ? "Current" : undefined}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        indexable:
                          option.value === "link" ? false : draft.indexable,
                        mode: option.value,
                      })
                    }
                  />
                );
              })}
            </div>

            {draft.mode !== "private" ? (
              <>
                <div className={styles.sectionHeading}>
                  <h4>Guests</h4>
                </div>
                <div
                  className={styles.modes}
                  role="radiogroup"
                  aria-label="What readers see about who is coming"
                >
                  {VISIBILITIES.map((option) => (
                    <RowAction
                      aria-checked={draft.attendeeVisibility === option.value}
                      detail={option.detail}
                      disabled={busy}
                      key={option.value}
                      label={option.label}
                      role="radio"
                      selected={draft.attendeeVisibility === option.value}
                      showChevron={false}
                      value={
                        draft.attendeeVisibility === option.value
                          ? "Current"
                          : undefined
                      }
                      onClick={() =>
                        setDraft({ ...draft, attendeeVisibility: option.value })
                      }
                    />
                  ))}
                </div>
                {draft.mode === "public" ? (
                  <Checkbox
                    checked={draft.indexable}
                    disabled={busy}
                    label="Allow search engines to list this page"
                    onChange={(input) =>
                      setDraft({ ...draft, indexable: input.target.checked })
                    }
                  />
                ) : null}
              </>
            ) : null}

            {current ? (
              <div className={styles.linkRow}>
                <input
                  aria-label="Public link"
                  className={styles.linkField}
                  readOnly
                  value={current.url}
                />
                <Button
                  icon={
                    copied ? (
                      <Check size={15} strokeWidth={1.8} />
                    ) : (
                      <Copy size={15} strokeWidth={1.6} />
                    )
                  }
                  size="compact"
                  variant="secondary"
                  onClick={() => void copyLink(current.url)}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            ) : null}
          </section>

          <section className={styles.column} aria-labelledby="details-title">
            <div className={styles.columnHeading}>
              <h3 id="details-title">Event details</h3>
              <p>Details shown at the top of public page.</p>
            </div>
            <Field label="Event title">
              <input
                disabled={busy}
                value={eventDraft.title}
                onChange={(input) =>
                  setEventDraft({ ...eventDraft, title: input.target.value })
                }
              />
            </Field>
            <div className={styles.dateFields}>
              <Field label="Starts">
                <input
                  disabled={busy}
                  type="date"
                  value={eventDraft.date}
                  onChange={(input) =>
                    setEventDraft({ ...eventDraft, date: input.target.value })
                  }
                />
              </Field>
              {!eventDraft.isAllDay ? (
                <Field label="Start time">
                  <input
                    disabled={busy}
                    type="time"
                    value={eventDraft.startTime}
                    onChange={(input) =>
                      setEventDraft({
                        ...eventDraft,
                        startTime: input.target.value,
                      })
                    }
                  />
                </Field>
              ) : null}
              <Field label="Ends">
                <input
                  disabled={busy}
                  type={eventDraft.isAllDay ? "date" : "time"}
                  value={
                    eventDraft.isAllDay
                      ? eventDraft.endDate
                      : eventDraft.endTime
                  }
                  onChange={(input) =>
                    setEventDraft({
                      ...eventDraft,
                      [eventDraft.isAllDay ? "endDate" : "endTime"]:
                        input.target.value,
                    })
                  }
                />
              </Field>
            </div>
            <Checkbox
              checked={eventDraft.isAllDay}
              disabled={busy}
              label="All day"
              onChange={(input) =>
                setEventDraft({ ...eventDraft, isAllDay: input.target.checked })
              }
            />
            <p className={styles.timezoneNote}>
              Times use your calendar’s timezone.
            </p>
            <Field label="Location">
              <input
                disabled={busy}
                placeholder="Add location"
                value={eventDraft.location}
                onChange={(input) =>
                  setEventDraft({ ...eventDraft, location: input.target.value })
                }
              />
            </Field>
            <Field label="Event link">
              <input
                disabled={busy}
                placeholder="https://…"
                type="url"
                value={eventDraft.url}
                onChange={(input) =>
                  setEventDraft({ ...eventDraft, url: input.target.value })
                }
              />
            </Field>
            <Field label="Description">
              <textarea
                disabled={busy}
                rows={5}
                value={eventDraft.description}
                onChange={(input) =>
                  setEventDraft({
                    ...eventDraft,
                    description: input.target.value,
                  })
                }
              />
            </Field>
          </section>

          <section className={styles.column} aria-label="Event page settings">
            <EventPageSettings
              busy={busy}
              content={draft.content}
              coverUrl={current?.coverUrl ?? null}
              theme={draft.theme}
              onChange={({ content, theme }) =>
                setDraft({ ...draft, content, theme })
              }
              onPreviewUrlChange={setCoverPreviewUrl}
              onUpload={async (file) => {
                await uploadEventCover(event.id, file);
              }}
            />
          </section>
        </div>
      </Dialog>

      <DraftPreview
        content={draft.content}
        coverUrl={coverUrl}
        event={updateEventFromForm(event, eventDraft)}
        open={previewOpen}
        theme={draft.theme}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}

function DraftPreview({
  content,
  coverUrl,
  event,
  open,
  theme,
  onOpenChange,
}: {
  content: EventPageContent;
  coverUrl: null | string;
  event: Event;
  open: boolean;
  theme: EventPageTheme;
  onOpenChange: (open: boolean) => void;
}) {
  const focalPosition = `${content.cover.focalX}% ${content.cover.focalY}%`;
  const when = event.isAllDay
    ? new Intl.DateTimeFormat(undefined, {
        day: "numeric",
        month: "long",
        weekday: "short",
      }).format(event.start)
    : `${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long", weekday: "short" }).format(event.start)} · ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(event.start)}–${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(event.end)}`;

  return (
    <Dialog
      bodyLayout="flush"
      closeLabel="Close preview"
      description="Unsaved changes shown here are not public yet."
      elevated
      open={open}
      size="fullscreen"
      title="Draft preview"
      onOpenChange={onOpenChange}
    >
      <main className={pageStyles.page} id="draft-preview">
        <div className={pageStyles.shell}>
          <header
            className={pageStyles.hero}
            data-cover={theme.cover}
            data-upload={coverUrl ? "" : undefined}
            style={
              coverUrl
                ? {
                    backgroundImage: `url(${coverUrl})`,
                    backgroundPosition: focalPosition,
                    backgroundSize: `${content.cover.zoom * 100}%`,
                  }
                : undefined
            }
          >
            <div className={pageStyles.heroCopy}>
              <div className={pageStyles.heroTitleRow}>
                <time
                  className={pageStyles.dateBadge}
                  dateTime={event.start.toISOString()}
                >
                  <span>
                    {new Intl.DateTimeFormat(undefined, {
                      weekday: "short",
                    }).format(event.start)}
                  </span>
                  <strong>
                    {new Intl.DateTimeFormat(undefined, {
                      day: "2-digit",
                    }).format(event.start)}
                  </strong>
                  <span>
                    {new Intl.DateTimeFormat(undefined, {
                      month: "short",
                    }).format(event.start)}
                  </span>
                </time>
                <div>
                  <h1>{event.title || "Untitled event"}</h1>
                  <div className={pageStyles.heroFacts}>
                    <span>{when}</span>
                    {event.location ? (
                      <span>
                        <MapPin aria-hidden="true" size={16} />
                        {event.location}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </header>
          <div className={pageStyles.layout}>
            <aside className={pageStyles.sidebar}>
              <section className={pageStyles.sideCard}>
                <h2>Organized by</h2>
                <p>{event.organizer}</p>
              </section>
              {event.location ? (
                <section className={pageStyles.sideCard}>
                  <h2>Location</h2>
                  <p>{event.location}</p>
                </section>
              ) : null}
            </aside>
            <div className={pageStyles.content}>
              {event.description || content.tags.length > 0 ? (
                <section className={pageStyles.contentCard}>
                  <h2>About this event</h2>
                  {event.description ? (
                    <p className={pageStyles.description}>
                      {event.description}
                    </p>
                  ) : null}
                  {content.tags.length > 0 ? (
                    <ul className={pageStyles.tags} aria-label="Event tags">
                      {content.tags.map((tag) => (
                        <li key={tag}>{tag}</li>
                      ))}
                    </ul>
                  ) : null}
                </section>
              ) : null}
              {content.agenda.length > 0 ? (
                <section className={pageStyles.contentCard}>
                  <h2>Program</h2>
                  <ol className={pageStyles.agenda}>
                    {content.agenda.map((item) => (
                      <li key={item.id}>
                        <time>{item.time}</time>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{item.title}</strong>
                          {item.description ? <p>{item.description}</p> : null}
                        </div>
                      </li>
                    ))}
                  </ol>
                </section>
              ) : null}
            </div>
          </div>
        </div>
      </main>
    </Dialog>
  );
}
