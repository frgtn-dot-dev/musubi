import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTimePicker } from "./DateTimePicker";

const h = vi.hoisted(() => ({ platform: "android" }));
vi.mock("react-native", () => ({ Platform: { get OS() { return h.platform; } } }));
vi.mock("@expo/ui/community/datetime-picker", () => ({ DateTimePicker: "ExpoDateTimePicker" }));
beforeEach(() => { h.platform = "android"; });
afterEach(() => vi.unstubAllEnvs());

describe.each(["Europe/Prague", "America/Los_Angeles", "Pacific/Kiritimati", "Pacific/Pago_Pago"])("date picker in %s", timezone => {
  beforeEach(() => vi.stubEnv("TZ", timezone));

  it.each([0, 8])("opens and confirms the displayed day at local midnight in month %s", month => {
    const value = new Date(2026, month, 25);
    const change = vi.fn();
    const native = DateTimePicker({ value, mode: "date", onValueChange: change }).props;
    const utcDay = new Date(Date.UTC(2026, month, 25));
    expect(native.value).toEqual(utcDay);
    // The real Material picker returns UTC midnight, not a local Date.
    native.onValueChange({ nativeEvent: { timestamp: utcDay.getTime(), utcOffset: 0 } }, utcDay);
    expect(change).toHaveBeenCalledExactlyOnceWith({
      nativeEvent: { timestamp: value.getTime(), utcOffset: -value.getTimezoneOffset() },
    }, value);
  });

  it("changes only the calendar day of a timed value, including across DST", () => {
    const value = new Date(2026, 2, 7, 23, 45);
    const change = vi.fn();
    const native = DateTimePicker({ value, onValueChange: change }).props;
    expect(native.value).toEqual(new Date("2026-03-07T00:00:00Z"));
    const selected = new Date("2026-03-30T00:00:00Z");
    native.onValueChange({ nativeEvent: { timestamp: selected.getTime(), utcOffset: 0 } }, selected);
    expect(change.mock.calls[0][1]).toEqual(new Date(2026, 2, 30, 23, 45));
  });
});

it("passes Android time entry through without changing the instant or handlers", () => {
  const props = { value: new Date("2026-09-25T12:30:00Z"), mode: "time" as const, is24Hour: false, onValueChange: vi.fn(), onDismiss: vi.fn() };
  expect(DateTimePicker(props).props).toEqual(props);
});

it("preserves iOS picker behavior", () => {
  h.platform = "ios";
  const props = { value: new Date("2026-09-25T00:00:00Z"), mode: "date" as const, display: "compact" as const, onValueChange: vi.fn() };
  expect(DateTimePicker(props).props).toEqual(props);
});

it("preserves date bounds and dismissal without emitting a change", () => {
  const onDismiss = vi.fn(), onValueChange = vi.fn();
  const minimumDate = new Date(2026, 8, 1), maximumDate = new Date(2026, 8, 30);
  const native = DateTimePicker({ value: minimumDate, minimumDate, maximumDate, onDismiss, onValueChange }).props;
  // Expo already converts bounds using the device's local day on Android.
  expect(native.minimumDate).toBe(minimumDate);
  expect(native.maximumDate).toBe(maximumDate);
  native.onDismiss();
  expect(onDismiss).toHaveBeenCalledOnce();
  expect(onValueChange).not.toHaveBeenCalled();
});
