import { Alert } from "react-native";
import { calendarCoverageNotice } from "@musubi/calendar";
import type { Calendar } from "@musubi/types";
import { colors } from "@/constants/theme";
import { Tap } from "@/components/ui/Tap";
import { Feather } from "@expo/vector-icons";

export function CalendarCoverageNotice({ calendars }: { calendars: readonly Calendar[] }) {
  const message = calendarCoverageNotice(calendars);
  if (!message) return null;
  return (
    <Tap accessibilityLabel="Calendar sync information" accessibilityHint="Shows provider calendar coverage details"
      onPress={() => Alert.alert("Calendar sync", message)}
      style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
      <Feather name="info" size={18} color={colors.fg3} />
    </Tap>
  );
}
