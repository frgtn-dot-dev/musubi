import * as Dialog from "@radix-ui/react-dialog";
import type { Calendar } from "@musubi/types";
import { Download, FileUp, X } from "lucide-react";
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
  onExport: (calendarId: string) => Promise<string>;
  onImport: (input: ImportInput) => Promise<ImportedCalendar>;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
};

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

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

export function CalendarTransferDialog({
  calendars,
  onExport,
  onImport,
  onNotice,
  onOpenChange,
  open,
}: CalendarTransferDialogProps) {
  const [exportCalendarId, setExportCalendarId] = useState(
    calendars[0]?.id ?? "",
  );
  const [importName, setImportName] = useState("");
  const [importColor, setImportColor] = useState("#7a9e7e");
  const [importFileName, setImportFileName] = useState("");
  const [ics, setIcs] = useState("");
  const [busy, setBusy] = useState<"export" | "import">();
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
              <Dialog.Title>Calendar files</Dialog.Title>
              <Dialog.Description id="calendar-transfer-description">
                Import a new calendar or download an iCalendar snapshot.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close calendar files"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

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
