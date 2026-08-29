// The hidden diagnostics screen, reached by tapping the version row ten times.
//
// It exists because every way this app fails to notify somebody is silent. A
// reminder that never arrives could be a permission nobody asked for, rules
// that never loaded, an OS that dropped the alarms, a clock two minutes out, or
// a server that stopped answering — and from the outside all five look like
// nothing happening. There is no way to attach a debugger to a build from the
// store, so the build has to be able to answer the question itself.
//
// It runs its checks on open rather than waiting to be asked, because the first
// thing anybody wants is the verdict, not a form.

import { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, Share, StyleSheet, Text, View } from "react-native";
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

function StatusDot({ status }: { status: CheckStatus }) {
  return (
    <View
      style={{
        backgroundColor: STATUS_COLOR[status],
        borderRadius: 5,
        height: 10,
        marginTop: 4,
        width: 10,
      }}
      // The dot is decoration; the row's text already carries the verdict, so
      // a screen reader that announced both would say everything twice.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <Text style={[styles.sectionLabel, local.heading]}>{title}</Text>
      <View style={local.section}>{children}</View>
    </>
  );
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

  const share = () => {
    if (!snapshot) return;
    void Share.share({ message: buildReport(snapshot) });
  };

  const failing = snapshot?.checks.filter((check) => check.status === "fail") ?? [];

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
        <Section title={running ? "Checking…" : summarise(snapshot?.checks ?? [])}>
          {(snapshot?.checks ?? []).map((check) => (
            <View key={check.id} style={local.check}>
              <StatusDot status={check.status} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[local.checkLabel, { color: colors.fg2 }]}>{check.label}</Text>
                <Text style={[local.checkDetail, { color: colors.fg4 }]}>{check.detail}</Text>
              </View>
            </View>
          ))}
          {!running && failing.length === 0 ? (
            <Text style={[local.checkDetail, { color: colors.fg4 }]}>
              Nothing here explains a missing notification. If one still has not
              arrived, send a test reminder below and share the report.
            </Text>
          ) : null}
        </Section>

        <Section title="Try it">
          <View style={local.buttons}>
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
            <Btn label="Re-run checks" variant="secondary" onPress={() => void run()} />
          </View>
        </Section>

        <Section title="Server">
          <Row label="URL" value={snapshot?.server.url ?? "—"} />
          <Row
            label="Status"
            value={
              snapshot
                ? `${snapshot.server.probe.status ?? "no answer"} in ${snapshot.server.probe.ms} ms`
                : "—"
            }
          />
          {snapshot?.server.probe.error ? (
            <Row label="Error" value={snapshot.server.probe.error} />
          ) : null}
          <Text style={[local.rowLabel, { color: colors.fg4 }]}>Answered</Text>
          <ScrollView horizontal style={[local.code, { backgroundColor: colors.bg2 }]}>
            <Text style={[local.codeText, { color: colors.fg3 }]} selectable>
              {JSON.stringify(snapshot?.server.probe.body ?? null, null, 2)}
            </Text>
          </ScrollView>
        </Section>

        <Section title="Reminders">
          <Row label="Permission" value={snapshot?.reminders?.permission ?? "—"} />
          <Row
            label="Held by the OS"
            value={String(snapshot?.reminders?.scheduled ?? "—")}
          />
          <Row
            label="Recorded here"
            value={String(snapshot?.reminders?.receipts ?? "—")}
          />
          <Row
            label="Rules"
            value={snapshot?.reminders?.rulesLoaded ? "loaded" : "not loaded"}
          />
          <Row
            label="Next"
            value={snapshot?.reminders?.nextScheduled.join("\n") || "nothing scheduled"}
          />
          {snapshot?.reminders?.channels.length ? (
            <Row
              label="Channels"
              value={snapshot.reminders.channels
                .map((channel) => `${channel.id} — ${channel.importance}`)
                .join("\n")}
            />
          ) : null}
        </Section>

        <Section title="On this device">
          <Row label="App" value={`${snapshot?.app.version} (${snapshot?.app.build})`} />
          <Row label="Platform" value={snapshot?.app.platform ?? "—"} />
          <Row
            label="Signed in"
            value={snapshot?.session.signedIn ? (snapshot.session.userId ?? "yes") : "no"}
          />
          <Row label="Events cached" value={String(snapshot?.local.events ?? "—")} />
          <Row label="Calendars cached" value={String(snapshot?.local.calendars ?? "—")} />
          <Row label="Last sync" value={snapshot?.local.lastSync ?? "never"} />
          {snapshot?.local.error ? (
            <Row label="Database error" value={snapshot.local.error} />
          ) : null}
        </Section>

        <Section title="Recent requests">
          <ScrollView horizontal style={[local.code, { backgroundColor: colors.bg2 }]}>
            <Text style={[local.codeText, { color: colors.fg3 }]} selectable>
              {snapshot?.requests ?? "—"}
            </Text>
          </ScrollView>
        </Section>

        <Section title="Report">
          <View style={local.buttons}>
            <Btn label="Share this report" onPress={share} />
          </View>
        </Section>

        <Section title="Reset">
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
                    message: "The onboarding flow starts again from the beginning.",
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
        </Section>
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
  code: { borderRadius: 8, marginTop: 6, maxHeight: 220, padding: 10 },
  codeText: {
    fontFamily: Platform.select({ android: "monospace", default: "Menlo" }),
    fontSize: 11,
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    paddingBottom: 8,
    paddingHorizontal: 12,
    paddingTop: 56,
  },
  heading: { paddingHorizontal: 16 },
  row: { gap: 2, paddingVertical: 5 },
  rowLabel: { fontFamily: fonts.sans, fontSize: 11 },
  rowValue: { fontFamily: fonts.sans, fontSize: 13 },
  section: { paddingBottom: 12, paddingHorizontal: 16 },
  title: { fontFamily: fonts.serif, fontSize: 20 },
});
