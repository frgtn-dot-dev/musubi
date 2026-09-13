import assert from "node:assert/strict";
import { clientFamily, providerFamily, priorityFamily, snapshotCache, syncStatusFamily } from "./product_metrics";

async function main() {
  const samples = [
    ["Mozilla/5.0 (Windows NT 10.0) Chrome/140 Safari/537 Edg/140", "desktop", "windows", "edge"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18) Version/18 Mobile Safari/604", "mobile", "ios", "safari"],
    ["Mozilla/5.0 (iPad; CPU OS 18) CriOS/140 Mobile Safari/604", "tablet", "ios", "chrome"],
    ["Mozilla/5.0 (Linux; Android 15) Chrome/140 Mobile Safari/537", "mobile", "android", "chrome"],
    ["Mozilla/5.0 (X11; Linux) Firefox/140", "desktop", "linux", "firefox"],
    ["", "unknown", "unknown", "unknown"],
  ];
  for (const [ua, device, os, browser] of samples) {
    assert.equal(clientFamily(ua, "device"), device);
    assert.equal(clientFamily(ua, "os"), os);
    assert.equal(clientFamily(ua, "browser"), browser);
  }
  assert.equal(providerFamily("secret@example.com"), "unknown");
  assert.equal(syncStatusFamily("secret-token"), "unknown");
  assert.deepEqual(Array.from({length: 11}, (_, n) => priorityFamily(n)), ["none", "high", "high", "high", "high", "medium", "low", "low", "low", "low", "unknown"]);
  let calls = 0;
  let now = 0;
  let fail = false;
  const cache = snapshotCache(async () => { calls++; if (fail) throw Error("offline"); return { count: calls }; }, 60, () => now);
  const results = await Promise.all(Array.from({length: 30}, () => cache.get()));
  assert.equal(calls, 1, "concurrent collectors share one database read");
  assert.ok(results.every(r => r === results[0]));
  assert.equal(cache.healthy, true);
  const lastSuccess = cache.lastSuccess;
  fail = true; now = 61;
  assert.deepEqual(await cache.get(), {count: 1}, "failure preserves the last good inventory");
  assert.equal(cache.healthy, false);
  assert.equal(cache.lastSuccess, lastSuccess);
  await cache.get(); assert.equal(calls, 2, "failures also back off");
  now = 122; fail = false;
  assert.deepEqual(await cache.get(), {count: 3});
  assert.equal(cache.healthy, true);
  const cold = snapshotCache(async () => { throw Error("offline"); });
  assert.equal(await cold.get(), undefined, "cold failure is missing data, never a zero inventory");
  let slowCalls = 0;
  const slow = snapshotCache(() => { slowCalls++; return new Promise<never>(() => {}); }, 60, () => 0, 5);
  assert.equal(await slow.get(), undefined, "a stuck connection cannot hang a scrape");
  assert.equal(slow.healthy, false);
  await slow.get(); assert.equal(slowCalls, 1, "deadline failures back off too");
  console.log("product metrics: classification, cardinality, concurrent refresh and recovery passed");
}
void main();
