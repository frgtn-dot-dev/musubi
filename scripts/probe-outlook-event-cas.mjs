// Live evidence for the event endpoint, never a substitute for provider review.
// Only this run's new, attendee-free calendar is writable. No existing IDs input.
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const validID = value => typeof value === 'string' && value.length > 0 && value.trim() === value && !['.', '..'].includes(value);
const validEtag = value => typeof value === 'string' && /^(W\/)?"[^"\r\n]+"$/.test(value);
const preservedFields = event => Object.fromEntries(['body', 'location', 'categories', 'isReminderOn', 'reminderMinutesBeforeStart', 'start', 'end', 'isAllDay', 'attendees', 'recurrence', 'showAs', 'sensitivity'].map(key => [key, event[key]]));

export async function probeOutlookEventCAS({ token, fetchImpl = fetch, now = new Date() }) {
  if (!token || /[\r\n]/.test(token)) throw new Error('A Graph access token is required.');
  const runID = randomUUID();
  const name = `Musubi QA event CAS ${now.toISOString().slice(0, 10)} ${runID.slice(0, 8)}`;
  const content = event => ({ subject: event.subject, ...preservedFields(event) });
  const report = { schemaVersion: 1, runID, startedAt: now.toISOString(), endpoint: '/v1.0/me/calendars/{id}/events/{id}', calendarName: name, cases: [], requests: [], cleanup: 'not-created', verified: false };
  let calendarPath;
  async function request(label, method, path, body, etag, prefer = 'outlook.timezone="UTC"') {
    // No redirects with credentials. No retries of possibly accepted mutations.
    const response = await fetchImpl(`${GRAPH}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', Prefer: prefer, ...(etag === undefined ? {} : { 'If-Match': etag }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const requestID = response.headers.get('request-id');
    report.requests.push({ label, method, status: response.status, ...(requestID && /^[0-9a-f-]{36}$/i.test(requestID) ? { requestID } : {}) });
    const data = await response.json().catch(() => null);
    return { status: response.status, data };
  }
  async function read(label, path) {
    const result = await request(label, 'GET', path);
    if (result.status !== 200 || !validID(result.data?.id) || !validEtag(result.data?.['@odata.etag'])) throw new Error('incomplete-event-read');
    return result.data;
  }
  try {
    report.cleanup = 'creation-unconfirmed';
    const created = await request('create-calendar', 'POST', '/me/calendars', { name });
    if (created.status !== 201 || !validID(created.data?.id)) {
      report.cleanup = created.status >= 400 && created.status < 500 ? 'not-created' : 'creation-response-incomplete';
      throw new Error('calendar-create-failed');
    }
    calendarPath = `/me/calendars/${encodeURIComponent(created.data.id)}`;
    report.cleanup = 'required';
    // Retain this test-only ID only if cleanup fails, so it can be removed manually.
    report.cleanupCalendarID = created.data.id;
    if (created.data.canEdit !== true) throw new Error('calendar-not-writable');
    for (const kind of ['zoned', 'all-day']) {
      const day = new Date(now.getTime() + 7 * 86400_000).toISOString().slice(0, 10);
      const next = new Date(now.getTime() + 8 * 86400_000).toISOString().slice(0, 10);
      const allDay = kind === 'all-day';
      const original = {
        subject: `Musubi QA CAS ${kind} ${runID.slice(0, 8)}`,
        transactionId: randomUUID(),
        body: { contentType: 'HTML', content: '<html><body><p>Keep <strong>rich text</strong> unchanged.</p></body></html>' },
        location: { displayName: 'Musubi synthetic QA location' },
        categories: [], isReminderOn: false, reminderMinutesBeforeStart: 15,
        showAs: 'free', isAllDay: allDay, attendees: [],
        start: { dateTime: `${day}T${allDay ? '00:00:00' : '10:00:00'}`, timeZone: allDay ? 'UTC' : 'W. Europe Standard Time' },
        end: { dateTime: `${allDay ? next : day}T${allDay ? '00:00:00' : '11:00:00'}`, timeZone: allDay ? 'UTC' : 'W. Europe Standard Time' },
      };
      const result = await request(`${kind}:create`, 'POST', `${calendarPath}/events`, original);
      if (result.status !== 201 || !validID(result.data?.id)) throw new Error('event-create-failed');
      const eventPath = `${calendarPath}/events/${encodeURIComponent(result.data.id)}`;
      const before = await read(`${kind}:baseline`, eventPath);
      if (before.type !== 'singleInstance' || before.attendees?.length !== 0 || before.recurrence != null || before.isOrganizer !== true) throw new Error('unexpected-event-kind');
      const etag = before['@odata.etag'];
      const outcome = { kind, etagFormat: etag.startsWith('W/') ? 'weak' : 'strong', checks: {} };
      report.cases.push(outcome);
      const changedTitle = `${original.subject} edited`;
      const patch = await request(`${kind}:fresh-patch`, 'PATCH', eventPath, { subject: changedTitle }, etag);
      let current = await read(`${kind}:after-fresh-patch`, eventPath);
      outcome.checks.freshPatchAccepted = patch.status === 200 && current.subject === changedTitle;
      outcome.checks.omittedFieldsPreserved = isDeepStrictEqual(preservedFields(before), preservedFields(current));
      outcome.checks.versionChanged = etag !== current['@odata.etag'];
      const contentPatch = await request(`${kind}:fresh-content-patch`, 'PATCH', eventPath, {
        body: { contentType: 'text', content: 'Explicitly edited test description' }, location: { displayName: 'Explicitly edited test location' },
      }, current['@odata.etag']);
      current = await read(`${kind}:after-content-patch`, eventPath);
      const plain = await request(`${kind}:plain-content-read`, 'GET', eventPath, undefined, undefined, 'outlook.timezone="UTC", outlook.body-content-type="text"');
      outcome.checks.freshContentPatchAccepted = contentPatch.status === 200 && plain.status === 200 && plain.data.body?.content?.trim() === 'Explicitly edited test description' && current.location?.displayName === 'Explicitly edited test location';
      const stale = current['@odata.etag'];
      // Deliberate independent writer on the same synthetic event.
      const competing = await request(`${kind}:competing-edit`, 'PATCH', eventPath, { location: { displayName: 'Synthetic concurrent edit' } });
      current = await read(`${kind}:after-competing-edit`, eventPath);
      if (competing.status !== 200 || current.location?.displayName !== 'Synthetic concurrent edit' || stale === current['@odata.etag']) throw new Error('competing-edit-not-observed');
      let snapshot = current;
      const stalePatch = await request(`${kind}:stale-patch`, 'PATCH', eventPath, { subject: 'THIS STALE WRITE MUST NOT WIN' }, stale);
      current = await read(`${kind}:after-stale-patch`, eventPath);
      outcome.checks.stalePatchRejected = stalePatch.status === 412 && isDeepStrictEqual(content(current), content(snapshot));
      snapshot = current;
      // Use a genuine version from a different new event, rather than a malformed
      // changeKey (Graph can answer 500 for a syntactically valid random ETag).
      const control = await request(`${kind}:control-create`, 'POST', `${calendarPath}/events`, { ...original, subject: 'Musubi QA version control', transactionId: randomUUID() });
      if (control.status !== 201 || !validID(control.data?.id)) throw new Error('event-create-failed');
      const controlEvent = await read(`${kind}:control-read`, `${calendarPath}/events/${encodeURIComponent(control.data.id)}`);
      const badTag = controlEvent['@odata.etag'];
      if (badTag === current['@odata.etag']) throw new Error('incomplete-event-read');
      const invalidPatch = await request(`${kind}:invalid-etag-patch`, 'PATCH', eventPath, { subject: 'THIS INVALID WRITE MUST NOT WIN' }, badTag);
      current = await read(`${kind}:after-invalid-etag`, eventPath);
      outcome.checks.invalidPatchRejected = invalidPatch.status === 412 && isDeepStrictEqual(content(current), content(snapshot));
      snapshot = current;
      const staleDelete = await request(`${kind}:stale-delete`, 'DELETE', eventPath, undefined, stale);
      const afterDelete = await request(`${kind}:after-stale-delete`, 'GET', eventPath);
      outcome.checks.staleDeleteRejected = staleDelete.status === 412 && afterDelete.status === 200 && isDeepStrictEqual(content(afterDelete.data), content(snapshot));
      if (afterDelete.status === 200 && validEtag(afterDelete.data?.['@odata.etag'])) {
        const freshDelete = await request(`${kind}:fresh-delete`, 'DELETE', eventPath, undefined, afterDelete.data['@odata.etag']);
        const absent = await request(`${kind}:verify-deletion`, 'GET', eventPath);
        outcome.checks.freshDeleteAccepted = freshDelete.status === 204 && absent.status === 404;
      } else outcome.checks.freshDeleteAccepted = false;
    }
  } catch (error) {
    // Do not copy response payloads or arbitrary error messages into evidence.
    report.error = ['calendar-create-failed', 'calendar-not-writable', 'event-create-failed', 'unexpected-event-kind', 'incomplete-event-read', 'competing-edit-not-observed'].includes(error.message) ? error.message : 'request-failed';
  } finally {
    if (calendarPath) {
      try {
        const removed = await request('cleanup-calendar', 'DELETE', calendarPath);
        const missing = await request('verify-cleanup', 'GET', calendarPath);
        if ([204, 404].includes(removed.status) && missing.status === 404) {
          report.cleanup = 'verified'; delete report.cleanupCalendarID;
        } else report.cleanup = 'failed';
      } catch { report.cleanup = 'failed'; }
    }
  }
  report.patchVerified = !report.error && report.cases.length === 2 && report.cases.every(test => ['freshPatchAccepted', 'omittedFieldsPreserved', 'versionChanged', 'freshContentPatchAccepted', 'stalePatchRejected', 'invalidPatchRejected'].every(key => test.checks[key] === true)) && report.cleanup === 'verified';
  report.verified = !report.error && report.cases.length === 2 && report.cases.every(test => Object.values(test.checks).every(value => value === true)) && report.cleanup === 'verified';
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--live') || !process.env.OUTLOOK_CAS_TOKEN) {
    console.error('Run with --live and OUTLOOK_CAS_TOKEN in the environment. Creates and removes a new attendee-free test calendar.');
    process.exitCode = 1;
  } else {
    probeOutlookEventCAS({ token: process.env.OUTLOOK_CAS_TOKEN }).then(report => {
      console.log(JSON.stringify(report, null, 2)); process.exitCode = report.verified ? 0 : 1;
    }).catch(() => { console.error('Probe could not start.'); process.exitCode = 1; });
  }
}
