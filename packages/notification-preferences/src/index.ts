export type NotificationTopic = "payments" | "delivery" | "subscriptions" | "security" | "marketing";
export type NotificationChannel = "email" | "webhook" | "dashboard";

export interface NotificationPreference {
  userId: string;
  topic: NotificationTopic;
  channel: NotificationChannel;
  enabled: boolean;
}

export function setNotificationPreference(preferences: NotificationPreference[], next: NotificationPreference): NotificationPreference[] {
  return [...preferences.filter((pref) => !(pref.userId === next.userId && pref.topic === next.topic && pref.channel === next.channel)), next];
}

export function notificationEnabled(preferences: NotificationPreference[], userId: string, topic: NotificationTopic, channel: NotificationChannel): boolean {
  return preferences.find((pref) => pref.userId === userId && pref.topic === topic && pref.channel === channel)?.enabled ?? true;
}
