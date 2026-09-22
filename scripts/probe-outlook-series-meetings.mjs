// Bounded live evidence, not a production writer. Only events created by this
// run may be mutated. Meeting probes require explicit recipient authorization.
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const validID = value => typeof value === 'string' && value.trim() === value && value.length > 0 && !['.', '..'].includes(value);
const version = value => typeof value === 'string' && /^W\/"[^"\r\n]+"$/.test(value);
const requireProof = condition => { if (!condition) throw new Error('incomplete-probe-evidence'); };

export async function probeOutlookSeriesMeetings({ token, guest, allowInvitations = false, fetchImpl = fetch, now = new Date(), settle = () => new Promise(resolve => setTimeout(resolve, 1500)) }) {
  if (!token || /[\r\n]/.test(token)) throw new Error('Access token required');
  if (guest !== undefined && (!allowInvitations || typeof guest !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guest))) throw new Error('Explicit invitation authorization and one guest address required');
  const runID = randomUUID(), name = `Musubi QA scope ${runID.slice(0, 8)}`;
  const report = { schemaVersion: 1, runID, startedAt: now.toISOString(), completed: false, cases: [], requests: [], cleanup: 'not-created', notificationDelivery: 'not-tested' };
  const createdPaths = new Set(), meetings = new Set(), possibleCancellations = new Set();
  let calendarPath;
  async function request(label, method, path, body, etag) {
    const target = path.split('?')[0];
    if (['PATCH', 'DELETE'].includes(method) || method === 'POST' && target.endsWith('/cancel')) {
      requireProof(target === calendarPath || createdPaths.has(target) || target.endsWith('/cancel') && createdPaths.has(target.slice(0, -7)));
    }
    const cancelling = method === 'POST' && target.endsWith('/cancel');
    if (cancelling) {
      requireProof(!possibleCancellations.has(target));
      possibleCancellations.add(target);
    }
    const response = await fetchImpl(`${GRAPH}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"', 'Cache-Control': 'no-cache', ...(etag ? { 'If-Match': etag } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (cancelling && [401, 403, 412, 429].includes(response.status)) possibleCancellations.delete(target);
    const requestID = response.headers.get('request-id');
    report.requests.push({ label, method, status: response.status, ...(requestID && /^[0-9a-f-]{36}$/i.test(requestID) ? { requestID } : {}) });
    return { status: response.status, data: await response.json().catch(() => null) };
  }
  async function read(label, path) {
    const result = await request(label, 'GET', path);
    requireProof(result.status === 200 && validID(result.data?.id) && version(result.data?.['@odata.etag']));
    return result.data;
  }
  const day = offset => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  function body(label, allDay, recurring, invited) {
    return {
      subject: `${name} ${label}`, transactionId: randomUUID(), isReminderOn: false, showAs: 'free', isAllDay: allDay,
      body: { contentType: 'text', content: 'Disposable Musubi integration verification.' },
      start: { dateTime: `${day(7)}T${allDay ? '00:00:00' : '10:00:00'}`, timeZone: 'UTC' },
      end: { dateTime: `${day(allDay ? 8 : 7)}T${allDay ? '00:00:00' : '11:00:00'}`, timeZone: 'UTC' },
      attendees: invited ? [{ emailAddress: { address: guest }, type: 'required' }] : [],
      ...(recurring ? { recurrence: { pattern: { type: 'daily', interval: 1 }, range: { type: 'numbered', startDate: day(7), numberOfOccurrences: 3, recurrenceTimeZone: 'UTC' } } } : {}),
    };
  }
  async function create(label, base, payload, invited = false) {
    if (invited) report.possibleUntrackedInvitation = true;
    const result = await request(`${label}:create`, 'POST', `${base}/events`, payload);
    requireProof(result.status === 201 && validID(result.data?.id));
    const path = `${base}/events/${encodeURIComponent(result.data.id)}`;
    createdPaths.add(path);
    if (invited) { meetings.add(path); delete report.possibleUntrackedInvitation; }
    await settle();
    return path;
  }
  async function instances(label, path) {
    const result = await request(label, 'GET', `${path}/instances?startDateTime=${day(6)}T00:00:00Z&endDateTime=${day(12)}T00:00:00Z&$top=10`);
    requireProof(result.status === 200 && Array.isArray(result.data?.value) && !result.data['@odata.nextLink']);
    const parentID = decodeURIComponent(path.split('/').at(-1));
    const ids = new Set();
    for (const event of result.data.value) {
      requireProof(validID(event.id) && event.seriesMasterId === parentID && ['occurrence', 'exception'].includes(event.type) && !ids.has(event.id));
      ids.add(event.id);
      createdPaths.add(`${path.slice(0, path.lastIndexOf('/'))}/${encodeURIComponent(event.id)}`);
    }
    return result.data.value.sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime));
  }
  const eventPath = (master, event) => `${master.slice(0, master.lastIndexOf('/'))}/${encodeURIComponent(event.id)}`;
  async function absent(label, path) {
    for (let i = 0; i < 4; i++) {
      const r = await request(`${label}:${i + 1}`, 'GET', path);
      if (r.status === 404) return true;
      if (r.status !== 200) return false;
      await settle();
    }
    return false;
  }
  try {
    report.cleanup = 'creation-unconfirmed';
    const calendar = await request('create-test-calendar', 'POST', '/me/calendars', { name });
    requireProof(calendar.status === 201 && validID(calendar.data?.id));
    calendarPath = `/me/calendars/${encodeURIComponent(calendar.data.id)}`;
    report.cleanupCalendarID = calendar.data.id; report.cleanup = 'required';
    requireProof(calendar.data.canEdit === true);
    for (const allDay of [false, true]) {
      const label = allDay ? 'personal-all-day-series' : 'personal-timed-series';
      const item = { scenario: label, checks: {} }; report.cases.push(item);
      const path = await create(label, calendarPath, body(label, allDay, true, false));
      const master = await read(`${label}:master-before`, path);
      requireProof(master.type === 'seriesMaster' && master.attendees?.length === 0);
      const children = await instances(`${label}:instances`, path); requireProof(children.length === 3);
      const occurrencePath = eventPath(path, children[0]);
      const before = await read(`${label}:occurrence-before`, occurrencePath);
      const patch = await request(`${label}:occurrence-fresh-patch`, 'PATCH', occurrencePath, { subject: `${name} changed occurrence` }, before['@odata.etag']);
      const changed = await read(`${label}:occurrence-after`, occurrencePath);
      item.checks.freshOccurrencePatch = patch.status === 200 && changed.subject === `${name} changed occurrence` && changed.type === 'exception';
      requireProof(item.checks.freshOccurrencePatch && changed['@odata.etag'] !== before['@odata.etag']);
      const parentAfterChild = await read(`${label}:master-after-child`, path);
      item.checks.masterVersionChangedByChild = master['@odata.etag'] !== parentAfterChild['@odata.etag'];
      const stale = await request(`${label}:occurrence-stale-patch`, 'PATCH', occurrencePath, { subject: `${name} stale occurrence` }, before['@odata.etag']);
      item.checks.staleOccurrencePatchRejected = stale.status === 412 && (await read(`${label}:occurrence-after-stale`, occurrencePath)).subject === changed.subject;
      const parentPatch = await request(`${label}:master-old-version-patch`, 'PATCH', path, { subject: `${name} parent changed` }, master['@odata.etag']);
      item.checks.masterOldVersionPatchStatus = parentPatch.status;
      const changedParent = await read(`${label}:master-after-patch`, path);
      item.checks.exceptionUnchangedAfterMasterAttempt = (await read(`${label}:exception-after-master-patch`, occurrencePath)).subject === changed.subject;
      const oldParentTag = changedParent['@odata.etag'];
      requireProof((await request(`${label}:master-concurrent-edit`, 'PATCH', path, { location: { displayName: 'Synthetic concurrent change' } }, oldParentTag)).status === 200);
      const staleParent = await request(`${label}:master-stale-patch`, 'PATCH', path, { subject: `${name} stale parent` }, oldParentTag);
      item.checks.staleMasterPatchRejected = staleParent.status === 412 && (await read(`${label}:master-after-stale-patch`, path)).subject === changedParent.subject;
      const deleteOccurrence = await request(`${label}:occurrence-stale-delete`, 'DELETE', occurrencePath, undefined, before['@odata.etag']);
      item.checks.staleOccurrenceDeleteStatus = deleteOccurrence.status;
      item.checks.deletedOccurrenceAbsent = await absent(`${label}:occurrence-after-delete`, occurrencePath);
      const remaining = await instances(`${label}:remaining-instances`, path);
      item.checks.otherOccurrencesPreserved = remaining.length === 2 && remaining.every(child => children.slice(1).some(original => original.id === child.id));
      const deleteMaster = await request(`${label}:master-stale-delete`, 'DELETE', path, undefined, oldParentTag);
      item.checks.staleMasterDeleteStatus = deleteMaster.status;
      item.checks.masterAbsent = await absent(`${label}:master-after-delete`, path);
      item.checks.childrenAbsent = true;
      for (const child of remaining) if (!await absent(`${label}:child-after-master-delete`, eventPath(path, child))) item.checks.childrenAbsent = false;
    }
    if (guest !== undefined) {
      const own = await request('default-calendar', 'GET', '/me/calendar?$select=id,canEdit');
      requireProof(own.status === 200 && validID(own.data?.id) && own.data.canEdit === true);
      const base = `/me/calendars/${encodeURIComponent(own.data.id)}`;
      for (const recurring of [false, true]) {
        const label = recurring ? 'organizer-recurring-meeting' : 'organizer-one-off-meeting';
        const item = { scenario: label, checks: {} }; report.cases.push(item);
        const path = await create(label, base, body(label, false, recurring, true), true);
        report.notificationDelivery = 'unknown';
        const before = await read(`${label}:before`, path);
        requireProof(before.isOrganizer === true && before.attendees?.length === 1 && before.attendees[0].emailAddress?.address.toLowerCase() === guest.toLowerCase());
        let target = path, targetBefore = before, children;
        if (recurring) {
          children = await instances(`${label}:instances`, path); requireProof(children.length === 3);
          target = eventPath(path, children[0]); targetBefore = await read(`${label}:occurrence-before`, target);
        }
        const patch = await request(`${label}:fresh-patch`, 'PATCH', target, { subject: `${name} meeting updated` }, targetBefore['@odata.etag']);
        const changed = await read(`${label}:after-patch`, target);
        item.checks.freshPatchAccepted = patch.status === 200 && changed.subject === `${name} meeting updated`;
        requireProof(item.checks.freshPatchAccepted && targetBefore['@odata.etag'] !== changed['@odata.etag']);
        const stale = await request(`${label}:stale-patch`, 'PATCH', target, { subject: `${name} stale meeting` }, targetBefore['@odata.etag']);
        item.checks.stalePatchRejected = stale.status === 412 && (await read(`${label}:after-stale-patch`, target)).subject === changed.subject;
        const cancel = await request(`${label}:stale-cancel`, 'POST', `${target}/cancel`, { comment: 'Musubi integration test finished; this test meeting is cancelled.' }, targetBefore['@odata.etag']);
        item.checks.staleCancelStatus = cancel.status;
        item.checks.cancelledCopyAbsent = await absent(`${label}:after-cancel`, target);
        if (item.checks.cancelledCopyAbsent && !recurring) meetings.delete(path);
        if (recurring) {
          const remaining = await instances(`${label}:remaining-instances`, path);
          item.checks.otherOccurrencesPreserved = remaining.length === 2 && remaining.every(child => children.slice(1).some(original => original.id === child.id));
        }
      }
    }
    report.completed = true;
  } catch {
    report.error = 'probe-incomplete';
  } finally {
    const outstanding = [];
    for (const path of meetings) {
      try {
        if (!await absent('cleanup-meeting-read', path)) {
          if (possibleCancellations.has(`${path}/cancel`)) { outstanding.push(path); continue; }
          await request('cleanup-meeting-cancel', 'POST', `${path}/cancel`, { comment: 'Musubi integration test cleanup; this test meeting is cancelled.' });
          if (!await absent('cleanup-meeting-verify', path)) outstanding.push(path);
        }
      } catch { outstanding.push(path); }
    }
    if (outstanding.length) report.cleanupMeetingPaths = outstanding;
    if (calendarPath) {
      try {
        const removed = await request('cleanup-test-calendar', 'DELETE', calendarPath);
        const gone = await request('cleanup-test-calendar-read', 'GET', calendarPath);
        report.cleanup = [204, 404].includes(removed.status) && gone.status === 404 ? 'verified' : 'failed';
        if (report.cleanup === 'verified') delete report.cleanupCalendarID;
      } catch { report.cleanup = 'failed'; }
    }
    if (outstanding.length || report.possibleUntrackedInvitation) report.cleanup = 'incomplete';
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--live')) throw new Error('Live probe requires --live');
  const guest = process.env.OUTLOOK_QA_GUEST;
  const report = await probeOutlookSeriesMeetings({ token: process.env.OUTLOOK_CAS_TOKEN, guest, allowInvitations: process.argv.includes('--allow-invitations') });
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.completed && report.cleanup === 'verified' ? 0 : 1;
}
