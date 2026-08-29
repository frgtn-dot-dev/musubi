// The diagnostics screen, reached from the row that appears after ten taps on
// the version.
//
// It exists because every way this app fails to notify somebody is silent. A
// reminder that never arrives could be a permission nobody asked for, rules
// that never loaded, an OS that dropped the alarms, a clock two minutes out, or
// a server that stopped answering — and from the outside all five look like
// nothing happening. There is no way to attach a debugger to a build from the
// store, so the build has to be able to answer the question itself.
//
// The layout follows that: the verdict first and whole, then the things to try,
// then the evidence folded away. Somebody opening this wants to know whether
// something is wrong before they want to read a request log.

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { colors, fonts, styles } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";
import { Tap } from "@/components/ui/Tap";
import { showToast } from "@/components/ui/Toast";
import { confirm } from "@/lib/confirm";
import { useServer } from "@/contexts/ServerContext";
import { useRefreshData } from "@/hooks/useRefreshData";
import { useEventsStore } from "@/store/useEventsStore";
import { summarise, type CheckStatus } from "@/lib/healthChecks";
import { resetOnboardingRoute } from "@/lib/onboardingState";
import { cacheClearAll } from "@/services/eventsCache";
import {
  buildReport,
  collectDebugSnapshot,
  type DebugSnapshot,
} from "@/services/debugReport";
import {
  requestEventNotificationPermission,
  sendTestReminder,
  syncScheduledReminders,
} from "@/services/notifications";

// ponytail: three constants, not a token layer — this screen is their only
// reader. The red is the app's existing destructive colour; the green is a
// muted moss chosen to sit in the same warm palette rather than a stock #0f0.
const STATUS_COLOR: Record<CheckStatus, string> = {
  fail: "#C8553D",
  pass: "#5F7A4F",
  warn: "#C08A2E",
};

// Shape as well as colour. Red/green is the commonest colour blindness there
// is, and a column of dots that differ only in hue says nothing to those
// readers — which would leave this screen unable to report its own verdict.
const STATUS_ICON: Record<CheckStatus, keyof typeof Feather.glyphMap> = {
  fail: "x-circle",
  pass: "check-circle",
  warn: "alert-triangle",
};

/** The summary reads as a heading here, not as the middle of a sentence. */
const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The worst thing in the run — what the summary is coloured by. */
function worst(statuses: CheckStatus[]): CheckStatus {
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("warn")) return "warn";
  return "pass";
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={[styles.sectionLabel, local.heading]}>{children}</Text>;
}

/** A label and its value, wrapping rather than truncating — this is evidence. */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={local.row}>
      <Text style={[local.rowLabel, { color: colors.fg4 }]}>{label}</Text>
      <Text style={[local.rowValue, { color: colors.fg2 }]} selectable>
        {value}
      </Text>
    </View>
  );
}

/**
 * A detail section that stays folded until it is asked for.
 *
 * The header carries a one-line summary, so the common case — glancing to see
 * whether the server answered, or how many reminders are scheduled — never
 * needs a tap. Opening it is for when that line is not enough.
 */
function Fold({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[local.fold, { borderColor: colors.line }]}>
      <Tap
        onPress={() => setOpen((current) => !current)}
        scaleTo={1}
        style={local.foldHeader}
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${summary}`}
        accessibilityState={{ expanded: open }}
      >
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[local.foldTitle, { color: colors.fg2 }]}>{title}</Text>
          <Text style={[local.rowLabel, { color: colors.fg4 }]}>{summary}</Text>
        </View>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.fg4}
        />
      </Tap>
      {open ? <View style={local.foldBody}>{children}</View> : null}
    </View>
  );
}

export default function DebugScreen() {
  const { apiUrl, authClient } = useServer();
  const refresh = useRefreshData();
  const [snapshot, setSnapshot] = useState<DebugSnapshot | null>(null);
  const [running, setRunning] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // `running` starts true, so the first pass sets no state until its await has
  // returned. Flipping the flag here instead would be a synchronous setState
  // inside the effect below, which is a cascading render for a value that is
  // already correct.
  const collect = useCallback(async () => {
    try {
      setSnapshot(
        await collectDebugSnapshot({
          apiUrl,
          getSession: () => authClient.getSession(),
        }),
      );
    } finally {
      setRunning(false);
    }
  }, [apiUrl, authClient]);

  useEffect(() => {
    void collect();
  }, [collect]);

  /** Re-check on demand, which is the one path that has to raise the flag. */
  const run = useCallback(() => {
    setRunning(true);
    return collect();
  }, [collect]);

  /** Run an action, then re-check — every button here changes what the checks say. */
  const act = async (id: string, action: () => Promise<string | void>) => {
    setBusy(id);
    try {
      const message = await action();
      if (message) showToast({ message });
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setBusy(null);
      void run();
    }
  };

  const checks = snapshot?.checks ?? [];
  const overall = worst(checks.map((check) => check.status));
  const probe = snapshot?.server.probe;
  const reminders = snapshot?.reminders;

  return (
    <View style={{ backgroundColor: colors.bg, flex: 1 }}>
      <View style={local.header}>
        <Tap
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back"
          style={{ padding: 4 }}
        >
          <Feather name="chevron-left" size={22} color={colors.fg2} />
        </Tap>
        <Text style={[local.title, { color: colors.fg }]}>Diagnostics</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 48 }}>
        {/* The verdict, before anything else and in plain words. */}
        <View style={local.section}>
          <View
            style={[
              local.summary,
              {
                backgroundColor: colors.bg2,
                borderColor: running ? colors.line : STATUS_COLOR[overall],
              },
            ]}
          >
            {running ? (
              // A spinner rather than a static "loader" glyph, which reads as a
              // broken icon when it does not turn.
              <ActivityIndicator size="small" color={colors.fg4} />
            ) : (
              <Feather
                name={STATUS_ICON[overall]}
                size={18}
                color={STATUS_COLOR[overall]}
              />
            )}
            <Text style={[local.summaryText, { color: colors.fg }]}>
              {running ? "Checking…" : sentence(summarise(checks))}
            </Text>
          </View>

          {checks.map((check) => (
            <View key={check.id} style={local.check}>
              <Feather
                name={STATUS_ICON[check.status]}
                size={14}
                color={STATUS_COLOR[check.status]}
                style={{ marginTop: 2 }}
              />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[local.checkLabel, { color: colors.fg2 }]}>
                  {check.label}
                </Text>
                <Text style={[local.checkDetail, { color: colors.fg4 }]}>
                  {check.detail}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <SectionLabel>Try it</SectionLabel>
        <View style={[local.section, local.buttons]}>
          <Btn
            label="Send a test reminder"
            loading={busy === "test"}
            onPress={() =>
              void act("test", async () => {
                const problem = await sendTestReminder();
                return (
                  problem ??
                  "Scheduled. It should arrive in about five seconds — leave this screen to see it."
                );
              })
            }
          />
          <Btn
            label="Ask for notification permission"
            variant="secondary"
            loading={busy === "permission"}
            onPress={() =>
              void act("permission", async () => {
                const granted = await requestEventNotificationPermission();
                return granted
                  ? "Granted."
                  : "Not granted. If the system did not ask, it has been refused before — grant it in system settings.";
              })
            }
          />
          <Btn
            label="Re-schedule reminders"
            variant="secondary"
            loading={busy === "reschedule"}
            onPress={() =>
              void act("reschedule", async () => {
                await syncScheduledReminders(useEventsStore.getState().events);
                return "Reconciled against the events this device holds.";
              })
            }
          />
          <Btn
            label="Refresh from the server"
            variant="secondary"
            loading={busy === "refresh"}
            onPress={() =>
              void act("refresh", async () => {
                await refresh({ full: true });
                return "Refreshed.";
              })
            }
          />
          <Btn
            label="Run the checks again"
            variant="secondary"
            loading={running}
            onPress={() => void run()}
          />
        </View>

        <SectionLabel>Details</SectionLabel>
        <View style={local.section}>
          <Fold
            title="Server"
            summary={
              probe
                ? `${snapshot?.server.url} · ${probe.status ?? "no answer"} in ${probe.ms} ms`
                : "—"
            }
          >
            {probe?.error ? <Row label="Error" value={probe.error} /> : null}
            <Text style={[local.rowLabel, { color: colors.fg4 }]}>Answered</Text>
            <ScrollView
              horizontal
              style={[local.code, { backgroundColor: colors.bg3 }]}
            >
              <Text style={[local.codeText, { color: colors.fg3 }]} selectable>
                {JSON.stringify(probe?.body ?? null, null, 2)}
              </Text>
            </ScrollView>
          </Fold>

          <Fold
            title="Reminders"
            summary={
              reminders
                ? `${reminders.permission} · ${reminders.scheduled} scheduled`
                : "—"
            }
          >
            <Row label="Permission" value={reminders?.permission ?? "—"} />
            <Row
              label="Held by the OS"
              value={String(reminders?.scheduled ?? "—")}
            />
            <Row
              label="Recorded here"
              value={String(reminders?.receipts ?? "—")}
            />
            <Row
              label="Rules"
              value={reminders?.rulesLoaded ? "loaded" : "not loaded"}
            />
            <Row
              label="Next"
              value={reminders?.nextScheduled.join("\n") || "nothing scheduled"}
            />
            {reminders?.channels.length ? (
              <Row
                label="Android channels"
                value={reminders.channels
                  .map((channel) => `${channel.id} — ${channel.importance}`)
                  .join("\n")}
              />
            ) : null}
          </Fold>

          <Fold
            title="This device"
            summary={`${snapshot?.app.version ?? "—"} (${snapshot?.app.build ?? "—"}) · ${snapshot?.app.platform ?? "—"}`}
          >
            <Row
              label="Signed in"
              value={
                snapshot?.session.signedIn
                  ? (snapshot.session.userId ?? "yes")
                  : "no"
              }
            />
            <Row
              label="Events cached"
              value={String(snapshot?.local.events ?? "—")}
            />
            <Row
              label="Calendars cached"
              value={String(snapshot?.local.calendars ?? "—")}
            />
            <Row label="Last sync" value={snapshot?.local.lastSync ?? "never"} />
            {snapshot?.local.error ? (
              <Row label="Database error" value={snapshot.local.error} />
            ) : null}
          </Fold>

          <Fold
            title="Recent requests"
            summary={`${snapshot?.requests.split("\n").length ?? 0} lines`}
          >
            <ScrollView
              horizontal
              style={[local.code, { backgroundColor: colors.bg3 }]}
            >
              <Text style={[local.codeText, { color: colors.fg3 }]} selectable>
                {snapshot?.requests ?? "—"}
              </Text>
            </ScrollView>
          </Fold>
        </View>

        <View style={[local.section, local.buttons, { paddingTop: 12 }]}>
          <Btn
            label="Share this report"
            onPress={() => {
              if (snapshot) void Share.share({ message: buildReport(snapshot) });
            }}
          />
        </View>

        <SectionLabel>Reset</SectionLabel>
        <View style={local.section}>
          <Text style={[local.checkDetail, { color: colors.fg4 }]}>
            These throw away local state. Nothing on the server is touched, and
            everything is fetched again on the next refresh.
          </Text>
          <View style={local.buttons}>
            <Btn
              label="Clear the local cache"
              variant="destructive"
              loading={busy === "cache"}
              onPress={() =>
                confirm(
                  {
                    confirmLabel: "Clear",
                    message:
                      "Cached events and calendars are deleted from this device and read again from the server.",
                    title: "Clear the local cache?",
                  },
                  () =>
                    void act("cache", async () => {
                      await cacheClearAll();
                      await refresh({ full: true });
                      return "Cleared and refetched.";
                    }),
                )
              }
            />
            <Btn
              label="Reset onboarding"
              variant="destructive"
              onPress={() =>
                confirm(
                  {
                    confirmLabel: "Reset",
                    message:
                      "The onboarding flow starts again from the beginning.",
                    title: "Reset onboarding?",
                  },
                  () => {
                    resetOnboardingRoute();
                    showToast({ message: "Reset. Restart the app to see it." });
                  },
                )
              }
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Layout only. Colours are read inline at render because `colors` is a mutable
// singleton that applyTheme() swaps in place — freezing one into a module-scope
// StyleSheet would pin this screen to whichever theme was active at import.
const local = StyleSheet.create({
  buttons: { gap: 10, paddingTop: 4 },
  check: { flexDirection: "row", gap: 10, paddingVertical: 7 },
  checkDetail: { fontFamily: fonts.sans, fontSize: 12, lineHeight: 17 },
  checkLabel: { fontFamily: fonts.sansMedium, fontSize: 14 },
  code: { borderRadius: 6, marginTop: 6, maxHeight: 220, padding: 10 },
  codeText: {
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 11,
  },
  fold: { borderRadius: 10, borderWidth: 1, marginBottom: 8 },
  foldBody: { paddingBottom: 12, paddingHorizontal: 12 },
  foldHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    padding: 12,
  },
  foldTitle: { fontFamily: fonts.sansMedium, fontSize: 14 },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 56,
  },
  heading: { paddingBottom: 8, paddingHorizontal: 16, paddingTop: 20 },
  row: { gap: 2, paddingVertical: 5 },
  rowLabel: { fontFamily: fonts.sans, fontSize: 11 },
  rowValue: { fontFamily: fonts.sans, fontSize: 13 },
  section: { paddingHorizontal: 16 },
  summary: {
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    marginBottom: 8,
    padding: 14,
  },
  summaryText: { fontFamily: fonts.sansMedium, fontSize: 15 },
  title: { fontFamily: fonts.serif, fontSize: 20 },
});
