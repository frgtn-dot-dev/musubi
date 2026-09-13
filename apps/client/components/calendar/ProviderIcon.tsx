import { colors } from "@/constants/theme";
import { Feather, Ionicons } from "@expo/vector-icons";

/** Shared source mark; calendar chips pass their pigment instead of the account tone. */
export function ProviderIcon({ provider, color = colors.fg3 }: { provider?: string | null; color?: string }) {
  if (provider === "google") return <Ionicons name="logo-google" size={13} color={color} />;
  if (provider === "microsoft") return <Ionicons name="logo-microsoft" size={13} color={color} />;
  if (provider === "apple") return <Ionicons name="logo-apple" size={14} color={color} />;
  if (provider === "caldav") return <Ionicons name="cloud" size={14} color={color} />;
  return <Feather name="calendar" size={13} color={color} />;
}
