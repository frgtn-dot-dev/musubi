import { propfind } from "tsdav";
import { createGuardedCaldavFetch } from "./caldav_client";

const fetch = createGuardedCaldavFetch();

/** Only successful propstats for the requested resource are permission evidence. */
async function properties(url: string, authorization: string, props: Record<string, unknown>) {
  const responses = await propfind({
    url, depth: "0", props, headers: { authorization }, fetch,
  });
  return responses.find((response) =>
    response.ok && response.href && new URL(response.href, url).href === new URL(url).href,
  )?.props;
}

export async function caldavEventPrivileges(url: string, authorization: string) {
  const props = await properties(url, authorization, { "d:current-user-privilege-set": {} });
  const value = props?.currentUserPrivilegeSet;
  if (value == null) return undefined;
  const privileges = value.privilege == null ? []
    : Array.isArray(value.privilege) ? value.privilege : [value.privilege];
  return new Set<string>(privileges.flatMap((privilege: Record<string, unknown>) => Object.keys(privilege)));
}

export function caldavAllows(
  privileges: Set<string> | undefined,
  action: "create" | "update" | "delete",
): boolean | undefined {
  if (!privileges) return undefined;
  return privileges.has("all") || privileges.has("write") || privileges.has(
    action === "create" ? "bind" : action === "delete" ? "unbind" : "writeContent",
  );
}

export async function caldavOrganizerAddresses(url: string, authorization: string) {
  const props = await properties(url, authorization, { "d:current-user-principal": {} });
  const href = props?.currentUserPrincipal?.href;
  if (typeof href !== "string") return undefined;
  const principal = new URL(href, url);
  // Do not send credentials to an unrelated principal origin.
  if (principal.origin !== new URL(url).origin) return undefined;
  const addresses = await properties(principal.href, authorization, { "c:calendar-user-address-set": {} });
  const values = addresses?.calendarUserAddressSet?.href;
  if (values == null) return undefined;
  return (Array.isArray(values) ? values : [values])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.replace(/^mailto:/i, "").toLowerCase());
}
