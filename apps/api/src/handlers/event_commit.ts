import type { Event } from "@musubi/types";
import { EventDeliveryError } from "../sync/engine";
import { ProviderEventWriteError } from "../sync/event_write";

/** A retained transaction receipt is not a claim about the latest readable row. */
export function committedFailure(error: unknown, committed: Event[]) {
  const failure = error instanceof EventDeliveryError ? error.failure : error;
  const conflict = failure instanceof ProviderEventWriteError && failure.code === "provider-conflict";
  return {
    status: conflict ? 409 : 502,
    body: {
      error: "Saved locally, but follow-up work was not confirmed. Your draft was kept. Refresh and reconcile before any retry.",
      code: conflict ? "provider-conflict" : "event-delivery-unconfirmed",
      localCommitted: true,
      committed,
      delivery: {
        completed: error instanceof EventDeliveryError && error.receipts.some((receipt) => receipt.status === "completed"),
        status: conflict ? "conflict" : "unconfirmed",
      },
    },
  };
}
