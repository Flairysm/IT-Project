import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
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
import { formatAmount } from "./lib/currency";

function formatBatchDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isThisYear = d.getFullYear() === now.getFullYear();
    return isThisYear
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

type BatchRow = { id: string; name: string; created_at: string; host_id: string; member_ids: string[]; profit: number };

export default function BusinessProjectDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ projectId?: string }>();
  const projectId = params.projectId;
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const [projectName, setProjectName] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [avatarMap, setAvatarMap] = useState<Record<string, string | null>>({});
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [addBatchModalVisible, setAddBatchModalVisible] = useState(false);
  const [batchName, setBatchName] = useState("");
  const [friends, setFriends] = useState<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }[]>([]);
  const [selectedProjectMemberIds, setSelectedProjectMemberIds] = useState<string[]>([]);
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [projectSettingsVisible, setProjectSettingsVisible] = useState(false);
  const [projectEditName, setProjectEditName] = useState("");
  const [deletingProject, setDeletingProject] = useState(false);
  const [addMembersVisible, setAddMembersVisible] = useState(false);
  const [leavingProject, setLeavingProject] = useState(false);

  const loadProjectAndBatches = useCallback(async () => {
    if (!projectId || !user?.id) return;
    const { data: proj, error: projErr } = await supabase
      .from("business_projects")
      .select("id, name, host_id")
      .eq("id", projectId)
      .single();
    if (projErr || !proj) {
      setProjectName("Project");
      setBatches([]);
      setLoading(false);
      return;
    }
    const projRow = proj as { id: string; name: string; host_id: string };
    setProjectName(projRow.name);
    setIsHost(projRow.host_id === user.id);
    const { data: memberRows } = await supabase
      .from("business_project_members")
      .select("user_id")
      .eq("project_id", projectId);
    const projectMemberIds = [projRow.host_id, ...(memberRows ?? []).map((r: { user_id: string }) => r.user_id).filter(Boolean)];
    const { data: batchList, error: batchErr } = await supabase
      .from("business_batches")
      .select("id, name, created_at, host_id")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (batchErr) {
      setBatches([]);
      setAvatarMap({});
      setProfileNames({});
      setLoading(false);
      return;
    }
    const list = (batchList ?? []) as { id: string; name: string; created_at: string; host_id: string }[];
    const batchIds = list.map((b) => b.id);
    const uniqueMemberIds = [...new Set(projectMemberIds)];
    let avatars: Record<string, string | null> = {};
    const names: Record<string, string> = {};
    if (uniqueMemberIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("id, avatar_url, username, display_name").in("id", uniqueMemberIds);
      profiles?.forEach((p: { id: string; avatar_url: string | null; username?: string; display_name?: string | null }) => {
        avatars[p.id] = p.avatar_url ?? null;
        const name = (p.display_name && p.display_name.trim()) || p.username || "?";
        names[p.id] = name;
      });
    }
    setAvatarMap(avatars);
    setProfileNames(names);
    if (batchIds.length === 0) {
      setBatches(list.map((b) => ({ ...b, member_ids: uniqueMemberIds, profit: 0 })));
      setLoading(false);
      return;
    }
    const { data: items } = await supabase
      .from("business_items")
      .select("batch_id, purchase_price, sold_price, sold_at")
      .in("batch_id", batchIds);
    const profitByBatch: Record<string, number> = {};
    batchIds.forEach((id) => (profitByBatch[id] = 0));
    (items ?? []).forEach((row: { batch_id: string; purchase_price: number; sold_price: number | null; sold_at: string | null }) => {
      if (row.sold_at && row.sold_price != null) {
        profitByBatch[row.batch_id] = (profitByBatch[row.batch_id] ?? 0) + (Number(row.sold_price) - Number(row.purchase_price));
      }
    });
    const { data: ledgerRows } = await supabase
      .from("business_ledger")
      .select("batch_id, type, amount")
      .in("batch_id", batchIds);
    (ledgerRows ?? []).forEach((row: { batch_id: string; type: string; amount: number }) => {
      const amt = Number(row.amount) || 0;
      if (row.type === "income") profitByBatch[row.batch_id] = (profitByBatch[row.batch_id] ?? 0) + amt;
      else if (row.type === "expense") profitByBatch[row.batch_id] = (profitByBatch[row.batch_id] ?? 0) - amt;
    });
    setBatches(
      list.map((b) => ({
        ...b,
        member_ids: uniqueMemberIds,
        profit: profitByBatch[b.id] ?? 0,
      }))
    );
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

  const openAddBatch = () => {
    setBatchName("");
    setAddBatchModalVisible(true);
  };

  const handleAddBatch = async () => {
    const name = batchName.trim();
    if (!name || !projectId || !user?.id) {
      Alert.alert("Required", "Enter a batch name.");
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
    setAddBatchModalVisible(false);
    await loadProjectAndBatches();
    router.push({ pathname: "/business-inventory", params: { batchId: batch.id, projectId } });
  };

  const toggleProjectMember = (id: string) => {
    setSelectedProjectMemberIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const openAddMembers = () => {
    setSelectedProjectMemberIds([]);
    setAddMemberSearchQuery("");
    setAddMembersVisible(true);
    loadFriends();
  };

  const handleAddProjectMembers = async () => {
    if (!projectId || !user?.id || selectedProjectMemberIds.length === 0) return;
    setSaving(true);
    const { error } = await supabase.from("business_project_members").insert(
      selectedProjectMemberIds.map((user_id) => ({ project_id: projectId, user_id }))
    );
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setAddMembersVisible(false);
    await loadProjectAndBatches();
  };

  const handleLeaveProject = async () => {
    if (!projectId || !user?.id) return;
    Alert.alert("Leave project", "You will no longer see this project or its batches.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          setLeavingProject(true);
          const { error } = await supabase
            .from("business_project_members")
            .delete()
            .eq("project_id", projectId)
            .eq("user_id", user.id);
          setLeavingProject(false);
          setProjectSettingsVisible(false);
          if (error) {
            Alert.alert("Error", error.message);
            return;
          }
          router.back();
        },
      },
    ]);
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
          router.back();
        },
      },
    ]);
  };

  if (!projectId) return null;

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
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
              <Text style={styles.emptySub}>Tap "Add batch" to create one.</Text>
            </View>
          ) : (
            batches.map((b) => (
              <Pressable
                key={b.id}
                style={({ pressed }) => [styles.batchCard, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: "/business-inventory", params: { batchId: b.id, projectId } })}
              >
                <View style={styles.batchCardLeft}>
                  <Text style={styles.batchName} numberOfLines={1}>{b.name}</Text>
                  <Text style={styles.batchDate}>{formatBatchDate(b.created_at)}</Text>
                </View>
                <View style={styles.batchCardRight}>
                  <View style={styles.batchProfitBlock}>
                    <Text style={styles.batchProfitLabel}>Total profit</Text>
                    <Text style={styles.batchProfit}>{formatAmount(b.profit, currencyCode)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#737373" />
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      )}

      {isHost && (
        <Pressable style={({ pressed }) => [styles.fab, pressed && styles.pressed]} onPress={openAddBatch}>
          <Ionicons name="add" size={24} color="#0a0a0a" />
          <Text style={styles.fabText}>Add batch</Text>
        </Pressable>
      )}

      <Modal visible={addBatchModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setAddBatchModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>New batch</Text>
            <Text style={styles.modalSub}>Name this batch.</Text>
            <Text style={styles.inputLabel}>Batch name</Text>
            <TextInput
              style={styles.input}
              value={batchName}
              onChangeText={setBatchName}
              placeholder="e.g. Batch name"
              placeholderTextColor="#525252"
              autoCapitalize="words"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setAddBatchModalVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleAddBatch} disabled={saving || !batchName.trim()}>
                <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Create & open"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add project members modal (host only) */}
      <Modal visible={addMembersVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setAddMembersVisible(false)}>
          <Pressable style={[styles.modalCard, styles.modalCardWide]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Add members</Text>
              <Text style={styles.modalSub}>Search and select friends to add to this project.</Text>
              <View style={styles.addMemberSearchWrap}>
                <Ionicons name="search" size={18} color="#737373" style={styles.addMemberSearchIcon} />
                <TextInput
                  style={styles.addMemberSearchInput}
                  value={addMemberSearchQuery}
                  onChangeText={setAddMemberSearchQuery}
                  placeholder="Search by name or username…"
                  placeholderTextColor="#525252"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {addMemberSearchQuery.length > 0 ? (
                  <Pressable onPress={() => setAddMemberSearchQuery("")} style={styles.addMemberSearchClear} hitSlop={8}>
                    <Ionicons name="close-circle" size={20} color="#737373" />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.memberList}>
                {(() => {
                  const currentIds = batches[0]?.member_ids ?? [];
                  const addable = friends.filter((f) => !currentIds.includes(f.id));
                  const searchLower = addMemberSearchQuery.trim().toLowerCase();
                  const filtered = searchLower
                    ? addable.filter(
                        (f) =>
                          (f.display_name && f.display_name.toLowerCase().includes(searchLower)) ||
                          (f.username && f.username.toLowerCase().includes(searchLower))
                      )
                    : addable;
                  if (addable.length === 0) {
                    return <Text style={styles.memberEmpty}>No friends to add, or all are already in the project.</Text>;
                  }
                  if (filtered.length === 0) {
                    return <Text style={styles.memberEmpty}>No matches for "{addMemberSearchQuery.trim()}".</Text>;
                  }
                  return filtered.map((f) => {
                    const selected = selectedProjectMemberIds.includes(f.id);
                    const displayName = (f.display_name && f.display_name.trim()) || f.username || "—";
                    return (
                      <Pressable
                        key={f.id}
                        style={[styles.memberRow, selected && styles.memberRowSelected]}
                        onPress={() => toggleProjectMember(f.id)}
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
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setAddMembersVisible(false)}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleAddProjectMembers} disabled={saving || selectedProjectMemberIds.length === 0}>
                  <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Add to project"}</Text>
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
            {isHost ? (
              <>
                <Text style={styles.modalSub}>Rename, add members, or delete this project.</Text>
                <Text style={styles.inputLabel}>Project name</Text>
                <TextInput
                  style={styles.input}
                  value={projectEditName}
                  onChangeText={setProjectEditName}
                  placeholder="e.g. Project name"
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
                <Pressable style={styles.addMembersBtn} onPress={() => { setProjectSettingsVisible(false); openAddMembers(); }}>
                  <Ionicons name="person-add-outline" size={20} color="#8DEB63" />
                  <Text style={styles.addMembersBtnText}>Add members to project</Text>
                </Pressable>
                <Pressable style={styles.deleteProjectBtn} onPress={handleDeleteProject} disabled={deletingProject}>
                  <Ionicons name="trash-outline" size={20} color="#f97373" />
                  <Text style={styles.deleteProjectBtnText}>{deletingProject ? "Deleting…" : "Delete project"}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.modalSub}>You can leave this project. You will no longer see it in Manage.</Text>
                <Pressable style={styles.leaveProjectBtn} onPress={handleLeaveProject} disabled={leavingProject}>
                  <Ionicons name="exit-outline" size={20} color="#f97373" />
                  <Text style={styles.leaveProjectBtnText}>{leavingProject ? "Leaving…" : "Leave project"}</Text>
                </Pressable>
              </>
            )}
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
    justifyContent: "space-between",
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  batchCardLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  batchName: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  batchDate: { color: "#737373", fontSize: 12, marginBottom: 8 },
  batchAvatars: { flexDirection: "row", alignItems: "center" },
  batchAvatar: { width: 28, height: 28, borderRadius: 14, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.1)" },
  batchAvatarOverlap: { marginLeft: -8 },
  batchAvatarImg: { width: 28, height: 28 },
  batchAvatarPlaceholder: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(141,235,99,0.2)" },
  batchAvatarLetter: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  batchCardRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  batchProfitBlock: { alignItems: "flex-end" },
  batchProfitLabel: { color: "#737373", fontSize: 11, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  batchProfit: { color: "#8DEB63", fontSize: 15, fontWeight: "700", marginTop: 2 },
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
  addMemberSearchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderRadius: 12, marginBottom: 16, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  addMemberSearchIcon: { marginRight: 8 },
  addMemberSearchInput: { flex: 1, color: "#fff", fontSize: 16, paddingVertical: 12, minHeight: 44 },
  addMemberSearchClear: { padding: 4 },
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
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  modalBtnCancel: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  modalBtnCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalBtnSave: { backgroundColor: "#8DEB63" },
  modalBtnSaveText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  addMembersBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, paddingVertical: 14, borderWidth: 1, borderColor: "rgba(141,235,99,0.4)", borderRadius: 12 },
  addMembersBtnText: { color: "#8DEB63", fontSize: 15, fontWeight: "700" },
  deleteProjectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingVertical: 14, borderWidth: 1, borderColor: "rgba(249,115,115,0.5)", borderRadius: 12 },
  deleteProjectBtnText: { color: "#f97373", fontSize: 15, fontWeight: "700" },
  leaveProjectBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderWidth: 1, borderColor: "rgba(249,115,115,0.5)", borderRadius: 12 },
  leaveProjectBtnText: { color: "#f97373", fontSize: 15, fontWeight: "700" },
});
