import * as Dialog from "@radix-ui/react-dialog";
import {
  can,
  providerDisplayName,
  type Calendar,
} from "@musubi/types";
import { Check, Download, FileUp, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  useState,
} from "react";
import type { ImportedCalendar } from "~/api/contracts";
import { ApiError, ApiResponseError } from "~/api/http";
import styles from "./workspace.module.css";

type ImportInput = {
  color: string;
  ics: string;
  name: string;
};

type CalendarTransferDialogProps = {
  calendars: Calendar[];
  onCreate: (input: { color: string; name: string }) => Promise<Calendar>;
  onExport: (calendarId: string) => Promise<string>;
  onImport: (input: ImportInput) => Promise<ImportedCalendar>;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onRemove: (calendar: Calendar) => Promise<Calendar>;
  onUpdate: (calendar: Calendar) => Promise<Calendar>;
  open: boolean;
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const DEFAULT_COLOR = "#7a9e7e";

function transferError(error: unknown, fallback: string) {
  return {
    message: error instanceof Error ? error.message : fallback,
    requestId:
      error instanceof ApiError || error instanceof ApiResponseError
        ? error.requestId
        : undefined,
  };
}

function exportFilename(calendar: Calendar) {
  return `${calendar.name.replace(/[^\w.-]+/g, "_") || "calendar"}.ics`;
}

type EditDraft = { color: string; id: string; name: string };

export function CalendarTransferDialog({
  calendars,
  onCreate,
  onExport,
  onImport,
  onNotice,
  onOpenChange,
  onRemove,
  onUpdate,
  open,
}: CalendarTransferDialogProps) {
  const [exportCalendarId, setExportCalendarId] = useState(
    calendars[0]?.id ?? "",
  );
  const [importName, setImportName] = useState("");
  const [importColor, setImportColor] = useState(DEFAULT_COLOR);
  const [importFileName, setImportFileName] = useState("");
  const [ics, setIcs] = useState("");
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [edit, setEdit] = useState<EditDraft>();
  const [busy, setBusy] = useState<
    "export" | "import" | "create" | "save" | "delete"
  >();
  const [error, setError] = useState<{
    message: string;
    requestId?: string;
  }>();

  async function handleFile(changeEvent: ChangeEvent<HTMLInputElement>) {
    const file = changeEvent.target.files?.[0];
    setError(undefined);

    if (!file) {
      setIcs("");
      setImportFileName("");
      return;
    }

    if (file.size > MAX_IMPORT_BYTES) {
      setError({ message: "Choose an .ics file smaller than 10 MB." });
      changeEvent.target.value = "";
      return;
    }

    const text = await file.text();
    setIcs(text);
    setImportFileName(file.name);
    if (!importName) {
      setImportName(file.name.replace(/\.ics$/i, ""));
    }
  }

  async function handleCreate(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!newName.trim()) {
      setError({ message: "Name the new calendar." });
      return;
    }
    setBusy("create");
    setError(undefined);
    try {
      const calendar = await onCreate({
        color: newColor,
        name: newName.trim(),
      });
      onNotice(`${calendar.name} created.`);
      setNewName("");
      setNewColor(DEFAULT_COLOR);
    } catch (createError) {
      setError(transferError(createError, "Could not create the calendar."));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleSaveEdit() {
    if (!edit) return;
    const source = calendars.find((item) => item.id === edit.id);
    if (!source || !edit.name.trim()) {
      setError({ message: "Give the calendar a name." });
      return;
    }
    setBusy("save");
    setError(undefined);
    try {
      await onUpdate({ ...source, color: edit.color, name: edit.name.trim() });
      onNotice("Calendar updated.");
      setEdit(undefined);
    } catch (saveError) {
      setError(transferError(saveError, "Could not update the calendar."));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleDelete(calendar: Calendar) {
    if (
      !window.confirm(
        `Delete “${calendar.name}” and all of its events? This can’t be undone.`,
      )
    ) {
      return;
    }
    setBusy("delete");
    setError(undefined);
    try {
      await onRemove(calendar);
      onNotice(`${calendar.name} deleted.`);
      if (exportCalendarId === calendar.id) setExportCalendarId("");
    } catch (deleteError) {
      setError(transferError(deleteError, "Could not delete the calendar."));
    } finally {
      setBusy(undefined);
    }
  }

  async function handleImport(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!ics.trim() || !importName.trim()) {
      setError({ message: "Choose an .ics file and calendar name." });
      return;
    }

    setBusy("import");
    setError(undefined);
    try {
      const calendar = await onImport({
        color: importColor,
        ics,
        name: importName.trim(),
      });
      onNotice(
        `Imported ${calendar.imported} event${
          calendar.imported === 1 ? "" : "s"
        } into ${calendar.name}.`,
      );
      onOpenChange(false);
    } catch (importError) {
      setError(
        transferError(importError, "Could not import this calendar."),
      );
    } finally {
      setBusy(undefined);
    }
  }

  async function handleExport() {
    const calendar = calendars.find(
      (item) => item.id === exportCalendarId,
    );
    if (!calendar) return;

    setBusy("export");
    setError(undefined);
    try {
      const text = await onExport(calendar.id);
      const url = URL.createObjectURL(
        new Blob([text], { type: "text/calendar;charset=utf-8" }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = exportFilename(calendar);
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      onNotice(`${calendar.name} exported.`);
    } catch (exportError) {
      setError(
        transferError(exportError, "Could not export this calendar."),
      );
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="calendar-transfer-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Calendars</Dialog.Title>
              <Dialog.Description id="calendar-transfer-description">
                Create, rename and remove calendars, or move them as .ics files.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close calendars"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <div>
                <h3>Your calendars</h3>
                <p>Owners can rename, recolor or delete native calendars.</p>
              </div>
            </div>
            <ul className={styles.calendarManageList}>
              {calendars.map((calendar) => {
                const external = Boolean(calendar.provider);
                const editable =
                  !external && can(calendar.role, "editCalendar");
                const deletable =
                  editable &&
                  !calendar.isDefault &&
                  can(calendar.role, "deleteCalendar");
                const isEditing = edit?.id === calendar.id;

                if (isEditing) {
                  return (
                    <li className={styles.calendarManageRow} key={calendar.id}>
                      <input
                        aria-label={`Rename ${calendar.name}`}
                        className={styles.calendarManageName}
                        disabled={busy === "save"}
                        value={edit.name}
                        onChange={(event) =>
                          setEdit({ ...edit, name: event.target.value })
                        }
                      />
                      <label className={styles.colorPicker}>
                        <span className={styles.srOnly}>
                          {calendar.name} color
                        </span>
                        <input
                          disabled={busy === "save"}
                          type="color"
                          value={edit.color}
                          onChange={(event) =>
                            setEdit({ ...edit, color: event.target.value })
                          }
                        />
                      </label>
                      <button
                        aria-label="Save calendar"
                        className={styles.iconButton}
                        disabled={busy === "save"}
                        type="button"
                        onClick={() => void handleSaveEdit()}
                      >
                        <Check aria-hidden="true" size={16} />
                      </button>
                      <button
                        aria-label="Cancel"
                        className={styles.iconButton}
                        disabled={busy === "save"}
                        type="button"
                        onClick={() => setEdit(undefined)}
                      >
                        <X aria-hidden="true" size={16} />
                      </button>
                    </li>
                  );
                }

                return (
                  <li className={styles.calendarManageRow} key={calendar.id}>
                    <span
                      className={styles.calendarDot}
                      style={{ backgroundColor: calendar.color }}
                    />
                    <span className={styles.calendarManageName}>
                      {calendar.name}
                    </span>
                    {calendar.isDefault ? (
                      <span className={styles.calendarBadge}>Personal</span>
                    ) : null}
                    {external ? (
                      <span className={styles.calendarBadge}>
                        {providerDisplayName(calendar)}
                      </span>
                    ) : null}
                    {editable ? (
                      <button
                        aria-label={`Rename ${calendar.name}`}
                        className={styles.iconButton}
                        disabled={Boolean(busy)}
                        type="button"
                        onClick={() =>
                          setEdit({
                            color: calendar.color,
                            id: calendar.id,
                            name: calendar.name,
                          })
                        }
                      >
                        <Pencil aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                    {deletable ? (
                      <button
                        aria-label={`Delete ${calendar.name}`}
                        className={styles.iconButton}
                        disabled={Boolean(busy)}
                        type="button"
                        onClick={() => void handleDelete(calendar)}
                      >
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <form className={styles.transferControls} onSubmit={handleCreate}>
              <label>
                <span className={styles.srOnly}>New calendar name</span>
                <input
                  disabled={busy === "create"}
                  placeholder="New calendar"
                  value={newName}
                  onChange={(event) => setNewName(event.target.value)}
                />
              </label>
              <label className={styles.colorPicker}>
                <span className={styles.srOnly}>New calendar color</span>
                <input
                  disabled={busy === "create"}
                  type="color"
                  value={newColor}
                  onChange={(event) => setNewColor(event.target.value)}
                />
              </label>
              <button
                className={styles.primaryButton}
                disabled={busy === "create"}
                type="submit"
              >
                <Plus aria-hidden="true" size={16} />
                <span>{busy === "create" ? "Creating…" : "Add"}</span>
              </button>
            </form>
          </section>

          <section className={styles.transferSection}>
            <div className={styles.transferHeading}>
              <Download aria-hidden="true" size={17} />
              <div>
                <h3>Export</h3>
                <p>Downloads the calendar and its events as an .ics file.</p>
              </div>
            </div>
            <div className={styles.transferControls}>
              <label>
                <span className={styles.srOnly}>Calendar to export</span>
                <select
                  disabled={Boolean(busy)}
                  value={exportCalendarId}
                  onChange={(event) =>
                    setExportCalendarId(event.target.value)
                  }
                >
                  <option value="">Choose a calendar</option>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={styles.secondaryButton}
                disabled={!exportCalendarId || Boolean(busy)}
                type="button"
                onClick={() => void handleExport()}
              >
                {busy === "export" ? "Exporting…" : "Export .ics"}
              </button>
            </div>
          </section>

          <form className={styles.transferSection} onSubmit={handleImport}>
            <div className={styles.transferHeading}>
              <FileUp aria-hidden="true" size={17} />
              <div>
                <h3>Import</h3>
                <p>Creates a new native calendar from an .ics file.</p>
              </div>
            </div>
            <label className={styles.filePicker}>
              <span>{importFileName || "Choose .ics file"}</span>
              <input
                accept=".ics,text/calendar"
                disabled={Boolean(busy)}
                required
                type="file"
                onChange={(event) => void handleFile(event)}
              />
            </label>
            <div className={styles.transferControls}>
              <label>
                <span className={styles.srOnly}>Imported calendar name</span>
                <input
                  disabled={Boolean(busy)}
                  placeholder="Calendar name"
                  required
                  value={importName}
                  onChange={(event) => setImportName(event.target.value)}
                />
              </label>
              <label className={styles.colorPicker}>
                <span className={styles.srOnly}>Imported calendar color</span>
                <input
                  disabled={Boolean(busy)}
                  type="color"
                  value={importColor}
                  onChange={(event) => setImportColor(event.target.value)}
                />
              </label>
              <button
                className={styles.primaryButton}
                disabled={Boolean(busy)}
                type="submit"
              >
                {busy === "import" ? "Importing…" : "Import"}
              </button>
            </div>
          </form>

          {error ? (
            <div className={styles.formError} role="alert">
              <p>{error.message}</p>
              {error.requestId ? (
                <span>Request {error.requestId}</span>
              ) : null}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
