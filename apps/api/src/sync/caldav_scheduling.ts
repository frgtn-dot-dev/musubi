import { davMultistatus, type DavNode as Node } from "./caldav_properties";
import { createGuardedCaldavFetch } from "./caldav_client";
import { assertEventWriteResponse } from "./event_write";
import { EventWriteError } from "@musubi/types";

const DAV = "DAV:", CAL = "urn:ietf:params:xml:ns:caldav";
const guardedFetch = createGuardedCaldavFetch();
function refuse(): never { throw new EventWriteError("event-write", "unsupported", "Verified CalDAV automatic scheduling permission is required."); }
const key = (namespace: string, name: string) => `{${namespace}}${name}`;
/** Preserve namespace identity; the ordinary DAV convenience parser discards it. */
function schedulingResponse(xml: string, expectedURL: string) {
  if (xml.length > 262144) refuse();
  let responses;
  try { responses = davMultistatus(xml, expectedURL); } catch { return refuse(); }
  const matching = responses.filter(response => response.href === expectedURL);
  if (matching.length !== 1 || matching[0]!.status !== undefined) refuse();
  return matching[0]!.properties;
}
export function schedulingProperties(xml: string, expectedURL: string): Map<string, Node> {
  return new Map([...schedulingResponse(xml, expectedURL)].map(([name, property]) => [name, property.status === 200 ? property.value : { ...property.value, children: [], text: "" }]));
}

function one(props: Map<string, Node>, namespace: string, name: string): Node {
  const value = props.get(key(namespace, name)); if (!value) return refuse(); return value;
}
function href(node: Node, base: string): string {
  if (node.text || node.children.length !== 1 || node.children[0]!.name !== key(DAV, "href") || node.children[0]!.children.length || !node.children[0]!.text) refuse();
  return safeURL(node.children[0]!.text, base);
}
function safeURL(value: string, base: string): string {
  const url = new URL(value, base), origin = new URL(base);
  if (url.origin !== origin.origin || url.username || url.password || url.search || url.hash || !["http:", "https:"].includes(url.protocol)) refuse();
  for (const part of url.pathname.split("/")) {
    let decoded: string; try { decoded = decodeURIComponent(part); } catch { return refuse(); }
    if (decoded === "." || decoded === ".." || /[\\/%\u0000-\u001f\u007f]/.test(decoded)) refuse();
  }
  return url.href;
}
async function properties(url: string, authorization: string, names: string[], signal?: AbortSignal, discoverPrincipal = false) {
  const response = await guardedFetch(url, { method: "PROPFIND", redirect: "error", signal, headers: { authorization, depth: "0", "content-type": "application/xml", "cache-control": "no-cache" }, body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${names.map(name => `<${name}/>`).join("")}</d:prop></d:propfind>` });
  assertEventWriteResponse(response);
  if (response.status !== 207 || response.headers.has("content-range") || !response.headers.get("content-type")?.toLowerCase().includes("xml")) refuse();
  const raw = schedulingResponse(await response.text(), url);
  const props = new Map([...raw].map(([name, property]) => [name, property.status === 200 ? property.value : { ...property.value, children: [], text: "" }]));
  // RFC 5397 identity may be exposed at the origin root but unavailable on a
  // calendar. Only an explicit empty 404 permits this bounded discovery step.
  const current = raw.get(key(DAV, "current-user-principal"));
  if (discoverPrincipal && current?.status === 404 && !current.value.text && !current.value.children.length) {
    href(one(props, DAV, "owner"), url);
    const root = new URL("/", url).href;
    if (root === url) refuse();
    const principal = one(await properties(root, authorization, ["d:current-user-principal"], signal), DAV, "current-user-principal");
    // Resolve a relative root href at the root, never at the collection.
    const resolved = href(principal, root);
    props.set(key(DAV, "current-user-principal"), { ...principal, children: [{ ...principal.children[0]!, text: resolved }] });
  }
  return props;
}
function privileges(node: Node): Set<string> {
  if (node.text) refuse();
  return new Set(node.children.map(item => {
    if (item.name !== key(DAV, "privilege") || item.text || item.children.length !== 1 || item.children[0]!.children.length || item.children[0]!.text) refuse();
    return item.children[0]!.name;
  }));
}
export type CaldavSchedulingProof = { principal: string; owner: string; outbox: string; addresses: string[] };
export async function readCaldavSchedulingProof(collection: string, resource: string, authorization: string, signal?: AbortSignal, action: "reply" | "create" | "update" | "delete" = "reply"): Promise<CaldavSchedulingProof> {
  safeURL(resource, collection);
  const options = await guardedFetch(collection, { method: "OPTIONS", redirect: "error", signal, headers: { authorization, "cache-control": "no-cache" } });
  assertEventWriteResponse(options);
  if (!options.ok || !options.headers.get("dav")?.split(",").map(value => value.trim()).includes("calendar-auto-schedule")) refuse();
  const props = await properties(collection, authorization, ["d:current-user-principal", "d:owner"], signal, true);
  const principal = href(one(props, DAV, "current-user-principal"), collection), owner = href(one(props, DAV, "owner"), collection);
  if (principal !== owner) refuse();
  const identity = await properties(principal, authorization, ["c:calendar-user-address-set", "c:schedule-outbox-URL"], signal);
  const addressSet = one(identity, CAL, "calendar-user-address-set");
  if (addressSet.text || !addressSet.children.length || addressSet.children.length > 100) refuse();
  const seen = new Set<string>(), addresses: string[] = [];
  for (const item of addressSet.children) {
    if (item.name !== key(DAV, "href") || item.children.length) refuse();
    const value = item.text;
    // RFC 6638 allows URI identities as well as mailto addresses. Validate
    // references, but never fetch or reinterpret a non-email identity as email.
    if (!value || !/^[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]+$/.test(value) || /%(?![0-9a-f]{2})/i.test(value)) refuse();
    let decoded: string;
    try { decoded = decodeURIComponent(value); } catch { return refuse(); }
    if (/[\u0000-\u0020\u007f\\]/.test(decoded)) refuse();
    const mailto = /^mailto:/i.test(value);
    if (mailto) {
      if (!/^mailto:[^\s<>@,;:?#%\\]+@[^\s<>@,;:?#%\\]+$/i.test(value)) refuse();
    } else if (value.startsWith("/")) {
      if (value.startsWith("//")) refuse();
      safeURL(value, principal);
    } else {
      if (!/^[a-z][a-z0-9+.-]*:.+/i.test(value)) refuse();
      try { new URL(value); } catch { return refuse(); }
      if (/^urn:/i.test(value) && !/^urn:[a-z0-9][a-z0-9-]{0,31}:.+/i.test(value)) refuse();
    }
    const identity = mailto ? value.toLowerCase() : value;
    if (seen.has(identity)) refuse();
    seen.add(identity);
    if (mailto) addresses.push(identity);
  }
  if (!addresses.length) refuse();
  addresses.sort();
  const outbox = href(one(identity, CAL, "schedule-outbox-URL"), principal);
  const permission = await properties(outbox, authorization, ["d:resourcetype", "d:current-user-privilege-set"], signal);
  const type = one(permission, DAV, "resourcetype");
  if (type.text || !type.children.some(item => item.name === key(DAV, "collection") && !item.children.length && !item.text) || !type.children.some(item => item.name === key(CAL, "schedule-outbox") && !item.children.length && !item.text)) refuse();
  const sending = privileges(one(permission, DAV, "current-user-privilege-set"));
  if (![key(DAV, "all"), key(CAL, "schedule-send"), key(CAL, action === "reply" ? "schedule-send-reply" : "schedule-send-invite")].some(value => sending.has(value))) refuse();
  const writable = privileges(one(await properties(action === "create" || action === "delete" ? collection : resource, authorization, ["d:current-user-privilege-set"], signal), DAV, "current-user-privilege-set"));
  if (![key(DAV, "all"), key(DAV, "write"), key(DAV, action === "create" ? "bind" : action === "delete" ? "unbind" : "write-content")].some(value => writable.has(value))) refuse();
  return { principal, owner, outbox, addresses };
}
