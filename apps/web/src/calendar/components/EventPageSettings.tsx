import { eventPageCovers } from "@musubi/design-system";
import type {
  EventPageAgendaItem,
  EventPageContent,
  EventPageTheme,
} from "@musubi/types";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import { useEffect, useId, useState, type PointerEvent } from "react";
import { Button } from "~/ui/Button";
import { Field } from "~/ui/Field";
import styles from "./styles/share-event.module.css";

const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COVER_MAX_BYTES = 5 * 1024 * 1024;

export function validateEventPageContent(content: EventPageContent): string | undefined {
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
  onChange: (value: { content: EventPageContent; theme: EventPageTheme }) => void;
  onPreviewUrlChange: (url: null | string) => void;
  onUpload: (file: File) => Promise<void>;
  theme: EventPageTheme;
}) {
  const uploadId = useId();
  const [tagText, setTagText] = useState(content.tags.join(", "));
  const [previewUrl, setPreviewUrl] = useState(coverUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function change(next: Partial<{ content: EventPageContent; theme: EventPageTheme }>) {
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

  function chooseFocalPoint(event: PointerEvent<HTMLButtonElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    change({
      content: {
        ...content,
        cover: {
          ...content.cover,
          focalX: Math.round(((event.clientX - bounds.left) / bounds.width) * 100),
          focalY: Math.round(((event.clientY - bounds.top) / bounds.height) * 100),
        },
      },
    });
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
                  content: { ...content, cover: { ...content.cover, source: "preset" } },
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
          <>
            <button
              aria-label="Choose the important point of the cover image"
              className={styles.focalPreview}
              style={{
                backgroundImage: `url(${previewUrl})`,
                backgroundPosition: `${content.cover.focalX}% ${content.cover.focalY}%`,
              }}
              type="button"
              onPointerDown={chooseFocalPoint}
            >
              <span
                aria-hidden="true"
                style={{
                  left: `${content.cover.focalX}%`,
                  top: `${content.cover.focalY}%`,
                }}
              />
            </button>
            <p className={styles.help}>Click the important point.</p>
          </>
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
                tags: [...new Set(next.split(",").map((tag) => tag.trim()).filter(Boolean))],
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
                    { description: "", id: crypto.randomUUID(), time: "18:00", title: "" },
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
              onChange={(event) => updateAgenda(item.id, { time: event.target.value })}
            />
            <input
              aria-label="Title"
              disabled={busy || uploading}
              maxLength={120}
              placeholder="Doors open"
              value={item.title}
              onChange={(event) => updateAgenda(item.id, { title: event.target.value })}
            />
            <input
              aria-label="Description"
              disabled={busy || uploading}
              maxLength={240}
              placeholder="Optional note"
              value={item.description}
              onChange={(event) => updateAgenda(item.id, { description: event.target.value })}
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
                    agenda: content.agenda.filter((entry) => entry.id !== item.id),
                  },
                })
              }
            >
              <Trash2 aria-hidden="true" size={15} />
            </button>
          </div>
        ))}
      </div>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
