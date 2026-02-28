import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";

function initials(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
  return s.slice(0, 2).toUpperCase();
}

function displayName(username: string): string {
  return username
    .split(/[.\-_]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

export default function FriendDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ username: string; display_name?: string | null; avatar_url?: string | null } | null>(null);
  const [unfriending, setUnfriending] = useState(false);

  const loadProfile = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: e } = await supabase
        .from("profiles")
        .select("username, display_name, avatar_url")
        .eq("id", id)
        .single();
      if (e) throw new Error(e.message);
      setProfile(data as { username: string; display_name?: string | null; avatar_url?: string | null } | null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load profile");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  const unfriend = () => {
    if (!id || !user?.id) return;
    Alert.alert("Unfriend", `Remove ${profile?.display_name?.trim() || profile?.username || "this user"} from your friends?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Unfriend",
        style: "destructive",
        onPress: async () => {
          setUnfriending(true);
          setError(null);
          try {
            const { error: e1 } = await supabase.from("friendships").delete().eq("user_id", user.id).eq("friend_id", id);
            if (e1) throw new Error(e1.message);
            const { error: e2 } = await supabase.from("friendships").delete().eq("user_id", id).eq("friend_id", user.id);
            if (e2) throw new Error(e2.message);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to unfriend");
          } finally {
            setUnfriending(false);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !profile) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.headerRow}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
          </Pressable>
        </View>
        <View style={styles.errorWrap}>
          <Ionicons name="warning-outline" size={24} color="#fca5a5" />
          <Text style={styles.errorText}>{error || "Friend not found"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const name = (profile.display_name || "").trim() || displayName(profile.username);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Friend</Text>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.card}>
        {profile.avatar_url ? (
          <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarInitial}>{initials(profile.username)}</Text>
          </View>
        )}
        <Text style={styles.displayName} numberOfLines={2}>{name}</Text>
        <Text style={styles.handle}>@{profile.username}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.unfriendBtn, pressed && styles.pressed, unfriending && styles.unfriendBtnDisabled]}
          onPress={unfriend}
          disabled={unfriending}
        >
          <Ionicons name="person-remove-outline" size={20} color="#fca5a5" />
          <Text style={styles.unfriendBtnText}>{unfriending ? "Removing…" : "Unfriend"}</Text>
        </Pressable>
      </View>

      {error ? (
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  pressed: { opacity: 0.9 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#a3a3a3", fontSize: 15 },
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  backBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  headerSpacer: { width: 44 },
  title: { flex: 1, color: "#fff", fontSize: 18, fontWeight: "700", textAlign: "center" },
  errorWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12, padding: 24 },
  errorText: { color: "#fca5a5", fontSize: 14, textAlign: "center" },
  errorBlock: { padding: 16, marginHorizontal: 16, backgroundColor: "rgba(252,165,165,0.12)", borderRadius: 12 },
  card: {
    alignItems: "center",
    marginHorizontal: 20,
    marginTop: 24,
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: "#141414",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  avatar: { width: 96, height: 96, borderRadius: 48 },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: { color: "#8DEB63", fontSize: 32, fontWeight: "800" },
  displayName: { color: "#fff", fontSize: 22, fontWeight: "800", marginTop: 16, textAlign: "center" },
  handle: { color: "#737373", fontSize: 15, marginTop: 6 },
  actions: { marginTop: 24, paddingHorizontal: 20 },
  unfriendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: "rgba(252,165,165,0.12)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.3)",
  },
  unfriendBtnDisabled: { opacity: 0.6 },
  unfriendBtnText: { color: "#fca5a5", fontSize: 16, fontWeight: "600" },
});
