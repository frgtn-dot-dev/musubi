# Web DST axis acceptance — 2026-09-10

The owner approved the concrete Prague spring/fall Storybook pattern before
production integration. Day/week now use the same memoized, explicit-zone axis
for ticks, current time, opening scroll, event/availability pieces, selection,
draft previews, pointer moves/resizes and keyboard actions. Ordinary-day geometry
and overlap placement are retained. Native/shared layout is unchanged.

Spring holes have no create/drop instant. Fall repeats retain separate instants
and offset labels. Cross-hole pieces belong to one event action per day; resize
handles remain on actual event endpoints. Very short pieces cannot paint into a
hole. Zero-duration imported events remain visible without inventing persisted
duration. Move preserves elapsed duration; resize respects the fixed endpoint
and real day boundary, including short imported events near midnight.

Quick create, full editor and serialized URL handoff preserve exact endpoints.
Editing one civil endpoint preserves the other endpoint's chosen fold. An edited
missing/ambiguous legacy local time is refused until resolved. Reloading the full
editor retains the chosen instant. Draft civil fields derive from complete exact
endpoints, never from clipped preview coordinates. A rapid Save after dragging
is not swallowed as the trailing pointer click.

## Evidence

- Full `pnpm check` passed; targeted follow-up geometry, pointer-state, editor,
  URL and renderer regressions cover the fixes found during review.
- Four production renderer Storybook Chromium/accessibility cases passed.
- Fourteen new Playwright scenarios cover Prague first/second 02:30 create,
  pointer move/resize and keyboard payloads, quick/full handoff plus reload,
  spring hole rejection and an actual invalid draft drop followed by immediate
  save, day-end creation, midnight-crossing pieces and a moved overnight draft,
  and one-minute painting at a spring hole. The create/handoff cases include
  1280px light and 390px dark layouts. Lord Howe tests exercise both repeated
  01:45 instants and refusal of missing spring 02:15.
- The browser scenarios assert UTC mutation bodies and meaningful rendered
  states; they check runtime errors and framework overlays. Provider endpoints
  are mocked; no new live-provider writes or invitations were used.
- Existing day/week, overlap, drag/resize, draft, keyboard, Escape, density,
  full-editor and ghost browser regressions were checked separately.
- Independent review findings around short-event boundaries, zero-duration
  visibility, cross-midnight draft handoff and resize edges were fixed and
  regression-tested before handoff.

This is bounded Chromium/web acceptance, not physical-device/OS notification
acceptance or production provider activation. Other calendar views and native
axis integration remain separate. Product/minimum versions and provider flags
are unchanged. The Google interval overlay keeps its existing identity,
query-generation, privacy and opt-in fences; only its obsolete DST exclusion
was removed after projection onto the same axis.

## Full-matrix CI follow-up

The first CI run found a single-piece height/container-query regression and two
obsolete browser assertions requiring the former DST availability exclusion.
Single pieces now fill the action's actual height; the existing content-density
browser test passes unchanged. Availability acceptance now requires the correct
fall-day busy interval and preserves its lack of event actions. All fourteen DST
browser scenarios passed again after the correction, along with the affected
availability cases and an existing two-session realtime case. Final required CI
results are attached to the PR's exact head; the first failed run is not treated
as acceptance.
