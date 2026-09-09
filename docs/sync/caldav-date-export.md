# Calendar DATE recurrence export/import

The public calendar ICS exporter and the legacy CalDAV VEVENT serializer share
`toVevent` / `addRecurrence`. Both now retain explicit
`RDATE;VALUE=DATE:YYYYMMDD` and `EXDATE;VALUE=DATE:YYYYMMDD` properties on all-day
events. Previously the serializer silently skipped these parameterized lines,
so exporting an imported series could restore excluded dates and lose additions.

The public ICS import parser retains the DATE value type rather than converting
these properties into UTC DATE-TIME values. The RRULE and its original DTSTART
anchor remain unchanged: exclusions do not replenish COUNT, an excluded DTSTART
stays excluded, and additions can occur beyond the finite RRULE's last slot.
Property grouping may change during import; occurrence membership is preserved.
This is calendar serialization, not preservation of every original ICS byte.

Explicit DATE values must contain exactly eight digits and name a real calendar
date. All comma-separated tokens are checked. The narrow DATE contract refuses
quoted VALUE forms too; parameter detection respects quoted colons/semicolons so
embedded text cannot bypass the check or masquerade as a VALUE parameter.
The header parser permits quotes only at the start of a parameter value and
requires a delimiter after its closing quote; embedded/unclosed quotes and
trailing characters are rejected before ICAL parsing. Comma-separated parameter
values are refused: ICAL can interpret mixed quoted/unquoted lists differently
from the grammar. This restriction concerns header parameters, not the supported
comma-separated DATE property values. Encoded header text (caret or backslash),
commas inside quoted parameter values, and repeated parameter names are also
refused because decoding/multivalue merging can shift ICAL's computed property
value boundary. Accepted quoted-punctuation controls are
verified through ICAL and the public import/export serializer, not only the raw
validator.
Public import validates unfolded
original property text before ICAL can normalize malformed tokens, and validates
all accepted master fields before creating a destination calendar. DATE values
on timed events, unrepresentable dated recurrence without an RRULE, and invalid
DATE tokens are refused. Export also refuses unsupported dated property forms
instead of silently dropping them. Serializer refusals are typed unsupported
recurrence errors, so legacy native preflight preserves their meaning instead of
reporting unknown write permission. Valid legacy bare DATE-TIME serialization
keeps its existing UTC behavior, including conversion to DATE for all-day events;
VTODO import keeps its prior representation.

The existing native content-patch/create callers also reuse this serializer.
This fix does not enable any new native recurrence write capability, change
resource CAS, or relax the dedicated series writer's preservation guards. It
adds no UI, feature activation, provider calls, or dependency. Detached import
fidelity, PERIOD values, new dated recurrence editor actions, and arbitrary
parameter/timezone conversion remain outside this slice.

## Verification

`apps/api/src/sync/adapters/caldav_date_export.test.ts` is registered in the API
unit suite. It uses the public export serializer and import parser for a finite
COUNT series with an excluded DTSTART, another exclusion, and additions beyond
the rule. It checks the exact visible date set through two round trips, including
the public importer's legacy time-model path; folded properties; malformed date
refusal; DATE-TIME compatibility; and public-handler rejection before any
calendar write. The existing CalDAV adapter suite verifies prior task and event
serialization behavior. No live-provider acceptance is claimed.

```sh
node --import tsx apps/api/src/sync/adapters/caldav_date_export.test.ts
node --import tsx apps/api/src/sync/adapters/caldav.test.ts
```
