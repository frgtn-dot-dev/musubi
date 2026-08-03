import type { Calendar, SettingsDocument } from "@musubi/types";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getServerCapabilities } from "~/api/resources";
import { getServerOrigin } from "~/api/query-keys";
import { authClient } from "~/auth/auth-client";
import {
  GOOGLE_CALENDAR_SCOPES,
  MICROSOFT_CALENDAR_SCOPES,
  rememberProviderLink,
} from "~/calendar/connections";
import { ThemeToggle } from "~/calendar/components/ThemeToggle";
import { AuthShell } from "~/ui/AuthShell";
import { Button } from "~/ui/Button";
import { ColorPicker } from "~/ui/ColorPicker";
import { Field } from "~/ui/Field";
import { ProviderGlyph } from "~/ui/ProviderGlyph";
import styles from "./onboarding.module.css";

const STEPS = 3;

/**
 * First run in the browser.
 *
 * The same three questions the phone asks (`apps/client/app/onboarding`), gated
 * on the same server flag — somebody who set themselves up on the phone must not
 * be asked again here, and the flag is the only thing both clients can agree on.
 *
 * Nothing here creates anything. The personal calendar already exists: the
 * server makes one for every account the moment it is registered
 * (`packages/auth/src/lib/auth.ts`), so this only renames it. A step that
 * created one would have to cope with being run twice.
 */
export function Onboarding({
  calendars,
  onDone,
  onGetSettingsDocument,
  onPatchSettings,
  onUpdateCalendar,
  userName,
}: {
  calendars: Calendar[];
  onDone: () => void;
  onGetSettingsDocument: () => Promise<SettingsDocument>;
  onPatchSettings: (input: {
    baseRevision: number;
    patch: { onboarded: true };
  }) => Promise<unknown>;
  onUpdateCalendar: (calendar: Calendar) => Promise<unknown>;
  userName: string;
}) {
  const personal = calendars.find((calendar) => calendar.isDefault);

  const [step, setStep] = useState(1);
  const [name, setName] = useState(userName);
  const [calendarName, setCalendarName] = useState(personal?.name ?? "Personal");
  const [color, setColor] = useState(personal?.color ?? "#C8553D");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const capabilities = useQuery({
    queryFn: ({ signal }) => getServerCapabilities(signal),
    queryKey: ["server-capabilities", getServerOrigin()],
    staleTime: 5 * 60_000,
  });
  const providers = capabilities.data?.syncProviders ?? [];

  /**
   * Marks the account set up.
   *
   * Read the revision first: the patch is a compare-and-set, and the settings
   * this screen was rendered from may be a snapshot older than the server's.
   */
  async function finish() {
    const document = await onGetSettingsDocument();
    await onPatchSettings({
      baseRevision: document.revision,
      patch: { onboarded: true },
    });
    onDone();
  }

  /** Never strand somebody in a flow they cannot leave. */
  async function attempt(work: () => Promise<void>, fallback: string) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function connect(provider: "google" | "microsoft") {
    await attempt(async () => {
      // Finish first, then leave: the trip to the provider comes back to this
      // page, and an account still marked unfinished would ask all over again.
      await finish();
      rememberProviderLink(provider);
      const result = await authClient.linkSocial({
        callbackURL: window.location.href,
        provider,
        scopes:
          provider === "google"
            ? GOOGLE_CALENDAR_SCOPES
            : MICROSOFT_CALENDAR_SCOPES,
      });
      if (result?.error) throw new Error(result.error.message);
    }, "Could not start the connection.");
  }

  return (
    <AuthShell
      eyebrow={`Step ${step} of ${STEPS}`}
      introduction={
        step === 1
          ? "Two questions and you are in. Everything here can be changed later in settings."
          : step === 2
            ? "We already made you a personal calendar. Give it a name you recognise."
            : "Bring in a calendar you already keep somewhere else, or leave it for later."
      }
      title={
        step === 1
          ? "Welcome to Musubi"
          : step === 2
            ? "Your calendar"
            : "Anything to bring with you?"
      }
      utility={<ThemeToggle />}
    >
      <div className={styles.step}>
        {step === 1 ? (
          <Field label="Your name">
            <input
              autoComplete="name"
              name="name"
              placeholder="How other people see you"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        ) : null}

        {step === 2 ? (
          <>
            <Field label="Calendar name">
              <input
                name="calendar"
                placeholder="Personal"
                value={calendarName}
                onChange={(event) => setCalendarName(event.target.value)}
              />
            </Field>
            <ColorPicker
              label="Colour"
              value={color}
              onChange={setColor}
            />
          </>
        ) : null}

        {step === 3 ? (
          <div className={styles.providers}>
            {providers.includes("google") ? (
              <Button
                disabled={busy}
                icon={<ProviderGlyph provider="google" />}
                variant="secondary"
                onClick={() => void connect("google")}
              >
                Connect Google Calendar
              </Button>
            ) : null}
            {providers.includes("microsoft") ? (
              <Button
                disabled={busy}
                icon={<ProviderGlyph provider="microsoft" />}
                variant="secondary"
                onClick={() => void connect("microsoft")}
              >
                Connect Outlook
              </Button>
            ) : null}
            <p className={styles.note}>
              CalDAV, iCloud and another Musubi server are in settings under
              Connections, whenever you want them.
            </p>
          </div>
        ) : null}

        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}

        <div className={styles.actions}>
          {step > 1 ? (
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => setStep(step - 1)}
            >
              Back
            </Button>
          ) : null}

          {step < STEPS ? (
            <Button
              loading={busy}
              onClick={() =>
                void attempt(async () => {
                  if (step === 1) {
                    const trimmed = name.trim();
                    if (trimmed && trimmed !== userName) {
                      const result = await authClient.updateUser({
                        name: trimmed,
                      });
                      if (result?.error) throw new Error(result.error.message);
                    }
                  }
                  if (step === 2 && personal) {
                    const trimmed = calendarName.trim() || "Personal";
                    if (trimmed !== personal.name || color !== personal.color) {
                      await onUpdateCalendar({
                        ...personal,
                        color,
                        name: trimmed,
                      });
                    }
                  }
                  setStep(step + 1);
                }, "That could not be saved. Try again.")
              }
            >
              Continue
            </Button>
          ) : (
            <Button
              loading={busy}
              variant={providers.length > 0 ? "secondary" : "primary"}
              onClick={() =>
                void attempt(finish, "Could not finish setting up. Try again.")
              }
            >
              {providers.length > 0 ? "Not now" : "Open my calendar"}
            </Button>
          )}
        </div>
      </div>
    </AuthShell>
  );
}
