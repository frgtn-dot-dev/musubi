import { Text, View } from "react-native";
import { calendarCoverageNotice } from "@musubi/calendar";
import type { Calendar } from "@musubi/types";
import { colors, fonts } from "@/constants/theme";

export function CalendarCoverageNotice({ calendars }: { calendars: readonly Calendar[] }) {
  const message = calendarCoverageNotice(calendars);
  if (!message) return null;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8, backgroundColor: colors.bg1 }}>
      <Text accessibilityLiveRegion="polite" style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg2 }}>{message}</Text>
    </View>
  );
}
