import assert from "node:assert/strict";
import { isIcloudRsvpDestination } from "./provider-rsvp";
const account = "https://caldav.icloud.com/";
const collection = "https://p123-caldav.icloud.com/owner/calendars/work/";
const resource = collection + "event.ics";
assert.equal(isIcloudRsvpDestination(account, collection, resource), true);
assert.equal(isIcloudRsvpDestination(collection, collection, resource), true);
for (const [server, calendar, event] of [
  ["https://caldav.icloud.com.evil.test/", collection, resource],
  ["http://caldav.icloud.com/", collection, resource],
  ["https://user:pass@caldav.icloud.com/", collection, resource],
  ["https://caldav.icloud.com:8443/", collection, resource],
  [account + "?secret=value", collection, resource],
  [account, collection, resource + "#fragment"],
  [account, collection, resource + "?query"],
  [account, collection, resource.replace("p123-", "p124-")],
  [account, collection, collection + "%2e%2e/foreign.ics"],
  [account, collection, collection + "%252e%252e.ics"],
  [account, collection, collection + "a%2fb.ics"],
  [account, collection, collection + "%00.ics"],
  [account, collection, collection],
  [account, collection.slice(0, -1), resource],
  [account, collection, resource.replace("/work/", "/personal/")],
]) assert.equal(isIcloudRsvpDestination(server!, calendar!, event!), false);
console.log("iCloud RSVP: exact authenticated destination bounds OK");
