import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { SubscriptionDiamond } from "../components/SubscriptionDiamond";
import { Image } from "expo-image";

type MemberInfo = { username: string; avatar_url?: string | null };
type GroupRow = {
  id: string;
  name: string;
  members: MemberInfo[];
  /** Total people in group (accepted + pending). Use for "X members" label. */
  memberCount: number;
  avatar_url?: string | null;
  isHost?: boolean;
};
type GroupInvitation = {
  id: string;
  group_id: string;
  group_name: string;
  group_avatar_url: string | null;
  host_username: string;
};

type FriendOption = { id: string; username: string };

function groupInitial(name: string): string {
  const s = name.trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

export default function GroupsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [friendsList, setFriendsList] = useState<FriendOption[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "requests">("all");
  const [refreshing, setRefreshing] = useState(false);

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

  const loadGroups = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      // All groups I'm in: host or accepted member (RLS get_my_group_ids uses status='accepted')
      const { data: rows, error: err } = await supabase
        .from("groups")
        .select("id, name, avatar_url, host_id, group_members(user_id, status, profiles(username, avatar_url))");
      if (err) throw new Error(err.message);
      type Gm = { user_id?: string; status?: string; profiles?: { username?: string; avatar_url?: string | null } | null };
      type GroupWithMembers = { id: string; name: string; avatar_url?: string | null; host_id?: string; group_members?: Gm[] };
      const list = ((rows || []) as GroupWithMembers[])
        .filter((g) => {
          const myMembership = (g.group_members || []).find((gm) => (gm as Gm).user_id === user.id);
          const amHost = g.host_id === user.id;
          const amAccepted = (myMembership as Gm | undefined)?.status === "accepted";
          return amHost || amAccepted;
        })
        .map((g) => {
          const allMembers = g.group_members || [];
          const acceptedOnly = allMembers.filter((gm) => (gm as Gm).status === "accepted");
          return {
            id: String(g.id),
            name: g.name,
            avatar_url: g.avatar_url ?? null,
            isHost: g.host_id === user.id,
            memberCount: allMembers.length,
            members: acceptedOnly
              .map((gm) => {
                const p = (gm as Gm).profiles;
                if (!p?.username) return null;
                return { username: p.username, avatar_url: p.avatar_url ?? null };
              })
              .filter(Boolean) as MemberInfo[],
          };
        });
      setGroups(list);

      // Pending invitations: my group_members rows with status = pending
      const { data: invRows, error: invErr } = await supabase
        .from("group_members")
        .select("id, group_id, groups(id, name, avatar_url, host_id)")
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (invErr) {
        setInvitations([]);
        return;
      }
      const invList = (invRows || []) as { id: string; group_id: string; groups: { id: string; name: string; avatar_url?: string | null; host_id: string } | null }[];
      const hostIds = [...new Set(invList.map((i) => i.groups?.host_id).filter(Boolean))] as string[];
      const hostProfiles: Record<string, string> = {};
      if (hostIds.length > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, username").in("id", hostIds);
        for (const p of profs || []) {
          hostProfiles[(p as { id: string }).id] = (p as { username: string }).username ?? "?";
        }
      }
      setInvitations(
        invList
          .filter((i) => i.groups)
          .map((i) => ({
            id: i.id,
            group_id: i.group_id,
            group_name: i.groups!.name,
            group_avatar_url: i.groups!.avatar_url ?? null,
            host_username: hostProfiles[i.groups!.host_id] ?? "?",
          }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  const onRefreshGroups = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadGroups();
    } finally {
      setRefreshing(false);
    }
  }, [loadGroups]);

  useEffect(() => {
    if (createModalVisible) {
      setError(null);
      setFriendSearchQuery("");
      setSelectedMemberIds([]);
      void loadFriends();
    }
  }, [createModalVisible, loadFriends]);

  const filteredFriendsForModal = useMemo(() => {
    const q = friendSearchQuery.trim().toLowerCase();
    if (!q) return friendsList;
    return friendsList.filter((f) => f.username.toLowerCase().includes(q));
  }, [friendsList, friendSearchQuery]);

  const toggleMember = (id: string) => {
    setSelectedMemberIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter(
      (g) =>
        g.name.toLowerCase().includes(q) ||
        g.members.some((m) => m.username.toLowerCase().includes(q))
    );
  }, [groups, searchQuery]);

  const createGroup = async () => {
    if (!user?.id) return;
    const name = groupName.trim();
    if (!name || selectedMemberIds.length === 0) {
      setError("Enter a group name and select at least one friend.");
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

      const memberRows = [
        { group_id: groupId, user_id: user.id, status: "accepted" as const },
        ...selectedMemberIds.map((friendId) => ({ group_id: groupId, user_id: friendId, status: "pending" as const })),
      ];
      const { error: membersErr } = await supabase.from("group_members").insert(memberRows);
      if (membersErr) throw new Error(membersErr.message);

      setGroupName("");
      setSelectedMemberIds([]);
      setCreateModalVisible(false);
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

  const confirmDelete = (g: GroupRow) => {
    Alert.alert("Delete group", `Remove "${g.name}"? This can't be undone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteGroup(g.id) },
    ]);
  };

  const acceptInvitation = async (inv: GroupInvitation) => {
    try {
      const { error } = await supabase
        .from("group_members")
        .update({ status: "accepted" })
        .eq("id", inv.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
      await loadGroups();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to accept");
    }
  };

  const rejectInvitation = async (inv: GroupInvitation) => {
    try {
      const { error } = await supabase
        .from("group_members")
        .delete()
        .eq("id", inv.id)
        .eq("user_id", user!.id);
      if (error) throw new Error(error.message);
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to reject");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshGroups} tintColor="#8DEB63" />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Groups</Text>
          <SubscriptionDiamond />
        </View>

        <View style={styles.actionsRow}>
          <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={() => setCreateModalVisible(true)}>
            <Ionicons name="add" size={22} color="#0a0a0a" />
            <Text style={styles.primaryBtnText}>Create group</Text>
          </Pressable>
        </View>

        {loading ? (
          <Text style={styles.meta}>Loading...</Text>
        ) : error ? (
          <View style={styles.errorWrap}>
            <View style={styles.errorRow}>
              <Ionicons name="warning-outline" size={18} color="#fca5a5" />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable onPress={() => setError(null)} style={styles.errorDismissIcon} hitSlop={8}>
                <Ionicons name="close" size={20} color="#a3a3a3" />
              </Pressable>
            </View>
            <View style={styles.errorActions}>
              <Pressable onPress={() => setError(null)} style={({ pressed }) => [styles.errorBtn, pressed && styles.btnPressed]}>
                <Text style={styles.errorBtnText}>Dismiss</Text>
              </Pressable>
              <Pressable onPress={() => { setError(null); void loadGroups(); }} style={({ pressed }) => [styles.errorBtn, styles.errorBtnRetry, pressed && styles.btnPressed]}>
                <Text style={styles.errorBtnText}>Retry</Text>
              </Pressable>
            </View>
          </View>
        ) : null}

        <View style={styles.tabRow}>
          <Pressable style={[styles.tab, activeTab === "all" && styles.tabActive]} onPress={() => setActiveTab("all")}>
            <Text style={[styles.tabText, activeTab === "all" && styles.tabTextActive]}>All ({groups.length})</Text>
          </Pressable>
          <Pressable style={[styles.tab, activeTab === "requests" && styles.tabActive]} onPress={() => setActiveTab("requests")}>
            <Text style={[styles.tabText, activeTab === "requests" && styles.tabTextActive]}>Group requests</Text>
            {invitations.length > 0 ? (
              <View style={[styles.tabBadge, styles.tabBadgeAlert]}>
                <Text style={styles.tabBadgeText}>{invitations.length}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        {activeTab === "requests" ? (
          <View style={styles.section}>
            {invitations.length === 0 ? (
              <View style={styles.emptyState}>
                <View style={styles.emptyAvatar}>
                  <Ionicons name="mail-open-outline" size={40} color="#525252" />
                </View>
                <Text style={styles.emptyTitle}>No group requests</Text>
                <Text style={styles.emptySub}>When someone adds you to a group, you can accept or reject here.</Text>
              </View>
            ) : (
              <View style={styles.invitationsCard}>
              {invitations.map((inv) => (
                <View key={inv.id} style={styles.invitationRow}>
                  <View style={styles.invitationLeft}>
                    {inv.group_avatar_url ? (
                      <Image source={{ uri: inv.group_avatar_url }} style={styles.invitationGroupAvatar} />
                    ) : (
                      <View style={styles.invitationGroupAvatarPlaceholder}>
                        <Text style={styles.invitationGroupAvatarText}>{groupInitial(inv.group_name)}</Text>
                      </View>
                    )}
                    <View style={styles.invitationInfo}>
                      <Text style={styles.invitationGroupName}>{inv.group_name}</Text>
                      <Text style={styles.invitationMeta}>Invited by @{inv.host_username}</Text>
                    </View>
                  </View>
                  <View style={styles.invitationActions}>
                    <Pressable style={({ pressed }) => [styles.invitationReject, pressed && styles.pressed]} onPress={() => void rejectInvitation(inv)}>
                      <Text style={styles.invitationRejectText}>Reject</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.invitationAccept, pressed && styles.pressed]} onPress={() => void acceptInvitation(inv)}>
                      <Text style={styles.invitationAcceptText}>Accept</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
              </View>
            )}
          </View>
        ) : (
          <View style={styles.section}>
            <View style={styles.searchRowWrap}>
              <View style={styles.searchRow}>
                <Ionicons name="search" size={20} color="#737373" style={styles.searchIcon} />
                <TextInput
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search groups or members..."
                  placeholderTextColor="#737373"
                  style={styles.searchInput}
                />
                {searchQuery.length > 0 ? (
                  <Pressable onPress={() => setSearchQuery("")} style={styles.searchClear} hitSlop={8}>
                    <Ionicons name="close-circle" size={22} color="#737373" />
                  </Pressable>
                ) : null}
              </View>
            </View>

          {!loading && groups.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyAvatar}>
                <Ionicons name="people-circle-outline" size={40} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>No groups yet</Text>
              <Text style={styles.emptySub}>Create a group and add members by username to split receipts faster.</Text>
              <Pressable style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]} onPress={() => setCreateModalVisible(true)}>
                <Text style={styles.emptyBtnText}>Create group</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.listCard}>
              {filteredGroups.map((g) => (
                <View key={g.id} style={styles.groupCard}>
                  <Pressable style={styles.groupCardPressable} onPress={() => router.push({ pathname: "/group/[id]", params: { id: g.id } })}>
                    <View style={styles.groupCardTop}>
                      {g.avatar_url ? (
                        <Image source={{ uri: g.avatar_url }} style={styles.groupAvatarImg} />
                      ) : (
                        <View style={styles.groupAvatar}>
                          <Text style={styles.groupAvatarText}>{groupInitial(g.name)}</Text>
                        </View>
                      )}
                      <View style={styles.groupCardCenter}>
                        <Text style={styles.groupCardName} numberOfLines={1}>{g.name}</Text>
                        <Text style={styles.groupCardMeta}>
                          {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                        </Text>
                        <View style={styles.memberAvatarsRow}>
                          {g.members.slice(0, 5).map((m, i) => (
                            <View key={`${g.id}-${m.username}-${i}`} style={[styles.memberAvatarChip, { marginLeft: i === 0 ? 0 : -8 }]}>
                              {m.avatar_url ? (
                                <Image source={{ uri: m.avatar_url }} style={styles.memberAvatarChipImg} />
                              ) : (
                                <View style={styles.memberAvatarChipPlaceholder}>
                                  <Text style={styles.memberAvatarChipText}>{groupInitial(m.username)}</Text>
                                </View>
                              )}
                            </View>
                          ))}
                          {g.members.length > 5 ? (
                            <View style={[styles.memberAvatarChip, styles.memberAvatarChipMore, { marginLeft: -8 }]}>
                              <Text style={styles.memberAvatarChipMoreText}>+{g.members.length - 5}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                      <Ionicons name="chevron-forward" size={20} color="#737373" />
                    </View>
                  </Pressable>
                  {g.isHost ? (
                    <Pressable style={({ pressed }) => [styles.groupCardDelete, pressed && styles.pressed]} onPress={() => confirmDelete(g)}>
                      <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                      <Text style={styles.groupCardDeleteText}>Remove</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
              {filteredGroups.length === 0 && searchQuery.trim() ? (
                <Text style={styles.noResults}>No matches for "{searchQuery.trim()}"</Text>
              ) : null}
            </View>
          )}
          </View>
        )}
      </ScrollView>

      <Modal transparent visible={createModalVisible} animationType="fade" onRequestClose={() => setCreateModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCreateModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalAccent} />
            <View style={styles.modalIconWrap}>
              <Ionicons name="people" size={32} color="#8DEB63" />
            </View>
            <Text style={styles.modalTitle}>Create group</Text>
            <Text style={styles.modalSub}>Add a name and select friends to include</Text>

            <View style={styles.modalField}>
              <View style={styles.modalFieldLabelRow}>
                <Ionicons name="pricetag-outline" size={14} color="#8DEB63" />
                <Text style={styles.modalFieldLabel}>Group name</Text>
              </View>
              <TextInput
                value={groupName}
                onChangeText={(t) => { setGroupName(t); setError(null); }}
                style={styles.modalInput}
                placeholder="e.g. Weekend trip, Roommates"
                placeholderTextColor="#525252"
                editable={!creating}
              />
            </View>

            <View style={styles.modalField}>
              <View style={styles.modalFieldLabelRow}>
                <Ionicons name="person-add-outline" size={14} color="#8DEB63" />
                <Text style={styles.modalFieldLabel}>Select friends ({selectedMemberIds.length} selected)</Text>
              </View>
              {friendsList.length > 0 ? (
                <View style={styles.modalFriendSearchWrap}>
                  <Ionicons name="search" size={16} color="#737373" style={styles.modalFriendSearchIcon} />
                  <TextInput
                    value={friendSearchQuery}
                    onChangeText={setFriendSearchQuery}
                    style={styles.modalFriendSearchInput}
                    placeholder="Search friends..."
                    placeholderTextColor="#525252"
                    editable={!creating}
                  />
                  {friendSearchQuery.length > 0 ? (
                    <Pressable onPress={() => setFriendSearchQuery("")} style={styles.modalFriendSearchClear} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color="#737373" />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.modalFriendList}>
                {friendsList.length === 0 ? (
                  <Text style={styles.modalFriendListEmpty}>Add friends first to create a group.</Text>
                ) : filteredFriendsForModal.length === 0 ? (
                  <Text style={styles.modalFriendListEmpty}>No friends match "{friendSearchQuery.trim()}"</Text>
                ) : (
                  <ScrollView style={styles.modalFriendScroll} nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    {filteredFriendsForModal.map((f) => {
                      const selected = selectedMemberIds.includes(f.id);
                      return (
                        <Pressable
                          key={f.id}
                          style={[styles.modalFriendRow, selected && styles.modalFriendRowSelected]}
                          onPress={() => !creating && toggleMember(f.id)}
                          disabled={creating}
                        >
                          <View style={styles.modalFriendAvatar}>
                            <Text style={styles.modalFriendAvatarText}>{groupInitial(f.username)}</Text>
                          </View>
                          <Text style={styles.modalFriendName} numberOfLines={1}>@{f.username}</Text>
                          <View style={[styles.modalFriendCheck, selected && styles.modalFriendCheckSelected]}>
                            {selected ? <Ionicons name="checkmark" size={16} color="#0a0a0a" /> : null}
                          </View>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            </View>

            {error ? (
              <View style={styles.modalErrorWrap}>
                <Ionicons name="warning-outline" size={14} color="#fca5a5" />
                <Text style={styles.modalError}>{error}</Text>
                <Pressable onPress={() => setError(null)} style={styles.modalErrorDismiss} hitSlop={8}>
                  <Ionicons name="close" size={18} color="#a3a3a3" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.modalActions}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={() => setCreateModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalAdd,
                  (creating || !groupName.trim() || selectedMemberIds.length === 0) && styles.modalAddDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void createGroup()}
                disabled={creating || !groupName.trim() || selectedMemberIds.length === 0}
              >
                <Ionicons name="add-circle" size={20} color={creating || !groupName.trim() || selectedMemberIds.length === 0 ? "#737373" : "#0a0a0a"} />
                <Text style={[styles.modalAddText, (creating || !groupName.trim() || selectedMemberIds.length === 0) && styles.modalAddTextDisabled]}>
                  {creating ? "Creating..." : "Create group"}
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
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: { color: "#fff", fontSize: 28, fontWeight: "800" },
  actionsRow: { flexDirection: "row", gap: 10, paddingHorizontal: 20, marginBottom: 20 },
  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
  },
  primaryBtnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "700" },
  meta: { color: "#737373", fontSize: 14, paddingHorizontal: 20, marginBottom: 12 },
  errorWrap: { marginHorizontal: 20, marginBottom: 12, padding: 12, borderRadius: 12, backgroundColor: "rgba(252,165,165,0.12)", borderWidth: 1, borderColor: "rgba(252,165,165,0.2)" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  errorDismissIcon: { padding: 4 },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  errorBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  errorBtnRetry: { backgroundColor: "rgba(141,235,99,0.2)" },
  errorBtnText: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
  btnPressed: { opacity: 0.8 },
  section: { marginBottom: 24 },
  sectionLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "700", marginBottom: 12, paddingHorizontal: 20 },
  allHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 },
  tabRow: { flexDirection: "row", paddingHorizontal: 20, marginBottom: 20, gap: 8 },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  tabActive: { backgroundColor: "rgba(141,235,99,0.15)", borderColor: "rgba(141,235,99,0.35)" },
  tabText: { color: "#a3a3a3", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#8DEB63", fontWeight: "700" },
  tabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tabBadgeAlert: { backgroundColor: "#f59e0b" },
  tabBadgeText: { color: "#fff", fontSize: 11, fontWeight: "700" },
  searchBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  searchBtnText: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
  searchRowWrap: { paddingHorizontal: 20, marginBottom: 16 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    gap: 10,
  },
  searchIcon: { marginRight: 4 },
  searchInput: {
    flex: 1,
    minHeight: 52,
    paddingVertical: 14,
    color: "#e5e5e5",
    fontSize: 16,
    paddingHorizontal: 0,
  },
  searchClear: { padding: 6 },
  listCard: {
    marginHorizontal: 20,
    gap: 14,
  },
  groupCard: {
    borderRadius: 20,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    padding: 16,
  },
  groupCardPressable: { marginBottom: 12 },
  groupCardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  groupAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupAvatarImg: { width: 56, height: 56, borderRadius: 28 },
  groupAvatarText: { color: "#8DEB63", fontSize: 22, fontWeight: "800" },
  groupCardCenter: { flex: 1, minWidth: 0 },
  groupCardName: { color: "#8DEB63", fontSize: 17, fontWeight: "700", marginBottom: 2 },
  groupCardMeta: { color: "#737373", fontSize: 13, marginBottom: 8 },
  memberAvatarsRow: { flexDirection: "row", alignItems: "center" },
  memberAvatarChip: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#141414",
    overflow: "hidden",
  },
  memberAvatarChipImg: { width: "100%", height: "100%" },
  memberAvatarChipPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(141,235,99,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarChipText: { color: "#8DEB63", fontSize: 11, fontWeight: "700" },
  memberAvatarChipMore: {
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarChipMoreText: { color: "#a3a3a3", fontSize: 10, fontWeight: "700" },
  groupCardDelete: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.06)",
  },
  groupCardDeleteText: { color: "#fca5a5", fontSize: 13, fontWeight: "600" },
  deleteIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.1)",
  },
  noResults: { color: "#737373", fontSize: 14, padding: 16, textAlign: "center" },
  invitationsCard: {
    marginHorizontal: 20,
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.2)",
    overflow: "hidden",
  },
  invitationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  invitationLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  invitationGroupAvatar: { width: 44, height: 44, borderRadius: 22 },
  invitationGroupAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  invitationGroupAvatarText: { color: "#8DEB63", fontSize: 18, fontWeight: "800" },
  invitationInfo: { flex: 1, minWidth: 0 },
  invitationGroupName: { color: "#e5e5e5", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  invitationMeta: { color: "#737373", fontSize: 13 },
  invitationActions: { flexDirection: "row", gap: 10 },
  invitationReject: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  invitationRejectText: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
  invitationAccept: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#8DEB63",
  },
  invitationAcceptText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },
  emptyState: { alignItems: "center", paddingVertical: 40, paddingHorizontal: 24 },
  emptyAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  emptyTitle: { color: "#e5e5e5", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptySub: { color: "#737373", fontSize: 14, textAlign: "center", marginBottom: 20 },
  emptyBtn: { paddingVertical: 12, paddingHorizontal: 24, borderRadius: 12, backgroundColor: "#8DEB63" },
  emptyBtnText: { color: "#0a0a0a", fontSize: 14, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    paddingTop: 0,
    paddingHorizontal: 24,
    paddingBottom: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 12,
  },
  modalAccent: {
    height: 4,
    width: "100%",
    backgroundColor: "#8DEB63",
    marginBottom: 20,
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(141,235,99,0.15)",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 6 },
  modalSub: { color: "#a3a3a3", fontSize: 14, textAlign: "center", marginBottom: 24 },
  modalField: { marginBottom: 18 },
  modalFieldLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  modalFieldLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  modalInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
    color: "#e5e5e5",
    fontSize: 16,
    paddingHorizontal: 16,
  },
  modalFriendSearchWrap: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.2)",
    marginBottom: 10,
    paddingHorizontal: 12,
  },
  modalFriendSearchIcon: { marginRight: 8 },
  modalFriendSearchInput: {
    flex: 1,
    color: "#e5e5e5",
    fontSize: 15,
    paddingVertical: 10,
  },
  modalFriendSearchClear: { padding: 4 },
  modalFriendList: {
    maxHeight: 180,
    borderRadius: 14,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
    overflow: "hidden",
  },
  modalFriendScroll: { maxHeight: 180 },
  modalFriendListEmpty: { color: "#737373", fontSize: 14, padding: 16, textAlign: "center" },
  modalFriendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  modalFriendRowSelected: { backgroundColor: "rgba(141,235,99,0.12)" },
  modalFriendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalFriendAvatarText: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  modalFriendName: { flex: 1, color: "#e5e5e5", fontSize: 15 },
  modalFriendCheck: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalFriendCheckSelected: { backgroundColor: "#8DEB63", borderColor: "#8DEB63" },
  modalErrorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(252,165,165,0.12)",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.2)",
  },
  modalError: { color: "#fca5a5", fontSize: 13, flex: 1 },
  modalErrorDismiss: { padding: 4 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center" },
  modalCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalAdd: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#8DEB63" },
  modalAddDisabled: { backgroundColor: "#2a2a2a", opacity: 0.9 },
  modalAddText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  modalAddTextDisabled: { color: "#737373" },
});
