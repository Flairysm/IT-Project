import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useSegments, Redirect } from "expo-router";
import { AuthProvider, useAuth } from "./auth-context";

function AppNavigator() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const inAuthScreen = segments[0] === "auth";

  if (loading) return null;
  const publicRoutes = ["terms", "privacy"];
  const isPublicRoute = publicRoutes.includes(segments[0] ?? "");
  if (!user && !inAuthScreen && !isPublicRoute) return <Redirect href="/auth" />;
  if (user && inAuthScreen) return <Redirect href="/(tabs)" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppNavigator />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
