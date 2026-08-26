import { eventPageCovers } from "@musubi/design-system";
import type {
  EventPageAgendaItem,
  EventPageContent,
  EventPageTheme,
} from "@musubi/types";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "~/ui/Button";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import styles from "./styles/share-event.module.css";

const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COVER_MAX_BYTES = 5 * 1024 * 1024;

export function validateEventPageContent(
  content: EventPageContent,
): string | undefined {
  if (content.tags.length > 6 || content.tags.some((tag) => tag.length > 24)) {
    return "Use up to 6 tags, each no longer than 24 characters.";
  }
  if (content.agenda.some((item) => !item.title.trim() || !item.time)) {
    return "Every agenda item needs a time and title.";
  }
}

export function EventPageSettings({
  busy,
  content,
  coverUrl,
  onChange,
  onPreviewUrlChange,
  onUpload,
  theme,
}: {
  busy: boolean;
  content: EventPageContent;
  coverUrl: null | string;
  onChange: (value: {
    content: EventPageContent;
    theme: EventPageTheme;
  }) => void;
  onPreviewUrlChange: (url: null | string) => void;
  onUpload: (file: File) => Promise<void>;
  theme: EventPageTheme;
}) {
  const uploadId = useId();
  const [tagText, setTagText] = useState(content.tags.join(", "));
  const [previewUrl, setPreviewUrl] = useState(coverUrl);
  const [uploading, setUploading] = useState(false);
  const [framingOpen, setFramingOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function change(
    next: Partial<{ content: EventPageContent; theme: EventPageTheme }>,
  ) {
    onChange({ content: next.content ?? content, theme: next.theme ?? theme });
  }

  function updateAgenda(id: string, patch: Partial<EventPageAgendaItem>) {
    change({
      content: {
        ...content,
        agenda: content.agenda.map((item) =>
          item.id === id ? { ...item, ...patch } : item,
        ),
      },
    });
  }

  function updateFocal(focalX: number, focalY: number) {
    change({
      content: {
        ...content,
        cover: {
          ...content.cover,
          focalX: Math.max(0, Math.min(100, Math.round(focalX))),
          focalY: Math.max(0, Math.min(100, Math.round(focalY))),
        },
      },
    });
  }

  function dragFocal(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    updateFocal(
      ((event.clientX - bounds.left) / bounds.width) * 100,
      ((event.clientY - bounds.top) / bounds.height) * 100,
    );
  }

  function moveFocalWithKeys(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 10 : 2;
    const changes: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const changeBy = changes[event.key];
    if (!changeBy) return;
    event.preventDefault();
    updateFocal(
      content.cover.focalX + changeBy[0],
      content.cover.focalY + changeBy[1],
    );
  }

  async function upload(file: File) {
    if (!COVER_TYPES.has(file.type)) {
      setError("Choose a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > COVER_MAX_BYTES) {
      setError("Choose an image up to 5 MB.");
      return;
    }

    setError("");
    setUploading(true);
    try {
      await onUpload(file);
      const nextUrl = URL.createObjectURL(file);
      setPreviewUrl(nextUrl);
      onPreviewUrlChange(nextUrl);
      change({
        content: { ...content, cover: { ...content.cover, source: "upload" } },
      });
      setFramingOpen(true);
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : "Could not upload the cover.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className={styles.pageEditor} aria-labelledby="page-design-title">
      <div className={styles.editorHeading}>
        <div>
          <h3 id="page-design-title">Event page</h3>
          <p>Choose the public page’s cover, tags, and schedule.</p>
        </div>
      </div>

      <div className={styles.editorSection}>
        <strong>Cover</strong>
        <div className={styles.coverChoices}>
          {eventPageCovers.map((cover) => (
            <button
              aria-pressed={
                content.cover.source === "preset" && theme.cover === cover.id
              }
              data-cover={cover.id}
              disabled={busy || uploading}
              key={cover.id}
              type="button"
              onClick={() =>
                change({
                  content: {
                    ...content,
                    cover: { ...content.cover, source: "preset" },
                  },
                  theme: { ...theme, cover: cover.id },
                })
              }
            >
              <span aria-hidden="true" />
              {cover.label}
            </button>
          ))}
          <input
            accept="image/png,image/jpeg,image/webp"
            className={styles.visuallyHidden}
            disabled={busy || uploading}
            id={uploadId}
            type="file"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void upload(file);
            }}
          />
          <label
            aria-busy={uploading || undefined}
            className={styles.uploadChoice}
            data-selected={content.cover.source === "upload" ? "" : undefined}
            htmlFor={uploadId}
          >
            <ImagePlus aria-hidden="true" size={18} />
            {uploading ? "Uploading…" : "Upload"}
          </label>
        </div>

        {content.cover.source === "upload" && previewUrl ? (
          <div className={styles.coverPreviewRow}>
            <div
              aria-hidden="true"
              className={styles.coverPreview}
              style={{
                backgroundImage: `url(${previewUrl})`,
                backgroundPosition: `${content.cover.focalX}% ${content.cover.focalY}%`,
                backgroundSize: `${content.cover.zoom * 100}%`,
              }}
            />
            <Button
              disabled={busy || uploading}
              size="compact"
              variant="secondary"
              onClick={() => setFramingOpen(true)}
            >
              Edit framing
            </Button>
          </div>
        ) : null}
      </div>

      <Field description="Comma-separated, up to 6. Display only." label="Tags">
        <input
          disabled={busy || uploading}
          placeholder="Community, Workshop"
          value={tagText}
          onChange={(event) => {
            const next = event.target.value;
            setTagText(next);
            change({
              content: {
                ...content,
                tags: [
                  ...new Set(
                    next
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  ),
                ],
              },
            });
          }}
        />
      </Field>

      <div className={styles.editorSection}>
        <div className={styles.editorHeading}>
          <div>
            <strong>Program</strong>
            <p>Simple timeline shown below the event description.</p>
          </div>
          <Button
            disabled={busy || uploading}
            icon={<Plus size={14} />}
            size="compact"
            variant="secondary"
            onClick={() =>
              change({
                content: {
                  ...content,
                  agenda: [
                    ...content.agenda,
                    {
                      description: "",
                      id: crypto.randomUUID(),
                      time: "18:00",
                      title: "",
                    },
                  ],
                },
              })
            }
          >
            Add item
          </Button>
        </div>

        {content.agenda.map((item) => (
          <div className={styles.agendaEditor} key={item.id}>
            <input
              aria-label="Time"
              disabled={busy || uploading}
              type="time"
              value={item.time}
              onChange={(event) =>
                updateAgenda(item.id, { time: event.target.value })
              }
            />
            <input
              aria-label="Title"
              disabled={busy || uploading}
              maxLength={120}
              placeholder="Doors open"
              value={item.title}
              onChange={(event) =>
                updateAgenda(item.id, { title: event.target.value })
              }
            />
            <input
              aria-label="Description"
              disabled={busy || uploading}
              maxLength={240}
              placeholder="Optional note"
              value={item.description}
              onChange={(event) =>
                updateAgenda(item.id, { description: event.target.value })
              }
            />
            <button
              aria-label={`Remove ${item.title || "agenda item"}`}
              className={styles.removeAgenda}
              disabled={busy || uploading}
              type="button"
              onClick={() =>
                change({
                  content: {
                    ...content,
                    agenda: content.agenda.filter(
                      (entry) => entry.id !== item.id,
                    ),
                  },
                })
              }
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </div>
        ))}
      </div>

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      {previewUrl ? (
        <Dialog
          closeLabel="Close cover framing"
          description="Position image inside public event header. Original image stays unchanged."
          elevated
          footer={
            <DialogClose>
              <Button>Done</Button>
            </DialogClose>
          }
          open={framingOpen}
          size="compact"
          title="Cover framing"
          onOpenChange={setFramingOpen}
        >
          <div className={styles.framingDialog}>
            <div
              aria-label="Cover position. Drag image or use arrow keys."
              className={styles.framingPreview}
              role="group"
              style={{
                backgroundImage: `url(${previewUrl})`,
                backgroundPosition: `${content.cover.focalX}% ${content.cover.focalY}%`,
                backgroundSize: `${content.cover.zoom * 100}%`,
              }}
              tabIndex={0}
              onKeyDown={moveFocalWithKeys}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                dragFocal(event);
              }}
              onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  dragFocal(event);
                }
              }}
            />
            <p className={styles.help}>Drag image to position it. Arrow keys nudge it.</p>
            <Field label={`Zoom · ${Math.round(content.cover.zoom * 100)}%`}>
              <input
                max="3"
                min="1"
                step="0.01"
                type="range"
                value={content.cover.zoom}
                onChange={(event) =>
                  change({
                    content: {
                      ...content,
                      cover: { ...content.cover, zoom: Number(event.target.value) },
                    },
                  })
                }
              />
            </Field>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
