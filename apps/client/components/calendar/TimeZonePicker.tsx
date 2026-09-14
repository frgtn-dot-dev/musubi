import { useState } from "react";
import { Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { timeZoneOptions } from "@musubi/calendar";
import { Tap } from "@/components/ui/Tap";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { colors, styles } from "@/constants/theme";
export function TimeZonePicker({ value, disabled, onChange, accessibilityLabel = "Event time zone" }: { accessibilityLabel?: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <Tap disabled={disabled} accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flex: 1 }}>
      <Text style={[styles.fieldValueText, { flex: 1, color: colors.fg3 }]}>{value.replaceAll("_", " ") || "Choose time zone"}</Text>
      {!disabled ? <Feather name="chevron-down" size={16} color={colors.fg3} /> : null}
    </Tap>
    {open ? <OptionPicker visible searchable title="Time zone" options={timeZoneOptions(value)} value={value} onSelect={onChange} onClose={() => setOpen(false)} /> : null}
  </>;
}
