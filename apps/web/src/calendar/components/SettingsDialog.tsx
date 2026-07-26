import * as Dialog from "@radix-ui/react-dialog";
import type {
  Settings,
  SettingsDocument,
  SettingsPatch,
} from "@musubi/types";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "~/api/http";
import styles from "./workspace.module.css";

type SettingsDialogProps = {
  onAdopt: (document: SettingsDocument) => void;
  onLoad: (signal?: AbortSignal) => Promise<SettingsDocument>;
  onNotice: (message: string) => void;
  onOpenChange: (open: boolean) => void;
  onPatch: (request: {
    baseRevision: number;
    patch: SettingsPatch;
  }) => Promise<SettingsDocument>;
  open: boolean;
};

function applyTheme(theme: Settings["theme"]) {
  localStorage.setItem("musubi-theme", theme);
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(new Event("musubi-theme-change"));
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function SettingsDialog({
  onAdopt,
  onLoad,
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

  async function save(patch: SettingsPatch) {
    if (!settings || saving) return;
    const base = settings;
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
          setError(
            refreshError instanceof Error
              ? refreshError.message
              : "Could not refresh conflicting settings.",
          );
          return;
        }
      }

      if (patch.theme) applyTheme(base.value.theme);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "This setting could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.dialogOverlay} />
        <Dialog.Content
          aria-describedby="settings-description"
          className={styles.manageDialog}
        >
          <header className={styles.manageDialogHeader}>
            <div>
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Description id="settings-description">
                Preferences sync across your Musubi devices.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label="Close settings"
                className={styles.iconButton}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </Dialog.Close>
          </header>

          {!settings && !error ? (
            <p className={styles.dialogLoading}>Loading settings…</p>
          ) : settings ? (
            <div className={styles.settingsList}>
              <SettingSelect
                disabled={saving}
                label="Theme"
                value={settings.value.theme}
                options={[
                  ["system", "System"],
                  ["light", "Light"],
                  ["dark", "Dark"],
                ]}
                onChange={(theme) =>
                  void save({ theme: theme as Settings["theme"] })
                }
              />
              <SettingSelect
                disabled={saving}
                label="Time format"
                value={settings.value.timeFormat}
                options={[
                  ["24h", "24 hour"],
                  ["12h", "12 hour"],
                ]}
                onChange={(timeFormat) =>
                  void save({
                    timeFormat: timeFormat as Settings["timeFormat"],
                  })
                }
              />
              <SettingSelect
                disabled={saving}
                label="Date format"
                value={settings.value.dateFormat}
                options={[
                  ["dmy", "Day / month / year"],
                  ["mdy", "Month / day / year"],
                  ["ymd", "Year / month / day"],
                ]}
                onChange={(dateFormat) =>
                  void save({
                    dateFormat: dateFormat as Settings["dateFormat"],
                  })
                }
              />
              <SettingSelect
                disabled={saving}
                label="Week starts"
                value={settings.value.weekStartsOn}
                options={[
                  ["monday", "Monday"],
                  ["sunday", "Sunday"],
                ]}
                onChange={(weekStartsOn) =>
                  void save({
                    weekStartsOn:
                      weekStartsOn as Settings["weekStartsOn"],
                  })
                }
              />
              <SettingSelect
                disabled={saving}
                label="Default view"
                value={settings.value.defaultCalendarView}
                options={[
                  ["day", "Day"],
                  ["week", "Week"],
                  ["month", "Month"],
                  ["schedule", "Agenda"],
                ]}
                onChange={(defaultCalendarView) =>
                  void save({
                    defaultCalendarView:
                      defaultCalendarView as Settings["defaultCalendarView"],
                  })
                }
              />
              <SettingToggle
                checked={settings.value.notificationsOnByDefault}
                disabled={saving}
                label="Event notifications by default"
                onChange={(notificationsOnByDefault) =>
                  void save({ notificationsOnByDefault })
                }
              />
              <SettingToggle
                checked={settings.value.showKanji}
                disabled={saving}
                label="Show kanji labels"
                onChange={(showKanji) => void save({ showKanji })}
              />
              <SettingToggle
                checked={settings.value.tabBarLabels ?? true}
                disabled={saving}
                label="Show mobile tab labels"
                onChange={(tabBarLabels) => void save({ tabBarLabels })}
              />
            </div>
          ) : (
            <div className={styles.settingsLoadFailure}>
              <p>Settings could not be loaded.</p>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              >
                Retry
              </button>
            </div>
          )}

          {error ? (
            <div className={styles.formError} role="alert">
              <p>{error}</p>
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SettingSelect({
  disabled,
  label,
  onChange,
  options,
  value,
}: {
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
  value: string;
}) {
  return (
    <label className={styles.settingRow}>
      <span>{label}</span>
      <select
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function SettingToggle({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={styles.settingRow}>
      <span>{label}</span>
      <input
        checked={checked}
        disabled={disabled}
        type="checkbox"
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
