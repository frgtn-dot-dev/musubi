import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Globe, Link2, Lock } from "lucide-react";
import { useState, type RefObject } from "react";
import { getServerOrigin } from "~/api/query-keys";
import {
  getEventShare,
  publishEvent,
  unpublishEvent,
} from "~/api/resources";
import type { EventShare } from "~/api/contracts";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { RowAction } from "~/ui/Row";
import { Select } from "~/ui/Select";
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

  const publish = useMutation({
    mutationFn: (input: {
      attendeeVisibility?: EventShare["attendeeVisibility"];
      indexable: boolean;
      mode: "link" | "public";
    }) =>
      publishEvent({
        attendeeVisibility:
          input.attendeeVisibility ?? current?.attendeeVisibility ?? "counts",
        eventId,
        indexable: input.indexable,
        mode: input.mode,
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
                showChevron={false}
                value={mode === option.value ? "On" : undefined}
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
            <Select
              label="Who is coming"
              options={[
                { label: "Show how many", value: "counts" },
                { label: "Show names", value: "names" },
                { label: "Show nothing", value: "hidden" },
              ]}
              size="compact"
              value={current.attendeeVisibility}
              onChange={(value) =>
                publish.mutate({
                  attendeeVisibility: value as EventShare["attendeeVisibility"],
                  indexable: current.indexable,
                  mode: current.mode,
                })
              }
            />
            <p className={styles.note}>
              Names are only ever those who said yes — a maybe and a no are
              answers people give in confidence.
            </p>
          </div>
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
