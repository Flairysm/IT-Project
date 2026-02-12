import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { OCR_SERVER_URL } from "./config";

type GroupRow = {
  id: string;
  name: string;
  members: string[];
};

export default function ManageGroupsScreen() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [membersInput, setMembersInput] = useState("");
  const [creating, setCreating] = useState(false);

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${OCR_SERVER_URL}/groups`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load groups");
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const createGroup = async () => {
    const name = groupName.trim();
    const members = membersInput
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!name || !members.length) {
      setError("Enter a group name and at least one member.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${OCR_SERVER_URL}/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, members }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create group");
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
    try {
      const res = await fetch(`${OCR_SERVER_URL}/groups/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete group");
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
        {error ? <Text style={styles.error}>{error}</Text> : null}
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

