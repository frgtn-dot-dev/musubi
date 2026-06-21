import * as Notifications from "expo-notifications";
import { Platform } from 'react-native';
import { db } from "./db";
import { notificationsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
// import Constants from 'expo-constants';


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export async function scheduleEventPushNotification(title: string, body: string, date: Date) {
  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
    },
  });

  return identifier;
}

export async function cancelEventPushNotification(identifier: string) {
  await Notifications.cancelScheduledNotificationAsync(identifier)
}

export async function updateEventPushNotification(identifier: string, title: string, body: string, date: Date) {
  await cancelEventPushNotification(identifier);
  const newIdentifier = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date,
    },
  });

  return newIdentifier;
}

export async function storeNotification(identifier: string, eventID: string, triggerDate: Date) {
  await db.insert(notificationsTable).values({
    identifier,
    eventID,
    triggerDate: String(triggerDate),
  })
  console.log("--- NOTIFICATION STORED IN DB ---")
}

export async function updateNotificationTriggerDate(identifier: string, eventID: string, triggerDate: Date) {
  await db.update(notificationsTable).set({ triggerDate: String(triggerDate), identifier }).where(eq(notificationsTable.eventID, eventID));
}

export async function removeNotification(eventID: string) {
  await db.delete(notificationsTable).where(eq(notificationsTable.eventID, eventID));
}

export async function getEventsNotificationIdentifier(eventID: string) {
  const result = await db
    .select({ identifier: notificationsTable.identifier })
    .from(notificationsTable)
    .where(eq(notificationsTable.eventID, eventID))
    .limit(1);

  return result[0]?.identifier ?? null;
}

export async function registerForPushNotificationsAsync() {
  // let token;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("musubiChannel", {
      name: "Musubi Notifications",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#FF231F7C",
    });
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (finalStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") {
    alert("Failed to get push token for push notification!");
    return;

  }
}
