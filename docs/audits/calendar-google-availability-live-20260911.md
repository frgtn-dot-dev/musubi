# Google availability: live web acceptance, 2026-09-11

## Scope and environment

Local development Musubi on ports 3000/7531, with the availability flag enabled
only in the private development configuration. The owner explicitly approved
Google calendar and free/busy OAuth permissions. Tasks permission was excluded
from this reconnect. Production activation and release remain separate.

The in-app browser was driven through CUA Playwright because a dedicated Browser
plugin was unavailable. Two already authorized Google accounts were used: one
owned a new disposable secondary calendar, the other subscribed with
free/busy-only access. Existing calendars and events were not changed.

## Observed results

- Google reconnect completed with the free/busy permission. The development
  callback returned to port 7531, which does not serve the web app; navigating
  back to port 3000 retained the authenticated session. This routing limitation
  is not a successful end-to-end callback UX claim.
- The secondary calendar was shared privately, not publicly. Its two guest-free
  events on September 22 had no reminders: a private opaque event at 10:00–11:00
  Europe/Prague with synthetic title, location and description, and a transparent
  event at 14:00–15:00.
- Discovery showed the source under Connections, initially disabled. Checking
  availability was disabled until explicit selection. No normal event mirror
  appeared in the calendar grid.
- The interval dialog returned only `2026-09-22T08:00:00.000Z` through
  `2026-09-22T09:00:00.000Z`. It exposed no event title, location or description;
  the transparent event did not block availability. A range before the fixtures
  returned confirmed empty intervals.
- Day view initially showed no availability overlay. Explicit session/page
  opt-in produced a static Busy note at 10:00–11:00, without event edit actions.
  Switching to September 23 removed the old interval; week view correctly
  showed the September 22 interval. This is rendered browser evidence, not
  physical native-device acceptance.
- A new manual refresh action ran against the real connected accounts. During
  refresh, availability was suspended, including after closing Connections;
  the grid explicitly said no free time was confirmed yet.
- Removing the test share in Google and refreshing in Musubi retired the source,
  disabled interval checks and removed its grid interval. The grid reported no
  selected sources instead of claiming free time.
- The disposable secondary calendar and both synthetic events were deleted
  after the test. Existing account connections were retained.

## Finding and fix

Connections instructed users to refresh connected calendars but offered no
manual refresh action. It now calls the existing authenticated sync endpoint,
shows pending/error feedback, and reconciles calendars, events, tasks and
availability after success or failure. Interval readers remain suspended while
discovery is running, even if the dialog closes.

Targeted regressions cover success/failure reconciliation, no-mirror discovery,
the rendered action and closing the dialog during refresh. Independent review
found no actionable issues in the implementation.

## Remaining evidence

Automatic approval review blocked upgrading this test calendar's share from
free/busy to full detail/edit access. Consequently writer → limited writer/reader
→ writer transitions, open-editor redaction and same-ETag restoration were not
live-tested here. They require explicit approval of those test ACL changes.
Existing automated evidence remains distinct from this live acceptance.

This run did not independently exercise raw API stale-generation/disabled-source
rejection, response headers, offline/device behavior, in-flight provider races or
older clients. Those retain their existing automated evidence and stated limits.
CUA date-input `fill` did not update the React-controlled range; native arrow-key
input did and was used for the accepted live result.
