import assert from "node:assert/strict";
import { createServer } from "node:http";
import { config } from "@musubi/config";
import { caldavRsvpFixtureData } from "./adapters/caldav_rsvp.fixture";

async function main() {
  const savedPrivate = config.security.federationAllowPrivateHosts;
  const savedRsvp = config.api.providerRsvpEditsEnabled;
  const savedOrganizer = config.api.caldavOrganizerEditsEnabled;
  config.security.federationAllowPrivateHosts = true;
  config.api.providerRsvpEditsEnabled = true;
  config.api.caldavOrganizerEditsEnabled = true;
  const { readCaldavSchedulingProof } = await import("./caldav_scheduling");
  const { readCaldavRsvp, deliverCaldavRsvp } = await import("./adapters/caldav_rsvp_delivery");
  const { caldavOrganizerTransport } = await import("./adapters/caldav_organizer_delivery");
  const mixed = ["mailto:self@example.test", "urn:uuid:12345678-1234-1234-1234-123456789abc", "/principal/", "/alternate/"];
  let principalStatus = 404, principalBody = "", rootStatus = 200, rootHref = "/principal/";
  let ownerHref = "/principal/", addresses = mixed, writeStatus = 200, denyBind = false, denyUnbind = false, emptyRootHref = false;
  let requests: string[] = [], mutations = 0;
  const xmlEscape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`);
    assert.equal(req.headers.authorization, "Basic Zml4dHVyZTpmaXh0dXJl");
    if (!["OPTIONS", "PROPFIND", "GET"].includes(req.method!)) { mutations++; res.writeHead(500); return res.end(); }
    if (req.method === "OPTIONS") { res.writeHead(200, { DAV: "1, calendar-auto-schedule" }); return res.end(); }
    if (req.method === "GET") { res.writeHead(200, { "content-type": "text/calendar", etag: '"before"', "schedule-tag": '"schedule-before"' }); return res.end(caldavRsvpFixtureData); }
    assert.equal(req.headers.depth, "0");
    let body = ""; for await (const chunk of req) body += chunk;
    const propstat = (prop: string, status = 200) => `<d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 ${status} Status</d:status></d:propstat>`;
    const href = (value: string) => `<d:href>${xmlEscape(value)}</d:href>`;
    let props: string;
    if (req.url === "/") props = propstat(`<d:current-user-principal>${emptyRootHref ? "<d:href/>" : rootHref ? href(rootHref) : ""}</d:current-user-principal>`, rootStatus);
    else if (req.url === "/collection/" && body.includes("current-user-principal")) {
      props = propstat(`<d:owner>${href(ownerHref)}</d:owner>`);
      if (principalStatus) props += propstat(`<d:current-user-principal>${principalBody}</d:current-user-principal>`, principalStatus);
    } else if (req.url === "/principal/") props = propstat(`<c:calendar-user-address-set>${addresses.map(href).join("")}</c:calendar-user-address-set><c:schedule-outbox-URL>${href("/outbox/")}</c:schedule-outbox-URL>`);
    else if (req.url === "/outbox/") props = propstat("<d:resourcetype><d:collection/><c:schedule-outbox/></d:resourcetype><d:current-user-privilege-set><d:privilege><c:schedule-send/></d:privilege></d:current-user-privilege-set>");
    else if (req.url === "/collection/") props = propstat(`<d:current-user-privilege-set>${denyBind ? "" : "<d:privilege><d:bind/></d:privilege>"}${denyUnbind ? "" : "<d:privilege><d:unbind/></d:privilege>"}</d:current-user-privilege-set>`);
    else { assert.equal(req.url, "/collection/invite.ics"); props = propstat(`<d:current-user-privilege-set>${writeStatus === 200 ? "<d:privilege><d:write-content/></d:privilege>" : ""}</d:current-user-privilege-set>`, writeStatus); }
    res.writeHead(207, { "content-type": "application/xml" });
    res.end(`<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response>${href(req.url!)}${props}</d:response></d:multistatus>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address(); assert.ok(port && typeof port !== "string");
  const origin = `http://127.0.0.1:${port.port}`, collection = `${origin}/collection/`, resource = `${collection}invite.ics`;
  const auth = "Basic Zml4dHVyZTpmaXh0dXJl";
  const proof = (action: "reply" | "create" | "update" | "delete" = "reply") => readCaldavSchedulingProof(collection, resource, auth, undefined, action);
  const reset = () => { principalStatus = 404; principalBody = ""; rootStatus = 200; rootHref = "/principal/"; ownerHref = "/principal/"; addresses = mixed; writeStatus = 200; denyBind = false; denyUnbind = false; emptyRootHref = false; requests = []; mutations = 0; };
  try {
    for (const action of ["reply", "create", "update", "delete"] as const) {
      reset(); const result = await proof(action);
      assert.equal(result.principal, `${origin}/principal/`); assert.equal(result.owner, result.principal);
      assert.deepEqual(result.addresses, ["mailto:self@example.test"]);
      assert.equal(requests.filter(r => r === "PROPFIND /").length, 1);
      assert.equal(requests.some(r => r.includes("/alternate/")), false);
      assert.equal(mutations, 0);
    }
    reset(); addresses = [mixed[0]!, "urn:uuid:opaque-provider-identifier"]; assert.deepEqual((await proof()).addresses, [mixed[0]!]);
    reset(); rootHref = "principal/"; assert.equal((await proof()).principal, `${origin}/principal/`);
    reset(); principalStatus = 200; principalBody = "<d:href>/principal/</d:href>"; await proof(); assert.equal(requests.includes("PROPFIND /"), false);
    for (const [status, body] of [[403, ""], [401, ""], [200, ""], [0, ""], [404, "unexpected"], [404, "<d:href>/principal/</d:href>"], [200, "<d:unauthenticated/>"], [200, "<d:href>http://foreign.invalid/principal/</d:href>"]] as const) {
      reset(); principalStatus = status; principalBody = body; await assert.rejects(() => proof()); assert.equal(requests.includes("PROPFIND /"), false);
    }
    for (const [status, value] of [[403, "/principal/"], [404, ""], [200, ""], [200, "http://foreign.invalid/principal/"], [200, "/other/"]] as const) {
      reset(); rootStatus = status; rootHref = value; await assert.rejects(() => proof()); assert.equal(requests.includes("PROPFIND /principal/"), false);
    }
    reset(); emptyRootHref = true; ownerHref = "/"; await assert.rejects(() => proof()); assert.equal(requests.filter(r => r === "PROPFIND /").length, 1);
    reset(); ownerHref = "http://foreign.invalid/principal/"; await assert.rejects(() => proof()); assert.equal(requests.includes("PROPFIND /"), false);
    for (const invalid of ["mailto:broken", "mailto:self@example.test?subject=bad", "mailto:self%40example.test", "mailto:self@example.test#fragment", "urn:-invalid:opaque", "/bad%zz", "/bad%0a", "//foreign.invalid/principal/", "relative-without-scheme", "urn:uuid:", "mailto:self @example.test"]) {
      reset(); addresses = [mixed[0]!, invalid]; await assert.rejects(() => proof()); assert.equal(mutations, 0);
    }
    for (const invalid of [[mixed[1]!], [mixed[0]!, "MAILTO:SELF@EXAMPLE.TEST"], [mixed[0]!, mixed[1]!, mixed[1]!]]) {
      reset(); addresses = invalid; await assert.rejects(() => proof());
    }
    reset(); denyBind = true; await assert.rejects(() => proof("create"));
    reset(); denyUnbind = true; await assert.rejects(() => proof("delete"));
    reset(); const ref = { id: resource, etag: '"before"', uid: "rsvp-fixture" };
    const evidence = await readCaldavRsvp(collection, ref, auth, "accepted");
    for (const status of [403, 404]) {
      reset(); writeStatus = status;
      await assert.rejects(() => deliverCaldavRsvp(collection, evidence, auth));
      await assert.rejects(() => caldavOrganizerTransport(async () => auth)("actor", "account", collection, "update", resource));
      assert.equal(mutations, 0); assert.equal(requests.some(r => r.startsWith("GET ")), false);
    }
    reset(); addresses = ["mailto:self@example.test", "mailto:other@example.test"];
    await assert.rejects(() => readCaldavRsvp(collection, ref, auth, "accepted")); assert.equal(mutations, 0);
    console.log("CalDAV scheduling: strict root discovery, mixed URI identities, operation privileges and no write on unknown resource permission: OK");
  } finally {
    config.security.federationAllowPrivateHosts = savedPrivate; config.api.providerRsvpEditsEnabled = savedRsvp; config.api.caldavOrganizerEditsEnabled = savedOrganizer;
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
