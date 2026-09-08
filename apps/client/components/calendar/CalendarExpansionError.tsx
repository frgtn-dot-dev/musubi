import { Text, View } from "react-native";
import { colors, fonts } from "@/constants/theme";
import { Btn } from "@/components/ui/Btn";

export function CalendarExpansionError({
  message,
  onRetry,
  refreshing,
}: {
  message: string;
  onRetry?: () => void;
  refreshing?: boolean;
}) {
  return (
    <View style={{ padding: 16, gap: 12, backgroundColor: colors.bg1 }}>
      <Text accessibilityRole="alert" style={{ fontFamily: fonts.sans, fontSize: 13, color: colors.fg2 }}>
        {message}
      </Text>
      {onRetry && <Btn label="Try again" variant="secondary" loading={refreshing} onPress={onRetry} />}
    </View>
  );
}
