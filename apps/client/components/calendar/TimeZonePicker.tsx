import { useMemo, useState } from "react";
import { typeSizes } from "@musubi/design-system";
import { Text } from "react-native";
import { Feather } from "@expo/vector-icons";
import { timeZoneOptions } from "@musubi/calendar";
import { Tap } from "@/components/ui/Tap";
import { OptionPicker } from "@/components/ui/OptionPicker";
import { colors, styles } from "@/constants/theme";
export function TimeZonePicker({ value, disabled, onChange, subdued = false, accessibilityLabel = "Event time zone" }: { subdued?: boolean; accessibilityLabel?: string; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const options = useMemo(() => open ? timeZoneOptions(value) : [], [open, value]);
  return <>
    <Tap disabled={disabled} accessibilityLabel={accessibilityLabel} onPress={() => setOpen(true)} style={{ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, flex: 1 }}>
      <Text style={[styles.fieldValueText, { flex: 1, color: colors.fg3 }, subdued && { fontSize: typeSizes[13] }]}>{value.replaceAll("_", " ") || "Choose time zone"}</Text>
      {!disabled ? <Feather name="chevron-down" size={16} color={colors.fg3} /> : null}
    </Tap>
    {open ? <OptionPicker visible searchable title="Time zone" options={options} value={value} onSelect={onChange} onClose={() => setOpen(false)} /> : null}
  </>;
}
