# Durable EVENT create identity (K08a)

K08a supplies stable create identity and read-only lookup. K08b must consume the
lookup evidence in the durable worker and coordinate pull/push; K08 as a whole
is not complete. Lookups do not silently accept a new remote version or authorize
another write. Existing mapped Outlook update/delete restrictions remain.

## Identity and rollout

The outbox operation UUID identifies one target create. New intents persist
`payload.createIdentityVersion: 1` before the first attempt. The delivery closure
passes the committed operation ID to the adapter. A new link after unlink has a
new operation and remote identity. User IDs, credentials and event content are
not encoded in this key. No column migration or wire/version change is needed.

Rows without the marker used the legacy create protocol. Never retroactively
mark their ambiguous attempts as safely repeatable merely because an outbox UUID
exists. Existing mappings remain valid. K08b must distinguish this rollout case.

## Provider evidence

- Google receives a base32hex-compatible event ID derived from the operation UUID
  and a private `musubiOperationID` marker. Lookup uses the exact account/calendar
  and ID, checks the marker, and returns content plus the actual response ETag.
  An occupied ID with a different marker or a cancelled resource is a conflict.
  [Events insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
  documents client-supplied IDs and private extended properties. UUID allocation
  and marker verification are not a universal exactly-once guarantee.
- Graph receives the same persisted UUID as `transactionId`. Recovery scans the
  complete target calendar's paginated event listing and matches that value.
  Duplicate matches, a failed later page, malformed pagination or a next link
  outside that exact trusted collection fail closed. The lookup supplies content
  and identity; it does not replay POST. Microsoft documents transactionId as a
  retry deduplication mechanism, but the cited contract does not promise unlimited
  retention, and this implementation assumes no such window. An absent match
  after an ambiguous attempt needs reconciliation, not a blind new create.
  [Event resource](https://learn.microsoft.com/en-us/graph/api/resources/event?view=graph-rest-1.0),
  [calendar event listing](https://learn.microsoft.com/en-us/graph/api/calendar-list-events?view=graph-rest-1.0).
- CalDAV uses an operation-specific resource URL and UID and sends
  `If-None-Match: *` on PUT. Lookup requires a complete UTF-8 GET and the matching
  master UID; it returns the content and validator without overwriting anything.
  A repeated conditional create cannot replace an occupied resource. All requests
  retain the existing SSRF/DNS-pinning/credential boundary.
  [RFC 4791 §5.3.2](https://www.rfc-editor.org/rfc/rfc4791.html#section-5.3.2).

All lookups return either observed matching content or no observed object;
errors stay errors. A missing lookup result alone is not proof that a remote
request never committed. K08b owns the decision to reconcile/retry/block and must
compare recovered content before accepting its validator. Missing validators
remain null. Partial responses never count as complete recovery evidence.

## Local evidence

`provider_create_recovery.integration.test.ts` uses the real adapters, disposable
PostgreSQL credentials and local HTTP. It destroys the response after the fake
provider has committed, then finds the same object without a new mutation.
It also checks Google collision markers and sibling accounts, complete Graph
pagination (including an empty continuation), selected meeting URL preservation,
hostile/failed next pages, CalDAV conditional PUT/UID and occupied
resources, and partial-read refusal. It is included in `pnpm test:db:sync`.
The existing authenticated provider handler suite additionally checks that the
first create request uses the identity already persisted in the claimed outbox.
These fixtures do not certify live provider behavior. Test-account availability
is still a separate K15 dependency.

The first clean-context review found an empty Graph continuation being treated
as completion and missing meeting URL fields in the lookup projection. Both have
explicit regression fixtures; the URL fixture reproduced null instead of the
existing URL before the fix. Final merge requires another clean-context review
and green local/CI gates.
