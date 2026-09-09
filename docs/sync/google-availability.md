# Google interval-only availability

`GOOGLE_AVAILABILITY_ENABLED` defaults to false. This bounded K14 read slice does
not change event writes, product versions, or live deployment settings.

Complete Google CalendarList discovery publishes freeBusyReader sources into a
private availability registry. These sources remain excluded from the ordinary
calendar set: the existing downgrade transaction still retires the detail mirror
and its memberships before subsequent event fetches. Partial discovery never
retires availability sources. Initial sources and sources returning after removal
are disabled until the connection owner explicitly selects them. There are no
calendar memberships, event identities, recurrence expansion, writes, or outbox
operations for busy intervals.

Connections shows a separate Google availability section. Its switches select
sources only for explicit availability checks; they do not overlay every account
or add anything to a page. The Check availability dialog reads up to 20 selected
sources for a UTC range up to 42 days. The selection flow explains and enforces
that limit; an existing over-limit selection must be reduced before checking. The end is exclusive. It renders existing
Field, Row, SettingsSection, Switch and Dialog primitives, with no event edit,
RSVP, reminder, drag, or resize controls. An empty confirmed result means no busy
intervals in that range. Unavailable and reconnect-required never mean free.

The API resolves opaque source UUIDs against the authenticated owner and account;
clients cannot submit provider calendar IDs. Each source result is independently
validated, clipped and unioned as UTC instants, preserving DST offsets. Google
HTTP 200 responses can contain individual calendar errors. Missing/invalid
coverage, invalid intervals, partial bodies, HTTP failures and unknown provider
errors are unavailable, never empty-success. There is no server interval cache.
HTTP uses no-store; browser queries have separate server/user/source/generation
keys, zero retention after unmount and no offline-persistence allowance. Selection,
identity and stream invalidation discard prior observations. Source refresh or
errors hide previous interval data while it is being revalidated.

Source generations and account discovery generations fence late replies. A random
account epoch also prevents disconnect/reconnect ABA. Enabling/disabling a source
uses generation CAS. Account cleanup cascades sources; fresh discovery must
verify its accepted epoch and account credentials before reconciliation. Before
and after provider reads, the source selection/generation, current account,
refresh-token presence, sync status and scope are rechecked. Raw tokens/native
calendar IDs are internal and never part of availability DTOs.

Google documents calendar.events.freebusy, calendar.freebusy, calendar.readonly
or calendar for freeBusy.query; calendar.events alone is not sufficient. When the
server capability is enabled, web connection/reconnection/onboarding and native
connection code request the narrow calendar.events.freebusy scope in addition to
the existing event/calendar scopes. Existing insufficient grants explicitly need
reconnection, including when invalid_grant has cleared the refresh token.
Sources remain visible for reconnecting until explicit account disconnection
removes the registry. No real OAuth consent or provider calls were performed for this
implementation. Actual re-consent, provider interoperability, physical-device QA
and production activation remain human-last.

Validation uses mocked Google HTTP and a disposable DB under ENVIRONMENT=test.
The integration regression runs in the standard test:db:sync chain and CI. Cases include
interval/DST normalization, per-calendar errors, scope checks, private owner and
account isolation, downgrade mirror retirement, disabled defaults, and delayed
responses across source removal, selection changes and disconnect/reconnect.

Day/week grid rendering is a deferred implementation follow-up, not blocked
solely by the interval DTO. A static layout may reuse
existing visual patterns; any genuinely new visual pattern needs a Storybook
proposal and normal Musubi UI approval. These dialogs are functional clients, not completion of all K14 availability/cache work.

Primary protocol: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query


## Native connection caller

The native connection screen exposes Check availability only for the current
server capability. It reuses ModalPortal, Btn, SettingRowToggle, theme fields and
ScrollView. A body keyed by home-server origin and authenticated user remounts on
identity changes. The session holds only ephemeral source/interval state: nothing
enters the event stores, SQLite, notification scheduling or offline snapshots.
Explicit selection uses the same source generation CAS and 20-source limit as web.

Home-authenticated requests validate the shared DTOs, retain cancellation through
the existing request timeout, and never accept a provider/picker URL. Close and
background transitions abort pending requests and clear results. Foreground,
external-sync invalidation and source polling require fresh evidence; stale source
polls cannot overwrite a selection. Sync refreshes arriving during a selection
are coalesced until its PUT settles, then read current sources; close and identity
changes still abort and retire the entire session. Interval replies with changed source identities
or generations are discarded. Errors, reconnect-required and confirmed empty reads
remain distinct. Reconnection uses the existing Google disclosure/OAuth flow.

Pure controller and actual native modal/connection callback tests cover this
contract with mocked authenticated transport. They are not screenshots, emulator
rendering or physical-device QA; VoiceOver/TalkBack, touch/layout and real OAuth
acceptance remain unverified. No live provider requests or production activation
were performed for the native caller.
