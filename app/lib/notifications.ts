import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// So the app receives and shows notifications (foreground + tap). Without this, Expo may show the push but the app won't handle it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldAnnounce: true,
  }),
});

export type NotificationStatus = "granted" | "denied" | "undetermined" | "unknown";

export async function getNotificationPermissionStatus(): Promise<NotificationStatus> {
  if (!Device.isDevice) return "unknown";
  const { status } = await Notifications.getPermissionsAsync();
  return status as NotificationStatus;
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#8DEB63",
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    throw new Error(
      "Push notifications need an EAS project ID. In the project root run: npx eas init\nThen try enabling notifications again."
    );
  }
  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
  const token = tokenResult?.data ?? null;
  return token;
}

export async function savePushTokenToProfile(userId: string): Promise<{ ok: boolean; error?: string }> {
  let token: string | null;
  try {
    token = await registerForPushNotificationsAsync();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not get push token.";
    return { ok: false, error: msg };
  }
  if (!token) {
    return { ok: false, error: "Could not get push token (permission denied or not a device)." };
  }
  const { error } = await supabase
    .from("profiles")
    .update({ push_token: token })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Opt out: clear push token from profile so the user no longer receives reminder notifications. */
export async function clearPushTokenFromProfile(userId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("profiles")
    .update({ push_token: null })
    .eq("id", userId);
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
