import type { Announcement } from "@musubi/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Megaphone, Trash2 } from "lucide-react";
import {
  createAnnouncement,
  listAdminAnnouncements,
  removeAnnouncement,
  updateAnnouncement,
} from "~/api/resources";
import { getServerOrigin, queryKeys } from "~/api/query-keys";
import { useSessionUser } from "~/auth/use-session-user";
import { useAnnouncementsQuery } from "~/calendar/components/AnnouncementDialog";
import { Button } from "~/ui/Button";
import {
  ConfirmationDialog,
  ConfirmationNotice,
} from "~/ui/ConfirmationDialog";
import { Disclosure } from "~/ui/Disclosure";
import { Field } from "~/ui/Field";
import { RouteState } from "~/ui/RouteState";
import { Row } from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import { Toast } from "~/ui/Toast";
import styles from "~/routes/app/admin.module.css";

const EMPTY = { body: "", minVersion: "", title: "" };
// Same acknowledgement window Workspace uses for its own Toast — the parent
// owns timing (Toast.tsx's contract), so a failed publish/edit/delete does
// not sit on screen forever.
const TOAST_ACKNOWLEDGEMENT_MS = 3_500;

export function AdminSettings() {
  const { user } = useSessionUser();
  const origin = getServerOrigin();
  const queryClient = useQueryClient();

  // Tentýž dotaz (a tytéž staleTime/refetchOnWindowFocus), jaký si stáhne
  // modal — sdílená cache, takže odpověď navíc tahle stránka nestojí, a
  // refokusování stránky nemůže modal probudit uprostřed rozepsaného textu.
  const { data: mine, isPending: minePending } = useAnnouncementsQuery();

  const { data, isPending } = useQuery({
    enabled: mine?.isAdmin === true,
    queryFn: () => listAdminAnnouncements(),
    queryKey: queryKeys.adminAnnouncements(origin),
  });

  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  // The composer is the bulky half of this page, so it stays folded until
  // there is something to write — and unfolds itself when Edit fills it in.
  const [composerOpen, setComposerOpen] = useState(false);
  const [confirming, setConfirming] = useState<Announcement | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which Delete button asked, so a cancelled confirmation returns focus there
  // — same convention as CalendarTransferDialog's per-row delete/edit/disconnect.
  const deleteReturnFocusRef = useRef<HTMLButtonElement>(null);

  const refresh = () => {
    // The admin listing, and the per-user cache `AnnouncementGate` (and this
    // page's own `isAdmin` check, and the sidebar's) read with `staleTime:
    // Infinity` — without this half, a publish/edit/delete stays invisible
    // everywhere else in this tab until a full reload.
    void queryClient.invalidateQueries({
      queryKey: queryKeys.adminAnnouncements(origin),
    });
    return queryClient.invalidateQueries({
      queryKey: queryKeys.announcements(origin, user?.id ?? ""),
    });
  };

  const save = useMutation({
    mutationFn: () => {
      const input = {
        body: draft.body,
        minVersion: draft.minVersion.trim() || null,
        title: draft.title,
      };
      return editing
        ? updateAnnouncement(editing, input)
        : createAnnouncement(input);
    },
    onError: () => {
      setError(
        editing
          ? "Could not save your changes. Try again."
          : "Could not publish this announcement. Try again.",
      );
    },
    onSuccess: async () => {
      setError(null);
      setDraft(EMPTY);
      setEditing(null);
      setComposerOpen(false);
      await refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeAnnouncement(id),
    onError: () => setError("Could not delete this announcement. Try again."),
    onSuccess: async () => {
      setError(null);
      setConfirming(null);
      await refresh();
    },
  });

  // Toast's contract: the parent owns timing. Without this an error from a
  // failed save/delete would sit on screen forever, waiting for the next
  // success to clear it.
  useEffect(() => {
    if (!error) return;
    const timeout = window.setTimeout(
      () => setError(null),
      TOAST_ACKNOWLEDGEMENT_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [error]);

  // Dotaz na isAdmin ještě neodpověděl — bez téhle větve by formulář na
  // okamžik probliknul, než přijde odpověď. Kosmetické: ochranu dělá server,
  // ne tahle podmínka.
  if (minePending) {
    return <RouteState busy eyebrow="Server admin" title="Loading…" />;
  }

  // Slušnost UI, ne ochrana. Ta je na serveru: každá admin cesta běží za
  // `requireAdmin` a odmítne i toho, kdo si sem zadá URL ručně.
  if (mine && !mine.isAdmin) {
    return (
      <RouteState
        eyebrow="Server admin"
        description="Only this server's admins can write announcements."
        title="Not your page"
      />
    );
  }

  return (
    <div className={styles.content}>
      {/* Writing comes first: it is why an admin opens this page, and the list
          below is what they check afterwards. */}
      <SettingsSection title={editing ? "Edit announcement" : "New announcement"}>
        <Disclosure
          detail="Everyone signed in to this server sees it once"
          label="Title, message, and minimum version"
          onOpenChange={setComposerOpen}
          open={composerOpen}
        >
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Title">
              <input
                maxLength={200}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                required
                value={draft.title}
              />
            </Field>

            <Field
              description="An empty line starts a new paragraph. Links starting with http:// or https:// become clickable."
              label="Message"
            >
              <textarea
                className={styles.body}
                maxLength={4000}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    body: event.target.value,
                  }))
                }
                required
                value={draft.body}
              />
            </Field>

            <Field
              description="Only clients on this version or newer will see it. Leave empty to show it to everyone. Write it when you release the version — an older message with a higher minimum than a newer one gets skipped."
              label="Minimum version"
            >
              <input
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    minVersion: event.target.value,
                  }))
                }
                placeholder="0.1.7"
                value={draft.minVersion}
              />
            </Field>

            <div className={styles.actions}>
              <Button disabled={save.isPending} type="submit">
                {editing ? "Save changes" : "Publish"}
              </Button>
              {editing ? (
                <Button
                  onClick={() => {
                    setEditing(null);
                    setDraft(EMPTY);
                    setComposerOpen(false);
                  }}
                  type="button"
                  variant="secondary"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </form>
        </Disclosure>
      </SettingsSection>

      <SettingsSection title="Published">
        {isPending ? (
          <Row
            icon={<Megaphone size={16} strokeWidth={1.6} />}
            label="Loading…"
          />
        ) : data?.announcements.length ? (
          data.announcements.map((announcement) => (
            <Row
              detail={
                announcement.minVersion
                  ? `${announcement.id} · ${announcement.minVersion} and newer`
                  : `${announcement.id} · everyone`
              }
              icon={<Megaphone size={16} strokeWidth={1.6} />}
              key={announcement.id}
              label={announcement.title}
              trailing={
                <div className={styles.actions}>
                  <Button
                    aria-label={`Edit ${announcement.title}`}
                    onClick={() => {
                      setEditing(announcement.id);
                      setComposerOpen(true);
                      setDraft({
                        body: announcement.body,
                        minVersion: announcement.minVersion ?? "",
                        title: announcement.title,
                      });
                    }}
                    size="compact"
                    variant="secondary"
                  >
                    Edit
                  </Button>
                  <Button
                    aria-label={`Delete ${announcement.title}`}
                    onClick={(event) => {
                      deleteReturnFocusRef.current = event.currentTarget;
                      setConfirming(announcement);
                    }}
                    size="compact"
                    variant="secondary"
                  >
                    Delete
                  </Button>
                </div>
              }
            />
          ))
        ) : (
          <Row
            detail="Write one above."
            icon={<Megaphone size={16} strokeWidth={1.6} />}
            label="Nothing published yet"
          />
        )}

      </SettingsSection>

      {confirming ? (
        <ConfirmationDialog
          closeLabel="Cancel"
          confirmLabel="Delete"
          confirmVariant="destructive"
          description="Deleting it does not un-show it — anyone who already saw it keeps their mark."
          loading={remove.isPending}
          onConfirm={() => remove.mutate(confirming.id)}
          onOpenChange={(open) => {
            if (!open) setConfirming(null);
          }}
          open
          returnFocus={deleteReturnFocusRef}
          title={`Delete "${confirming.title}"?`}
        >
          <ConfirmationNotice icon={<Trash2 size={18} />}>
            People who have not seen it yet never will.
          </ConfirmationNotice>
        </ConfirmationDialog>
      ) : null}

      {error ? <Toast message={error} tone="error" /> : null}
    </div>
  );
}
