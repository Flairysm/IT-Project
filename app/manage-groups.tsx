import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";

type GroupRow = {
  id: string;
  name: string;
  members: string[];
};

export default function ManageGroupsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [membersInput, setMembersInput] = useState("");
  const [creating, setCreating] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: rows, error: err } = await supabase
        .from("groups")
        .select("id, name, group_members(user_id, profiles(username))")
        .eq("host_id", user.id);
      if (err) throw new Error(err.message);
      const list = (rows || []).map((g: { id: string; name: string; group_members?: Array<{ profiles?: { username?: string } | null }> }) => ({
        id: String(g.id),
        name: g.name,
        members: (g.group_members || []).map((gm) => gm.profiles?.username).filter(Boolean) as string[],
      }));
      setGroups(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const createGroup = async () => {
    if (!user?.id) return;
    const name = groupName.trim();
    const memberNames = membersInput
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    if (!name || !memberNames.length) {
      setError("Enter a group name and at least one member (username).");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const { data: groupRow, error: groupErr } = await supabase
        .from("groups")
        .insert({ host_id: user.id, name })
        .select("id")
        .single();
      if (groupErr) throw new Error(groupErr.message);
      const groupId = groupRow?.id;
      if (!groupId) throw new Error("Failed to create group");
      for (const username of memberNames) {
        const { data: profileRow } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
        if (profileRow?.id) {
          await supabase.from("group_members").insert({ group_id: groupId, user_id: profileRow.id, status: "accepted" });
        }
      }
      setGroupName("");
      setMembersInput("");
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create group");
    } finally {
      setCreating(false);
    }
  };

  const deleteGroup = async (id: string) => {
    if (!user?.id) return;
    try {
      const { error } = await supabase.from("groups").delete().eq("id", id).eq("host_id", user.id);
      if (error) throw new Error(error.message);
      setGroups((prev) => prev.filter((g) => g.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete group");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Manage Groups</Text>
          <Text style={styles.subtitle}>Save member sets for faster receipt splitting.</Text>
        </View>
      </View>

      {error ? (
        <View style={styles.errorWrap}>
          <View style={styles.errorRow}>
            <Ionicons name="warning-outline" size={18} color="#fca5a5" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)} style={styles.errorDismissIcon} hitSlop={8}>
              <Ionicons name="close" size={20} color="#a3a3a3" />
            </Pressable>
          </View>
          <View style={styles.errorActions}>
            <Pressable onPress={() => setError(null)} style={({ pressed }) => [styles.errorBtn, pressed && styles.pressed]}>
              <Text style={styles.errorBtnText}>Dismiss</Text>
            </Pressable>
            <Pressable onPress={() => { setError(null); void loadGroups(); }} style={({ pressed }) => [styles.errorBtn, styles.errorBtnRetry, pressed && styles.pressed]}>
              <Text style={styles.errorBtnText}>Retry</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.formCard}>
        <Text style={styles.formTitle}>Create New Group</Text>
        <Text style={styles.label}>Group Name</Text>
        <TextInput value={groupName} onChangeText={setGroupName} style={styles.input} placeholder="e.g. Office Team" placeholderTextColor="#737373" />
        <Text style={styles.label}>Members (comma separated)</Text>
        <TextInput
          value={membersInput}
          onChangeText={setMembersInput}
          style={[styles.input, styles.membersInput]}
          placeholder="e.g. Bryant, Hayden, Alex"
          placeholderTextColor="#737373"
          multiline
          textAlignVertical="top"
        />
        <Pressable onPress={createGroup} disabled={creating} style={({ pressed }) => [styles.createBtn, pressed && styles.pressed]}>
          <Text style={styles.createBtnText}>{creating ? "Creating..." : "Create Group"}</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <Text style={styles.listTitle}>Saved Groups</Text>
        {loading ? <Text style={styles.meta}>Loading groups...</Text> : null}
        {!loading && !groups.length ? <Text style={styles.meta}>No groups yet.</Text> : null}
        {groups.map((g) => (
          <View key={g.id} style={styles.groupCard}>
            <View style={styles.groupTopRow}>
              <Text style={styles.groupName}>{g.name}</Text>
              <Pressable onPress={() => void deleteGroup(g.id)} style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>
            <Text style={styles.memberCount}>{g.members.length} member{g.members.length === 1 ? "" : "s"}</Text>
            <View style={styles.memberChipWrap}>
              {g.members.map((member, idx) => (
                <View key={`${g.id}-${member}-${idx}`} style={styles.memberChip}>
                  <Text style={styles.memberChipText}>{member}</Text>
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, marginTop: 8, marginBottom: 14 },
  headerTextWrap: { flex: 1 },
  backBtn: { minHeight: 34, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  backBtnText: { color: "#e5e5e5", fontSize: 13, fontWeight: "600" },
  title: { color: "#e5e5e5", fontSize: 24, fontWeight: "700", lineHeight: 28 },
  subtitle: { color: "#a3a3a3", fontSize: 12, marginTop: 2 },
  formCard: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#141414", padding: 14, marginBottom: 12 },
  formTitle: { color: "#e5e5e5", fontSize: 15, fontWeight: "700", marginBottom: 6 },
  label: { color: "#a3a3a3", fontSize: 12, marginBottom: 6, marginTop: 8 },
  input: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#101010",
    color: "#e5e5e5",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  membersInput: { minHeight: 70 },
  createBtn: { marginTop: 10, minHeight: 42, borderRadius: 10, backgroundColor: "#8DEB63", alignItems: "center", justifyContent: "center" },
  createBtnText: { color: "#0a0a0a", fontWeight: "700", fontSize: 14 },
  error: { color: "#fca5a5", marginTop: 8, fontSize: 12 },
  errorWrap: { marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "rgba(252,165,165,0.12)", borderWidth: 1, borderColor: "rgba(252,165,165,0.25)" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  errorDismissIcon: { padding: 4 },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  errorBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  errorBtnRetry: { backgroundColor: "rgba(141,235,99,0.2)" },
  errorBtnText: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 20 },
  listTitle: { color: "#e5e5e5", fontSize: 15, fontWeight: "700", marginBottom: 8 },
  groupCard: { borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#141414", padding: 12, marginBottom: 10 },
  groupTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  groupName: { color: "#e5e5e5", fontSize: 15, fontWeight: "700", flex: 1, paddingRight: 8 },
  memberCount: { color: "#8f8f8f", fontSize: 12, marginBottom: 8 },
  memberChipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  memberChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  memberChipText: { color: "#e5e5e5", fontSize: 12, fontWeight: "500" },
  deleteBtn: { minHeight: 30, borderRadius: 8, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(252,165,165,0.35)", backgroundColor: "rgba(239,68,68,0.12)" },
  deleteBtnText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  meta: { color: "#a3a3a3", fontSize: 13 },
  pressed: { opacity: 0.9 },
});

