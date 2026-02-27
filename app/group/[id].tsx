import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";

type MemberRow = { user_id: string; username: string; avatar_url?: string | null };
type FriendOption = { id: string; username: string };

function groupInitial(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [friendsList, setFriendsList] = useState<FriendOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");

  const isHost = user?.id && hostId === user.id;

  const loadGroup = useCallback(async () => {
    if (!id || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: g, error: err } = await supabase
        .from("groups")
        .select("id, name, avatar_url, host_id, group_members(user_id, status, profiles(username, avatar_url))")
        .eq("id", id)
        .single();
      if (err) throw new Error(err.message);
      if (!g) {
        setError("Group not found");
        setLoading(false);
        return;
      }
      setGroupName((g as { name?: string }).name ?? "");
      setAvatarUrl((g as { avatar_url?: string | null }).avatar_url ?? null);
      setHostId((g as { host_id?: string }).host_id ?? null);
      const gms = (g as { group_members?: Array<{ user_id: string; status?: string; profiles?: { username?: string; avatar_url?: string | null } | null }> }).group_members ?? [];
      const acceptedOnly = gms.filter((gm) => gm.status === "accepted");
      setMembers(
        acceptedOnly.map((gm) => ({
          user_id: gm.user_id,
          username: (gm.profiles as { username?: string })?.username ?? "?",
          avatar_url: (gm.profiles as { avatar_url?: string | null })?.avatar_url ?? null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load group");
    } finally {
      setLoading(false);
    }
  }, [id, user?.id]);

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  const loadFriends = useCallback(async () => {
    if (!user?.id) return;
    try {
      const myId = user.id;
      const { data: asUser, error: e1 } = await supabase.from("friendships").select("id, friend_id, status").eq("user_id", myId);
      if (e1) throw new Error(e1.message);
      const { data: asFriend, error: e2 } = await supabase.from("friendships").select("id, user_id, status").eq("friend_id", myId);
      if (e2) throw new Error(e2.message);
      const list: FriendOption[] = [];
      for (const row of asUser || []) {
        if (row.status === "accepted") {
          const { data: prof } = await supabase.from("profiles").select("username").eq("id", row.friend_id).single();
          list.push({ id: row.friend_id, username: (prof as { username?: string })?.username ?? "?" });
        }
      }
      for (const row of asFriend || []) {
        if (row.status === "accepted" && !list.some((f) => f.id === row.user_id)) {
          const { data: prof } = await supabase.from("profiles").select("username").eq("id", row.user_id).single();
          list.push({ id: row.user_id, username: (prof as { username?: string })?.username ?? "?" });
        }
      }
      setFriendsList(list);
    } catch {
      setFriendsList([]);
    }
  }, [user?.id]);

  useEffect(() => {
    if (addModalVisible) {
      setSelectedIds([]);
      setFriendSearchQuery("");
      void loadFriends();
    }
  }, [addModalVisible, loadFriends]);

  const filteredFriends = useMemo(() => {
    const q = friendSearchQuery.trim().toLowerCase();
    if (!q) return friendsList;
    return friendsList.filter((f) => f.username.toLowerCase().includes(q));
  }, [friendsList, friendSearchQuery]);

  const friendsNotInGroup = useMemo(
    () => filteredFriends.filter((f) => !members.some((m) => m.user_id === f.id)),
    [filteredFriends, members]
  );

  const saveName = async () => {
    if (!id || !isHost || !groupName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const { error: err } = await supabase.from("groups").update({ name: groupName.trim() }).eq("id", id).eq("host_id", user!.id);
      if (err) throw new Error(err.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update name");
    } finally {
      setSaving(false);
    }
  };

  const pickAndUploadPhoto = async () => {
    if (!id || !isHost || !user?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Permission to access photos is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    setUploadingPhoto(true);
    setError(null);
    try {
      const path = `${id}/avatar-${Date.now()}.jpg`;
      const file = new File(uri);
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadErr } = await supabase.storage
        .from("group-avatars")
        .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);
      const { data: urlData } = supabase.storage.from("group-avatars").getPublicUrl(path);
      const publicUrl = urlData.publicUrl;
      const { error: updateErr } = await supabase.from("groups").update({ avatar_url: publicUrl }).eq("id", id).eq("host_id", user.id);
      if (updateErr) throw new Error(updateErr.message);
      setAvatarUrl(publicUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to upload photo");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const removeMember = (userId: string) => {
    if (!id || !isHost || userId === user?.id) return;
    Alert.alert("Remove member", "Remove this member from the group?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            const { error: err } = await supabase.from("group_members").delete().eq("group_id", id).eq("user_id", userId);
            if (err) throw new Error(err.message);
            setMembers((prev) => prev.filter((m) => m.user_id !== userId));
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to remove member");
          }
        },
      },
    ]);
  };

  const leaveGroup = () => {
    if (!id || !user?.id || isHost) return;
    Alert.alert("Leave group", `Leave "${groupName}"? You can rejoin if someone adds you again.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: async () => {
          try {
            const { error: err } = await supabase.from("group_members").delete().eq("group_id", id).eq("user_id", user.id);
            if (err) throw new Error(err.message);
            router.back();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to leave group");
          }
        },
      },
    ]);
  };

  const addMembers = async () => {
    if (!id || !isHost || selectedIds.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      for (const uid of selectedIds) {
        await supabase.from("group_members").insert({ group_id: id, user_id: uid, status: "pending" });
      }
      setAddModalVisible(false);
      setSelectedIds([]);
      await loadGroup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add members");
    } finally {
      setSaving(false);
    }
  };

  const toggleSelected = (fid: string) => {
    setSelectedIds((prev) => (prev.includes(fid) ? prev.filter((x) => x !== fid) : [...prev, fid]));
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar style="light" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading group...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !groupName && members.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar style="light" />
        <View style={styles.headerRow}>
          <Pressable style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={22} color="#e5e5e5" />
          </Pressable>
          <Text style={styles.title}>Group</Text>
        </View>
        <View style={styles.errorBlock}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.headerRow}>
        <Pressable style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={22} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Group details</Text>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.avatarSection}>
          <Pressable
            style={styles.avatarWrap}
            onPress={isHost ? pickAndUploadPhoto : undefined}
            disabled={!isHost || uploadingPhoto}
          >
            {uploadingPhoto ? (
              <View style={styles.avatarPlaceholder}>
                <ActivityIndicator size="large" color="#8DEB63" />
              </View>
            ) : avatarUrl ? (
              <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{groupInitial(groupName)}</Text>
              </View>
            )}
            {isHost && !uploadingPhoto ? (
              <View style={styles.avatarBadge}>
                <Ionicons name="camera" size={16} color="#0a0a0a" />
              </View>
            ) : null}
          </Pressable>
          {isHost ? (
            <Text style={styles.avatarHint}>Tap to change photo</Text>
          ) : null}
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Group name</Text>
          {isHost ? (
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              onBlur={() => void saveName()}
              style={styles.input}
              placeholder="Group name"
              placeholderTextColor="#525252"
              editable={!saving}
            />
          ) : (
            <Text style={styles.nameReadOnly}>{groupName}</Text>
          )}
        </View>

        {error ? (
          <View style={styles.errorWrap}>
            <Ionicons name="warning-outline" size={16} color="#fca5a5" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Members ({members.length})</Text>
            {isHost ? (
              <Pressable style={({ pressed }) => [styles.addMemberBtn, pressed && styles.pressed]} onPress={() => setAddModalVisible(true)}>
                <Ionicons name="person-add" size={18} color="#8DEB63" />
                <Text style={styles.addMemberBtnText}>Add</Text>
              </Pressable>
            ) : null}
          </View>
          <View style={styles.memberList}>
            {members.map((m, idx) => (
              <View key={m.user_id} style={[styles.memberRow, idx === members.length - 1 && styles.memberRowLast]}>
                {m.avatar_url ? (
                  <Image source={{ uri: m.avatar_url }} style={styles.memberAvatarImg} />
                ) : (
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{groupInitial(m.username)}</Text>
                  </View>
                )}
                <Text style={styles.memberName}>@{m.username}</Text>
                {m.user_id === user?.id ? (
                  <Text style={styles.youChip}>You</Text>
                ) : isHost ? (
                  <Pressable style={({ pressed }) => [styles.removeMemberBtn, pressed && styles.pressed]} onPress={() => removeMember(m.user_id)}>
                    <Ionicons name="close-circle" size={22} color="#fca5a5" />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </View>
        </View>

        {!isHost && user?.id && members.some((m) => m.user_id === user.id) ? (
          <View style={styles.leaveSection}>
            <Pressable style={({ pressed }) => [styles.leaveGroupBtn, pressed && styles.pressed]} onPress={leaveGroup}>
              <Ionicons name="exit-outline" size={20} color="#fca5a5" />
              <Text style={styles.leaveGroupBtnText}>Leave group</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>

      <Modal transparent visible={addModalVisible} animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Add members</Text>
            <Text style={styles.modalSub}>Select friends to add (friends only)</Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={16} color="#737373" />
              <TextInput
                value={friendSearchQuery}
                onChangeText={setFriendSearchQuery}
                style={styles.searchInput}
                placeholder="Search friends..."
                placeholderTextColor="#525252"
              />
            </View>
            <ScrollView style={styles.friendScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
              {friendsNotInGroup.length === 0 ? (
                <Text style={styles.emptyModal}>No friends to add or none match your search.</Text>
              ) : (
                friendsNotInGroup.map((f) => {
                  const selected = selectedIds.includes(f.id);
                  return (
                    <Pressable
                      key={f.id}
                      style={[styles.friendRow, selected && styles.friendRowSelected]}
                      onPress={() => toggleSelected(f.id)}
                    >
                      <View style={styles.friendAvatar}>
                        <Text style={styles.friendAvatarText}>{groupInitial(f.username)}</Text>
                      </View>
                      <Text style={styles.friendName}>@{f.username}</Text>
                      <View style={[styles.checkBox, selected && styles.checkBoxSelected]}>
                        {selected ? <Ionicons name="checkmark" size={16} color="#0a0a0a" /> : null}
                      </View>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.modalActions}>
              <Pressable style={({ pressed }) => [styles.cancelBtn, pressed && styles.pressed]} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.addBtn, selectedIds.length === 0 && styles.addBtnDisabled, pressed && styles.pressed]}
                onPress={() => void addMembers()}
                disabled={selectedIds.length === 0 || saving}
              >
                <Text style={[styles.addBtnText, selectedIds.length === 0 && styles.addBtnTextDisabled]}>
                  {saving ? "Adding..." : `Add (${selectedIds.length})`}
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  pressed: { opacity: 0.9 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#a3a3a3", fontSize: 15 },
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 32 },
  avatarSection: { alignItems: "center", marginTop: 8, marginBottom: 24 },
  avatarWrap: { position: "relative" },
  avatarPlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: 100, height: 100, borderRadius: 50 },
  avatarInitial: { color: "#8DEB63", fontSize: 36, fontWeight: "800" },
  avatarBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#8DEB63",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHint: { color: "#737373", fontSize: 12, marginTop: 8 },
  field: { marginBottom: 20 },
  fieldLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  input: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
    color: "#e5e5e5",
    fontSize: 16,
    paddingHorizontal: 16,
  },
  nameReadOnly: { color: "#e5e5e5", fontSize: 18, fontWeight: "600" },
  errorBlock: { padding: 20 },
  errorWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(252,165,165,0.12)", padding: 12, borderRadius: 12, marginBottom: 16 },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  section: { marginTop: 8 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "700" },
  addMemberBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(141,235,99,0.2)" },
  addMemberBtnText: { color: "#8DEB63", fontSize: 14, fontWeight: "600" },
  memberList: { backgroundColor: "#141414", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", overflow: "hidden" },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 14, paddingHorizontal: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  memberRowLast: { borderBottomWidth: 0 },
  memberAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  memberAvatarImg: { width: 40, height: 40, borderRadius: 20 },
  memberAvatarText: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  memberName: { flex: 1, color: "#e5e5e5", fontSize: 15 },
  youChip: { color: "#737373", fontSize: 12, fontWeight: "600" },
  removeMemberBtn: { padding: 4 },
  leaveSection: { marginTop: 24, marginBottom: 16 },
  leaveGroupBtn: {
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
  leaveGroupBtnText: { color: "#fca5a5", fontSize: 16, fontWeight: "600" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 360, maxHeight: "80%", borderRadius: 24, backgroundColor: "#1a1a1a", padding: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "800", marginBottom: 4 },
  modalSub: { color: "#a3a3a3", fontSize: 14, marginBottom: 16 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44, borderRadius: 12, backgroundColor: "#0f0f0f", paddingHorizontal: 12, marginBottom: 12 },
  searchInput: { flex: 1, color: "#e5e5e5", fontSize: 15 },
  friendScroll: { maxHeight: 240, marginBottom: 16 },
  emptyModal: { color: "#737373", fontSize: 14, padding: 16, textAlign: "center" },
  friendRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  friendRowSelected: { backgroundColor: "rgba(141,235,99,0.12)" },
  friendAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  friendAvatarText: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  friendName: { flex: 1, color: "#e5e5e5", fontSize: 15 },
  checkBox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: "rgba(255,255,255,0.3)", alignItems: "center", justifyContent: "center" },
  checkBoxSelected: { backgroundColor: "#8DEB63", borderColor: "#8DEB63" },
  modalActions: { flexDirection: "row", gap: 12 },
  cancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center" },
  cancelBtnText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  addBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: "#8DEB63", alignItems: "center" },
  addBtnDisabled: { backgroundColor: "#2a2a2a", opacity: 0.9 },
  addBtnText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  addBtnTextDisabled: { color: "#737373" },
});
