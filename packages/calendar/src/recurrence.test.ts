import assert from 'node:assert/strict'
import { excludeOccurrence, expandRecurringEvents } from './recurrence'
import type { ICalendarEventBase } from './interfaces'

// Every assertion here pins a timezone. Recurrence is the one part of the
// calendar whose correctness depends on the machine it runs on: the same rule
// has to survive a daylight-saving change in Prague, in New York (which changes
// on different dates) and in UTC (which never changes). A suite that only ever
// runs in the author's zone proves none of that — the wall-clock bug this file
// covers passed a green suite for months.
//
// Note that the Date objects are built INSIDE the pinned zone. A `new Date(
// '2026-03-25T09:00:00')` outside it is parsed against whatever the machine
// happens to be set to, which is how a timezone test ends up testing nothing.
function inZone<T>(zone: string, body: () => T): T {
  const previous = process.env.TZ
  process.env.TZ = zone
  try {
    return body()
  } finally {
    process.env.TZ = previous
  }
}

/** Local wall clock as "YYYY-MM-DD HH:mm", which is what a user actually reads. */
function wallClock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

type Series = {
  end: string
  isAllDay?: boolean
  recurrence?: string
  start: string
}

function series({ end, isAllDay, recurrence = 'FREQ=DAILY', start }: Series): ICalendarEventBase {
  return {
    end: new Date(end),
    id: 'standup',
    isAllDay,
    recurrence,
    start: new Date(start),
    title: 'Standup',
  }
}

/** Wall clock of every occurrence in [from, to], as seen from `zone`. */
function clocksIn(zone: string, definition: Series, from: string, to: string): string[] {
  return inZone(zone, () =>
    expandRecurringEvents([series(definition)], new Date(from), new Date(to)).map(
      (occurrence) => wallClock(occurrence.start),
    ),
  )
}

// ── Spring forward ────────────────────────────────────────────────────────────
// Europe/Prague loses an hour at 02:00 on 2026-03-29. A 09:00 standup is a 09:00
// standup on both sides of it; before this was fixed it became 10:00.
assert.deepEqual(
  clocksIn(
    'Europe/Prague',
    { end: '2026-03-25T09:30:00', start: '2026-03-25T09:00:00' },
    '2026-03-27T00:00:00',
    '2026-03-31T00:00:00',
  ),
  ['2026-03-27 09:00', '2026-03-28 09:00', '2026-03-29 09:00', '2026-03-30 09:00'],
)

// ── Fall back ─────────────────────────────────────────────────────────────────
// And gains it back at 03:00 on 2026-10-25.
assert.deepEqual(
  clocksIn(
    'Europe/Prague',
    { end: '2026-10-23T09:30:00', start: '2026-10-23T09:00:00' },
    '2026-10-23T00:00:00',
    '2026-10-27T00:00:00',
  ),
  ['2026-10-23 09:00', '2026-10-24 09:00', '2026-10-25 09:00', '2026-10-26 09:00'],
)

// A zone that changes on other dates entirely: New York springs forward on
// 2026-03-08, three weeks before Europe.
assert.deepEqual(
  clocksIn(
    'America/New_York',
    { end: '2026-03-06T08:30:00', start: '2026-03-06T08:00:00' },
    '2026-03-06T00:00:00',
    '2026-03-10T00:00:00',
  ),
  ['2026-03-06 08:00', '2026-03-07 08:00', '2026-03-08 08:00', '2026-03-09 08:00'],
)

// A zone without daylight saving must be untouched by any of this.
assert.deepEqual(
  clocksIn(
    'UTC',
    { end: '2026-03-25T09:30:00', start: '2026-03-25T09:00:00' },
    '2026-03-27T00:00:00',
    '2026-03-31T00:00:00',
  ),
  ['2026-03-27 09:00', '2026-03-28 09:00', '2026-03-29 09:00', '2026-03-30 09:00'],
)

// An occurrence starting before the window still belongs when its end overlaps it.
assert.deepEqual(
  clocksIn(
    'UTC',
    { end: '2026-03-25T11:00:00', start: '2026-03-25T09:00:00' },
    '2026-03-27T10:00:00',
    '2026-03-27T10:30:00',
  ),
  ['2026-03-27 09:00'],
)

// A half-hour offset, because an hour of slack hides bugs an odd offset exposes.
assert.deepEqual(
  clocksIn(
    'Asia/Kolkata',
    { end: '2026-03-25T09:30:00', start: '2026-03-25T09:00:00' },
    '2026-03-28T00:00:00',
    '2026-03-30T00:00:00',
  ),
  ['2026-03-28 09:00', '2026-03-29 09:00'],
)

// ── The hour that does not exist ──────────────────────────────────────────────
// 02:30 never happens on 2026-03-29 in Prague. The occurrence still belongs to
// that day — dropping it would silently lose a meeting.
assert.deepEqual(
  clocksIn(
    'Europe/Prague',
    { end: '2026-03-27T03:00:00', start: '2026-03-27T02:30:00' },
    '2026-03-28T00:00:00',
    '2026-03-30T00:00:00',
  ),
  ['2026-03-28 02:30', '2026-03-29 03:30'],
)

// ── Cancelled occurrences survive the change ──────────────────────────────────
// EXDATE is stored in UTC. Delete an occurrence that falls after a DST change and
// it must stay deleted: the offset the stamp was written with is not the offset
// the series started with.
{
  const zone = 'Europe/Prague'
  const cancelled = inZone(zone, () => {
    const occurrences = expandRecurringEvents(
      [series({ end: '2026-03-25T09:30:00', start: '2026-03-25T09:00:00' })],
      new Date('2026-03-29T00:00:00'),
      new Date('2026-03-30T00:00:00'),
    )
    assert.equal(occurrences.length, 1, 'expected exactly the 29 March occurrence')
    return excludeOccurrence('RRULE:FREQ=DAILY', occurrences[0]!.start)
  })

  assert.deepEqual(
    clocksIn(
      zone,
      {
        end: '2026-03-25T09:30:00',
        recurrence: cancelled,
        start: '2026-03-25T09:00:00',
      },
      '2026-03-27T00:00:00',
      '2026-03-31T00:00:00',
    ),
    ['2026-03-27 09:00', '2026-03-28 09:00', '2026-03-30 09:00'],
  )
}

// ── UNTIL is an instant, and still has to bound the wall clock ────────────────
// 2026-03-30T07:30:00Z is 09:30 in Prague, just after that morning's occurrence.
assert.deepEqual(
  clocksIn(
    'Europe/Prague',
    {
      end: '2026-03-25T09:30:00',
      recurrence: 'FREQ=DAILY;UNTIL=20260330T073000Z',
      start: '2026-03-25T09:00:00',
    },
    '2026-03-27T00:00:00',
    '2026-04-05T00:00:00',
  ),
  ['2026-03-27 09:00', '2026-03-28 09:00', '2026-03-29 09:00', '2026-03-30 09:00'],
)

// ── All-day events stay on their date ─────────────────────────────────────────
// They are stored as UTC midnight of a timezone-invariant date, so they must NOT
// go through the wall-clock frame: in a negative-offset zone that midnight reads
// as the previous evening, and a weekly series would slide a day backwards.
{
  const days = inZone('America/New_York', () =>
    expandRecurringEvents(
      [
        series({
          end: '2026-07-06T00:00:00.000Z',
          isAllDay: true,
          recurrence: 'FREQ=WEEKLY',
          start: '2026-07-06T00:00:00.000Z',
        }),
      ],
      new Date('2026-07-01T00:00:00.000Z'),
      new Date('2026-07-31T00:00:00.000Z'),
    ).map((occurrence) => occurrence.start.toISOString().slice(0, 10)),
  )

  assert.deepEqual(days, ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'])
}

// ── Durations are kept as elapsed time ────────────────────────────────────────
// A 30-minute meeting is 30 minutes even on the day the clocks move.
{
  const durations = inZone('Europe/Prague', () =>
    expandRecurringEvents(
      [series({ end: '2026-03-25T09:30:00', start: '2026-03-25T09:00:00' })],
      new Date('2026-03-28T00:00:00'),
      new Date('2026-03-30T00:00:00'),
    ).map((occurrence) => occurrence.end.getTime() - occurrence.start.getTime()),
  )

  assert.deepEqual(durations, [30 * 60_000, 30 * 60_000])
}

console.log('recurrence: ok')
