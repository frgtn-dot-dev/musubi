import type {
  Calendar,
  CreatePageRequest,
  PageConfigV1,
  PageDocument,
  PageIcon,
} from "@musubi/types";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "~/ui/Button";
import { Checkbox } from "~/ui/Checkbox";
import { Dialog, DialogClose } from "~/ui/Dialog";
import { Field } from "~/ui/Field";
import { Row } from "~/ui/Row";
import { SectionLabel } from "~/ui/SectionLabel";
import { Select } from "~/ui/Select";
import type { Notify } from "../notice";
import {
  calendarIdsForVisibility,
  toggleCalendarVisibility,
  visibilityEquals,
  type SavePageResult,
} from "../page-editor";
import {
  pageIconChoices,
  pageIconComponent,
  resolvePageIcon,
} from "../page-icons";
import type { Density } from "../time-geometry";
import { CalendarVisibilityRow } from "./CalendarVisibilityRow";
import styles from "./styles/page-settings.module.css";

const DENSITY_OPTIONS = [
  { label: "Compact", value: "compact" },
  { label: "Comfortable", value: "comfortable" },
  { label: "Spacious", value: "spacious" },
] as const;

type PageSettingsDialogProps = {
  calendars: Calendar[];
  /** False for the last remaining page: the server would just backfill it. */
  canDelete: boolean;
  onCreatePage: (request: CreatePageRequest) => Promise<PageDocument>;
  onDeletePage: (id: string) => Promise<unknown>;
  onNotice: Notify;
  onOpenChange: (open: boolean) => void;
  onSavePage: (input: {
    baseRevision: number;
    config: PageConfigV1;
    id: string;
    name: string;
  }) => Promise<SavePageResult>;
  /** Follow a page created from a conflicting draft. */
  onOpenPage: (pageId: string) => void;
  page: PageDocument;
};

/**
 * Everything a Page is, in one explicit editor: name, icon, how its view is
 * presented and which calendars it shows.
 *
 * Mounted only while open and keyed on the page, so the draft — including the
 * revision it is based on — is set up once from the page it opened on. A
 * realtime update from another session bumps the cached Page underneath;
 * saving against the frozen base then returns 409 rather than overwriting it.
 */
export function PageSettingsDialog({
  calendars,
  canDelete,
  onCreatePage,
  onDeletePage,
  onNotice,
  onOpenChange,
  onOpenPage,
  onSavePage,
  page,
}: PageSettingsDialogProps) {
  const [name, setName] = useState(page.name);
  const [icon, setIcon] = useState<PageIcon>(
    resolvePageIcon(page.config.icon, page.isDefault),
  );
  const [view, setView] = useState<PageConfigV1["view"]>(page.config.view);
  const [visibility, setVisibility] = useState(page.config.calendarVisibility);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const trimmedName = name.trim();
  const dirty =
    trimmedName !== page.name ||
    icon !== resolvePageIcon(page.config.icon, page.isDefault) ||
    JSON.stringify(view) !== JSON.stringify(page.config.view) ||
    !visibilityEquals(visibility, page.config.calendarVisibility);
  const canSave = Boolean(trimmedName) && dirty && !busy;
  const visibleCalendarIds = calendarIdsForVisibility(visibility, calendars);

  const draftConfig = (): PageConfigV1 => ({
    ...page.config,
    calendarVisibility: visibility,
    icon,
    view,
  });

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // Ctrl/Cmd+S saves, as it did in the old inline editor. The dialog traps
  // focus, so it is the only thing that can own the shortcut while open.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "s" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      void save();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function requestClose(nextOpen: boolean) {
    if (nextOpen) return;
    if (dirty && !window.confirm("Discard your unsaved page changes?")) {
      return;
    }
    onOpenChange(false);
  }

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    setConflict(false);
    try {
      const result = await onSavePage({
        baseRevision: page.revision,
        config: draftConfig(),
        id: page.id,
        name: trimmedName,
      });
      if (result.status === "conflict") {
        setConflict(true);
        return;
      }
      onNotice("Page saved.");
      onOpenChange(false);
    } catch {
      setError("This page could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsCopy() {
    setBusy(true);
    setError("");
    try {
      const created = await onCreatePage({
        config: draftConfig(),
        name: `${trimmedName || page.name} copy`,
      });
      onNotice("Saved as a new page.");
      onOpenChange(false);
      onOpenPage(created.id);
    } catch {
      setError("The new page could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    // Soft-deleted server-side with no restore endpoint, so an Undo toast would
    // be a promise we can't keep — this delete earns its confirm.
    if (!window.confirm(`Delete "${page.name}"? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onDeletePage(page.id);
      // Closing is the feedback, together with the row leaving the sidebar: the
      // route sends the calendar to the default page if this was the open one.
      onOpenChange(false);
    } catch {
      setError("This page could not be deleted.");
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save();
  }

  return (
    <Dialog
      closeLabel="Close page settings"
      description="Applies to this page only, on every device."
      footer={
        conflict ? (
          <>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              Discard my changes
            </Button>
            <Button loading={busy} onClick={() => void saveAsCopy()}>
              Save as a copy
            </Button>
          </>
        ) : (
          <>
            <DialogClose>
              <Button disabled={busy} variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              disabled={!canSave}
              form="page-settings-form"
              loading={busy}
              type="submit"
            >
              Save
            </Button>
          </>
        )
      }
      initialFocus={nameRef}
      onOpenChange={requestClose}
      open
      size="wide"
      title="Page settings"
    >
      <form
        className={styles.form}
        id="page-settings-form"
        onSubmit={handleSubmit}
      >
        {conflict ? (
          <div className={styles.conflict} role="alert">
            <AlertTriangle aria-hidden="true" size={18} strokeWidth={1.6} />
            <div>
              <strong>This page changed on another device</strong>
              <p>
                Your edits weren’t saved. Keep them as a new page, or discard
                them and use the latest version.
              </p>
            </div>
          </div>
        ) : null}

        <Field label="Page name">
          <input
            disabled={busy}
            maxLength={80}
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>

        <IconField
          disabled={busy}
          name="page-settings-icon"
          value={icon}
          onChange={setIcon}
        />

        <section className={styles.section}>
          <SectionLabel className={styles.sectionHeading} level={3}>
            Presentation
          </SectionLabel>
          <div className={styles.sectionRows}>
            {"density" in view ? (
              <Row
                label="Row height"
                detail="How tall an hour is in the day and week grids"
                trailing={
                  <Select
                    disabled={busy}
                    label="Row height"
                    options={DENSITY_OPTIONS}
                    size="compact"
                    value={view.density}
                    onChange={(value) =>
                      setView((current) =>
                        "density" in current
                          ? { ...current, density: value as Density }
                          : current,
                      )
                    }
                  />
                }
              />
            ) : null}
            {"weekend" in view ? (
              <Row
                label="Weekend"
                detail="Show Saturday and Sunday columns"
                trailing={
                  <Checkbox
                    checked={view.weekend}
                    disabled={busy}
                    label="Weekend"
                    labelHidden
                    onChange={(event) =>
                      setView((current) =>
                        "weekend" in current
                          ? { ...current, weekend: event.target.checked }
                          : current,
                      )
                    }
                  />
                }
              />
            ) : null}
            {"showAdjacentDays" in view ? (
              <Row
                label="Nearby months"
                detail="Fill the month grid with neighbouring days"
                trailing={
                  <Checkbox
                    checked={view.showAdjacentDays}
                    disabled={busy}
                    label="Nearby months"
                    labelHidden
                    onChange={(event) =>
                      setView((current) =>
                        "showAdjacentDays" in current
                          ? {
                              ...current,
                              showAdjacentDays: event.target.checked,
                            }
                          : current,
                      )
                    }
                  />
                }
              />
            ) : null}
          </div>
        </section>

        <section className={styles.section}>
          <SectionLabel className={styles.sectionHeading} level={3}>
            Visible calendars
          </SectionLabel>
          <div className={styles.sectionRows}>
            {calendars.map((calendar) => (
              <CalendarVisibilityRow
                calendar={calendar}
                key={calendar.id}
                visible={visibleCalendarIds.includes(calendar.id)}
                onVisibleChange={() =>
                  setVisibility((current) =>
                    toggleCalendarVisibility(current, calendar.id, calendars),
                  )
                }
              />
            ))}
          </div>
        </section>

        {canDelete ? (
          <div className={styles.danger}>
            <Button
              disabled={busy}
              icon={<Trash2 aria-hidden="true" size={16} strokeWidth={1.7} />}
              size="compact"
              variant="secondary"
              onClick={() => void remove()}
            >
              Delete page
            </Button>
          </div>
        ) : null}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/**
 * Native radios in a grid: arrow-key movement, the checked state and a real
 * accessible name all come from the platform, so there is no roving tabindex or
 * `aria-selected` bookkeeping to get wrong.
 */
function IconField({
  disabled,
  name,
  onChange,
  value,
}: {
  disabled: boolean;
  /** Radio group name — unique per dialog, so two open forms never merge. */
  name: string;
  onChange: (icon: PageIcon) => void;
  value: PageIcon;
}) {
  return (
    <fieldset className={styles.icons} disabled={disabled}>
      <legend className={styles.iconsLegend}>Icon</legend>
      <div className={styles.iconGrid}>
        {pageIconChoices.map((choice) => {
          const Icon = pageIconComponent(choice.icon);

          return (
            <label
              className={styles.iconChoice}
              key={choice.icon}
              title={choice.label}
            >
              <input
                checked={value === choice.icon}
                className={styles.iconInput}
                name={name}
                type="radio"
                value={choice.icon}
                onChange={() => onChange(choice.icon)}
              />
              <span aria-hidden="true" className={styles.iconGlyph}>
                <Icon size={19} strokeWidth={1.6} />
              </span>
              <span className={styles.visuallyHidden}>{choice.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * Creating a page asks only what the page cannot be born without: a name and an
 * icon. Everything else it inherits from the view it was created in, and the
 * settings dialog is one click away for the rest.
 */
export function NewPageDialog({
  onCreate,
  onOpenChange,
}: {
  onCreate: (input: { icon: PageIcon; name: string }) => Promise<void>;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<PageIcon>("calendar-days");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const trimmedName = name.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName || busy) return;
    setBusy(true);
    setError("");
    try {
      await onCreate({ icon, name: trimmedName });
      onOpenChange(false);
    } catch {
      setError("The new page could not be created.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      closeLabel="Close new page"
      description="It starts from the calendars you can see right now."
      footer={
        <>
          <DialogClose>
            <Button disabled={busy} variant="secondary">
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={!trimmedName || busy}
            form="new-page-form"
            loading={busy}
            type="submit"
          >
            Create page
          </Button>
        </>
      }
      initialFocus={nameRef}
      onOpenChange={onOpenChange}
      open
      size="compact"
      title="New page"
    >
      <form
        className={styles.form}
        id="new-page-form"
        onSubmit={(event) => void submit(event)}
      >
        <Field label="Page name">
          <input
            disabled={busy}
            maxLength={80}
            placeholder="Work, Family, Training…"
            ref={nameRef}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Field>
        <IconField
          disabled={busy}
          name="new-page-icon"
          value={icon}
          onChange={setIcon}
        />
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
