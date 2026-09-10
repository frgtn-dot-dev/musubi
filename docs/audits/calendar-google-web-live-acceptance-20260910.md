# Google web live acceptance — 2026-09-10

## Scope

Live Musubi development web/API with an isolated QA database and the owner's
existing Google account. A new secondary calendar, `Musubi QA 2026-09-10`, was
created through Musubi. Only synthetic personal events in that calendar were
written. No attendees, invitations, existing-event mutations or production
activation were involved.

## Observations

- New OAuth secret was configured locally without committing credentials.
  Google sign-in completed for the original Musubi user. Attempting to connect
  the same Google identity to the separate QA user correctly failed with
  `account_already_linked_to_different_user`; no account reassignment was used.
- Development OAuth callback landed on API port 7531, which does not serve the
  web route (`Cannot GET /app/p/default/month`). Navigating to web port 3000
  retained the authenticated session. Development return routing remains an
  environment UX observation, not a successful end-to-end redirect claim.
- Creating the secondary calendar through Musubi succeeded and the calendar
  was visible in Google Calendar.
- Creating `Musubi QA Google roundtrip 0910` at 12:00–13:00 succeeded. Musubi
  displayed a confirmed delivery receipt. Google Calendar independently showed
  the same title, date and time after loading its day view.
- Renaming to `Musubi QA Google renamed 0910` appeared in Google Calendar after
  a fresh page load; time remained 12:00–13:00.
- Ordinary legacy end-time editing to 14:15 succeeded and was independently
  visible in Google Calendar. This event was created without an explicit time
  model. The result is **not** acceptance of the gated explicit-time endpoint.
- Deleting this synthetic event through Musubi showed a confirmation explaining
  propagation to Google. After deletion, a fresh Google Calendar day view still
  showed the selected QA calendar but no synthetic event. Musubi's unfinished
  deliveries list was empty.
- During a development API restart the calendar displayed a retry state;
  Try again recovered after the server restarted.

## Explicit-time follow-up after owner authorization

The owner subsequently authorized necessary local test operations. The isolated
development time flag was enabled; production settings and other writer flags
were unchanged.

- Explicit zoned Google series creation was rejected locally before provider I/O.
  The previous unstructured error misleadingly described an unconfirmed Google
  write. The guard now uses the established structured `unsupported` error.
  Live browser retest of explicit all-day creation displayed the accurate
  unsupported message with the title draft and request ID retained. This change
  does not add a Google explicit-time create capability.
- A synthetic DAILY COUNT=4 series was created directly in the secondary Google
  QA calendar at 10:00–10:30, September 10–13, with no guests. Existing Google
  sync imported exactly four occurrences and their Europe/Prague zone.
- Musubi's This event operation changed the September 11 end to 11:00 locally.
  Delivery correctly remained queued while the dev scheduler was disabled.
  Running the standard worker for exactly that QA operation applied the change
  in Google. A fresh Google day view showed September 11 at 10:00–11:00 and
  September 12 still at 10:00–10:30.
- The initial worker result was `unconfirmed`: the native master ETag changed
  following the instance write, so strict old-master validator validation
  rejected the postwrite read. A diagnostic read using the current ETag only
  in memory passed the remaining master/instance checks and matched the desired
  result. No saved intent was rewritten and no blind retry was performed.
- The fix persists a versioned hash of the complete native master, excluding only
  its top-level `etag` and `updated`. Admission and prewrite checks remain strict.
  Postwrite confirmation and read-only recovery accept an ETag change only with
  matching stored proof and the existing occurrence checks. Missing proof or
  changed native content fails closed; whole-series writes remain unsupported.
- A fresh provider-created series, `Musubi QA proof recovery 0912`, spans
  September 12–15 at 10:00–10:30. After import, Musubi changed only September 13
  to end at 11:15. The scoped standard worker completed the operation, Google
  Calendar independently showed 10:00–11:15, and Musubi displayed
  **Delivery confirmed**.
- A subsequent read-only recovery probe used that operation's exact stored
  intent and proof with the final implementation. The master validator had
  changed and the occurrence matched the desired state. Four Calendar GETs and
  zero event writes were observed; non-GET Calendar requests were actively
  rejected. No delivery status or saved intent was modified. This is live
  read-only recovery evidence, not a simulated live lost-response test.
- Eight new isolated HTTP/database scenarios cover master proof validation,
  changed native content, missing proof/validator, strict prewrite drift and
  lost-response recovery without duplicate PATCH. The final `pnpm check` passed.
  Independent source review reported no actionable findings.

## Personal one-off reminder follow-up

- The owner authorized necessary local-account tests. A fresh guest-free
  `Musubi QA reminder 0910` event was created in the same secondary QA calendar
  at 12:00–13:00 and refreshed through the standard Google sync.
- With the local reminder flag enabled, the provider details exposed the editor.
  Negative minutes produced a local validation error and retained the draft.
  Source inspection and existing component tests establish rejection before API
  submission; browser network instrumentation was not used for that assertion.
- Saving a 15-minute Notification returned the explicit pending receipt while
  the scheduler was off. The standard worker completed the single QA operation.
  Fresh Google Calendar detail displayed “15 minut předem”; Musubi displayed
  `popup · 15 minutes before start`. Title and time remained unchanged.
- Switching to Off also completed through the scoped worker. A fresh Google
  detail no longer contained the notification. This validates stored settings,
  not an actual OS notification firing; no email reminder was selected.
- Musubi cleanup first rejected a stale revision, then after reload explicitly
  rejected the unsupported time-model-aware one-off provider delete. No failed
  delete was queued. Cleanup was instead performed in Google Calendar and
  followed by standard sync. This is not acceptance of explicit-time Google
  one-off deletion.
- CI exposed two additional old HTTP 400 expectations in the Graph-create
  fixture for mixed-calendar and Google unsupported requests. They now assert
  the structured 403 contract and no canonical event. Both full affected API/DB
  fixtures passed; independent review found no issue with this test-only fix.

## Remaining work and retained state

The secondary QA calendar and both four-occurrence provider series are retained
for subsequent tests. The first operation still has an unconfirmed receipt: its
old intent lacks the prewrite proof. It was neither retrofitted nor blindly
retried. The fresh operation has a confirmed receipt.
An earlier automatic approval rejection was resolved by explicit owner approval;
the local time flag is now enabled. The subsequent reminder test also enabled
`PROVIDER_REMINDER_EDITS_ENABLED` locally; organizer/RSVP/CalDAV alarm flags
remain off.

This evidence covers basic legacy personal CRUD and provider-visible results.
Known-time single-occurrence delivery, confirmation and read-only recovery passed
for the fresh operation. This evidence does not certify conditional conflicts,
bound-instance Google reminders, interval-only availability, invite/RSVP delivery,
iCloud/Outlook writes, OS notifications or physical-device acceptance.
