import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect } from "expo-router";
import { useAuth } from "./auth-context";

export default function AuthScreen() {
  const { user, loading, signUp, login } = useAuth();
  const [isSignUp, setIsSignUp] = useState(true);
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Redirect href="/(tabs)" />;

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (isSignUp) await signUp(email, password, confirmPassword, username || undefined);
      else await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.card}>
        <Text style={styles.title}>{isSignUp ? "Create Account" : "Login"}</Text>
        <Text style={styles.subtitle}>
          {isSignUp ? "Sign up with email. Set a username for EZSplit." : "Sign in with your email."}
        </Text>

        <TextInput
          value={email}
          onChangeText={setEmail}
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="#737373"
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
        />
        {isSignUp ? (
          <TextInput
            value={username}
            onChangeText={setUsername}
            style={styles.input}
            placeholder="Username (optional)"
            placeholderTextColor="#737373"
            autoCapitalize="none"
            autoComplete="username"
          />
        ) : null}
        <TextInput
          value={password}
          onChangeText={setPassword}
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="#737373"
          secureTextEntry
          autoComplete={isSignUp ? "new-password" : "password"}
        />
        {isSignUp ? (
          <TextInput
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor="#737373"
            secureTextEntry
            autoComplete="new-password"
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable onPress={() => void onSubmit()} style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} disabled={submitting}>
          <Text style={styles.primaryBtnText}>{submitting ? "Please wait..." : isSignUp ? "Sign Up" : "Login"}</Text>
        </Pressable>

        <Pressable
          onPress={() => {
            setIsSignUp((prev) => !prev);
            setError(null);
          }}
          style={({ pressed }) => [styles.switchBtn, pressed && styles.pressed]}
        >
          <Text style={styles.switchBtnText}>
            {isSignUp ? "Already have an account? Login" : "No account yet? Sign Up"}
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center", padding: 20 },
  card: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#141414",
    padding: 16,
  },
  title: { color: "#e5e5e5", fontSize: 24, fontWeight: "700", marginBottom: 6 },
  subtitle: { color: "#a3a3a3", fontSize: 13, marginBottom: 14 },
  input: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#101010",
    color: "#e5e5e5",
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  error: { color: "#fca5a5", marginBottom: 8, fontSize: 12 },
  primaryBtn: { minHeight: 44, borderRadius: 10, backgroundColor: "#8DEB63", alignItems: "center", justifyContent: "center", marginTop: 2 },
  primaryBtnText: { color: "#0a0a0a", fontWeight: "700", fontSize: 14 },
  switchBtn: { minHeight: 36, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 10 },
  switchBtnText: { color: "#a3a3a3", fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.9 },
});
