import { eventPageCovers } from "@musubi/design-system";
import type {
  EventPageAgendaItem,
  EventPageContent,
  EventPageTheme,
} from "@musubi/types";
import { ImagePlus, Plus, Trash2 } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { Button, buttonClassName, IconButton } from "~/ui/Button";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import styles from "./styles/share-event.module.css";

const COVER_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const HERO_ASPECT = 16 / 6;

type Crop = { height: number; width: number; x: number; y: number };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cropForCover(
  cover: EventPageContent["cover"],
  imageAspect: number,
): Crop {
  const width = Math.min(1 / cover.zoom, 1, HERO_ASPECT / imageAspect);
  const height = (width * imageAspect) / HERO_ASPECT;
  return {
    height,
    width,
    x: ((1 - width) * cover.focalX) / 100,
    y: ((1 - height) * cover.focalY) / 100,
  };
}

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
  const [imageAspect, setImageAspect] = useState(HERO_ASPECT);
  const imageRef = useRef<HTMLImageElement>(null);
  const drag = useRef<
    { mode: "move" | "resize"; offsetX: number; offsetY: number } | undefined
  >(undefined);
  const cropDraft = useRef<Crop | undefined>(undefined);
  const [cropFrame, setCropFrame] = useState<Crop>();
  const [error, setError] = useState("");
  const crop = cropFrame ?? cropForCover(content.cover, imageAspect);

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

  function normalizeCrop(next: Crop): Crop {
    const maxWidth = Math.min(1, HERO_ASPECT / imageAspect);
    const width = clamp(next.width, 1 / 3, maxWidth);
    const height = (width * imageAspect) / HERO_ASPECT;
    return {
      height,
      width,
      x: clamp(next.x, 0, 1 - width),
      y: clamp(next.y, 0, 1 - height),
    };
  }

  function updateCrop(next: Crop) {
    const { height, width, x, y } = normalizeCrop(next);
    change({
      content: {
        ...content,
        cover: {
          ...content.cover,
          focalX: width === 1 ? 50 : (x / (1 - width)) * 100,
          focalY: height === 1 ? 50 : (y / (1 - height)) * 100,
          zoom: 1 / width,
        },
      },
    });
  }

  function previewCrop(next: Crop) {
    const normalized = normalizeCrop(next);
    cropDraft.current = normalized;
    setCropFrame(normalized);
  }

  function commitCrop() {
    const next = cropDraft.current;
    cropDraft.current = undefined;
    setCropFrame(undefined);
    if (next) updateCrop(next);
  }

  function endCrop() {
    if (!drag.current) return;
    drag.current = undefined;
    commitCrop();
  }

  function imagePosition(event: PointerEvent<HTMLElement>) {
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!bounds) return;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }

  function moveCrop(event: PointerEvent<HTMLElement>) {
    const position = imagePosition(event);
    const action = drag.current;
    if (!position || !action) return;
    const activeCrop = cropDraft.current ?? crop;
    if (action.mode === "resize") {
      previewCrop({ ...activeCrop, width: position.x - activeCrop.x });
      return;
    }
    previewCrop({
      ...activeCrop,
      x: position.x - action.offsetX,
      y: position.y - action.offsetY,
    });
  }

  function nudgeCrop(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 0.1 : 0.02;
    const changes: Record<string, [number, number]> = {
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
    };
    const changeBy = changes[event.key];
    if (!changeBy) return;
    event.preventDefault();
    updateCrop({
      ...crop,
      x: crop.x + changeBy[0],
      y: crop.y + changeBy[1],
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
          {content.cover.source === "upload" && previewUrl ? (
            <button
              aria-label="Edit uploaded cover framing"
              className={styles.uploadChoice}
              data-selected=""
              disabled={busy || uploading}
              type="button"
              onClick={() => setFramingOpen(true)}
            >
              <span
                aria-hidden="true"
                className={styles.uploadPreview}
                style={{
                  backgroundImage: `url(${previewUrl})`,
                  backgroundPosition: `${content.cover.focalX}% ${content.cover.focalY}%`,
                  backgroundSize: `${content.cover.zoom * 100}%`,
                }}
              />
              Upload
            </button>
          ) : (
            <label
              aria-busy={uploading || undefined}
              className={styles.uploadChoice}
              htmlFor={uploadId}
            >
              <ImagePlus aria-hidden="true" size={18} />
              {uploading ? "Uploading…" : "Upload"}
            </label>
          )}
        </div>
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
            <IconButton
              className={styles.removeAgenda}
              disabled={busy || uploading}
              label={`Remove ${item.title || "agenda item"}`}
              size="compact"
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
              <Trash2 size={15} />
            </IconButton>
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
          description="Move frame to choose visible area; drag corner to zoom. Original image stays unchanged."
          elevated
          footer={
            <div className={styles.framingFooter}>
              <label
                aria-disabled={busy || uploading || undefined}
                className={buttonClassName({
                  size: "compact",
                  variant: "secondary",
                })}
                htmlFor={busy || uploading ? undefined : uploadId}
              >
                Change file
              </label>
              <DialogClose>
                <Button>Done</Button>
              </DialogClose>
            </div>
          }
          open={framingOpen}
          size="compact"
          title="Cover framing"
          onOpenChange={setFramingOpen}
        >
          <div className={styles.framingDialog}>
            <div className={styles.cropStage}>
              <img
                alt=""
                className={styles.cropImage}
                ref={imageRef}
                src={previewUrl}
                onLoad={(event) => {
                  cropDraft.current = undefined;
                  setCropFrame(undefined);
                  setImageAspect(
                    event.currentTarget.naturalWidth /
                      event.currentTarget.naturalHeight,
                  );
                }}
              />
              <div
                aria-label="Crop area. Drag to move; use arrow keys to nudge."
                className={styles.cropFrame}
                role="group"
                style={{
                  height: `${crop.height * 100}%`,
                  left: `${crop.x * 100}%`,
                  top: `${crop.y * 100}%`,
                  width: `${crop.width * 100}%`,
                }}
                tabIndex={0}
                onKeyDown={nudgeCrop}
                onPointerDown={(event) => {
                  const position = imagePosition(event);
                  if (!position) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  drag.current = {
                    mode: "move",
                    offsetX: position.x - crop.x,
                    offsetY: position.y - crop.y,
                  };
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId))
                    moveCrop(event);
                }}
                onPointerCancel={endCrop}
                onPointerUp={endCrop}
              >
                <span
                  aria-hidden="true"
                  className={styles.cropHandle}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { mode: "resize", offsetX: 0, offsetY: 0 };
                  }}
                  onPointerMove={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      moveCrop(event);
                  }}
                  onPointerCancel={endCrop}
                  onPointerUp={endCrop}
                />
              </div>
            </div>
            <p className={styles.help}>
              Move frame to choose visible area. Drag corner to zoom.
            </p>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}
