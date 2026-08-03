import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, Lock } from "lucide-react";
import { useState, type RefObject } from "react";
import { getServerOrigin } from "~/api/query-keys";
import {
  getEventRsvps,
  getEventShare,
  publishEvent,
  unpublishEvent,
} from "~/api/resources";
import {
  eventPageCovers,
  eventPageFonts,
  eventPageLayouts,
  eventPagePalettes,
} from "@musubi/design-system";
import {
  defaultEventPageTheme,
  type EventPageTheme,
} from "@musubi/types";
import type { EventShare } from "~/api/contracts";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { RowAction } from "~/ui/Row";
import styles from "./styles/share-event.module.css";

type Mode = "link" | "private" | "public";

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
    detail: "A page you can put anywhere. You choose whether search may list it.",
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
    // Only the yeses, ever: a maybe and a no are answers people give in
    // confidence, and publishing them would be a different promise.
    detail: "Readers see the names of people who said yes",
    label: "Show names",
    value: "names",
  },
  {
    detail: "Readers learn nothing about who answered",
    label: "Show nothing",
    value: "hidden",
  },
];

/**
 * Publishing an event as a page anyone can open.
 *
 * Three modes rather than a switch, because "who can open this" and "may a
 * crawler index it" are different questions (`PRD §17.1`) and collapsing them is
 * how a private thing ends up in a search result. Nothing is published until
 * this dialog says so — an event with no share is simply private.
 */
export function ShareEventDialog({
  eventId,
  eventTitle,
  onNotice,
  onOpenChange,
  returnFocus,
}: {
  eventId: string;
  eventTitle: string;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const shareKey = ["event-share", getServerOrigin(), eventId];
  const [copied, setCopied] = useState(false);

  const share = useQuery({
    queryFn: ({ signal }) => getEventShare(eventId, signal),
    queryKey: shareKey,
  });

  // The organizer's own view of the answers. Fetched here rather than badged on
  // the event, which would cost a request every time anyone opened any event's
  // details for a feature most events never use.
  const rsvps = useQuery({
    queryFn: ({ signal }) => getEventRsvps(eventId, signal),
    queryKey: ["event-rsvps", getServerOrigin(), eventId],
    refetchOnWindowFocus: true,
  });

  const publish = useMutation({
    mutationFn: (input: {
      attendeeVisibility?: EventShare["attendeeVisibility"];
      indexable: boolean;
      mode: "link" | "public";
      theme?: EventPageTheme;
    }) =>
      publishEvent({
        attendeeVisibility:
          input.attendeeVisibility ?? current?.attendeeVisibility ?? "counts",
        eventId,
        indexable: input.indexable,
        mode: input.mode,
        theme: input.theme ?? current?.theme ?? defaultEventPageTheme,
      }),
    onSuccess: (result) => queryClient.setQueryData(shareKey, result),
  });

  const unpublish = useMutation({
    mutationFn: () => unpublishEvent(eventId),
    onSuccess: () => {
      queryClient.setQueryData(shareKey, null);
      // Worth saying out loud: the old link is dead, not merely hidden.
      onNotice("Page unpublished. The old link no longer opens.");
    },
  });

  const current = share.data;
  const theme = current?.theme ?? defaultEventPageTheme;
  const publishTheme = (change: Partial<EventPageTheme>) => {
    if (!current) return;
    publish.mutate({
      indexable: current.indexable,
      mode: current.mode,
      theme: { ...theme, ...change },
    });
  };
  const counts = rsvps.data?.counts ?? { declined: 0, going: 0, maybe: 0 };
  const answered = counts.going + counts.maybe + counts.declined > 0;
  const mode: Mode = current?.mode ?? "private";
  const busy = publish.isPending || unpublish.isPending;
  const error = publish.error ?? unpublish.error;

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2_000);
    } catch {
      // Clipboard refused (permissions, insecure origin): the field next to the
      // button still holds the whole link to select by hand.
      onNotice("Could not copy — select the link and copy it yourself.");
    }
  }

  return (
    <Dialog
      bodyLayout="flush"
      closeLabel="Close sharing"
      description={`Publish “${eventTitle}” as a page, or keep it private.`}
      // Opened from the event popover, so it has to sit above it — and so do the
      // select's options, which otherwise open behind the popover and look like
      // a dropdown that does nothing.
      elevated
      onOpenChange={onOpenChange}
      open
      returnFocus={returnFocus}
      title="Share event"
    >
      <div aria-busy={busy || undefined} className={styles.content}>
        <div className={styles.modes} role="radiogroup" aria-label="Who can open this page">
          {MODES.map((option) => {
            const Icon = option.icon;

            return (
              <RowAction
                aria-checked={mode === option.value}
                detail={option.detail}
                disabled={busy || share.isPending}
                icon={<Icon size={17} strokeWidth={1.7} />}
                key={option.value}
                label={option.label}
                role="radio"
                selected={mode === option.value}
                showChevron={false}
                value={mode === option.value ? "Current" : undefined}
                onClick={() => {
                  if (option.value === mode) return;
                  if (option.value === "private") {
                    unpublish.mutate();
                    return;
                  }
                  publish.mutate({
                    // Switching to "link" always drops indexing — the mode's
                    // whole promise is that it stays out of search.
                    indexable:
                      option.value === "public"
                        ? (current?.indexable ?? false)
                        : false,
                    mode: option.value,
                  });
                }}
              />
            );
          })}
        </div>

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

        {current ? (
          <div className={styles.visibilityRow}>
            {/* Rows, not a select: this dialog opens from the event popover, and
                a dropdown's own popover layers behind it — the same trap the
                layer order in `docs/ui/calendar-ui.md` records. The pattern also
                matches the modes above. */}
            <div
              aria-label="What readers see about who is coming"
              className={styles.modes}
              role="radiogroup"
            >
              {VISIBILITIES.map((option) => (
                <RowAction
                  aria-checked={current.attendeeVisibility === option.value}
                  detail={option.detail}
                  disabled={busy}
                  key={option.value}
                  label={option.label}
                  role="radio"
                  selected={current.attendeeVisibility === option.value}
                  showChevron={false}
                  value={
                    current.attendeeVisibility === option.value
                      ? "Current"
                      : undefined
                  }
                  onClick={() =>
                    publish.mutate({
                      attendeeVisibility: option.value,
                      indexable: current.indexable,
                      mode: current.mode,
                    })
                  }
                />
              ))}
            </div>
          </div>
        ) : null}

        {current ? (
          <section aria-labelledby="page-look-title" className={styles.look}>
            <h3 id="page-look-title">How the page looks</h3>
            {/* Closed sets, no colour picker and no CSS box: the palettes are
                the ones whose contrast is proven in the design system, which is
                how "accessibility is not customisable" (PRD §17.3) stays true
                rather than being a line in a document. */}
            <Choices
              label="Palette"
              onChange={(palette) =>
                publishTheme({ palette: palette as EventPageTheme["palette"] })
              }
              options={eventPagePalettes.map((palette) => ({
                id: palette.id,
                label: palette.label,
                swatch: palette.accent,
              }))}
              value={theme.palette}
            />
            <Choices
              label="Layout"
              onChange={(layout) =>
                publishTheme({ layout: layout as EventPageTheme["layout"] })
              }
              options={eventPageLayouts.map((item) => ({ ...item }))}
              value={theme.layout}
            />
            <Choices
              label="Cover"
              onChange={(cover) =>
                publishTheme({ cover: cover as EventPageTheme["cover"] })
              }
              options={eventPageCovers.map((item) => ({ ...item }))}
              value={theme.cover}
            />
            <Choices
              label="Type"
              onChange={(font) =>
                publishTheme({ font: font as EventPageTheme["font"] })
              }
              options={eventPageFonts.map((item) => ({ ...item }))}
              value={theme.font}
            />
          </section>
        ) : null}

        {current?.mode === "public" ? (
          <div className={styles.indexRow}>
            <Checkbox
              checked={current.indexable}
              disabled={busy}
              label="Allow search engines to list this page"
              onChange={(event) =>
                publish.mutate({
                  indexable: event.target.checked,
                  mode: "public",
                })
              }
            />
          </div>
        ) : null}

        {answered ? (
          <section aria-labelledby="rsvp-answers-title" className={styles.answers}>
            <h3 id="rsvp-answers-title">
              {counts.going} going
              {counts.maybe > 0 ? ` · ${counts.maybe} maybe` : ""}
              {counts.declined > 0 ? ` · ${counts.declined} can’t` : ""}
            </h3>
            {/* Always shown to whoever can edit the event, whatever readers of
                the page are allowed to see — the setting above is about them. */}
            <AnswerList label="Going" names={rsvps.data?.going ?? []} />
            <AnswerList label="Maybe" names={rsvps.data?.maybe ?? []} />
            <AnswerList label="Can’t go" names={rsvps.data?.declined ?? []} />
          </section>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error.message}
          </p>
        ) : null}

        <p className={styles.note}>
          {/* Said before anyone asks: the page is a projection, not the event. */}
          A published page shows the title, description, when and where, and who
          is organizing. It never shows who else is coming, the calendar it lives
          in, or anything else in it.
        </p>
      </div>

      <div className={styles.footer}>
        <DialogClose>
          <Button variant="secondary">Done</Button>
        </DialogClose>
      </div>
    </Dialog>
  );
}

function AnswerList({ label, names }: { label: string; names: string[] }) {
  if (names.length === 0) return null;

  return (
    <p className={styles.answerLine}>
      <span className={styles.answerLabel}>{label}</span>
      {names.join(", ")}
    </p>
  );
}

/**
 * One row of mutually exclusive looks.
 *
 * Buttons rather than a select for the same reason the modes above are rows:
 * this dialog opens from a popover, and a dropdown's own layer lands behind it.
 */
function Choices({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ id: string; label: string; swatch?: string }>;
  value: string;
}) {
  return (
    <div className={styles.choices} role="group" aria-label={label}>
      <span className={styles.choicesLabel}>{label}</span>
      {options.map((option) => (
        <Button
          aria-pressed={value === option.id}
          icon={
            option.swatch ? (
              <span
                aria-hidden="true"
                className={styles.swatch}
                style={{ background: option.swatch }}
              />
            ) : undefined
          }
          key={option.id}
          size="compact"
          variant={value === option.id ? "primary" : "secondary"}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
