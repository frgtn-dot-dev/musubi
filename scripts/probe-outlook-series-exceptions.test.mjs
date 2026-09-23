import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOutlookSeriesExceptions } from './probe-outlook-series-exceptions.mjs';

function graph({ foreignChild = false, foreignGuest = false, lostCleanup = false } = {}) {
  const events = new Map(), calls = []; let serial = 0;
  const json = (status, data) => new Response([202, 204].includes(status) ? null : JSON.stringify(data ?? {}), { status });
  const bump = event => { event['@odata.etag'] = `W/"v${++serial}"`; return event; };
  const children = id => [...events.values()].filter(event => event.seriesMasterId === id);
  const familyVersion = id => { bump(events.get(id)); for (const item of children(id)) if (item.type === 'occurrence') bump(item); };
  function slots(master) {
    for (let i = 0; i < 5; i++) {
      const date = new Date(Date.parse(master.start.dateTime + 'Z') + i * 3 * 86400000).toISOString().slice(0, 10);
      const id = `${master.id}-slot-${i}`;
      events.set(id, bump({ ...structuredClone(master), id, iCalUId: `uid-${id}`, type: 'occurrence', recurrence: null, seriesMasterId: master.id, originalStart: `${date}T${master.start.dateTime.slice(11)}Z`, start: { ...master.start, dateTime: `${date}T${master.start.dateTime.slice(11)}` }, end: { ...master.end, dateTime: `${date}T${master.end.dateTime.slice(11)}` } }));
    }
  }
  const full = event => event.type === 'seriesMaster' ? { ...event, exceptionOccurrences: children(event.id).filter(item => item.type === 'exception') } : event;
  const remove = event => {
    events.delete(event.id);
    if (event.seriesMasterId) { events.get(event.seriesMasterId).cancelledOccurrences.push(event.originalStart.slice(0, 10)); familyVersion(event.seriesMasterId); }
    else for (const child of children(event.id)) events.delete(child.id);
  };
  return { calls, events, fetchImpl: async (input, options) => {
    const url = new URL(input), path = url.pathname.slice('/v1.0'.length), method = options.method;
    const body = options.body === undefined ? undefined : JSON.parse(options.body);
    calls.push({ method, path, body });
    assert.equal(url.origin, 'https://graph.microsoft.com'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer secret-test-token');
    if (path === '/me/calendar') { assert.equal(method, 'GET'); return json(200, { id: 'default', canEdit: true }); }
    const base = '/me/calendars/default/events'; assert.ok(path.startsWith(base));
    if (path === base) {
      assert.equal(method, 'POST');
      const master = bump({ ...body, id: `created-${++serial}`, iCalUId: `master-uid-${serial}`, type: 'seriesMaster', isOrganizer: true, cancelledOccurrences: [] });
      events.set(master.id, master); slots(master); return json(201, full(master));
    }
    const parts = path.split('/'), resource = parts.at(-1), id = ['instances', 'cancel'].includes(resource) ? parts.at(-2) : resource;
    assert.ok(id.startsWith('created-'), 'No mutations of pre-existing events');
    const event = events.get(id); if (!event) return json(404);
    if (resource === 'instances') return json(200, { value: children(id).map(item => foreignChild ? { ...item, seriesMasterId: 'foreign-series' } : item) });
    if (method === 'GET') {
      const result = { ...full(event) };
      if (foreignGuest && event.type === 'seriesMaster') result.attendees = [{ emailAddress: { address: 'unapproved@example.test' } }];
      if (!url.searchParams.get('$select')?.split(',').includes('originalStart')) delete result.originalStart;
      return json(200, result);
    }
    if (method === 'PATCH') {
      if (options.headers['If-Match'] !== event['@odata.etag']) return json(412);
      Object.assign(event, structuredClone(body)); bump(event);
      if (body.start || body.end) for (const guest of event.attendees) guest.status = { response: 'notResponded', time: '4501-01-01T00:00:00Z' };
      if (event.type === 'seriesMaster') {
        for (const child of children(id)) events.delete(child.id);
        event.cancelledOccurrences = []; slots(event);
      } else { event.type = 'exception'; familyVersion(event.seriesMasterId); }
      return json(200, full(event));
    }
    assert.ok(method === 'DELETE' || method === 'POST' && resource === 'cancel');
    remove(event);
    if (lostCleanup && !event.seriesMasterId) throw new Error('PRIVATE PROVIDER ERROR');
    return json(method === 'DELETE' ? 204 : 202);
  } };
}
const options = { token: 'secret-test-token', now: new Date('2026-09-23T12:00:00Z'), settle: async () => {} };
test('captures destructive master writes, reconstruction limits and partial individual writes', async () => {
  for (const meeting of [false, true]) {
    const fake = graph(), checkpoints = [];
    const report = await probeOutlookSeriesExceptions({ ...options, fetchImpl: fake.fetchImpl, ...(meeting ? { guest: 'guest@example.test', allowInvitations: true } : {}), checkpoint: async value => checkpoints.push(value) });
    assert.equal(report.completed, true); assert.equal(report.cases.length, 6); assert.equal(fake.events.size, 0);
    for (const item of report.cases.slice(0, 5)) {
      assert.equal(item.checks.patchStatus, 200); assert.equal(item.checks.after.exceptions, 0);
      assert.equal(item.checks.after.cancellations, 0); assert.equal(item.cleanup, 'verified');
    }
    const restored = report.cases[4].checks;
    assert.equal(restored.restoreContentAndTimes, true); assert.equal(restored.restoreCancellation, true);
    assert.equal(restored.restoreOriginalExceptionIDs, true); assert.equal(restored.restoreOriginalExceptionUIDs, true);
    assert.equal(restored.restoreExceptionResponses, !meeting);
    const partial = report.cases[5].checks;
    assert.deepEqual(partial.individualStatuses, [200, 412]); assert.equal(partial.firstChangedDespiteLaterFailure, true);
    assert.equal(partial.masterClockUnchanged, true); assert.equal(partial.originalExceptionsUnchanged, true); assert.equal(partial.cancellationPreserved, true);
    assert.equal(checkpoints.at(-1), null);
    for (const privateValue of ['secret-test-token', 'guest@example.test', 'created-', 'PRIVATE PROVIDER ERROR']) assert.equal(JSON.stringify(report).includes(privateValue), false);
  }
});
test('invitation approval and a bounded scenario list are required before network access', async () => {
  let calls = 0; const fetchImpl = async () => { calls++; };
  await assert.rejects(() => probeOutlookSeriesExceptions({ ...options, fetchImpl, guest: 'guest@example.test' }), /authorization/);
  await assert.rejects(() => probeOutlookSeriesExceptions({ ...options, fetchImpl, scenarios: ['unrelated'] }), /Known distinct/);
  await assert.rejects(() => probeOutlookSeriesExceptions({ ...options, fetchImpl, scenarios: ['mixed-duration', 'mixed-duration'] }), /Known distinct/);
  assert.equal(calls, 0);
});
test('refuses foreign children and cleans only its newly created master', async () => {
  const fake = graph({ foreignChild: true });
  const report = await probeOutlookSeriesExceptions({ ...options, fetchImpl: fake.fetchImpl });
  assert.equal(report.completed, false); assert.equal(report.cases[0].cleanup, 'verified'); assert.equal(fake.events.size, 0);
  assert.equal(fake.calls.some(call => call.method === 'PATCH'), false);
});
test('never retries an uncertain cleanup write and preserves its private fixture checkpoint', async () => {
  const fake = graph({ lostCleanup: true }), checkpoints = [];
  const report = await probeOutlookSeriesExceptions({ ...options, fetchImpl: fake.fetchImpl, scenarios: ['mixed-duration'], checkpoint: async value => checkpoints.push(value) });
  assert.equal(report.completed, false); assert.equal(report.cases[0].cleanup, 'unconfirmed');
  assert.equal(fake.calls.filter(call => call.method === 'DELETE' && !call.path.includes('-slot-')).length, 1);
  assert.equal(checkpoints.at(-1).cancellationStarted, true);
  assert.equal(JSON.stringify(report).includes('PRIVATE PROVIDER ERROR'), false);
});

test('does not edit or notify a fixture with an unexpected recipient', async () => {
  const fake = graph({ foreignGuest: true });
  const report = await probeOutlookSeriesExceptions({ ...options, fetchImpl: fake.fetchImpl });
  assert.equal(report.completed, false);
  assert.equal(fake.calls.some(call => call.method === 'PATCH' || call.path.endsWith('/cancel')), false);
});
