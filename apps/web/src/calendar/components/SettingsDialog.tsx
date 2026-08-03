import type {
  Settings,
  SettingsDocument,
  SettingsPatch,
} from "@musubi/types";
import {
  ExternalLink,
  LifeBuoy,
  UserRound,
} from "lucide-react";
import { useEffect, useState } from "react";
import musubiPackage from "../../../../../package.json";
import { ApiError } from "~/api/http";
import { applyTheme } from "~/design/theme";
import { Button } from "~/ui/Button";
import { Dialog } from "~/ui/Dialog";
import {
  Row,
  RowAction,
  RowOptions,
  RowToggle,
} from "~/ui/Row";
import { SettingsSection } from "~/ui/SettingsSection";
import styles from "./styles/settings.module.css";

const FEEDBACK_URL = "https://feedback.musubi.pro/";
const KOFI_URL = "https://ko-fi.com/frgtn";
const PRIVACY_URL = "https://musubi.pro/privacy/";
const TERMS_URL = "https://musubi.pro/terms/";

const THEME_OPTIONS = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] as const;

const VIEW_OPTIONS = [
  { label: "Day", value: "day" },
  { label: "Week", value: "week" },
  { label: "Month", value: "month" },
  { label: "Agenda", value: "schedule" },
] as const;

const WEEK_START_OPTIONS = [
  { label: "Sunday", value: "sunday" },
  { label: "Monday", value: "monday" },
] as const;

const TIME_FORMAT_OPTIONS = [
  { label: "24 hour", value: "24h" },
  { label: "12 hour", value: "12h" },
] as const;

const DATE_FORMAT_OPTIONS = [
  { label: "D/M/Y", value: "dmy" },
  { label: "M/D/Y", value: "mdy" },
  { label: "Y-M-D", value: "ymd" },
] as const;

type SettingsDialogProps = {
  onAdopt: (document: SettingsDocument) => void;
  onLoad: (signal?: AbortSignal) => Promise<SettingsDocument>;
  onManageAccount: () => void;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onPatch: (request: {
    baseRevision: number;
    patch: SettingsPatch;
  }) => Promise<SettingsDocument>;
  open: boolean;
};

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function openProblemReport() {
  const body = [
    `Musubi web ${musubiPackage.version}`,
    `Server: ${window.location.origin}`,
    `Browser: ${navigator.userAgent}`,
    "",
    "What happened?",
    "",
  ].join("\n");
  window.location.href = `mailto:hello@frgtn.dev?subject=${encodeURIComponent(
    "Musubi problem report",
  )}&body=${encodeURIComponent(body)}`;
}

/**
 * Our sentence, not the server's word for it. A failed write returns a machine
 * code ("server", "conflict"); showing that answers none of the four questions
 * an error has to. The request id is the part worth passing on.
 */
function withRequestId(message: string, error: unknown) {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  return requestId ? `${message} (Request ${requestId})` : message;
}

export function SettingsDialog({
  onAdopt,
  onLoad,
  onManageAccount,
  onNotice,
  onOpenChange,
  onPatch,
  open,
}: SettingsDialogProps) {
  const [settings, setSettings] = useState<SettingsDocument>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    onLoad(controller.signal)
      .then((document) => {
        if (active) {
          setError("");
          setSettings(document);
        }
      })
      .catch((loadError: unknown) => {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load settings.",
          );
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [loadAttempt, onLoad, open]);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setError("");
      setSettings(undefined);
    }
    onOpenChange(nextOpen);
  }

  function retryLoad() {
    setError("");
    setSettings(undefined);
    setLoadAttempt((attempt) => attempt + 1);
  }

  async function save(patch: SettingsPatch) {
    if (!settings || saving) return;
    const base = settings;
    setSettings({
      ...base,
      value: { ...base.value, ...patch },
    });
    if (patch.theme) applyTheme(patch.theme);
    setSaving(true);
    setError("");

    try {
      const updated = await onPatch({
        baseRevision: base.revision,
        patch,
      });
      setSettings(updated);
      onNotice("Settings saved.");
    } catch (saveError) {
      if (saveError instanceof ApiError && saveError.status === 409) {
        try {
          const current = await onLoad();
          const sameFieldChanged = Object.keys(patch).some((key) => {
            const field = key as keyof Settings;
            return !sameValue(
              base.value[field],
              current.value[field],
            );
          });

          if (!sameFieldChanged) {
            const retried = await onPatch({
              baseRevision: current.revision,
              patch,
            });
            setSettings(retried);
            onNotice("Settings merged and saved.");
            return;
          }

          setSettings(current);
          onAdopt(current);
          if (patch.theme) applyTheme(current.value.theme);
          setError(
            "This setting changed on another device. The newer server value is shown.",
          );
          return;
        } catch (refreshError) {
          setSettings(base);
          if (patch.theme) applyTheme(base.value.theme);
          setError(
            withRequestId(
              "The newer settings could not be fetched. Your change went back to its previous value — try again.",
              refreshError,
            ),
          );
          return;
        }
      }

      setSettings(base);
      if (patch.theme) applyTheme(base.value.theme);
      setError(
        withRequestId(
          "This setting could not be saved. It went back to its previous value — try again.",
          saveError,
        ),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      bodyLayout="flush"
      closeLabel="Close settings"
      description="Preferences sync across your Musubi devices."
      onOpenChange={handleOpenChange}
      open={open}
      size="spacious"
      title="Settings"
    >
      {!settings && !error ? (
        <div
          aria-live="polite"
          className={styles.loading}
          role="status"
        >
          <span aria-hidden="true" />
          <p>Loading settings…</p>
        </div>
      ) : settings ? (
        <div
          aria-busy={saving || undefined}
          className={styles.settingsContent}
        >
          <span
            className={styles.visuallyHidden}
            role="status"
          >
            {saving ? "Saving settings…" : ""}
          </span>

          <SettingsSection title="Appearance">
            <RowOptions
              disabled={saving}
              label="Theme"
              onChange={(theme) => void save({ theme })}
              options={THEME_OPTIONS}
              value={settings.value.theme}
            />
            <RowToggle
              checked={settings.value.showKanji}
              detail="Display Japanese day labels in the mini calendar"
              disabled={saving}
              label="Show kanji"
              onCheckedChange={(showKanji) => void save({ showKanji })}
            />
            <RowToggle
              checked={settings.value.tabBarLabels ?? true}
              detail="Show labels in the mobile navigation"
              disabled={saving}
              label="Tab labels"
              onCheckedChange={(tabBarLabels) =>
                void save({ tabBarLabels })
              }
            />
            <RowOptions
              disabled={saving}
              label="Default view"
              onChange={(defaultCalendarView) =>
                void save({ defaultCalendarView })
              }
              options={VIEW_OPTIONS}
              value={settings.value.defaultCalendarView}
            />
            <RowOptions
              disabled={saving}
              label="Week starts on"
              onChange={(weekStartsOn) =>
                void save({ weekStartsOn })
              }
              options={WEEK_START_OPTIONS}
              value={settings.value.weekStartsOn}
            />
            <RowOptions
              disabled={saving}
              label="Time format"
              onChange={(timeFormat) => void save({ timeFormat })}
              options={TIME_FORMAT_OPTIONS}
              value={settings.value.timeFormat}
            />
            <RowOptions
              disabled={saving}
              label="Date format"
              onChange={(dateFormat) => void save({ dateFormat })}
              options={DATE_FORMAT_OPTIONS}
              value={settings.value.dateFormat}
            />
          </SettingsSection>

          <SettingsSection
            // The setting is shared with the phone, the delivery is not: a
            // browser reminder would need a service worker and a push
            // subscription, which Musubi does not run. Saying so beats a toggle
            // that quietly does nothing where you are standing.
            description="Reminders are delivered by the Musubi app on your phone. This browser does not send them."
            title="Notifications"
          >
            <RowToggle
              checked={settings.value.notificationsOnByDefault}
              detail="New events on any device start with a reminder"
              disabled={saving}
              label="On by default"
              onCheckedChange={(notificationsOnByDefault) =>
                void save({ notificationsOnByDefault })
              }
            />
          </SettingsSection>

          <SettingsSection title="Help & About">
            <RowAction
              detail="Suggest ideas, vote, and see what is planned"
              label="Feedback & Roadmap"
              showChevron={false}
              trailing={<ExternalLink aria-hidden="true" size={15} />}
              onClick={() => openExternal(FEEDBACK_URL)}
            />
            <RowAction
              detail="Includes browser and server details"
              label="Report a Problem"
              showChevron={false}
              trailing={<LifeBuoy aria-hidden="true" size={16} />}
              onClick={openProblemReport}
            />
            <RowAction
              detail="Buy us a coffee on Ko-fi"
              label="Support Us"
              showChevron={false}
              trailing={<ExternalLink aria-hidden="true" size={15} />}
              onClick={() => openExternal(KOFI_URL)}
            />
            <RowAction
              label="Privacy Policy"
              showChevron={false}
              trailing={<ExternalLink aria-hidden="true" size={15} />}
              onClick={() => openExternal(PRIVACY_URL)}
            />
            <RowAction
              label="Terms of Service"
              showChevron={false}
              trailing={<ExternalLink aria-hidden="true" size={15} />}
              onClick={() => openExternal(TERMS_URL)}
            />
            <Row
              label="Version"
              value={musubiPackage.version}
            />
          </SettingsSection>

          <SettingsSection title="Account">
            <RowAction
              detail="Profile, avatar, and account deletion"
              icon={<UserRound size={18} strokeWidth={1.6} />}
              label="Manage account"
              onClick={onManageAccount}
            />
          </SettingsSection>

          {error ? (
            <div className={styles.error} role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.loadFailure} role="alert">
          <div>
            <strong>Settings could not be loaded.</strong>
            <p>{error}</p>
          </div>
          <Button variant="secondary" onClick={retryLoad}>
            Retry
          </Button>
        </div>
      )}
    </Dialog>
  );
}
