import { IANA_TIME_ZONES } from "./iana-time-zones";
/** Bundled IANA zones plus runtime additions, preserving stored aliases and explicitly including UTC. */
export function timeZoneOptions(current = "") {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.("timeZone") ?? [];
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set(["UTC", local, current, ...IANA_TIME_ZONES, ...zones].filter(Boolean))]
    .sort((a, b) => a === "UTC" ? -1 : b === "UTC" ? 1 : a.localeCompare(b))
    .map(value => ({ value, label: value.replace(/_/g, " ") }));
}
