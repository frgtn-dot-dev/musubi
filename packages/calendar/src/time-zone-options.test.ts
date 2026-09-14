import assert from "node:assert/strict";
import { timeZoneOptions } from "./time-zone-options";
const supported = Intl.supportedValuesOf;
try {
  Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: undefined });
  const options = timeZoneOptions("US/Eastern");
  assert.ok(options.length >= 597);
  for (const zone of ["UTC", "Europe/Prague", "America/New_York", "Asia/Kathmandu", "Pacific/Auckland", "US/Eastern"]) assert.ok(options.some(option => option.value === zone));
  assert.equal(new Set(options.map(option => option.value)).size, options.length);
} finally {
  Object.defineProperty(Intl, "supportedValuesOf", { configurable: true, value: supported });
}
console.log("Bundled IANA catalog works without runtime enumeration and preserves aliases: OK");
