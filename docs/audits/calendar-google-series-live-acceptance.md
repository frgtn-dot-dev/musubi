# Google whole-series title acceptance — 2026-09-08

## Scope and authorization

The user authorized this isolated live test after reviewing the proposed write set. A development OAuth client and disposable local database were used. The probe created a temporary secondary calendar and two synthetic four-occurrence personal series, one Europe/Prague zoned and one all-day. No attendees were supplied. Existing calendars and events were not test targets. Both application write feature flags remained disabled; the probe called Google directly. The temporary calendar was deleted after recording the results.

This is provider-behaviour evidence, not end-to-end acceptance of Musubi delivery or a production activation approval.

## Procedure

For each series, move one occurrence and give it a custom title; move another without supplying a title; cancel a third. Read the complete unexpanded family with `showDeleted=true`. Fetch the current master and conditionally PATCH only its summary with `If-Match` and `sendUpdates=none`. Read the unexpanded family and expanded instances again.

An initial setup attempt received HTTP 412 when using an instance ETag captured before another occurrence mutation. Its temporary calendar was deleted. The successful run fetched each target immediately before each conditional mutation. This observation reinforces the need to re-read provider evidence between family mutations; it does not establish a universal ETag invalidation rule.

## Observed result

Both zoned and all-day scenarios behaved identically:

| Target | Title after master PATCH | ETag |
| --- | --- | --- |
| Master | New master title | Changed |
| Generated occurrence | New master title | Not compared |
| Moved occurrence with custom title | **New master title; custom title overwritten** | Changed |
| Moved occurrence retaining old master title | New master title | Changed |
| Cancelled exception | New master title; still cancelled | Changed |

The native family ID set and original occurrence identities were preserved. Among the recorded semantic fields, only summary changed. Start/end, moved positions, cancellation, description, location, reminders, visibility and transparency were unchanged where present. All-day exclusive end dates were preserved. The sanitized observation below contains synthetic content only, with account/calendar/event IDs and actual ETags omitted.

## Implementation consequence

A parent-only PATCH cannot implement Musubi's current planner contract, which preserves child content. The follow-up concurrency test below also rules out the initially proposed PATCH-then-restore approach under the strict preservation contract. Durable checkpoints can recover saved content after interruption, but cannot recover an unseen external edit that the parent PATCH already erased. Google whole-series writes therefore remain unsupported; reconciliation alone is not an implementation prerequisite that would make them safe.

Title-only evidence does not establish time/recurrence mutation behaviour, following-scope behaviour, meeting semantics, atomic snapshots, or other providers. Those remain separate acceptance work.

References: [Google Events PATCH](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch), [Google Calendars insert](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert).

## Follow-up: exception concurrency and product decision

A second authorized zoned-series test created a custom exception, read an accepted master ETag, edited that exception again, then attempted a master-title PATCH using the previously accepted ETag. It observed:

- The child ETag changed; the master ETag did not.
- The conditional master PATCH succeeded.
- The child's newer title was replaced by the master title.
- The temporary calendar was deleted.

Sanitized result:

```json
{
  "scenario": "Child edit versus accepted master ETag, synthetic title-only writes",
  "master_etag_changed_after_child_edit": false,
  "child_etag_changed": true,
  "master_patch_with_pre_child_edit_etag": "accepted",
  "child_title_after_master_attempt": "Synthetic master update",
  "cleanup": "temporary calendar deleted"
}
```

This supplies a concrete counterexample: save child title A, external edit writes B, parent PATCH writes C, recovery restores A. B is lost before recovery can observe it. Scanning again, an application mutex, an empty exception list, and durable journaling cannot close the gap between the last read and the provider mutation. A child-level conditional restore only protects changes made after propagation; it does not protect B in this sequence.

Google documents [resource-specific ETag checks](https://developers.google.com/workspace/calendar/api/guides/version-resources). Its [batch API](https://developers.google.com/workspace/calendar/api/guides/batch) processes separate requests and may execute them in any order; batching does not supply the missing family transaction. The conclusion about this writer follows from the observed counterexample; this is not a claim that every possible future Google capability has been ruled out.

**User decision, 2026-09-08:** preserve exception content and leave Google whole-series operations unsupported for now. Continue other K12–K14 work. Do not silently replace this contract with Google's propagation semantics or treat an empty local child list as safe. Reconsider only with demonstrated family-wide protection or an explicitly approved different product contract. This does not mark Google whole-series implementation complete.

The HTTP/DB regression covers zoned/all-day read scans that return a stale child despite a stable master ETag, and rejects a whole-series rename with the application time-edit gate enabled, both with and without an imported child. No provider call, local content/revision/mapping change, outbox row, or scope receipt is created by the rejected request. Existing single-occurrence support remains available behind its default-off gate.

## Sanitized observations

```json
{
  "purpose": "Live title-only master PATCH observation, synthetic private series, no attendees",
  "scenarios": [
    {
      "kind": "zoned",
      "family_identity_preserved": true,
      "family": [
        {
          "role": "master",
          "before": {
            "summary": "Synthetic original",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-05T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-05T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "recurrence": [
              "RRULE:FREQ=DAILY;COUNT=4"
            ],
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-05T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-05T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "recurrence": [
              "RRULE:FREQ=DAILY;COUNT=4"
            ],
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "custom moved",
          "before": {
            "summary": "Synthetic custom exception",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-13T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-13T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-06T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-13T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-13T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-06T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "inherited moved",
          "before": {
            "summary": "Synthetic original",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-14T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-14T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-07T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-14T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-14T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-07T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "cancelled",
          "before": {
            "summary": "Synthetic original",
            "status": "cancelled",
            "start": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-08T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "cancelled",
            "start": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-08T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        }
      ],
      "instances": [
        {
          "role": "generated",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-05T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-05T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-05T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "custom moved",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-13T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-13T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-06T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "inherited moved",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "dateTime": "2026-10-14T14:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-14T15:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-07T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "cancelled",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "cancelled",
            "start": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "end": {
              "dateTime": "2026-10-08T11:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "originalStartTime": {
              "dateTime": "2026-10-08T10:00:00+02:00",
              "timeZone": "Europe/Prague"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        }
      ]
    },
    {
      "kind": "all-day",
      "family_identity_preserved": true,
      "family": [
        {
          "role": "master",
          "before": {
            "summary": "Synthetic original",
            "status": "confirmed",
            "start": {
              "date": "2026-10-05"
            },
            "end": {
              "date": "2026-10-06"
            },
            "recurrence": [
              "RRULE:FREQ=DAILY;COUNT=4"
            ],
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-05"
            },
            "end": {
              "date": "2026-10-06"
            },
            "recurrence": [
              "RRULE:FREQ=DAILY;COUNT=4"
            ],
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "custom moved",
          "before": {
            "summary": "Synthetic custom exception",
            "status": "confirmed",
            "start": {
              "date": "2026-10-13"
            },
            "end": {
              "date": "2026-10-14"
            },
            "originalStartTime": {
              "date": "2026-10-06"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-13"
            },
            "end": {
              "date": "2026-10-14"
            },
            "originalStartTime": {
              "date": "2026-10-06"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "inherited moved",
          "before": {
            "summary": "Synthetic original",
            "status": "confirmed",
            "start": {
              "date": "2026-10-14"
            },
            "end": {
              "date": "2026-10-15"
            },
            "originalStartTime": {
              "date": "2026-10-07"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-14"
            },
            "end": {
              "date": "2026-10-15"
            },
            "originalStartTime": {
              "date": "2026-10-07"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        },
        {
          "role": "cancelled",
          "before": {
            "summary": "Synthetic original",
            "status": "cancelled",
            "start": {
              "date": "2026-10-08"
            },
            "end": {
              "date": "2026-10-09"
            },
            "originalStartTime": {
              "date": "2026-10-08"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "after": {
            "summary": "Synthetic renamed master",
            "status": "cancelled",
            "start": {
              "date": "2026-10-08"
            },
            "end": {
              "date": "2026-10-09"
            },
            "originalStartTime": {
              "date": "2026-10-08"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          },
          "etag_changed": true,
          "native_identity_preserved": true
        }
      ],
      "instances": [
        {
          "role": "generated",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-05"
            },
            "end": {
              "date": "2026-10-06"
            },
            "originalStartTime": {
              "date": "2026-10-05"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "custom moved",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-13"
            },
            "end": {
              "date": "2026-10-14"
            },
            "originalStartTime": {
              "date": "2026-10-06"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "inherited moved",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "confirmed",
            "start": {
              "date": "2026-10-14"
            },
            "end": {
              "date": "2026-10-15"
            },
            "originalStartTime": {
              "date": "2026-10-07"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        },
        {
          "role": "cancelled",
          "fields": {
            "summary": "Synthetic renamed master",
            "status": "cancelled",
            "start": {
              "date": "2026-10-08"
            },
            "end": {
              "date": "2026-10-09"
            },
            "originalStartTime": {
              "date": "2026-10-08"
            },
            "description": "Synthetic preservation marker",
            "location": "Synthetic location",
            "reminders": {
              "useDefault": false
            },
            "visibility": "private",
            "transparency": "transparent"
          }
        }
      ]
    }
  ],
  "cleanup": "temporary calendar deleted"
}
```
