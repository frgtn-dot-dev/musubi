import { xml2js } from "xml-js";
import { createGuardedCaldavFetch } from "./caldav_client";
import { assertEventWriteResponse } from "./event_write";
import { EventWriteError } from "@musubi/types";

const DAV = "DAV:", CAL = "urn:ietf:params:xml:ns:caldav";
const guardedFetch = createGuardedCaldavFetch();
type Node = { name: string; text: string; children: Node[] };
function refuse(): never { throw new EventWriteError("event-write", "unsupported", "Verified CalDAV automatic scheduling permission is required."); }
const key = (namespace: string, name: string) => `{${namespace}}${name}`;
/** Preserve namespace identity; the ordinary DAV convenience parser discards it. */
export function schedulingProperties(xml: string, expectedURL: string): Map<string, Node> {
  if (xml.length > 262144 || /<!DOCTYPE|<!ENTITY/i.test(xml)) refuse();
  // xml-js's SAX reader silently retains the first duplicate attribute. Refuse
  // that ambiguity before parsing, including repeated namespace declarations.
  for (const match of xml.matchAll(/<(?:(?:[^"'>]|"[^"]*"|'[^']*')*)>/g)) {
    if (!/^<[A-Za-z_]/.test(match[0])) continue;
    const attributes = [...match[0].matchAll(/([^\s=]+)\s*=\s*("[^"]*"|'[^']*')/g)].map(item => item[1]);
    if (new Set(attributes).size !== attributes.length) refuse();
  }
  function parse(element: any, inherited: Record<string, string>): Node {
    if (element.type !== "element" || typeof element.name !== "string") return refuse();
    const namespaces = { ...inherited };
    for (const [name, value] of Object.entries(element.attributes ?? {})) {
      if (name === "xmlns" || name.startsWith("xmlns:")) {
        if (typeof value !== "string" || !value || name === "xmlns:xmlns") refuse();
        namespaces[name === "xmlns" ? "" : name.slice(6)] = value;
      }
    }
    const parts = element.name.split(":");
    if (parts.length > 2 || !namespaces[parts.length === 1 ? "" : parts[0]!]) refuse();
    const namespace = namespaces[parts.length === 1 ? "" : parts[0]!]!;
    const children: Node[] = []; let text = "";
    for (const child of element.elements ?? []) {
      if (child.type === "element") children.push(parse(child, namespaces));
      else if (child.type === "text") text += child.text;
      else if (child.type !== "comment") refuse();
    }
    return { name: key(namespace, parts[parts.length - 1]!), text: text.trim(), children };
  }
  let document: any;
  try { document = xml2js(xml, { compact: false, alwaysChildren: true }); } catch { return refuse(); }
  const elements = (document.elements ?? []).filter((item: any) => item.type !== "comment");
  if (elements.length !== 1) refuse();
  const root = parse(elements[0], { xml: "http://www.w3.org/XML/1998/namespace" });
  if (root.name !== key(DAV, "multistatus") || root.text) refuse();
  const responses = root.children.filter(item => item.name === key(DAV, "response"));
  const matching = responses.filter(item => {
    const hrefs = item.children.filter(child => child.name === key(DAV, "href"));
    if (hrefs.length !== 1 || hrefs[0]!.children.length) return false;
    try { return new URL(hrefs[0]!.text, expectedURL).href === expectedURL; } catch { return false; }
  });
  if (matching.length !== 1) refuse();
  if (matching[0]!.text || matching[0]!.children.some(item => item.name === key(DAV, "status"))) refuse();
  const result = new Map<string, Node>();
  for (const propstat of matching[0]!.children.filter(item => item.name === key(DAV, "propstat"))) {
    const statuses = propstat.children.filter(item => item.name === key(DAV, "status"));
    const props = propstat.children.filter(item => item.name === key(DAV, "prop"));
    if (statuses.length !== 1 || props.length !== 1 || statuses[0]!.children.length || props[0]!.text) refuse();
    const match = /^HTTP\/1\.[01] ([1-5]\d\d)(?: [^\r\n]*)?$/.exec(statuses[0]!.text);
    if (!match) refuse();
    // Duplicate properties are ambiguous even when one propstat failed.
    for (const prop of props[0]!.children) {
      if (result.has(prop.name)) refuse();
      result.set(prop.name, Number(match[1]) >= 200 && Number(match[1]) < 300 ? prop : { ...prop, children: [], text: "" });
    }
  }
  return result;
}
function one(props: Map<string, Node>, namespace: string, name: string): Node {
  const value = props.get(key(namespace, name)); if (!value) return refuse(); return value;
}
function href(node: Node, base: string): string {
  if (node.text || node.children.length !== 1 || node.children[0]!.name !== key(DAV, "href") || node.children[0]!.children.length) refuse();
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
async function properties(url: string, authorization: string, names: string[], signal?: AbortSignal) {
  const response = await guardedFetch(url, { method: "PROPFIND", redirect: "error", signal, headers: { authorization, depth: "0", "content-type": "application/xml", "cache-control": "no-cache" }, body: `<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${names.map(name => `<${name}/>`).join("")}</d:prop></d:propfind>` });
  assertEventWriteResponse(response);
  if (response.status !== 207 || response.headers.has("content-range") || !response.headers.get("content-type")?.toLowerCase().includes("xml")) refuse();
  return schedulingProperties(await response.text(), url);
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
  const props = await properties(collection, authorization, ["d:current-user-principal", "d:owner"], signal);
  const principal = href(one(props, DAV, "current-user-principal"), collection), owner = href(one(props, DAV, "owner"), collection);
  if (principal !== owner) refuse();
  const identity = await properties(principal, authorization, ["c:calendar-user-address-set", "c:schedule-outbox-URL"], signal);
  const addressSet = one(identity, CAL, "calendar-user-address-set");
  if (addressSet.text || !addressSet.children.length || addressSet.children.length > 100) refuse();
  const addresses = addressSet.children.map(item => {
    if (item.name !== key(DAV, "href") || item.children.length || !/^mailto:[^\s<>@]+@[^\s<>@]+$/i.test(item.text)) refuse();
    return item.text.toLowerCase();
  }).sort();
  if (new Set(addresses).size !== addresses.length) refuse();
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
