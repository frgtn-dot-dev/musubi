import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOutlookSeriesMeetings } from './probe-outlook-series-meetings.mjs';

function graph({ parentChangesWithChild = false, loseCancellation = false, loseInvitation = false, foreignChild = false } = {}) {
  const events = new Map(), calls = []; let serial = 0, calendar = false;
  const version = event => Object.assign(event, { '@odata.etag': `W/"version-${++serial}"` });
  const json = (status, value) => new Response([202, 204].includes(status) ? null : JSON.stringify(value ?? {}), { status });
  const remove = event => {
    events.delete(event.id);
    for (const [id, child] of events) if (child.seriesMasterId === event.id) events.delete(id);
  };
  return { calls, events, fetchImpl: async (input, options) => {
    const url = new URL(input), path = url.pathname.replace('/v1.0', ''), { method } = options;
    assert.equal(url.origin, 'https://graph.microsoft.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only');
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method, body });
    if (path === '/me/calendars' && method === 'POST') { calendar = true; return json(201, { id: 'test-calendar', canEdit: true }); }
    if (path === '/me/calendar') { assert.equal(method, 'GET'); return json(200, { id: 'existing-default-calendar', canEdit: true }); }
    if (path === '/me/calendars/test-calendar') {
      if (method === 'DELETE') { calendar = false; for (const event of [...events.values()]) if (event.testCalendar) remove(event); return json(204); }
      return json(calendar ? 200 : 404, { id: 'test-calendar' });
    }
    assert.match(path, /^\/me\/calendars\/(test-calendar|existing-default-calendar)\/events(?:\/|$)/);
    if (path.endsWith('/events') && method === 'POST') {
      const id = `created-${++serial}`, recurring = Boolean(body.recurrence);
      const event = version({ ...body, id, isOrganizer: true, type: recurring ? 'seriesMaster' : 'singleInstance', testCalendar: path.includes('/test-calendar/') });
      events.set(id, event);
      if (recurring) for (let i = 0; i < 3; i++) {
        const childID = `${id}-child-${i}`;
        const start = new Date(Date.parse(body.start.dateTime + 'Z') + i * 86400_000).toISOString().slice(0, -1);
        events.set(childID, version({ ...event, id: childID, type: 'occurrence', recurrence: null, seriesMasterId: id, start: { ...body.start, dateTime: start } }));
      }
      if (loseInvitation && body.attendees.length) throw new Error('Private provider payload must not appear in evidence');
      return json(201, event);
    }
    const segments = path.split('/'), subresource = ['instances', 'cancel'].includes(segments.at(-1));
    const id = segments.at(subresource ? -2 : -1), event = events.get(id);
    assert.ok(id.startsWith('created-'), 'only IDs returned by this run may be targeted');
    if (!event) return json(404);
    if (path.endsWith('/instances')) {
      assert.equal(method, 'GET');
      const value = [...events.values()].filter(child => child.seriesMasterId === id);
      return json(200, { value: foreignChild ? value.map(child => ({ ...child, seriesMasterId: 'unrelated-series' })) : value });
    }
    if (method === 'GET') return json(200, event);
    if (method === 'PATCH') {
      if (options.headers['If-Match'] !== event['@odata.etag']) return json(412);
      Object.assign(event, body); version(event);
      if (event.seriesMasterId) {
        event.type = 'exception';
        if (parentChangesWithChild) version(events.get(event.seriesMasterId));
      } else if (event.type === 'seriesMaster') {
        for (const child of events.values()) if (child.seriesMasterId === id && child.type === 'occurrence') { Object.assign(child, body); version(child); }
      }
      return json(200, event);
    }
    if (path.endsWith('/cancel')) {
      assert.equal(method, 'POST');
      if (loseCancellation) throw new Error('Private provider payload must not appear in evidence');
      remove(event); return json(202);
    }
    assert.equal(method, 'DELETE'); remove(event); return json(204);
  }};
}
const options = { token: 'test-only', settle: async () => {} };
test('records the distinction between child versions, family state and ignored DELETE/CANCEL conditions', async () => {
  const fake = graph();
  const report = await probeOutlookSeriesMeetings({ ...options, fetchImpl: fake.fetchImpl, guest: 'guest@example.test', allowInvitations: true });
  assert.equal(report.completed, true); assert.equal(report.cleanup, 'verified'); assert.equal(report.notificationDelivery, 'unknown');
  assert.equal(report.cases.length, 4); assert.equal(fake.events.size, 0);
  for (const item of report.cases.slice(0, 2)) {
    assert.equal(item.checks.masterVersionChangedByChild, false);
    assert.equal(item.checks.masterOldVersionPatchStatus, 200);
    assert.equal(item.checks.staleOccurrencePatchRejected, true);
    assert.equal(item.checks.staleMasterPatchRejected, true);
    assert.equal(item.checks.staleOccurrenceDeleteStatus, 204);
    assert.equal(item.checks.otherOccurrencesPreserved, true);
    assert.equal(item.checks.childrenAbsent, true);
  }
  for (const item of report.cases.slice(2)) { assert.equal(item.checks.stalePatchRejected, true); assert.equal(item.checks.staleCancelStatus, 202); }
  assert.equal(JSON.stringify(report).includes('guest@example.test'), false); assert.equal(JSON.stringify(report).includes(options.token), false);
});
test('does not assume that a child edit leaves the parent version unchanged', async () => {
  const fake = graph({ parentChangesWithChild: true });
  const report = await probeOutlookSeriesMeetings({ ...options, fetchImpl: fake.fetchImpl });
  assert.equal(report.completed, true);
  for (const item of report.cases) { assert.equal(item.checks.masterVersionChangedByChild, true); assert.equal(item.checks.masterOldVersionPatchStatus, 412); }
  assert.equal(fake.calls.some(call => call.body?.attendees?.length), false);
});
test('invitation authorization is checked before any network access', async () => {
  let calls = 0;
  await assert.rejects(() => probeOutlookSeriesMeetings({ ...options, guest: 'guest@example.test', fetchImpl: async () => { calls++; } }), /Explicit invitation/);
  assert.equal(calls, 0);
});
test('lost cancellation is never retried in cleanup and retains only its synthetic path', async () => {
  const fake = graph({ loseCancellation: true });
  const report = await probeOutlookSeriesMeetings({ ...options, fetchImpl: fake.fetchImpl, guest: 'guest@example.test', allowInvitations: true });
  assert.equal(report.completed, false); assert.equal(report.cleanup, 'incomplete');
  assert.equal(fake.calls.filter(call => call.path.endsWith('/cancel')).length, 1);
  assert.equal(report.cleanupMeetingPaths.length, 1); assert.equal(JSON.stringify(report).includes('Private provider'), false);
});
test('a lost invitation response is not resent and does not claim successful cleanup', async () => {
  const fake = graph({ loseInvitation: true });
  const report = await probeOutlookSeriesMeetings({ ...options, fetchImpl: fake.fetchImpl, guest: 'guest@example.test', allowInvitations: true });
  assert.equal(report.completed, false); assert.equal(report.possibleUntrackedInvitation, true); assert.equal(report.cleanup, 'incomplete');
  assert.equal(fake.calls.filter(call => call.body?.attendees?.length).length, 1);
});
test('foreign-family children stop the probe before any event mutation', async () => {
  const fake = graph({ foreignChild: true });
  const report = await probeOutlookSeriesMeetings({ ...options, fetchImpl: fake.fetchImpl });
  assert.equal(report.completed, false); assert.equal(report.cleanup, 'verified');
  assert.equal(fake.calls.some(call => call.method === 'PATCH'), false);
});
