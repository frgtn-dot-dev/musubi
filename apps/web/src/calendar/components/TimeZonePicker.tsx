import { timeZoneOptions } from "@musubi/calendar";
import { Select } from "~/ui/Select";
export function TimeZonePicker({ value, disabled, onChange }: { value: string; disabled?: boolean; onChange: (value: string) => void }) {
  return <Select label="Event time zone" searchable value={value} disabled={disabled} placeholder="Choose time zone" options={timeZoneOptions(value)} onChange={onChange} />;
}
