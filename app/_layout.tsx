import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useSegments, Redirect } from "expo-router";
import { AuthProvider, useAuth } from "./auth-context";

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
  return <Stack screenOptions={{ headerShown: false }} />;
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
