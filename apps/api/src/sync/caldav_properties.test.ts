import assert from "node:assert/strict";
import { DAV, CALDAV, davMultistatus, successfulDavProperty, assertDavReadResponse } from "./caldav_properties";
const url = "https://dav.example.test/home/calendar/";
const response = (properties: string, code = "HTTP/1.1 200 OK", href = url) => `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${properties}</d:prop><d:status>${code}</d:status></d:propstat></d:response>`;
const document = (value: string) => `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:x="urn:wrong">${value}</d:multistatus>`;
const privilege = '<d:current-user-privilege-set><d:privilege><d:read/></d:privilege><d:privilege><c:read-free-busy/></d:privilege></d:current-user-privilege-set>';
const [valid] = davMultistatus(document(response(privilege)), url);
assert.equal(successfulDavProperty(valid!, DAV, "current-user-privilege-set")!.children[1]!.children[0]!.name, `{${CALDAV}}read-free-busy`);
assert.equal(successfulDavProperty(davMultistatus(document(response(privilege, "HTTP/1.1 403 Forbidden")), url)[0]!, DAV, "current-user-privilege-set"), undefined);
assert.equal(successfulDavProperty(davMultistatus(document(response('<x:current-user-privilege-set/>')), url)[0]!, DAV, "current-user-privilege-set"), undefined);
for (const xml of [
  document(response(privilege)).replace('<d:status>HTTP/1.1 200 OK</d:status>', ''),
  document(response(privilege, "successful")),
  document(response(privilege) + response(privilege)),
  document(response(privilege)).replace('xmlns:d="DAV:"', 'xmlns:d="DAV:" xmlns:d="urn:wrong"'),
  document(response(privilege, "HTTP/1.1 200 OK", "https://other.test/calendar/")),
  '<!DOCTYPE x [<!ENTITY y "read">]>' + document(response(privilege)),
]) assert.throws(() => davMultistatus(xml, url));
const failed = davMultistatus(document(`<d:response><d:href>${url}</d:href><d:status>HTTP/1.1 403 Forbidden</d:status></d:response>`), url)[0]!;
assert.equal(failed.status, 403); assert.equal(failed.properties.size, 0);
console.log("Strict CalDAV multistatus: exact namespaced property/status/href identity and ambiguity refusal OK");

const collection = response('<d:resourcetype><d:collection/></d:resourcetype>');
const child = response('<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>', "HTTP/1.1 200 OK", url + "child/");
assert.doesNotThrow(() => assertDavReadResponse(document(collection + child), url, "discovery"));
assert.doesNotThrow(() => assertDavReadResponse(document(collection), url, "discovery"));
for (const payload of [document(""), document(child), document(collection + response('<d:resourcetype/>', "HTTP/1.1 403 Forbidden", url + "hidden/")), document(collection + response('<x:resourcetype/>', "HTTP/1.1 200 OK", url + "hidden/"))]) {
  assert.throws(() => assertDavReadResponse(payload, url, "discovery"), "Filtered or incomplete discovery cannot prove removal");
}
const fullResource = response('<d:getetag>"fresh"</d:getetag><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>', "HTTP/1.1 200 OK", url + "event.ics");
assert.doesNotThrow(() => assertDavReadResponse(document(fullResource), url, "multiget"));
assert.throws(() => assertDavReadResponse(document(fullResource.replace('c:calendar-data', 'x:calendar-data').replace('/c:calendar-data', '/x:calendar-data')), url, "multiget"));
assert.throws(() => assertDavReadResponse(document(response('<d:getetag>"fresh"</d:getetag>', "HTTP/1.1 200 OK", url + "event.ics")), url, "multiget"));
const token = '<d:sync-token>new-token</d:sync-token>';
assert.doesNotThrow(() => assertDavReadResponse(document(token), url, "sync"));
assert.throws(() => assertDavReadResponse(document(""), url, "sync"));
const deletion = `<d:response><d:href>${url}gone.ics</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
assert.doesNotThrow(() => assertDavReadResponse(document(token + deletion), url, "sync"));
assert.throws(() => assertDavReadResponse(document(token + deletion.replace("404 Not Found", "403 Forbidden")), url, "sync"));
console.log("Discovery absence and resource/sync completeness proofs OK");

assert.throws(() => assertDavReadResponse(document(fullResource), url, "multiget", [url + "missing.ics"]), "A different href cannot satisfy a requested read");
assert.throws(() => assertDavReadResponse(document(fullResource), url, "multiget", [url + "event.ics", url + "missing.ics"]), "Missing requested resource is incomplete, not empty");
assert.doesNotThrow(() => assertDavReadResponse(document(fullResource), url, "multiget", [url + "event.ics"]));

// The downstream convenience parser merges propstats after namespace stripping
// and camel-casing. Reject both cross-propstat and nested/sibling aliases.
for (const alias of ["x:calendar-data", "c:calendar_data", "c:calendarData", "c:calendar--data"]) {
  assert.throws(() => davMultistatus(document(response(`<c:calendar-data>proven</c:calendar-data><${alias}>other</${alias}>`)), url));
}
assert.throws(() => davMultistatus(document(response('<d:resourcetype><c:calendar/><x:calendar/></d:resourcetype>')), url));
assert.throws(() => davMultistatus(document(response('<c:calendar-data>proven</c:calendar-data>').replace('</d:response>', '<d:propstat><d:prop><x:calendar-data>other</x:calendar-data></d:prop><d:status>HTTP/1.1 404 Not Found</d:status></d:propstat></d:response>')), url));
console.log("Convenience namespace/camel-case aliases rejected before projection: OK");

for (const properties of [
  '<d:getetag><d:href>version</d:href></d:getetag><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>',
  '<d:getetag/> <c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>',
  '<d:getetag>"version"</d:getetag><c:calendar-data><c:comp/></c:calendar-data>',
  '<d:getetag>"version"</d:getetag><c:calendar-data/>',
]) assert.throws(() => assertDavReadResponse(document(response(properties)), url, "multiget"), "Resource validators and bodies must be nonempty scalars");
for (const formatted of [document(collection), `\n${document(collection)}\n`, `<?xml version="1.0"?>\n<!-- comment -->\n${document(collection)}\n  `]) {
  assert.doesNotThrow(() => assertDavReadResponse(formatted, url, "discovery"));
}

assert.equal(successfulDavProperty(davMultistatus(document(response(privilege, "HTTP/1.1 206 Partial Content")), url)[0]!, DAV, "current-user-privilege-set"), undefined, "Partial privilege proof is unknown");
assert.throws(() => assertDavReadResponse(document(response('<d:resourcetype/>', "HTTP/1.1 206 Partial Content")), url, "discovery"));
assert.throws(() => assertDavReadResponse(document(response('<d:getetag>"partial"</d:getetag><c:calendar-data>BEGIN:VCALENDAR</c:calendar-data>', "HTTP/1.1 206 Partial Content")), url, "multiget"));
