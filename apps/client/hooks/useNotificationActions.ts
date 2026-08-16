import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { useApi } from "@/services/api";
import {
  ACTION_DECLINE,
  ACTION_OPEN,
  cancelEventNotification,
} from "@/services/notifications";
import { useEventsStore } from "@/store/useEventsStore";
import { presentEventDetail } from "@/store/useEventDetailStore";
import { showToast } from "@/components/ui/Toast";

/**
 * What happens when somebody touches a reminder.
 *
 * Until now nothing did: the app registered no response listener at all, so a
 * tap merely opened it wherever it was last. This handles the two buttons and
 * the plain tap.
 *
 * Registered once, with no dependencies, because it has to survive the app
 * being launched cold BY the notification. Everything it needs is read when the
 * response arrives, not when the effect runs — through the store for events and
 * through a ref for the API, which is rebuilt on every render and would
 * otherwise be captured pointing at the server the user has since left.
 */
export function useNotificationActions() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener(
      (response) => {
        const { eventID } = response.notification.request.content.data as {
          eventID?: string;
        };
        if (!eventID) return;

        const events = useEventsStore.getState().events;
        const event = events.find((candidate) => candidate.id === eventID);
        // The event was deleted, or this device has not synced it. Nothing to
        // decline and nothing to show.
        if (!event) return;

        if (response.actionIdentifier === ACTION_DECLINE) {
          void apiRef.current
            .setAttendance(event, "declined")
            .then(async () => {
              // Declining is also what silences this event, so drop what is
              // already scheduled rather than wait for the next refresh.
              await cancelEventNotification(eventID);
              showToast({ message: `Declined ${event.title}.` });
            })
            .catch(() => {
              showToast({
                message: "Could not send your answer. Try in the app.",
              });
            });
          return;
        }

        // The explicit button and a plain tap both mean "show me this".
        if (
          response.actionIdentifier === ACTION_OPEN ||
          response.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER
        ) {
          presentEventDetail(events, event);
        }
      },
    );

    return () => subscription.remove();
  }, []);
}
