// Diagnostic only: every mutation is bound to a series created by this run.
// Never use this reconstruction experiment as a production repair algorithm.
import { randomUUID } from 'node:crypto';

const SCENARIOS = ['exceptions-clock', 'cancelled-clock', 'mixed-duration', 'mixed-explicit-rule', 'restore-exceptions', 'individual-partial'];
const validID = value => typeof value === 'string' && value.trim() === value && value.length > 0 && !['.', '..'].includes(value);
const GRAPH = 'https://graph.microsoft.com/v1.0';
const requireProof = condition => { if (!condition) throw new Error('incomplete-probe-evidence'); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stamp = (date, clock) => ({ dateTime: `${date}T${clock}`, timeZone: 'UTC' });
const slotDate = event => event.originalStart?.slice(0, 10);
const editable = event => ({ subject: event.subject, body: event.body, location: event.location, start: event.start, end: event.end });

export async function probeOutlookSeriesExceptions({ token, guest, allowInvitations = false, fetchImpl = fetch, scenarios = SCENARIOS, now = new Date(), settle = () => new Promise(resolve => setTimeout(resolve, 1500)), checkpoint = async () => {} }) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Access token required');
  if (guest !== undefined && (!allowInvitations || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest))) throw new Error('Explicit invitation authorization and one guest required');
  if (!Array.isArray(scenarios) || !scenarios.length || new Set(scenarios).size !== scenarios.length || scenarios.some(value => !SCENARIOS.includes(value))) throw new Error('Known distinct probe scenarios required');
  const runID = randomUUID(), report = { schemaVersion: 1, startedAt: now.toISOString(), completed: false, cases: [], notificationDelivery: guest ? 'unknown' : 'not-applicable' };
  const known = new Set();
  const allowedGuests = event => event.isOrganizer === true && Array.isArray(event.attendees) && event.attendees.length === (guest ? 1 : 0) && (!guest || event.attendees[0].emailAddress?.address?.toLowerCase() === guest.toLowerCase());
  const day = offset => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const firstDate = day(28);
  let base;
  async function request(method, path, body, etag) {
    const target = path.split('?')[0];
    if (method !== 'GET') requireProof(method === 'POST' && target === base || known.has(target) || method === 'POST' && target.endsWith('/cancel') && known.has(target.slice(0, -7)));
    const response = await fetchImpl(GRAPH + path, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC"', 'Cache-Control': 'no-cache', ...(etag ? { 'If-Match': etag } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  async function read(path) { const result = await request('GET', path.includes('?') ? path : `${path}?$select=*,originalStart`); requireProof(result.status === 200 && validID(result.data?.id) && result.data['@odata.etag'] && allowedGuests(result.data)); return result.data; }
  const pathFor = event => `${base}/${encodeURIComponent(event.id)}`;
  async function snapshot(path) {
    const master = await read(`${path}?$select=*,originalStart,cancelledOccurrences,exceptionOccurrences&$expand=exceptionOccurrences`);
    const list = await request('GET', `${path}/instances?startDateTime=${day(27)}T00:00:00Z&endDateTime=${day(43)}T00:00:00Z&$top=50&$select=*,originalStart`);
    requireProof(list.status === 200 && Array.isArray(list.data?.value) && !list.data['@odata.nextLink'] && Array.isArray(master.cancelledOccurrences) && Array.isArray(master.exceptionOccurrences));
    for (const event of list.data.value) { requireProof(validID(event.id) && allowedGuests(event) && event.seriesMasterId === master.id && event.originalStart && event['@odata.etag']); known.add(pathFor(event)); }
    return { master, instances: list.data.value.sort((a, b) => slotDate(a).localeCompare(slotDate(b))) };
  }
  const own = await request('GET', '/me/calendar?$select=id,canEdit,isDefaultCalendar');
  requireProof(own.status === 200 && own.data?.canEdit === true && validID(own.data.id));
  base = `/me/calendars/${encodeURIComponent(own.data.id)}/events`;
  for (const scenario of scenarios) {
    const item = { scenario, meeting: !!guest, completed: false, cleanup: 'not-created', checks: {} }; report.cases.push(item);
    const subject = `Musubi QA exception ${runID.slice(0, 8)} ${scenario}`;
    let path, cancellationStarted = false;
    try {
      item.cleanup = 'creation-unconfirmed';
      const created = await request('POST', base, { transactionId: randomUUID(), subject, body: { contentType: 'html', content: '<p>Disposable <b>Musubi</b> exception preservation probe.</p>' }, location: { displayName: 'Test office' }, isAllDay: false, isReminderOn: false, showAs: 'free', start: stamp(firstDate, '09:00:00'), end: stamp(firstDate, '10:00:00'), recurrence: { pattern: { type: 'daily', interval: 3 }, range: { type: 'numbered', numberOfOccurrences: 5, startDate: firstDate, recurrenceTimeZone: 'UTC' } }, attendees: guest ? [{ emailAddress: { address: guest }, type: 'required', status: { response: 'accepted', time: now.toISOString() } }] : [] });
      requireProof(created.status === 201 && validID(created.data?.id));
      path = pathFor(created.data); known.add(path); item.cleanup = 'required';
      // Private identity checkpoint permits fixture-only cleanup after a crash.
      await checkpoint({ runID, path, subject, meeting: !!guest });
      await settle();
      const initial = await snapshot(path); requireProof(initial.instances.length === 5 && initial.master.isOrganizer === true && initial.master.subject === subject);
      const hasExceptions = scenario !== 'cancelled-clock', hasCancellation = scenario !== 'exceptions-clock';
      if (hasExceptions) {
        const content = initial.instances[1], moved = initial.instances[2];
        requireProof((await request('PATCH', pathFor(content), { subject: 'Disposable independent title', body: { contentType: 'html', content: '<p>Keep <b>these independent notes</b>.</p>' }, location: { displayName: 'Independent room' } }, content['@odata.etag'])).status === 200);
        const currentMoved = await read(pathFor(moved));
        requireProof((await request('PATCH', pathFor(moved), { start: stamp(slotDate(moved), '11:00:00'), end: stamp(slotDate(moved), '12:30:00') }, currentMoved['@odata.etag'])).status === 200);
      }
      const cancelledDate = slotDate(initial.instances[3]);
      if (hasCancellation) {
        const cancelled = await read(pathFor(initial.instances[3]));
        const result = await request(guest ? 'POST' : 'DELETE', pathFor(cancelled) + (guest ? '/cancel' : ''), guest ? {} : undefined, cancelled['@odata.etag']);
        requireProof(result.status === (guest ? 202 : 204));
      }
      await settle();
      const before = await snapshot(path);
      requireProof(before.master.exceptionOccurrences.length === (hasExceptions ? 2 : 0) && before.master.cancelledOccurrences.length === (hasCancellation ? 1 : 0));
      const exceptions = before.instances.filter(event => event.type === 'exception');
      item.checks.before = { active: before.instances.length, exceptions: exceptions.length, cancellations: before.master.cancelledOccurrences.length };
      if (scenario === 'individual-partial') {
        const ordinary = before.instances.filter(event => event.type === 'occurrence'); requireProof(ordinary.length === 2);
        // After the first accepted edit, race the second with a separate change.
        // Re-read each ETag so family-wide token changes do not mask partial success.
        const statuses = [];
        const first = await read(pathFor(ordinary[0]));
        statuses.push((await request('PATCH', pathFor(first), { start: stamp(slotDate(first), '13:00:00'), end: stamp(slotDate(first), '14:00:00') }, first['@odata.etag'])).status);
        requireProof(statuses[0] === 200);
        const second = await read(pathFor(ordinary[1]));
        requireProof((await request('PATCH', pathFor(second), { location: { displayName: 'Disposable concurrent change' } }, second['@odata.etag'])).status === 200);
        statuses.push((await request('PATCH', pathFor(second), { start: stamp(slotDate(second), '13:00:00'), end: stamp(slotDate(second), '14:00:00') }, second['@odata.etag'])).status);
        const after = await snapshot(path);
        item.checks.individualStatuses = statuses;
        item.checks.firstChangedDespiteLaterFailure = after.instances.find(event => slotDate(event) === slotDate(ordinary[0]))?.start.dateTime.slice(11, 19) === '13:00:00' && statuses[1] === 412;
        item.checks.masterClockUnchanged = same(after.master.start, before.master.start);
        item.checks.originalExceptionsUnchanged = exceptions.every(event => { const next = after.instances.find(value => value.id === event.id); return next && same(editable(next), editable(event)); });
        item.checks.cancellationPreserved = !after.instances.some(event => slotDate(event) === cancelledDate) && same(after.master.cancelledOccurrences, before.master.cancelledOccurrences);
      } else {
        const patch = { ...(scenario === 'mixed-duration' ? {} : { start: stamp(firstDate, '13:00:00') }), end: stamp(firstDate, scenario === 'mixed-duration' ? '10:30:00' : '14:00:00'), ...(scenario === 'mixed-explicit-rule' ? { recurrence: before.master.recurrence } : {}) };
        const result = await request('PATCH', path, patch, before.master['@odata.etag']);
        item.checks.patchStatus = result.status; requireProof(result.status === 200);
        await settle();
        const after = await snapshot(path);
        item.checks.after = { active: after.instances.length, exceptions: after.master.exceptionOccurrences.length, cancellations: after.master.cancelledOccurrences.length };
        item.checks.nativeRuleUnchanged = same(after.master.recurrence, before.master.recurrence);
        item.checks.originalExceptionIDsPreserved = exceptions.every(event => after.instances.some(value => value.id === event.id && value.type === 'exception'));
        item.checks.independentContentPreserved = exceptions.every(event => { const next = after.instances.find(value => slotDate(value) === slotDate(event)); return next && same({ subject: next.subject, body: next.body, location: next.location }, { subject: event.subject, body: event.body, location: event.location }); });
        item.checks.cancelledSlotRevived = hasCancellation && after.instances.some(event => slotDate(event) === cancelledDate);
        item.checks.masterResponses = after.master.attendees.map(value => value.status.response);
        if (scenario === 'restore-exceptions') {
          const statuses = [];
          for (const exception of exceptions) {
            const target = after.instances.find(event => slotDate(event) === slotDate(exception)); requireProof(target);
            const current = await read(pathFor(target));
            statuses.push((await request('PATCH', pathFor(target), editable(exception), current['@odata.etag'])).status);
          }
          const revived = after.instances.find(event => slotDate(event) === cancelledDate); requireProof(revived);
          const current = await read(pathFor(revived));
          statuses.push((await request(guest ? 'POST' : 'DELETE', pathFor(revived) + (guest ? '/cancel' : ''), guest ? {} : undefined, current['@odata.etag'])).status);
          await settle();
          const restored = await snapshot(path);
          item.checks.restoreStatuses = statuses;
          item.checks.restoreContentAndTimes = exceptions.every(event => { const next = restored.instances.find(value => slotDate(value) === slotDate(event)); return next && same(editable(next), editable(event)); });
          item.checks.restoreOriginalExceptionIDs = exceptions.every(event => restored.instances.some(value => value.id === event.id));
          item.checks.restoreOriginalExceptionUIDs = exceptions.every(event => { const next = restored.instances.find(value => slotDate(value) === slotDate(event)); return next?.iCalUId === event.iCalUId; });
          item.checks.restoreCancellation = !restored.instances.some(event => slotDate(event) === cancelledDate) && restored.master.cancelledOccurrences.length === 1;
          item.checks.restoreExceptionResponses = exceptions.every(event => { const next = restored.instances.find(value => slotDate(value) === slotDate(event)); return next && same(next.attendees.map(value => value.status), event.attendees.map(value => value.status)); });
          item.checks.restoreWriteCount = statuses.length;
        }
      }
      item.completed = true;
    } catch { item.error = 'probe-incomplete'; }
    finally {
      if (path) {
        try {
          const current = await request('GET', path);
          if (current.status === 404) item.cleanup = 'verified';
          else {
            requireProof(current.status === 200 && current.data?.subject === subject && current.data.isOrganizer === true);
            requireProof(current.data.attendees.length === (guest ? 1 : 0) && (!guest || current.data.attendees[0].emailAddress.address.toLowerCase() === guest.toLowerCase()));
            cancellationStarted = true;
            const removed = await request(guest ? 'POST' : 'DELETE', path + (guest ? '/cancel' : ''), guest ? {} : undefined, current.data['@odata.etag']);
            item.cleanupStatus = removed.status;
            for (let attempt = 0; attempt < 4; attempt++) {
              if ((await request('GET', path)).status === 404) { item.cleanup = 'verified'; break; }
              await settle();
            }
          }
        } catch { item.cleanup = cancellationStarted ? 'unconfirmed' : 'failed'; }
        await checkpoint(item.cleanup === 'verified' ? null : { runID, path, subject, meeting: !!guest, cancellationStarted });
      }
    }
    if (!item.completed || item.cleanup !== 'verified') break;
  }
  report.completed = report.cases.length === scenarios.length && report.cases.every(item => item.completed && item.cleanup === 'verified');
  return report;
}
