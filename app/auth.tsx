import { useState } from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

const logoSource = require("../assets/EZSplitLogo.png");
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Redirect } from "expo-router";
import { useAuth } from "./auth-context";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const ACCENT = "#8DEB63";
const ACCENT_SOFT = "rgba(141, 235, 99, 0.2)";
const ACCENT_SOFT_2 = "rgba(141, 235, 99, 0.1)";
const BG = "#0b100b";
const TEXT = "#f0f0f0";
const TEXT_MUTED = "#9ca39c";
const INPUT_BG = "rgba(255,255,255,0.06)";

type AuthScreen = "landing" | "login" | "signup";

function WaveBlobs() {
  return (
    <View style={styles.waveContainer} pointerEvents="none">
      <View style={[styles.waveBlob, styles.waveBlob1]} />
      <View style={[styles.waveBlob, styles.waveBlob2]} />
      <View style={[styles.waveBlob, styles.waveBlob3]} />
      <View style={[styles.waveBlob, styles.waveBlob4]} />
    </View>
  );
}

function DecorativeCircles() {
  return (
    <View style={styles.decorCircles} pointerEvents="none">
      <View style={[styles.decorCircle, styles.decorCircle1]} />
      <View style={[styles.decorCircle, styles.decorCircle2]} />
    </View>
  );
}

export default function AuthScreen() {
  const { user, loading, signUp, login } = useAuth();
  const [screen, setScreen] = useState<AuthScreen>("landing");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Redirect href="/(tabs)" />;

  const goBack = () => {
    setScreen("landing");
    setError(null);
    setEmail("");
    setPassword("");
    setConfirmPassword("");
    setUsername("");
  };

  const onSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      if (screen === "signup") {
        await signUp(email, password, confirmPassword, username || undefined);
      } else {
        await login(email, password);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  };

  // —— Landing (Get Started) ——————————————————————————————————————————————
  if (screen === "landing") {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.landingWrap}>
          <View style={styles.logoTopWrap}>
            <Image source={logoSource} style={styles.logoImage} resizeMode="contain" />
          </View>
          <View style={styles.landingCenter}>
            <Text style={styles.landingTitle}>Get Started</Text>
            <Text style={styles.landingTagline}>Start with sign up or sign in</Text>
          </View>
          <View style={styles.landingActions}>
            <Pressable
              onPress={() => setScreen("login")}
              style={({ pressed }) => [styles.landingBtn, styles.landingBtnPrimary, pressed && styles.pressed]}
            >
              <Text style={styles.landingBtnPrimaryText}>LOG IN</Text>
            </Pressable>
            <Pressable
              onPress={() => setScreen("signup")}
              style={({ pressed }) => [styles.landingBtn, styles.landingBtnSecondary, pressed && styles.pressed]}
            >
              <Text style={styles.landingBtnSecondaryText}>SIGN UP</Text>
            </Pressable>
          </View>
        </View>
        <WaveBlobs />
      </SafeAreaView>
    );
  }

  // —— Login / Signup form ——————————————————————————————————————————————————
  const isSignUp = screen === "signup";
  const formTitle = isSignUp ? "Sign Up" : "Welcome Back";
  const formSubtitle = isSignUp ? "Hello! Let's join us." : "Hey! Good to see you again.";

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable onPress={goBack} style={styles.backBtn} hitSlop={12}>
            <Ionicons name="arrow-back" size={24} color={TEXT} />
          </Pressable>

          <View style={styles.formCard}>
            <DecorativeCircles />
            <Text style={styles.formTitle}>{formTitle}</Text>
            <Text style={styles.formSubtitle}>{formSubtitle}</Text>

            <View style={styles.inputRow}>
              <Ionicons name="mail-outline" size={20} color={TEXT_MUTED} style={styles.inputIcon} />
              <TextInput
                value={email}
                onChangeText={(t) => { setEmail(t); setError(null); }}
                style={styles.input}
                placeholder="Email"
                placeholderTextColor={TEXT_MUTED}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
            </View>
            {isSignUp ? (
              <View style={styles.inputRow}>
                <Ionicons name="person-outline" size={20} color={TEXT_MUTED} style={styles.inputIcon} />
                <TextInput
                  value={username}
                  onChangeText={(t) => { setUsername(t); setError(null); }}
                  style={styles.input}
                  placeholder="Username (for friends to find you)"
                  placeholderTextColor={TEXT_MUTED}
                  autoCapitalize="none"
                  autoComplete="username"
                />
              </View>
            ) : null}
            <View style={styles.inputRow}>
              <Ionicons name="lock-closed-outline" size={20} color={TEXT_MUTED} style={styles.inputIcon} />
              <TextInput
                value={password}
                onChangeText={(t) => { setPassword(t); setError(null); }}
                style={styles.input}
                placeholder="Password"
                placeholderTextColor={TEXT_MUTED}
                secureTextEntry
                autoComplete={isSignUp ? "new-password" : "password"}
              />
            </View>
            {isSignUp ? (
              <View style={styles.inputRow}>
                <Ionicons name="lock-closed-outline" size={20} color={TEXT_MUTED} style={styles.inputIcon} />
                <TextInput
                  value={confirmPassword}
                  onChangeText={(t) => { setConfirmPassword(t); setError(null); }}
                  style={styles.input}
                  placeholder="Confirm password"
                  placeholderTextColor={TEXT_MUTED}
                  secureTextEntry
                  autoComplete="new-password"
                />
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorWrap}>
                <Ionicons name="warning-outline" size={18} color="#fca5a5" />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable onPress={() => setError(null)} style={styles.errorDismiss} hitSlop={8}>
                  <Ionicons name="close" size={20} color={TEXT_MUTED} />
                </Pressable>
              </View>
            ) : null}

            <Pressable
              onPress={() => void onSubmit()}
              style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]}
              disabled={submitting}
            >
              <Text style={styles.landingBtnPrimaryText}>
                {submitting ? "Please wait…" : isSignUp ? "SIGN UP" : "SIGN IN"}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setScreen(isSignUp ? "login" : "signup");
                setError(null);
              }}
              style={({ pressed }) => [styles.switchBtn, pressed && styles.pressed]}
            >
              <Text style={styles.switchBtnText}>
                {isSignUp ? "You already have an account? Sign in" : "Don't have an account? Sign up"}
              </Text>
            </Pressable>
          </View>
        </ScrollView>
        <WaveBlobs />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  pressed: { opacity: 0.88 },

  // Wavy bottom shapes (green blobs)
  waveContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 280,
  },
  waveBlob: {
    position: "absolute",
    borderRadius: 999,
  },
  waveBlob1: {
    width: SCREEN_WIDTH * 1.1,
    height: 200,
    backgroundColor: ACCENT_SOFT,
    bottom: -60,
    left: -SCREEN_WIDTH * 0.15,
  },
  waveBlob2: {
    width: SCREEN_WIDTH * 0.9,
    height: 180,
    backgroundColor: ACCENT_SOFT_2,
    bottom: 20,
    right: -SCREEN_WIDTH * 0.2,
  },
  waveBlob3: {
    width: SCREEN_WIDTH * 0.7,
    height: 160,
    backgroundColor: ACCENT_SOFT,
    bottom: 60,
    left: -SCREEN_WIDTH * 0.1,
  },
  waveBlob4: {
    width: SCREEN_WIDTH * 0.5,
    height: 120,
    backgroundColor: "rgba(141, 235, 99, 0.2)",
    bottom: 100,
    right: -20,
  },

  // Decorative circles (top right on form)
  decorCircles: {
    position: "absolute",
    top: -20,
    right: -20,
  },
  decorCircle: {
    position: "absolute",
    borderRadius: 999,
  },
  decorCircle1: {
    width: 100,
    height: 100,
    backgroundColor: ACCENT_SOFT_2,
    top: 0,
    right: 0,
  },
  decorCircle2: {
    width: 60,
    height: 60,
    backgroundColor: ACCENT_SOFT,
    top: 30,
    right: 50,
  },

  // Landing
  landingWrap: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
  },
  logoTopWrap: {
    alignItems: "center",
    marginBottom: 0,
  },
  landingCenter: {
    alignItems: "center",
    marginTop: 32,
    marginBottom: 32,
  },
  landingTitle: {
    color: TEXT,
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  landingTagline: {
    color: TEXT_MUTED,
    fontSize: 16,
    textAlign: "center",
  },
  logoImage: {
    width: 100,
    height: 100,
  },
  landingActions: {
    gap: 14,
  },
  landingBtn: {
    height: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  landingBtnPrimary: {
    backgroundColor: ACCENT,
  },
  landingBtnPrimaryText: {
    color: "#0a0a0a",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  landingBtnSecondary: {
    backgroundColor: "transparent",
    borderWidth: 2,
    borderColor: ACCENT,
  },
  landingBtnSecondaryText: {
    color: ACCENT,
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  // Form
  keyboardWrap: { flex: 1 },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 160,
  },
  backBtn: {
    alignSelf: "flex-start",
    padding: 8,
    marginBottom: 8,
  },
  formCard: {
    maxWidth: 400,
    width: "100%",
    alignSelf: "center",
    position: "relative",
  },
  formTitle: {
    color: TEXT,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: 8,
  },
  formSubtitle: {
    color: TEXT_MUTED,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: INPUT_BG,
    borderRadius: 14,
    marginBottom: 14,
    paddingLeft: 14,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 52,
    color: TEXT,
    fontSize: 16,
    paddingVertical: 0,
  },
  errorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(252, 165, 165, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(252, 165, 165, 0.2)",
  },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  errorDismiss: { padding: 4 },
  primaryBtn: {
    height: 54,
    borderRadius: 16,
    backgroundColor: ACCENT,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  switchBtn: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
  },
  switchBtnText: {
    color: TEXT_MUTED,
    fontSize: 14,
    fontWeight: "500",
  },
});
