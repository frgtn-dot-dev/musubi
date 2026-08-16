// Lets Musubi's reminders actually land on the minute they promise.
//
// expo-notifications only asks the OS for an exact alarm when it is allowed to
// (`ExpoSchedulingDelegate.kt`):
//
//   if (SDK_INT < S || alarmManager.canScheduleExactAlarms()) {
//     AlarmManagerCompat.setExactAndAllowWhileIdle(...)
//   } else {
//     AlarmManagerCompat.setAndAllowWhileIdle(...)   // Doze can sit on this
//   }
//
// `canScheduleExactAlarms()` is false unless one of the two permissions below is
// held, so without them every reminder on Android 12 and newer is inexact —
// "10 minutes before" arrives whenever the system feels like it. For a calendar
// that is not a rough edge, it is the feature not working.
//
// Two permissions because Google changed the rules mid-stream:
//
//   Android 12  (SDK 31-32) — SCHEDULE_EXACT_ALARM, granted on install
//   Android 13+ (SDK 33+)   — USE_EXACT_ALARM, granted automatically and not
//                             revocable, but Play review checks the app really
//                             is an alarm or calendar app. Musubi is one, and
//                             already declares APP_CALENDAR to say so.
//
// SCHEDULE_EXACT_ALARM is capped at SDK 32 on purpose: from 13 it is a
// user-granted permission that would otherwise show up as something to nag
// about, when USE_EXACT_ALARM has already answered the question.
//
// Expo's declarative `android.permissions` cannot express `maxSdkVersion`,
// which is the whole reason this is a plugin rather than a line of config.
const { withAndroidManifest } = require("@expo/config-plugins");

const USE_EXACT_ALARM = "android.permission.USE_EXACT_ALARM";
const SCHEDULE_EXACT_ALARM = "android.permission.SCHEDULE_EXACT_ALARM";
/** Android 12L. From 13 the permission above takes over. */
const LAST_SDK_NEEDING_SCHEDULE = "32";

module.exports = function withExactAlarms(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest["uses-permission"] = manifest["uses-permission"] ?? [];

    const declare = (name, attributes = {}) => {
      const existing = manifest["uses-permission"].find(
        (permission) => permission.$["android:name"] === name,
      );
      if (existing) {
        Object.assign(existing.$, attributes);
        return;
      }
      manifest["uses-permission"].push({
        $: { "android:name": name, ...attributes },
      });
    };

    declare(USE_EXACT_ALARM);
    declare(SCHEDULE_EXACT_ALARM, {
      "android:maxSdkVersion": LAST_SDK_NEEDING_SCHEDULE,
    });

    return cfg;
  });
};
