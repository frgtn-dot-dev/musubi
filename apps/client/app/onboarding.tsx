import { useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { colors, fonts, styles } from "@/constants/theme";
import { appColors } from "@/constants/colors";
import { useApi } from "@/services/api";
import { useCalendarsStore } from "@/store/useCalendarsStore";
import { useSettingsStore } from "@/store/useSettingsStore";
import { useRefreshData } from "@/hooks/useRefreshData";
import { Btn } from "@/components/ui/Btn";
import { Tap } from "@/components/ui/Tap";
import SyncCalendarModal from "@/components/calendar/SyncCalendarModal";
import * as haptics from "@/lib/haptics";
import { Feather } from "@expo/vector-icons";

// One-screen onboarding, shown once after the first sign-in (email or Google):
// personalize the auto-created personal calendar, optionally connect external
// calendars, done. Finishing flips settings.onboarded on the server.
export default function Onboarding() {
  const api = useApi();
  const refresh = useRefreshData();
  const { calendars, localUpdateCalendar } = useCalendarsStore();
  const settings = useSettingsStore();

  const personal = useMemo(() => calendars.find(c => c.isDefault), [calendars]);
  const [name, setName] = useState<string | null>(null);       // null = untouched
  const [color, setColor] = useState<string | null>(null);
  const [syncVisible, setSyncVisible] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const shownName = name ?? personal?.name ?? "Personal";
  const shownColor = color ?? personal?.color ?? appColors[1].color;
  const connected = calendars.some(c => c.provider);

  const finish = async () => {
    setFinishing(true);
    try {
      if (personal && (name !== null || color !== null)) {
        const updated = { ...personal, name: shownName.trim() || "Personal", color: shownColor };
        await api.updateCalendar(updated);
        localUpdateCalendar(updated);
      }
      await api.saveSettings({
        showKanji: settings.showKanji,
        notificationsOnByDefault: settings.notificationsOnByDefault,
        defaultCalendarView: settings.defaultCalendarView,
        weekStartsOn: settings.weekStartsOn,
        timeLocale: settings.timeLocale,
        theme: settings.theme,
        onboarded: true,
      });
      settings.setOnboarded(true);
      haptics.success();
      router.replace("/(tabs)");
    } catch (e) {
      haptics.warn();
      console.error("Onboarding finish failed:", e);
      // Still let them in — the flag retries on the next settings save.
      settings.setOnboarded(true);
      router.replace("/(tabs)");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <View style={{ alignItems: "center", paddingTop: 48, paddingBottom: 32, gap: 12 }}>
          <Text style={{ fontFamily: fonts.kanji, fontSize: 52, color: colors.fg3 }}>結</Text>
          <Text style={{ fontFamily: fonts.serif, fontSize: 30, color: colors.fg }}>Welcome to Musubi</Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg3, textAlign: "center", paddingHorizontal: 32 }}>
            Two small things and you're in.
          </Text>
        </View>

        <View style={styles.fieldContainer}>
          <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Your personal calendar</Text>
          <TextInput
            value={shownName}
            onChangeText={setName}
            placeholder="Personal"
            placeholderTextColor={colors.fg4}
            autoCapitalize="words"
            style={[styles.fieldValueBig, { fontFamily: fonts.sans }]}
          />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              {appColors.map((c) => (
                <Tap
                  key={c.color}
                  onPress={() => setColor(c.color)}
                  style={{
                    width: 32, height: 32, borderRadius: 16,
                    backgroundColor: c.color,
                    borderWidth: shownColor === c.color ? 2 : 0,
                    borderColor: colors.fg,
                  }}
                />
              ))}
            </View>
          </ScrollView>
          <Text style={{ fontFamily: fonts.sans, fontSize: 11, color: colors.fg4, marginTop: 10 }}>
            This calendar is yours alone and always stays with your account.
          </Text>
        </View>

        <View style={styles.fieldContainer}>
          <Text style={[styles.fieldLabel, { fontFamily: fonts.sans }]}>Bring your schedule</Text>
          <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg2, marginBottom: 12 }}>
            {connected
              ? "Connected — your events will appear after the first sync."
              : "Connect Google or Apple/iCloud to see your existing events here. You can also do this later."}
          </Text>
          <Btn
            label={connected ? "Connect another calendar" : "Connect a calendar"}
            variant="secondary"
            icon={<Feather name="refresh-cw" size={14} color={colors.fg2} />}
            onPress={() => setSyncVisible(true)}
          />
        </View>
      </ScrollView>

      <View style={styles.screenActions}>
        <Btn label="Start using Musubi" onPress={finish} loading={finishing} />
      </View>

      <SyncCalendarModal
        visible={syncVisible}
        onClose={() => setSyncVisible(false)}
        onConnected={() => { refresh().catch(() => { }); }}
      />
    </View>
  );
}
