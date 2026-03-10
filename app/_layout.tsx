import { useEffect, useRef } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useSegments, Redirect } from "expo-router";
import * as Notifications from "expo-notifications";
import { AuthProvider, useAuth } from "./auth-context";
import "./lib/notifications"; // Sets notification handler so app receives push (foreground + tap)

function handleNotificationResponse(
  response: Notifications.NotificationResponse | null,
  router: ReturnType<typeof useRouter>
) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const data = response.notification.request.content.data as { receiptId?: string } | undefined;
  const receiptId = typeof data?.receiptId === "string" ? data.receiptId.trim() : null;
  if (receiptId) {
    router.push({ pathname: "/history/[id]", params: { id: receiptId } });
  }
}

function NotificationHandler() {
  const router = useRouter();
  const lastResponse = Notifications.useLastNotificationResponse();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      if (mounted.current) handleNotificationResponse(response, router);
    });
    return () => {
      mounted.current = false;
      sub.remove();
    };
  }, [router]);

  useEffect(() => {
    if (lastResponse) handleNotificationResponse(lastResponse, router);
  }, [lastResponse, router]);

  return null;
}

function AppNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const inAuthScreen = segments[0] === "auth";

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color="#8DEB63" />
      </View>
    );
  }
  const publicRoutes = ["terms", "privacy"];
  const isPublicRoute = publicRoutes.includes(segments[0] ?? "");
  if (!user && !inAuthScreen && !isPublicRoute) return <Redirect href="/auth" />;
  if (user && inAuthScreen) return <Redirect href="/(tabs)" />;
  return (
    <>
      <Stack screenOptions={{ headerShown: false }} />
      <NotificationHandler />
    </>
  );
}

const styles = StyleSheet.create({
  loadingScreen: {
    flex: 1,
    backgroundColor: "#0b100b",
    justifyContent: "center",
    alignItems: "center",
  },
});

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
