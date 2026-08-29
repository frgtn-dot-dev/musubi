import {
  deletePushSubscription,
  listPushSubscriptions,
  savePushSubscription,
} from "@musubi/db";
import { BadRequestError } from "@musubi/types";
import type { Request, Response } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";

// A subscription is an address the browser vendor's push service handed out,
// plus the keys a payload must be encrypted to. It is not a credential for
// anything of ours — but it IS a way to make somebody's device buzz, so it is
// stored against the session that produced it and only that session can drop it.

const SubscriptionSchema = z
  .object({
    // Always an https URL at the vendor (fcm.googleapis.com, *.notify.windows
    // .com, web.push.apple.com). Bounded because it is a primary key and an
    // unbounded string from a client is somebody else's outage.
    endpoint: z.string().url().max(2048).startsWith("https://"),
    keys: z
      .object({
        auth: z.string().min(1).max(256),
        p256dh: z.string().min(1).max(256),
      })
      .strict(),
  })
  .strict();

const UnsubscribeSchema = z
  .object({ endpoint: z.string().url().max(2048) })
  .strict();

/**
 * An endpoint reduced to something safe to hand back.
 *
 * A push endpoint is a capability URL: anyone holding it can make that device
 * buzz. Listing them would turn a diagnostics read into a way to harvest them,
 * so what goes out is a digest. A browser can hash the endpoint it already
 * holds and find itself in the list; nobody else can work backwards to one.
 */
export function fingerprintEndpoint(endpoint: string) {
  return createHash("sha256").update(endpoint).digest("hex");
}

export function createPushHandlers(
  dependencies: {
    list?: typeof listPushSubscriptions;
    remove?: typeof deletePushSubscription;
    save?: typeof savePushSubscription;
  } = {},
) {
  const list = dependencies.list ?? listPushSubscriptions;
  const remove = dependencies.remove ?? deletePushSubscription;
  const save = dependencies.save ?? savePushSubscription;

  return {
    async subscribe(req: Request, res: Response) {
      const parsed = SubscriptionSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError(
          "Body must be a PushSubscription — { endpoint, keys: { auth, p256dh } }.",
        );
      }

      await save({
        auth: parsed.data.keys.auth,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        userID: req.user!.id,
      });

      res.status(204).end();
    },

    /**
     * What this server thinks it can push to, for the caller alone.
     *
     * The check it exists for: a browser holding a subscription the server no
     * longer has. That happens whenever a send comes back 410 — the row goes,
     * the browser is never told, and it goes on believing it is covered.
     */
    async listSubscriptions(req: Request, res: Response) {
      const rows = await list(req.user!.id);
      res.status(200).json({
        subscriptions: rows.map((row) => ({
          fingerprint: fingerprintEndpoint(row.endpoint),
          lastSeenAt: row.lastSeenAt.toISOString(),
        })),
      });
    },

    async unsubscribe(req: Request, res: Response) {
      const parsed = UnsubscribeSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new BadRequestError("Body must be { endpoint }.");
      }

      await remove(req.user!.id, parsed.data.endpoint);
      res.status(204).end();
    },
  };
}

const handlers = createPushHandlers();

export const handlerListPushSubscriptions = handlers.listSubscriptions;
export const handlerSubscribePush = handlers.subscribe;
export const handlerUnsubscribePush = handlers.unsubscribe;
