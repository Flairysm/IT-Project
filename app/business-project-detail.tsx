import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";

type BatchRow = { id: string; name: string; created_at: string; member_count: number };

export default function BusinessProjectDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = params.projectId;
  const { user } = useAuth();
  const [projectName, setProjectName] = useState("");
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [addBatchModalVisible, setAddBatchModalVisible] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [friends, setFriends] = useState<{ id: string; username: string; display_name?: string | null }[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [projectSettingsVisible, setProjectSettingsVisible] = useState(false);
  const [projectEditName, setProjectEditName] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);

  const loadProjectAndBatches = useCallback(async () => {
    if (!projectId || !user?.id) return;
    const { data: proj, error: projErr } = await supabase
      .from("business_projects")
      .select("id, name")
      .eq("id", projectId)
      .eq("host_id", user.id)
      .single();
    if (projErr || !proj) {
      setProjectName("Project");
      setBatches([]);
      setLoading(false);
      return;
    }
    setProjectName((proj as { name: string }).name);
    const { data: batchList, error: batchErr } = await supabase
      .from("business_batches")
      .select("id, name, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (batchErr) {
      setBatches([]);
      setLoading(false);
      return;
    }
    const list = (batchList ?? []) as { id: string; name: string; created_at: string }[];
    const batchIds = list.map((b) => b.id);
    if (batchIds.length === 0) {
      setBatches(list.map((b) => ({ ...b, member_count: 0 })));
      setLoading(false);
      return;
    }
    const { data: memberRows } = await supabase
      .from("business_batch_members")
      .select("batch_id")
      .in("batch_id", batchIds);
    const countByBatch: Record<string, number> = {};
    batchIds.forEach((id) => (countByBatch[id] = 0));
    (memberRows ?? []).forEach((r: { batch_id: string }) => {
      countByBatch[r.batch_id] = (countByBatch[r.batch_id] ?? 0) + 1;
    });
    setBatches(list.map((b) => ({ ...b, member_count: countByBatch[b.id] ?? 0 })));
    setLoading(false);
  }, [projectId, user?.id]);

  useEffect(() => {
    if (!projectId) {
      router.replace("/(tabs)/history");
      return;
    }
    loadProjectAndBatches();
  }, [projectId, loadProjectAndBatches, router]);

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
    const { data: profs } = await supabase.from("profiles").select("id, username, display_name").in("id", [...ids]);
    setFriends(
      (profs ?? []).map((p: { id: string; username: string; display_name?: string | null }) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name ?? null,
      }))
    );
  }, [user?.id]);

  const openAddBatch = () => {
    setBatchName("");
    setSelectedMemberIds([]);
    setAddBatchModalVisible(true);
    loadFriends();
  };

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleAddBatch = async () => {
    const name = batchName.trim();
    if (!name || !projectId || !user?.id) {
      Alert.alert("Required", "Enter a batch name (e.g. March, TCGKL).");
      return;
    }
    setSaving(true);
    const { data: batch, error: batchError } = await supabase
      .from("business_batches")
      .insert({ host_id: user.id, project_id: projectId, name })
      .select("id")
      .single();
    setSaving(false);
    if (batchError || !batch?.id) {
      Alert.alert("Error", batchError?.message ?? "Could not create batch.");
      return;
    }
    if (selectedMemberIds.length > 0) {
      await supabase.from("business_batch_members").insert(
        selectedMemberIds.map((user_id) => ({ batch_id: batch.id, user_id }))
      );
    }
    setAddBatchModalVisible(false);
    await loadProjectAndBatches();
    router.push({ pathname: "/business-inventory", params: { batchId: batch.id, projectId } });
  };

  const openProjectSettings = () => {
    setProjectEditName(projectName);
    setProjectSettingsVisible(true);
  };

  const handleRenameProject = async () => {
    const name = projectEditName.trim();
    if (!name || !projectId || !user?.id) return;
    setSaving(true);
    const { error } = await supabase
      .from("business_projects")
      .update({ name, updated_at: new Date().toISOString() })
      .eq("id", projectId)
      .eq("host_id", user.id);
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setProjectName(name);
    setProjectSettingsVisible(false);
  };

  const handleDeleteProject = () => {
    if (!projectId || !user?.id) return;
    Alert.alert("Delete project", `Delete "${projectName}" and all its batches and items? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingProject(true);
          const batchIds = batches.map((b) => b.id);
          if (batchIds.length > 0) {
            await supabase.from("business_items").delete().in("batch_id", batchIds);
            await supabase.from("business_batch_members").delete().in("batch_id", batchIds);
          }
          await supabase.from("business_batches").delete().eq("project_id", projectId);
          const { error } = await supabase.from("business_projects").delete().eq("id", projectId).eq("host_id", user.id);
          setDeletingProject(false);
          setProjectSettingsVisible(false);
          if (error) {
            Alert.alert("Error", error.message);
            return;
          }
          router.replace("/(tabs)/history");
        },
      },
    ]);
  };

  if (!projectId) return null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/(tabs)/history")} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{projectName}</Text>
          <Text style={styles.subtitle}>Batches — tap to open Inventory · Profits · Logs</Text>
        </View>
        <Pressable onPress={openProjectSettings} style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]} hitSlop={8}>
          <Ionicons name="settings-outline" size={24} color="#a3a3a3" />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {batches.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={48} color="#525252" />
              <Text style={styles.emptyTitle}>No batches yet</Text>
              <Text style={styles.emptySub}>Tap "Add batch" to create one (e.g. March, TCGKL).</Text>
            </View>
          ) : (
            batches.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [styles.batchCard, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: "/business-inventory", params: { batchId: b.id, projectId } })}
              >
                <Text style={styles.batchName}>{b.name}</Text>
                <Text style={styles.batchMeta}>{b.member_count} member{b.member_count !== 1 ? "s" : ""}</Text>
                <Ionicons name="chevron-forward" size={20} color="#737373" />
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      <Pressable style={({ pressed }) => [styles.fab, pressed && styles.pressed]} onPress={openAddBatch}>
        <Ionicons name="add" size={24} color="#0a0a0a" />
        <Text style={styles.fabText}>Add batch</Text>
      </Pressable>

      <Modal visible={addBatchModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setAddBatchModalVisible(false)}>
          <Pressable style={[styles.modalCard, styles.modalCardWide]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>New batch</Text>
              <Text style={styles.modalSub}>Batch name and add members (e.g. March, TCGKL)</Text>
              <Text style={styles.inputLabel}>Batch name</Text>
              <TextInput
                style={styles.input}
                value={batchName}
                onChangeText={setBatchName}
                placeholder="e.g. March, TCGKL"
                placeholderTextColor="#525252"
                autoCapitalize="words"
              />
              <Text style={styles.inputLabel}>Add members</Text>
              <View style={styles.memberList}>
                {friends.length === 0 ? (
                  <Text style={styles.memberEmpty}>No friends yet.</Text>
                ) : (
                  friends.map((f) => {
                    const selected = selectedMemberIds.includes(f.id);
                    return (
                      <Pressable
                        key={f.id}
                        style={[styles.memberRow, selected && styles.memberRowSelected]}
                        onPress={() => toggleMember(f.id)}
                      >
                        <Text style={styles.memberName}>{(f.display_name && f.display_name.trim()) || f.username}</Text>
                        {selected ? <Ionicons name="checkmark-circle" size={22} color="#8DEB63" /> : <View style={styles.memberCheckEmpty} />}
                      </Pressable>
                    );
                  })
                )}
              </View>
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setAddBatchModalVisible(false)}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleAddBatch} disabled={saving || !batchName.trim()}>
                  <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Create & open"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Project settings modal */}
      <Modal visible={projectSettingsVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setProjectSettingsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Project settings</Text>
            <Text style={styles.modalSub}>Rename or delete this project.</Text>
            <Text style={styles.inputLabel}>Project name</Text>
            <TextInput
              style={styles.input}
              value={projectEditName}
              onChangeText={setProjectEditName}
              placeholder="e.g. Pokemon Flips"
              placeholderTextColor="#525252"
              autoCapitalize="words"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setProjectSettingsVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleRenameProject} disabled={saving || !projectEditName.trim()}>
                <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Save"}</Text>
              </Pressable>
            </View>
            <Pressable style={styles.deleteProjectBtn} onPress={handleDeleteProject} disabled={deletingProject}>
              <Ionicons name="trash-outline" size={20} color="#f97373" />
              <Text style={styles.deleteProjectBtnText}>{deletingProject ? "Deleting…" : "Delete project"}</Text>
            </Pressable>
            <Pressable style={[styles.modalBtn, styles.modalBtnCancel, { marginTop: 16 }]} onPress={() => setProjectSettingsVisible(false)}>
              <Text style={styles.modalBtnCancelText}>Cancel</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  pressed: { opacity: 0.85 },
  headerText: { flex: 1, minWidth: 0 },
  headerIconBtn: { padding: 4 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#737373", fontSize: 14, marginTop: 2 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#737373", fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 100 },
  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyTitle: { color: "#a3a3a3", fontSize: 16, fontWeight: "600" },
  emptySub: { color: "#737373", fontSize: 14 },
  batchCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  batchName: { flex: 1, color: "#fff", fontSize: 16, fontWeight: "700" },
  batchMeta: { color: "#737373", fontSize: 13, marginRight: 8 },
  fab: {
    position: "absolute",
    bottom: 24,
    right: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
  },
  fabText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 360, borderRadius: 24, backgroundColor: "#1a1a1a", padding: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalCardWide: { maxWidth: 400 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  modalSub: { color: "#a3a3a3", fontSize: 14, marginTop: 4, marginBottom: 20 },
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
    marginBottom: 20,
  },
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
  memberName: { color: "#e5e5e5", fontSize: 15 },
  memberCheckEmpty: { width: 22, height: 22 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  modalBtnCancel: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  modalBtnCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalBtnSave: { backgroundColor: "#8DEB63" },
  modalBtnSaveText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  deleteProjectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20, paddingVertical: 14, borderWidth: 1, borderColor: "rgba(249,115,115,0.5)", borderRadius: 12 },
  deleteProjectBtnText: { color: "#f97373", fontSize: 15, fontWeight: "700" },
});
