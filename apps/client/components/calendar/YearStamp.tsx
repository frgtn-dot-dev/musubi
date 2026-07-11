import { colors, fonts } from "@/constants/theme";
import { Text, View } from "react-native";

/**
 * The year as its last two digits with a line above them — a compact, zen
 * "year stamp" (‾26) shown next to month names and as the agenda's year
 * divider. RN has no `overline` text decoration, so the line is a borderTop.
 */
export function YearStamp({ date, size = 12 }: { date: Date; size?: number }) {
  return (
    <View style={{ borderTopWidth: 1, borderColor: colors.fg3, paddingTop: 2, alignSelf: "center" }}>
      <Text style={{ fontFamily: fonts.sansMedium, fontSize: size, color: colors.fg3, letterSpacing: 1 }}>
        {String(date.getFullYear()).slice(-2)}
      </Text>
    </View>
  );
}
