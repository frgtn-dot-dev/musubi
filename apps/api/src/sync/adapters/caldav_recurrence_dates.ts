import { EventWriteError } from "@musubi/types";
import { calendarLines } from "./caldav_event_ical";

const invalid = () => new EventWriteError("recurrence", "unsupported", "Unsupported or invalid recurrence date.");

/** Validate before ICAL normalization can truncate or normalize an invalid DATE. */
export function recurrenceDateValues(line: string): string[] {
  const match = /^(?:RDATE|EXDATE);VALUE=DATE:([0-9,]+)$/i.exec(line);
  if (!match) throw invalid();
  return match[1].split(",").map(value => {
    if (!/^\d{8}$/.test(value)) throw invalid();
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    const date = new Date(iso + "T00:00:00Z");
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw invalid();
    return iso;
  });
}

/** Parse parameter grammar before trusting where the property's value begins. */
function hasDateValueParameter(line: string): boolean {
  let offset = /^(?:RDATE|EXDATE)/i.exec(line)![0].length;
  let hasDate = false;
  const names = new Set<string>();
  while (line[offset] === ";") {
    offset++;
    const name = /^[A-Z0-9-]+/i.exec(line.slice(offset))?.[0];
    if (!name || names.has(name.toUpperCase())) throw invalid();
    names.add(name.toUpperCase());
    offset += name.length;
    if (line[offset++] !== "=") throw invalid();
    {
      let value = "";
      if (line[offset] === '"') {
        offset++;
        // Quotes are legal only at the start of a parameter value. RFC quoted
        // parameter text has no backslash escape that could hide a delimiter.
        while (offset < line.length && line[offset] !== '"') {
          if (/[\x00-\x08\x0a-\x1f\x7f]/.test(line[offset]!)) throw invalid();
          value += line[offset++];
        }
        if (line[offset++] !== '"') throw invalid();
        if (![",", ";", ":"].includes(line[offset] ?? "")) throw invalid();
      } else {
        while (offset < line.length && ![",", ";", ":"].includes(line[offset]!)) {
          const char = line[offset++]!;
          if (char === '"' || /[\x00-\x08\x0a-\x1f\x7f]/.test(char)) throw invalid();
          value += char;
        }
      }
      // ICAL decodes RFC6868 and text escapes before calculating the property
      // value offset. Multivalue parameter decoding can change that boundary.
      // Refuse encoded text and separators even within a single quoted value.
      if (/[\^\\,]/.test(value)) throw invalid();
      // ICAL does not preserve mixed quoted/unquoted parameter lists. Refuse
      // all lists here instead of allowing a second parser interpretation.
      if (line[offset] === ",") throw invalid();
      if (name.toUpperCase() === "VALUE" && value.toUpperCase() === "DATE") hasDate = true;
    }
  }
  if (line[offset] !== ":") throw invalid();
  return hasDate;
}

/** Public calendar import must check original DATE tokens before ICAL parses it. */
export function validateCalendarImportDates(data: string): void {
  const stack: string[] = [];
  for (const { unfolded } of calendarLines(data)) {
    const boundary = /^(BEGIN|END):([A-Z0-9-]+)$/i.exec(unfolded);
    if (boundary) {
      if (boundary[1].toUpperCase() === "BEGIN") stack.push(boundary[2].toUpperCase());
      else stack.pop();
      continue;
    }
    if (stack.join("/") === "VCALENDAR/VEVENT" && /^(RDATE|EXDATE)[;:]/i.test(unfolded) && hasDateValueParameter(unfolded)) recurrenceDateValues(unfolded);
  }
}
