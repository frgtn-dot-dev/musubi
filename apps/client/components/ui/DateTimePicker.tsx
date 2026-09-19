import { Platform } from "react-native";
import { DateTimePicker as ExpoDateTimePicker, type DateTimePickerProps } from "@expo/ui/community/datetime-picker";

/** Keep a local civil-date contract across the platform pickers. */
export function DateTimePicker(props: Omit<DateTimePickerProps, "onChange">) {
  if (Platform.OS !== "android" || props.mode === "time") return <ExpoDateTimePicker {...props} />;

  const { value, onValueChange } = props;
  // Expo UI 57 forwards Material's UTC calendar-day timestamps unchanged.
  // Encode/decode at this boundary so every editor sees the selected local day.
  const nativeValue = new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
  return <ExpoDateTimePicker {...props} value={nativeValue} onValueChange={(event, selected) => {
    const local = new Date(selected.getUTCFullYear(), selected.getUTCMonth(), selected.getUTCDate(),
      value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds());
    onValueChange?.({ ...event, nativeEvent: { ...event.nativeEvent, timestamp: local.getTime(), utcOffset: -local.getTimezoneOffset() } }, local);
  }} />;
}
