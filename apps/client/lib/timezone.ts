/**
 * The zone this device is in, as an IANA name.
 *
 * Its own module so the settings sync can report it without importing the
 * notification service, which pulls in expo-notifications and cannot be loaded
 * outside a native runtime.
 */
export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
