import { z } from "zod";
import { canonicalTimeZone, outlookEndpointZonesMatch, outlookWindowsZone } from "@musubi/calendar";
import type { Event } from "@musubi/types";
import { ProviderEventWriteError } from "../event_write";

/** Check the mailbox's supported zone formats, without positional joins or
 * comparing display labels/offsets. No cache may outlive admission/dispatch. */
export async function requireSupportedSeriesZone(transport: { get: (url: string) => Promise<unknown> }, template: Event, native: Record<string, unknown>) {
  const model = template.timeModel;
  if (model?.kind !== "zoned" || model.timeZone === "UTC") return;
  const fail = (): never => { throw new ProviderEventWriteError("provider-conflict"); };
  if (!outlookEndpointZonesMatch(native, model.timeZone)) fail();
  const labels = [native.originalStartTimeZone, native.originalEndTimeZone] as string[];
  for (const format of ["Iana", "Windows"] as const) {
    const needed = labels.filter(label => !!outlookWindowsZone(label) === (format === "Windows"));
    if (!needed.length) continue;
    const response = await transport.get(`https://graph.microsoft.com/v1.0/me/outlook/supportedTimeZones(TimeZoneStandard=microsoft.graph.timeZoneStandard'${format}')`);
    const parsed = z.object({ value: z.array(z.object({ alias: z.string().min(1) })), "@odata.nextLink": z.never().optional() }).safeParse(response);
    if (!parsed.success) return fail();
    if (!needed.every(label => parsed.data.value.some(item => format === "Windows"
      ? item.alias === label : !!canonicalTimeZone(item.alias) && canonicalTimeZone(item.alias) === canonicalTimeZone(label)))) fail();
  }
}
