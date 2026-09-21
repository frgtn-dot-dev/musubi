import test from 'node:test';
import assert from 'node:assert/strict';
import { probeOutlookEventCAS } from './probe-outlook-event-cas.mjs';

function graph({ ignoreConditions = false, failAfterCreate = false, cleanupFails = false } = {}) {
  let calendar = false, counter = 0;
  const events = new Map();
  const calls = [];
  const json = (status, data) => new Response(status === 204 ? null : JSON.stringify(data ?? {}), { status });
  function version(event) { event['@odata.etag'] = `W/"version-${++counter}"`; return event; }
  return { calls, events, fetchImpl: async (url, options) => {
    assert.equal(new URL(url).origin, 'https://graph.microsoft.com');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    const path = new URL(url).pathname.replace('/v1.0', '');
    const { method } = options; const body = options.body && JSON.parse(options.body);
    calls.push({ method, path, body });
    if (path === '/me/calendars' && method === 'POST') { calendar = true; return json(201, { id: 'run-calendar', canEdit: true }); }
    assert.ok(path.startsWith('/me/calendars/run-calendar'), 'never accesses an existing calendar');
    if (path === '/me/calendars/run-calendar') {
      if (method === 'DELETE') {
        if (cleanupFails) return json(500);
        calendar = false; events.clear(); return json(204);
      }
      return json(calendar ? 200 : 404, { id: 'run-calendar' });
    }
    if (path === '/me/calendars/run-calendar/events' && method === 'POST') {
      assert.deepEqual(body.attendees, []);
      assert.equal(body.isReminderOn, false);
      const id = `event-${counter}`;
      const event = version({ ...body, id, type: 'singleInstance', recurrence: null, isOrganizer: true });
      events.set(id, event); return json(201, event);
    }
    if (failAfterCreate) throw new Error('simulated secret response must not be logged');
    const id = path.split('/').at(-1), event = events.get(id);
    if (!event) return json(404);
    if (method === 'GET') return json(200, event);
    if (!ignoreConditions && options.headers['If-Match'] && options.headers['If-Match'] !== event['@odata.etag']) return json(412);
    if (method === 'PATCH') { Object.assign(event, body); version(event); return json(200, event); }
    if (method === 'DELETE') { events.delete(id); return json(204); }
    throw new Error('Unexpected request');
  }};
}
const token = 'test-only-token';
test('records current writes, rejects stale writes, preserves omitted fields and cleans up both cases', async () => {
  const fake = graph(); const report = await probeOutlookEventCAS({ token, fetchImpl: fake.fetchImpl });
  assert.equal(report.verified, true); assert.equal(report.cleanup, 'verified');
  assert.deepEqual(report.cases.map(value => value.kind), ['zoned', 'all-day']);
  for (const c of report.cases) { assert.equal(c.etagFormat, 'weak'); assert.equal(Object.keys(c.checks).length, 8); }
  assert.equal(fake.events.size, 0);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.equal('cleanupCalendarID' in report, false);
});
test('detects providers ignoring If-Match instead of producing false proof', async () => {
  const fake = graph({ ignoreConditions: true }); const report = await probeOutlookEventCAS({ token, fetchImpl: fake.fetchImpl });
  assert.equal(report.verified, false); assert.equal(report.cleanup, 'verified');
  for (const c of report.cases) {
    assert.equal(c.checks.stalePatchRejected, false); assert.equal(c.checks.invalidPatchRejected, false); assert.equal(c.checks.staleDeleteRejected, false);
  }
});
test('cleans up its own calendar after a failed request without logging provider payloads', async () => {
  const fake = graph({ failAfterCreate: true }); const report = await probeOutlookEventCAS({ token, fetchImpl: fake.fetchImpl });
  assert.equal(report.verified, false); assert.equal(report.cleanup, 'verified'); assert.equal(report.error, 'request-failed');
  assert.equal(fake.events.size, 0); assert.equal(JSON.stringify(report).includes('simulated secret'), false);
});
test('failed cleanup prevents a verified result and retains only the new calendar identity', async () => {
  const fake = graph({ cleanupFails: true }); const report = await probeOutlookEventCAS({ token, fetchImpl: fake.fetchImpl });
  assert.equal(report.verified, false); assert.equal(report.cleanup, 'failed'); assert.equal(report.cleanupCalendarID, 'run-calendar');
});
