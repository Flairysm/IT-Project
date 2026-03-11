import { useCallback, useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";

export default function BusinessNewBatchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [batchName, setBatchName] = useState("");
  const [friends, setFriends] = useState<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  const loadFriends = useCallback(async () => {
    if (!user?.id) return;
    const myId = user.id;
    const { data: asUser } = await supabase.from("friendships").select("friend_id").eq("user_id", myId).eq("status", "accepted");
    const { data: asFriend } = await supabase.from("friendships").select("user_id").eq("friend_id", myId).eq("status", "accepted");
    const ids = new Set<string>();
    (asUser ?? []).forEach((r: { friend_id: string }) => ids.add(r.friend_id));
    (asFriend ?? []).forEach((r: { user_id: string }) => ids.add(r.user_id));
    ids.delete(myId);
    if (ids.size === 0) {
      setFriends([]);
      return;
    }
    const { data: profs } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", [...ids]);
    setFriends(
      (profs ?? []).map((p: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => ({
        id: p.id,
        username: p.username ?? "",
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
      }))
    );
  }, [user?.id]);

  useEffect(() => {
    loadFriends();
  }, [loadFriends]);

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleCreate = async () => {
    const name = batchName.trim();
    if (!name || !user?.id) {
      Alert.alert("Required", "Enter a project name.");
      return;
    }
    setSaving(true);
    const { data: projectId, error: projectError } = await supabase.rpc("create_business_project", { p_name: name });
    setSaving(false);
    if (projectError || !projectId) {
      Alert.alert("Error", projectError?.message ?? "Could not create project.");
      return;
    }
    const pid = projectId as string;
    if (selectedMemberIds.length > 0) {
      await supabase.from("business_project_members").insert(
        selectedMemberIds.map((user_id) => ({ project_id: pid, user_id }))
      );
    }
    router.replace({ pathname: "/business-project-detail", params: { projectId: pid } });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>New project</Text>
          <Text style={styles.subtitle}>One-time setup — project name</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.inputLabel}>Project name</Text>
        <TextInput
          style={styles.input}
          value={batchName}
          onChangeText={setBatchName}
          placeholder="e.g. Project name"
          placeholderTextColor="#525252"
          autoCapitalize="words"
        />

        <Text style={styles.inputLabel}>Add members</Text>
        <Text style={styles.hintSmall}>Search and select friends. Added users can view all batches and leave from project settings.</Text>
        <View style={styles.memberSearchWrap}>
          <Ionicons name="search" size={18} color="#737373" style={styles.memberSearchIcon} />
          <TextInput
            style={styles.memberSearchInput}
            value={memberSearchQuery}
            onChangeText={setMemberSearchQuery}
            placeholder="Search by name or username…"
            placeholderTextColor="#525252"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {memberSearchQuery.length > 0 ? (
            <Pressable onPress={() => setMemberSearchQuery("")} style={styles.memberSearchClear} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color="#737373" />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.memberList}>
          {friends.length === 0 ? (
            <Text style={styles.memberEmpty}>No friends yet.</Text>
          ) : (() => {
            const searchLower = memberSearchQuery.trim().toLowerCase();
            const filtered = searchLower
              ? friends.filter(
                  (f) =>
                    (f.display_name && f.display_name.toLowerCase().includes(searchLower)) ||
                    (f.username && f.username.toLowerCase().includes(searchLower))
                )
              : friends;
            if (filtered.length === 0) {
              return <Text style={styles.memberEmpty}>No matches for "{memberSearchQuery.trim()}".</Text>;
            }
            return filtered.map((f) => {
              const selected = selectedMemberIds.includes(f.id);
              const displayName = (f.display_name && f.display_name.trim()) || f.username || "—";
              return (
                <Pressable
                  key={f.id}
                  style={[styles.memberRow, selected && styles.memberRowSelected]}
                  onPress={() => toggleMember(f.id)}
                >
                  <View style={styles.memberRowLeft}>
                    <View style={styles.memberAvatarWrap}>
                      {f.avatar_url ? (
                        <Image source={{ uri: f.avatar_url }} style={styles.memberAvatarImg} />
                      ) : (
                        <View style={styles.memberAvatarPlaceholder}>
                          <Text style={styles.memberAvatarLetter}>{(f.username || "?").charAt(0).toUpperCase()}</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.memberNameBlock}>
                      <Text style={styles.memberName}>{displayName}</Text>
                      <Text style={styles.memberUsername}>@{f.username || ""}</Text>
                    </View>
                  </View>
                  {selected ? <Ionicons name="checkmark-circle" size={22} color="#8DEB63" /> : <View style={styles.memberCheckEmpty} />}
                </Pressable>
              );
            });
          })()}
        </View>

        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.pressed, (!batchName.trim() || saving) && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={!batchName.trim() || saving}
        >
          <Text style={styles.createBtnText}>{saving ? "Creating…" : "Create project"}</Text>
        </Pressable>

        <Text style={styles.hint}>Project will appear in Manage → Business. Open it to add batches.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  pressed: { opacity: 0.85 },
  headerText: { flex: 1 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#737373", fontSize: 14, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  inputLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  createBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
    alignItems: "center",
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "800" },
  hint: { color: "#737373", fontSize: 13, marginTop: 20, textAlign: "center" },
  hintSmall: { color: "#737373", fontSize: 12, marginBottom: 10 },
  memberSearchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderRadius: 12, marginBottom: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  memberSearchIcon: { marginRight: 8 },
  memberSearchInput: { flex: 1, color: "#fff", fontSize: 16, paddingVertical: 12, minHeight: 44 },
  memberSearchClear: { padding: 4 },
  memberList: { marginBottom: 20 },
  memberEmpty: { color: "#737373", fontSize: 14 },
  memberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  memberRowSelected: { backgroundColor: "rgba(141,235,99,0.12)", borderColor: "rgba(141,235,99,0.3)" },
  memberRowLeft: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, marginRight: 12 },
  memberAvatarWrap: { width: 40, height: 40, borderRadius: 20, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.1)", marginRight: 12 },
  memberAvatarImg: { width: 40, height: 40 },
  memberAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(141,235,99,0.2)" },
  memberAvatarLetter: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  memberNameBlock: { flex: 1, minWidth: 0 },
  memberName: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  memberUsername: { color: "#737373", fontSize: 13, marginTop: 2 },
  memberCheckEmpty: { width: 22, height: 22 },
});
