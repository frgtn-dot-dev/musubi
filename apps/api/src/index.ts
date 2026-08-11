import { config, logger } from "@musubi/config";
import { auth } from "@musubi/auth";
import { initializeEmailCapability } from "@musubi/emails";
import { deleteExpiredInvites, deleteExpiredMemberTokens, deleteExpiredSessions, purgeDeletedEvents } from "@musubi/db";
import { toNodeHandler } from "better-auth/node";
import express from "express";
import cors from "cors";
import { middlewareErrorHandler } from "./middleware/error_handler";
import { handlerCreateCalendar, handlerGetCalendars, handlerGetCalendar, handlerRemoveCalendar, handlerUpdateCalendar, handlerJoinCalendar, handlerLeaveCalendar, handlerExportCalendar, handlerImportCalendar, handlerGetCalendarFromToken, handlerGetCalendarMembers, handlerSetMemberRole, handlerKickMember } from "./handlers/calendars";
import { handlerConfirmDeleteUser, handlerDeleteUser, handlerGetAvatar, handlerResetUsers, handlerUploadAvatar } from "./handlers/users";
import { handlerCreateEvent, handlerForkEvent, handlerGetAttendees, handlerGetEvents, handlerLinkEvent, handlerRemoveEvent, handlerSetAttendance, handlerUpdateEvent } from "./handlers/events";
import { optionalAuth, requireAuth } from "./middleware/require_auth";
import {
  handlerCreatePoll,
  handlerClosePoll,
  handlerDecidePoll,
  handlerDeletePoll,
  handlerGetPoll,
  handlerListPollCalendar,
  handlerListPolls,
  handlerVotePoll,
} from "./handlers/scheduling";
import {
  handlerGetEventRsvps,
  handlerGetEventShare,
  handlerGetPublicEvent,
  handlerGetPublicRsvp,
  handlerPutEventShare,
  handlerPutPublicRsvp,
  handlerRevokeEventShare,
} from "./handlers/event_shares";
import { BadRequestError, ForbiddenError } from "@musubi/types";
import { rateLimit } from "./middleware/rate_limit";
import { handlerCreateCalendarInvite, handlerGetCalendarInvites, handlerRevokeInvite } from "./handlers/invites";
import { handlerStream } from "./handlers/stream";
import { middlewareLogHandler } from "./middleware/log_handler";
import {
  handlerGetSettings,
  handlerGetSettingsDocument,
  handlerPatchSettings,
  handlerSaveSettings,
} from "./handlers/settings";
import { handlerAppleAppSiteAssociation, handlerServer, handlerServerStatus } from "./handlers/server";
import { handlerResetPasswordPage, handlerDeleteAccountPage, handlerEmailVerifiedPage } from "./handlers/pages";
import {
  handlerCreatePage,
  handlerDeletePage,
  handlerGetPage,
  handlerListPages,
  handlerReorderPages,
  handlerSavePage,
} from "./handlers/calendar_pages";
import { handlerCheckGoogleStatus, handlerGetGoogleCalendars, handlerRevokeGoogle } from "./handlers/google";
import { handlerCheckCaldavStatus, handlerConnectCaldav, handlerDisconnectCaldav } from "./handlers/caldav";
import { handlerDisconnectAccount, handlerDisconnectExternalCalendar } from "./handlers/connections";
import { handlerDeleteMusubiAccount, handlerFederationAccept, handlerFederationRotateToken, handlerGetFederationConnections, handlerInvitePage } from "./handlers/federation";
import { handlerFederationProxy } from "./handlers/federation_proxy";
import { handlerFederationConnect, handlerFederationPreview } from "./handlers/federation";
import { syncUser } from "./sync/engine";
import { getExternalSyncUserIDs } from "@musubi/db";
import { middlewareMetrics, recordExternalSyncFailure, recordScheduledTaskSkip, startMetricsServer } from "./metrics";
import { nonOverlapping } from "./scheduling";
import { acquireApiSingletonLock } from "./singleton";

const app = express()
const port = config.api.port;

const allowedOrigins = [
  config.api.url,
  ...(config.api.environment === "dev" ? [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8081",
  ] : []),
];

// Sign in with Apple in a browser comes back as a cross-site POST from Apple's
// own domain (`response_mode=form_post`), so that one request carries
// `Origin: https://appleid.apple.com`. It is allowed for that single callback
// path and nowhere else — the request still has to pass Better Auth's state and
// origin checks, and no other endpoint has any business trusting Apple.
const APPLE_FORM_POST_ORIGIN = "https://appleid.apple.com";
const APPLE_CALLBACK_PATH = "/api/auth/callback/apple";

function originsFor(path: string) {
  return path === APPLE_CALLBACK_PATH
    ? [...allowedOrigins, APPLE_FORM_POST_ORIGIN]
    : allowedOrigins;
}

// ── Middleware ────────────────────────────────────────────────────────────────

// First so even parser/CORS failures are measured and receive a correlation id.
app.use(middlewareMetrics);
app.use(middlewareLogHandler);
app.use(cors((req, done) => {
  const permitted = originsFor(req.path);
  done(null, {
    credentials: true,
    origin: (origin, callback) => {
      // No Origin header at all is a same-origin or non-browser caller (the
      // mobile app, curl), which this API serves by design.
      if (!origin || permitted.includes(origin)) {
        callback(null, true);
        return;
      }
      // Forbidden, not a crash: a request from somewhere we do not serve is an
      // answer, and logging it as a 500 buries real faults.
      callback(new ForbiddenError("Origin is not allowed to call this API."));
    },
  });
}));
app.use(express.json({ limit: "512kb" })); // avatars arrive as base64 JSON

// Better Auth owns everything under /api/auth (sign-in/up, sessions, reset).
app.all("/api/auth/{*any}", toNodeHandler(auth));

// ── Routes ────────────────────────────────────────────────────────────────────
// `wrap` adapts an async handler to Express: a rejected promise is forwarded to
// the error middleware (below) instead of crashing the process. Per route it's
// `requireAuth` first (dropped for the few public ones), then `wrap(handler)`.
// Grouped by resource to mirror docs/reference/server.mdx.
const wrap = (handler: (req: any, res: any) => Promise<unknown>): express.RequestHandler =>
  (req, res, next) => { Promise.resolve(handler(req, res)).catch(next); };

// Clients address an occurrence of a series as "<uuid>_<timestamp>", but only
// the master is a row. Checked once here rather than in each handler: without
// it the id reaches Postgres, which rejects the cast and turns a client mistake
// into a 500 with a query in the log.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
app.param("eventId", (_req, _res, next, value: string) => {
  next(
    UUID.test(value)
      ? undefined
      : new BadRequestError("eventId must be an event id, not an occurrence."),
  );
});

// Server (public)
app.get("/api/v1/server", handlerServer);
app.get("/api/v1/server/ok", handlerServerStatus);

// Realtime — Server-Sent Events. Kept outside /api/v1 to match the client's
// EventSource URL (`${apiUrl}/api/stream`). Holds the connection open and
// registers it for notifyCalendarMembers() broadcasts.
app.get("/api/stream", requireAuth, wrap(handlerStream));

// Federation (Musubi ↔ Musubi) — cross-server invite accept (public: the invite
// token is the credential) and the HTML hand-off page for invite links, so every
// server serves its own deep links (no dependency on the hosted domain).
// Public + creates accounts/tokens — cap per-IP so tokens can't be farmed or guessed.
app.post("/api/v1/federation/accept", rateLimit(10, 15 * 60_000), wrap(handlerFederationAccept));
app.post("/api/v1/federation/token/rotate", requireAuth, wrap(handlerFederationRotateToken));
app.get("/api/v1/federation/connections", requireAuth, wrap(handlerGetFederationConnections));
// Preview + accept an invite on ANOTHER server. Both make this API fetch a
// request-supplied origin, so they are authenticated, SSRF-guarded and rate-limited.
app.get("/api/v1/federation/preview", requireAuth, rateLimit(30, 15 * 60_000), wrap(handlerFederationPreview));
app.post("/api/v1/federation/connect", requireAuth, rateLimit(10, 15 * 60_000), wrap(handlerFederationConnect));
// Federation gateway (ADR-005): clients reach a connected server through their
// own origin, so the member token never leaves the API. Rate-limited because it
// makes this server perform outbound requests.
app.all("/api/v1/federation/s/:connectionId/{*rest}", requireAuth, rateLimit(300, 60_000), wrap(handlerFederationProxy));
app.get("/invite/:token", handlerInvitePage(config.api.url));
// Self-hosted auth pages — the reset/delete emails link here on this API's own
// origin, so nothing depends on the central website. Public, no auth (the token
// in the query string is the credential, read client-side).
app.get("/reset-password", handlerResetPasswordPage);
app.get("/delete-account", handlerDeleteAccountPage);
app.get("/email-verified", handlerEmailVerifiedPage);
// iOS universal links — must live at the domain root, public, no auth.
app.get("/.well-known/apple-app-site-association", handlerAppleAppSiteAssociation);
// The user's connections to other Musubi servers (member tokens, encrypted at
// rest) — stored home-side so a connection accepted on one device roams to all.
// Reading connections with their decrypted member token, and storing a
// client-supplied one, are gone (ADR-005 phase 4): `/federation/connections`
// lists them without a credential and `/federation/connect` is the only way one
// is created. A client that still calls the removed routes gets a 404 and falls
// back to its local registry, which is gentler than handing it token-less rows
// it would cache as valid.
app.delete("/api/v1/users/connections/musubi", requireAuth, wrap(handlerDeleteMusubiAccount));

// Events
app.get("/api/v1/events", requireAuth, wrap(handlerGetEvents));
app.post("/api/v1/events", requireAuth, wrap(handlerCreateEvent));
app.put("/api/v1/events", requireAuth, wrap(handlerUpdateEvent));
app.delete("/api/v1/events", requireAuth, wrap(handlerRemoveEvent));
app.post("/api/v1/events/:eventId/link", requireAuth, wrap(handlerLinkEvent));
app.post("/api/v1/events/:eventId/fork", requireAuth, wrap(handlerForkEvent));
app.get("/api/v1/events/:eventId/attendees", requireAuth, wrap(handlerGetAttendees));
app.put("/api/v1/events/:eventId/attendance", requireAuth, wrap(handlerSetAttendance));
// Publishing an event page. Gated on editing the event — handing something to
// the open internet is not a read.
app.get("/api/v1/events/:eventId/share", requireAuth, wrap(handlerGetEventShare));
app.put("/api/v1/events/:eventId/share", requireAuth, wrap(handlerPutEventShare));
app.delete("/api/v1/events/:eventId/share", requireAuth, wrap(handlerRevokeEventShare));
// Who answered. For the organizer, so it ignores the reader-facing visibility.
app.get("/api/v1/events/:eventId/rsvps", requireAuth, wrap(handlerGetEventRsvps));

// Calendars — /google must stay before /:id (both one-segment GETs)
app.get("/api/v1/calendars", requireAuth, wrap(handlerGetCalendars));
app.get("/api/v1/calendars/google", requireAuth, wrap(handlerGetGoogleCalendars));
// Public: possession of the (unguessable, expiring) invite token IS the
// credential — cross-server invitees have no session here yet.
app.get("/api/v1/calendars/tokens/:token", rateLimit(30, 15 * 60_000), wrap(handlerGetCalendarFromToken));
// Scheduling (group poll, PRD §19.1). Creating and deciding belong to the
// organizer; reading is open by token. A first answer needs only name + email;
// replacing an existing email's answer requires an authenticated matching inbox.
app.get(
  "/api/v1/scheduling/polls/calendar",
  requireAuth,
  wrap(handlerListPollCalendar),
);
app.get("/api/v1/scheduling/polls", requireAuth, wrap(handlerListPolls));
app.post("/api/v1/scheduling/polls", optionalAuth, rateLimit(30, 15 * 60_000), wrap(handlerCreatePoll));
app.post("/api/v1/scheduling/polls/:pollId/decide", requireAuth, wrap(handlerDecidePoll));
app.post("/api/v1/scheduling/polls/:pollId/close", requireAuth, wrap(handlerClosePoll));
app.delete("/api/v1/scheduling/polls/:pollId", requireAuth, wrap(handlerDeletePoll));
app.get("/api/v1/public/polls/:token", optionalAuth, rateLimit(60, 15 * 60_000), wrap(handlerGetPoll));
app.put("/api/v1/public/polls/:token/votes", optionalAuth, rateLimit(60, 15 * 60_000), wrap(handlerVotePoll));

// Public: the token IS the credential, same as an invite. Rate-limited per IP so
// the space cannot be walked, and the projection is narrow by construction.
app.get("/api/v1/public/events/:token", rateLimit(60, 15 * 60_000), wrap(handlerGetPublicEvent));
// Answering needs a session — the page signs the guest in with an emailed code
// first, so every RSVP is an address somebody proved.
app.get("/api/v1/public/events/:token/rsvp", requireAuth, rateLimit(60, 15 * 60_000), wrap(handlerGetPublicRsvp));
app.put("/api/v1/public/events/:token/rsvp", requireAuth, rateLimit(30, 15 * 60_000), wrap(handlerPutPublicRsvp));
app.get("/api/v1/calendars/:id/export", requireAuth, wrap(handlerExportCalendar)); // .ics snapshot
app.get("/api/v1/calendars/:id", requireAuth, wrap(handlerGetCalendar));
app.post("/api/v1/calendars", requireAuth, wrap(handlerCreateCalendar));
// Raw iCalendar body — its own text parser (the global 512 KB JSON cap is too small)
app.post("/api/v1/calendars/import", requireAuth, express.text({ type: "*/*", limit: "10mb" }), wrap(handlerImportCalendar));
app.put("/api/v1/calendars", requireAuth, wrap(handlerUpdateCalendar));
app.delete("/api/v1/calendars", requireAuth, wrap(handlerRemoveCalendar));

// Members & invites
app.post("/api/v1/calendars/invites", requireAuth, wrap(handlerCreateCalendarInvite));
app.get("/api/v1/calendars/:calendarId/invites", requireAuth, wrap(handlerGetCalendarInvites));
app.delete("/api/v1/calendars/invites/:inviteId", requireAuth, wrap(handlerRevokeInvite));
app.get("/api/v1/calendars/:calendarId/members", requireAuth, wrap(handlerGetCalendarMembers));
app.post("/api/v1/calendars/members/:calendarId", requireAuth, wrap(handlerJoinCalendar));
app.delete("/api/v1/calendars/members/:calendarId", requireAuth, wrap(handlerLeaveCalendar));
app.put("/api/v1/calendars/:calendarId/members/:userId", requireAuth, wrap(handlerSetMemberRole));
app.delete("/api/v1/calendars/:calendarId/members/:userId", requireAuth, wrap(handlerKickMember));

// Users & connections
app.get("/api/v1/users/settings", requireAuth, wrap(handlerGetSettings));
app.put("/api/v1/users/settings", requireAuth, wrap(handlerSaveSettings));
app.get("/api/v1/users/settings/document", requireAuth, wrap(handlerGetSettingsDocument));
app.patch("/api/v1/users/me/settings", requireAuth, wrap(handlerPatchSettings));

// Pages (private per-user view profiles). `reorder` before `:id` so the literal
// path can't be captured as an id.
app.get("/api/v1/pages", requireAuth, wrap(handlerListPages));
app.post("/api/v1/pages", requireAuth, wrap(handlerCreatePage));
app.put("/api/v1/pages/reorder", requireAuth, wrap(handlerReorderPages));
app.get("/api/v1/pages/:id", requireAuth, wrap(handlerGetPage));
app.patch("/api/v1/pages/:id", requireAuth, wrap(handlerSavePage));
app.delete("/api/v1/pages/:id", requireAuth, wrap(handlerDeletePage));

app.delete("/api/v1/users", requireAuth, wrap(handlerDeleteUser));
// Public: the emailed confirmation link lands on the website (no session); the
// token is the proof. Rate-limited against token guessing.
app.post("/api/v1/users/delete/confirm", rateLimit(10, 15 * 60_000), wrap(handlerConfirmDeleteUser));
app.post("/api/v1/users/avatar", requireAuth, wrap(handlerUploadAvatar));
app.get("/api/v1/users/connections/google", requireAuth, wrap(handlerCheckGoogleStatus));
app.post("/api/v1/users/connections/google/revoke", requireAuth, wrap(handlerRevokeGoogle));
app.get("/api/v1/users/connections/caldav", requireAuth, wrap(handlerCheckCaldavStatus));
app.post("/api/v1/users/connections/caldav", requireAuth, wrap(handlerConnectCaldav));
app.delete("/api/v1/users/connections/caldav", requireAuth, wrap(handlerDisconnectCaldav));
app.post("/api/v1/users/connections/disconnect", requireAuth, wrap(handlerDisconnectAccount));
app.post("/api/v1/users/connections/calendars/disconnect", requireAuth, wrap(handlerDisconnectExternalCalendar));
app.post("/api/v1/users/reset", wrap(handlerResetUsers)); // public — password reset entry
app.get("/api/v1/users/:userId/avatar", wrap(handlerGetAvatar)); // public — <Image> can't send auth headers

// ── Server ────────────────────────────────────────────────────────────────────
// Error middleware must be registered last so it catches everything above.
app.use(middlewareErrorHandler);

// Periodic cleanup of expired rows (Postgres has no native row TTL).
// Scheduling lives here (app concern); the deletes live in @musubi/db.
async function cleanupExpired() {
  const startedAt = performance.now();
  try {
    await deleteExpiredInvites();
    await deleteExpiredMemberTokens();
    await deleteExpiredSessions();
    await purgeDeletedEvents(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)); // tombstones > 30d
    logger.debug("cleanup.completed", {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  } catch (e) {
    logger.error("cleanup.failed", { error: e });
  }
}

// Near-realtime external sync: poll every connected Google/CalDAV account on a
// schedule; syncUser broadcasts an SSE "external_sync" to affected members when
// something actually changed, and their clients run a silent delta refresh.
// Polling is the uniform answer here — true Google push (watch webhooks) needs a
// public HTTPS endpoint + channel renewal (self-host-unfriendly), and CalDAV has
// no push protocol at all. EXTERNAL_SYNC_INTERVAL_MIN=0 disables.
async function syncExternalAccounts() {
  const startedAt = performance.now();
  try {
    const userIDs = await getExternalSyncUserIDs();
    let changedCalendars = 0;
    for (const userID of userIDs) {
      changedCalendars += (await syncUser(userID)).length; // per-provider errors are caught inside
    }
    const fields = {
      users: userIDs.length,
      changedCalendars,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    };
    if (changedCalendars > 0) logger.info("sync.scheduler.completed", fields);
    else logger.debug("sync.scheduler.completed", fields);
  } catch (e) {
    recordExternalSyncFailure("scheduler", "all");
    logger.error("sync.scheduler.failed", {
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      error: e,
    });
  }
}

const runCleanup = nonOverlapping(cleanupExpired, () => {
  recordScheduledTaskSkip("cleanup");
  logger.warn("cleanup.skipped", { reason: "previous_run_active" });
});

const runExternalSync = nonOverlapping(syncExternalAccounts, () => {
  recordScheduledTaskSkip("external_sync");
  logger.warn("sync.scheduler.skipped", { reason: "previous_run_active" });
});

async function start() {
  // The dedicated PostgreSQL session lock makes the documented deployment
  // boundary fail-safe: a second API process sharing this DB does not serve
  // traffic with split SSE/rate-limit/scheduler state.
  await acquireApiSingletonLock();
  await initializeEmailCapability();

  app.listen(port, "0.0.0.0", () => {
    logger.info("server.started", {
      port,
      environment: config.api.environment,
      deploymentMode: "single-replica",
      logLevel: config.api.logLevel,
      externalSyncIntervalMin: config.api.externalSyncIntervalMin,
    });
  });

  if (config.api.metricsPort > 0) {
    startMetricsServer(config.api.metricsPort);
  } else {
    logger.info("metrics.server.disabled");
  }

  void runCleanup(); // run once at boot (setInterval's first tick is delayed)
  setInterval(() => void runCleanup(), 60 * 60 * 1000);

  if (config.api.externalSyncIntervalMin > 0) {
    logger.info("sync.scheduler.enabled", { intervalMin: config.api.externalSyncIntervalMin });
    setInterval(
      () => void runExternalSync(),
      config.api.externalSyncIntervalMin * 60 * 1000,
    );
  } else {
    logger.info("sync.scheduler.disabled");
  }
}

void start().catch((error) => {
  logger.error("server.start_failed", { error });
  process.exit(1);
});
