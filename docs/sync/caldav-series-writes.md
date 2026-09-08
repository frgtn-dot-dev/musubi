# CalDAV series: complete resource evidence

The default-off `EVENT_TIME_EDITS_ENABLED` capability has an internal
`readCaldavSeries` adapter method. It reads the complete calendar object with its
accepted strong ETag and retains the original UTF-8 body, including detached
components, folded lines, alarms, timezone definitions and extension properties.
The body is private server-side evidence; it must not be logged or returned to
clients. This method does not enqueue or perform a scope write.

Preflight checks account ownership, a matching imported event calendar, resource
membership in that collection, DAV write-content privilege, complete GET and the
previously accepted resource ETag. It rejects weak/missing or changed validators,
encoded path traversal/separators and redirects on both PROPFIND and GET,
projected/partial bodies, unexpected UIDs, duplicate component identities,
duplicate scalar properties, meetings and scheduling METHOD resources. The
existing temporal importer still rejects unsupported RANGE/masterless resources
and recurring timed nominal-day durations. Exactly one recurring live master and
the complete local child set must match content, original identity, cancellation
and explicit civil time model. Zoned, floating and all-day representations are
covered. Empty/missing local children do not silently omit provider exceptions.

This evidence differs from a sequence of Google master/child reads: CalDAV stores
the recurrence family in a single calendar object. A future writer must preserve
untouched bytes and conditionally PUT that same object using its accepted ETag.
[RFC 4791, section 5.3.4](https://www.rfc-editor.org/rfc/rfc4791#section-5.3.4)
specifies strong calendar-object validators. A local Radicale test confirms that
changing a detached child's title changes the resource ETag and a subsequent
master-title PUT with the old ETag receives 412 without altering that child.
This local result is not iCloud or every-server acceptance.

## Validation and remaining work

Unit tests cover exact original bytes, moved/cancelled children, zoned/floating/
all-day models, incomplete local families, inconsistent identities, stale content,
weak validators, ambiguous scalar properties and meeting/scheduling refusal.
The Radicale integration exercises the actual adapter through PostgreSQL and HTTP:
accepted full read, account and feature-gate refusal, stale resource rejection,
fragment target refusal, missing local child refusal, and the conditional-PUT
concurrency counterexample that Google could not protect. The synthetic collection
is removed after the test. Existing delta/reset/revival/deletion tests still pass.

The scope endpoint, atomic local family/outbox commit, complete-resource delivery
and recovery, mapping acknowledgement for every component, and conflict handling
are still to be implemented. Content-only master edits can reuse the existing
physical property patcher, but do not assume generic legacy delivery confirms a
known temporal family. Occurrence/following/time/recurrence mutations require their
own contracts. No existing generic guard, production flag or client minimum is
relaxed by this preparatory slice.
