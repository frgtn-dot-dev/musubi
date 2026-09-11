# Event panel proposal

Storybook: `Calendar/Event panel proposal` (Detail, Edit, Long invitation,
Narrow, Draft protection, Switch with draft, All day).

Status: approved design integrated into production event detail and edit flows.
The shared Inspector owns selection, overlay geometry and responsive modality.
The full event edit route uses the same right-side placement. Existing centered
Dialog consumers keep their defaults.

## Implemented contract

- Desktop >=1024: 480 px inspector overlays the calendar without resizing its viewport. Clicking
  another event changes the selection in the same panel.
- Below 1024: modal overlay; full width on phones. Header and action footer stay
  visible, body owns scrolling. This does not change the production phone gate.
- Detail becomes an explicit editor in place; saving is deliberate.
- Dirty close, cancel, or selection change asks before discarding. Keep editing
  returns focus to the form; closing returns focus to the selected event.
- Date/time and location precede participants, short notes and provider details.
  Long notes remain available through a disclosure.

## Limits of the Storybook preview

All changes are in-memory fixtures. The week is illustrative, not the production
time grid or complete app sidebar; do not use it to approve event positioning or
time geometry. Date changes outside the pictured week remove the fixture from
that week. Recurrence, multi-day editing, RSVP, provider writes and delivery
recovery are not implemented here. The calendar selector has one fixture target.
Production composes the existing event form and provider controls, including
recurrence scopes, time model, reminders, RSVP, permissions and delivery recovery.

The overlay placement was approved during visual feedback; the calendar retains
its width and geometry while the panel is open. Ordinary saves return to detail;
recurrence operations retain their existing selection and recovery behavior.
Panel all-day edits use an exclusive end date, defaulting to the next civil day.

## Verification (2026-09-11)

- Browser: light/dark desktop; 768 x 1024 overlay; 390 x 844 proposal anatomy.
- Production browser: existing event detail and editor; automated creation,
  editing, deletion, attendance, recurrence scopes, draft handoff, text selection,
  outside interaction and unchanged calendar geometry.
- Storybook: 114 tests passed, including save, draft protection, selection and
  exclusive all-day end dates.
- Unit coverage includes guarded event switching, pending/failed saves, focus
  restoration and provider actions remaining available outside disclosures.
- Independent review findings on focus, draft protection and editor handoff
  were corrected before delivery.
