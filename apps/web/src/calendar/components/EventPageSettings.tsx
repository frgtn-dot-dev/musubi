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

type PageSettingsValue = {
  content: EventPageContent;
  theme: EventPageTheme;
};

export function EventPageSettings({
  busy,
  coverUrl,
  initial,
  onSave,
  onUpload,
}: {
  busy: boolean;
  coverUrl: null | string;
  initial: PageSettingsValue;
  onSave: (value: PageSettingsValue) => Promise<void>;
  onUpload: (file: File) => Promise<void>;
}) {
  const uploadId = useId();
  const [content, setContent] = useState(initial.content);
  const [theme, setTheme] = useState(initial.theme);
  const [tagText, setTagText] = useState(initial.content.tags.join(", "));
  const [previewUrl, setPreviewUrl] = useState(coverUrl);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      if (previewUrl?.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const updateAgenda = (id: string, patch: Partial<EventPageAgendaItem>) =>
    setContent({
      ...content,
      agenda: content.agenda.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });

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
      setPreviewUrl(URL.createObjectURL(file));
      setContent({
        ...content,
        cover: { ...content.cover, source: "upload" },
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
    setContent({
      ...content,
      cover: {
        ...content.cover,
        focalX: Math.round(
          ((event.clientX - bounds.left) / bounds.width) * 100,
        ),
        focalY: Math.round(
          ((event.clientY - bounds.top) / bounds.height) * 100,
        ),
      },
    });
  }

  async function save() {
    const tags = [
      ...new Set(
        tagText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    ];
    if (tags.length > 6 || tags.some((tag) => tag.length > 24)) {
      setError("Use up to 6 tags, each no longer than 24 characters.");
      return;
    }
    if (content.agenda.some((item) => !item.title.trim() || !item.time)) {
      setError("Every agenda item needs a time and title.");
      return;
    }

    setError("");
    const next = { ...content, tags };
    setContent(next);
    try {
      await onSave({ content: next, theme });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save the event page.",
      );
    }
  }

  return (
    <section className={styles.pageEditor} aria-labelledby="page-design-title">
      <div className={styles.editorHeading}>
        <div>
          <h3 id="page-design-title">Event page</h3>
          <p>Choose the public page’s cover, tags, and schedule.</p>
        </div>
        <Button
          disabled={busy || uploading}
          loading={busy}
          size="compact"
          onClick={() => void save()}
        >
          Save page
        </Button>
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
              key={cover.id}
              type="button"
              onClick={() => {
                setTheme({ ...theme, cover: cover.id });
                setContent({
                  ...content,
                  cover: { ...content.cover, source: "preset" },
                });
              }}
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
            <p className={styles.help}>
              Click the important point. Musubi keeps it visible on desktop and
              mobile.
            </p>
          </>
        ) : null}
      </div>

      <Field description="Comma-separated, up to 6. Display only." label="Tags">
        <input
          placeholder="Community, Workshop"
          value={tagText}
          onChange={(event) => setTagText(event.target.value)}
        />
      </Field>

      <div className={styles.editorSection}>
        <div className={styles.editorHeading}>
          <div>
            <strong>Program</strong>
            <p>Simple timeline shown below the event description.</p>
          </div>
          <Button
            icon={<Plus size={14} />}
            size="compact"
            variant="secondary"
            onClick={() =>
              setContent({
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
              type="time"
              value={item.time}
              onChange={(event) =>
                updateAgenda(item.id, { time: event.target.value })
              }
            />
            <input
              aria-label="Title"
              maxLength={120}
              placeholder="Doors open"
              value={item.title}
              onChange={(event) =>
                updateAgenda(item.id, { title: event.target.value })
              }
            />
            <input
              aria-label="Description"
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
              type="button"
              onClick={() =>
                setContent({
                  ...content,
                  agenda: content.agenda.filter(
                    (entry) => entry.id !== item.id,
                  ),
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
    </section>
  );
}
