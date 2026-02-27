import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { Image } from "expo-image";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";

type FriendRow = {
  id: string;
  username: string;
  avatar_url?: string | null;
  status: "accepted" | "pending_sent" | "pending_received";
  friendshipId: string;
};

function initials(username: string): string {
  const s = username.trim();
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

export default function FriendsScreen() {
  const { user, profile } = useAuth();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [pending, setPending] = useState<FriendRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addUsername, setAddUsername] = useState("");
  const [adding, setAdding] = useState(false);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"all" | "requests" | "sent">("all");
  const [refreshing, setRefreshing] = useState(false);

  const loadFriends = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const myId = user.id;
      const { data: asUser, error: e1 } = await supabase.from("friendships").select("id, friend_id, status").eq("user_id", myId);
      if (e1) throw new Error(e1.message);
      const { data: asFriend, error: e2 } = await supabase.from("friendships").select("id, user_id, status").eq("friend_id", myId);
      if (e2) throw new Error(e2.message);

      const accepted: FriendRow[] = [];
      const pendingList: FriendRow[] = [];

      for (const row of asUser || []) {
        if (row.status === "accepted") {
          const { data: prof } = await supabase.from("profiles").select("username, avatar_url").eq("id", row.friend_id).single();
          const p = prof as { username?: string; avatar_url?: string | null } | null;
          accepted.push({ id: row.friend_id, username: p?.username ?? "?", avatar_url: p?.avatar_url ?? null, status: "accepted", friendshipId: row.id });
        } else if (row.status === "pending") {
          const { data: prof } = await supabase.from("profiles").select("username, avatar_url").eq("id", row.friend_id).single();
          const p = prof as { username?: string; avatar_url?: string | null } | null;
          pendingList.push({ id: row.friend_id, username: p?.username ?? "?", avatar_url: p?.avatar_url ?? null, status: "pending_sent", friendshipId: row.id });
        }
      }
      for (const row of asFriend || []) {
        if (row.status === "accepted") {
          const { data: prof } = await supabase.from("profiles").select("username, avatar_url").eq("id", row.user_id).single();
          const p = prof as { username?: string; avatar_url?: string | null } | null;
          if (!accepted.some((f) => f.id === row.user_id)) accepted.push({ id: row.user_id, username: p?.username ?? "?", avatar_url: p?.avatar_url ?? null, status: "accepted", friendshipId: row.id });
        } else if (row.status === "pending") {
          const { data: prof } = await supabase.from("profiles").select("username, avatar_url").eq("id", row.user_id).single();
          const p = prof as { username?: string; avatar_url?: string | null } | null;
          pendingList.push({ id: row.user_id, username: p?.username ?? "?", avatar_url: p?.avatar_url ?? null, status: "pending_received", friendshipId: row.id });
        }
      }
      setFriends(accepted);
      setPending(pendingList);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load friends");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    void loadFriends();
  }, [loadFriends]);

  const onRefreshFriends = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFriends();
    } finally {
      setRefreshing(false);
    }
  }, [loadFriends]);

  const filteredFriends = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter((f) => f.username.toLowerCase().includes(q) || displayName(f.username).toLowerCase().includes(q));
  }, [friends, searchQuery]);

  const incomingRequests = useMemo(() => pending.filter((p) => p.status === "pending_received"), [pending]);
  const sentRequests = useMemo(() => pending.filter((p) => p.status === "pending_sent"), [pending]);

  const addFriend = async () => {
    const username = addUsername.trim().toLowerCase();
    if (!username || !user?.id) return;
    const myUsername = profile?.username?.toLowerCase();
    if (myUsername && username === myUsername) {
      setError("You can't send a friend request to yourself.");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const { data: profileRow } = await supabase.from("profiles").select("id").ilike("username", username).maybeSingle();
      if (!profileRow?.id) {
        setError("No user found with that username. They may need to sign up for EZSplit first.");
        setAdding(false);
        return;
      }
      const friendId = profileRow.id;
      const { data: existing1 } = await supabase.from("friendships").select("id, status").eq("user_id", user.id).eq("friend_id", friendId).maybeSingle();
      const { data: existing2 } = await supabase.from("friendships").select("id, status").eq("user_id", friendId).eq("friend_id", user.id).maybeSingle();
      const existing = existing1 || existing2;
      if (existing) {
        if (existing.status === "accepted") setError("You're already friends with this user.");
        else setError("A request is already pending—either you've sent one or they need to accept yours.");
        setAdding(false);
        return;
      }
      const { error: insertErr } = await supabase.from("friendships").insert({ user_id: user.id, friend_id: friendId, status: "pending" });
      if (insertErr) throw new Error(insertErr.message);
      setAddUsername("");
      setAddModalVisible(false);
      await loadFriends();
    } catch (e) {
      setError("Something went wrong. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const acceptRequest = async (friendshipId: string) => {
    try {
      const { error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId);
      if (error) throw new Error(error.message);
      await loadFriends();
    } catch {
      setError("Failed to accept");
    }
  };

  const declineRequest = async (friendshipId: string) => {
    try {
      const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
      if (error) throw new Error(error.message);
      await loadFriends();
    } catch {
      setError("Failed to decline");
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshFriends} tintColor="#8DEB63" />}
      >
      <View style={styles.header}>
        <Text style={styles.title}>Friends</Text>
      </View>

      <View style={styles.actionsRow}>
        <Pressable style={({ pressed }) => [styles.primaryBtn, pressed && styles.pressed]} onPress={() => setAddModalVisible(true)}>
          <Ionicons name="add" size={22} color="#0a0a0a" />
          <Text style={styles.primaryBtnText}>Add friend</Text>
        </Pressable>
      </View>

      <View style={styles.tabRow}>
        <Pressable style={[styles.tab, activeTab === "all" && styles.tabActive]} onPress={() => setActiveTab("all")}>
          <Text style={[styles.tabText, activeTab === "all" && styles.tabTextActive]}>All ({friends.length})</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === "requests" && styles.tabActive]} onPress={() => setActiveTab("requests")}>
          <Text style={[styles.tabText, activeTab === "requests" && styles.tabTextActive]}>Requests</Text>
          {incomingRequests.length > 0 ? <View style={[styles.tabBadge, styles.tabBadgeAlert]}><Text style={styles.tabBadgeText}>{incomingRequests.length}</Text></View> : null}
        </Pressable>
        <Pressable style={[styles.tab, activeTab === "sent" && styles.tabActive]} onPress={() => setActiveTab("sent")}>
          <Text style={[styles.tabText, activeTab === "sent" && styles.tabTextActive]}>Sent</Text>
          {sentRequests.length > 0 ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{sentRequests.length}</Text></View> : null}
        </Pressable>
      </View>

      {loading ? (
        <Text style={styles.meta}>Loading...</Text>
      ) : null}

      {activeTab === "all" && !loading && pending.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Requests</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.requestsScroll}>
            {pending.map((p) => (
              <View key={p.friendshipId} style={styles.requestCard}>
                {p.avatar_url ? (
                  <View style={styles.avatarLargeWrap}>
                    <Image source={{ uri: p.avatar_url }} style={styles.avatarLargeImg} />
                    {p.status === "pending_received" ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>!</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  <View style={styles.avatarLarge}>
                    <Text style={styles.avatarLargeText}>{initials(p.username)}</Text>
                    {p.status === "pending_received" ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>!</Text>
                      </View>
                    ) : null}
                  </View>
                )}
                <Text style={styles.requestName} numberOfLines={1}>{displayName(p.username)}</Text>
                <Text style={styles.requestHandle} numberOfLines={1}>@{p.username}</Text>
                {p.status === "pending_received" ? (
                  <View style={styles.requestActions}>
                    <Pressable style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]} onPress={() => void acceptRequest(p.friendshipId)}>
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]} onPress={() => void declineRequest(p.friendshipId)}>
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.pendingSent}>Pending</Text>
                )}
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}

      {activeTab === "all" ? (
        <View style={styles.section}>
          <View style={styles.searchRowWrap}>
            <View style={styles.searchRow}>
            <Ionicons name="search" size={20} color="#737373" style={styles.searchIcon} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search friends..."
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

          {!loading && friends.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyAvatar}>
                <Ionicons name="people-outline" size={40} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>No friends yet</Text>
              <Text style={styles.emptySub}>Add friends by username to split receipts and create groups.</Text>
              <Pressable style={({ pressed }) => [styles.emptyBtn, pressed && styles.pressed]} onPress={() => setAddModalVisible(true)}>
                <Text style={styles.emptyBtnText}>Add friend</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.listCard}>
              {filteredFriends.map((f, idx) => (
                <View key={f.id} style={[styles.listRow, idx === filteredFriends.length - 1 && styles.listRowLast]}>
                  {f.avatar_url ? (
                    <Image source={{ uri: f.avatar_url }} style={styles.avatarSmallImg} />
                  ) : (
                    <View style={styles.avatarSmall}>
                      <Text style={styles.avatarSmallText}>{initials(f.username)}</Text>
                    </View>
                  )}
                  <View style={styles.listRowCenter}>
                    <Text style={styles.listRowName} numberOfLines={1}>{displayName(f.username)}</Text>
                    <Text style={styles.listRowHandle} numberOfLines={1}>@{f.username}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#525252" />
                </View>
              ))}
              {filteredFriends.length === 0 && searchQuery.trim() ? (
                <Text style={styles.noResults}>No matches for "{searchQuery.trim()}"</Text>
              ) : null}
            </View>
          )}
        </View>
      ) : null}

      {activeTab === "requests" ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Incoming requests</Text>
          {incomingRequests.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyAvatar}>
                <Ionicons name="mail-open-outline" size={40} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>No requests</Text>
              <Text style={styles.emptySub}>When someone adds you, they'll show up here.</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {incomingRequests.map((p, idx) => (
                <View key={p.friendshipId} style={[styles.listRow, idx === incomingRequests.length - 1 && styles.listRowLast]}>
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.avatarSmallImg} />
                  ) : (
                    <View style={styles.avatarSmall}>
                      <Text style={styles.avatarSmallText}>{initials(p.username)}</Text>
                    </View>
                  )}
                  <View style={styles.listRowCenter}>
                    <Text style={styles.listRowName} numberOfLines={1}>{displayName(p.username)}</Text>
                    <Text style={styles.listRowHandle} numberOfLines={1}>Wants to be friends</Text>
                  </View>
                  <View style={styles.requestActions}>
                    <Pressable style={({ pressed }) => [styles.acceptBtn, pressed && styles.pressed]} onPress={() => void acceptRequest(p.friendshipId)}>
                      <Text style={styles.acceptBtnText}>Accept</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.declineBtn, pressed && styles.pressed]} onPress={() => void declineRequest(p.friendshipId)}>
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}

      {activeTab === "sent" ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Sent requests</Text>
          {sentRequests.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyAvatar}>
                <Ionicons name="send-outline" size={40} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>No sent requests</Text>
              <Text style={styles.emptySub}>Requests you send will appear here until they accept.</Text>
            </View>
          ) : (
            <View style={styles.listCard}>
              {sentRequests.map((p, idx) => (
                <View key={p.friendshipId} style={[styles.listRow, idx === sentRequests.length - 1 && styles.listRowLast]}>
                  {p.avatar_url ? (
                    <Image source={{ uri: p.avatar_url }} style={styles.avatarSmallImg} />
                  ) : (
                    <View style={styles.avatarSmall}>
                      <Text style={styles.avatarSmallText}>{initials(p.username)}</Text>
                    </View>
                  )}
                  <View style={styles.listRowCenter}>
                    <Text style={styles.listRowName} numberOfLines={1}>{displayName(p.username)}</Text>
                    <Text style={styles.listRowHandle} numberOfLines={1}>@{p.username}</Text>
                  </View>
                  <View style={styles.pendingChip}>
                    <Text style={styles.pendingChipText}>Pending</Text>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      ) : null}
      </ScrollView>

      <Modal transparent visible={addModalVisible} animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAddModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalAccent} />
            <View style={styles.modalIconWrap}>
              <Ionicons name="person-add" size={32} color="#8DEB63" />
            </View>
            <Text style={styles.modalTitle}>Add friend</Text>
            <Text style={styles.modalSub}>Send a request using their EZSplit username</Text>

            <View style={styles.modalField}>
              <View style={styles.modalFieldLabelRow}>
                <Ionicons name="at-outline" size={14} color="#8DEB63" />
                <Text style={styles.modalFieldLabel}>Username</Text>
              </View>
              <TextInput
                value={addUsername}
                onChangeText={(t) => { setAddUsername(t); setError(null); }}
                style={styles.modalInput}
                placeholder="e.g. alice, bob123"
                placeholderTextColor="#525252"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!adding}
              />
            </View>

            {error ? (
              <View style={styles.modalErrorWrap}>
                <Ionicons name="warning-outline" size={14} color="#fca5a5" />
                <Text style={styles.modalError}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]} onPress={() => setAddModalVisible(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [
                  styles.modalAdd,
                  (adding || !addUsername.trim()) && styles.modalAddDisabled,
                  pressed && styles.pressed,
                ]}
                onPress={() => void addFriend()}
                disabled={adding || !addUsername.trim()}
              >
                <Ionicons name="person-add" size={18} color={adding || !addUsername.trim() ? "#737373" : "#0a0a0a"} />
                <Text style={[styles.modalAddText, (adding || !addUsername.trim()) && styles.modalAddTextDisabled]}>
                  {adding ? "Sending..." : "Send request"}
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
  pendingChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.08)" },
  pendingChipText: { color: "#737373", fontSize: 12, fontWeight: "600" },
  meta: { color: "#737373", fontSize: 14, paddingHorizontal: 20, marginBottom: 12 },
  section: { marginBottom: 24 },
  sectionLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "700", marginBottom: 12, paddingHorizontal: 20 },
  requestsScroll: { paddingHorizontal: 20, gap: 16, paddingRight: 36 },
  requestCard: {
    width: 140,
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 10,
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  avatarLarge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  avatarLargeWrap: { width: 56, height: 56, marginBottom: 8, position: "relative" },
  avatarLargeImg: { width: 56, height: 56, borderRadius: 28 },
  avatarLargeText: { color: "#8DEB63", fontSize: 20, fontWeight: "800" },
  badge: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#f59e0b",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  requestName: { color: "#8DEB63", fontSize: 13, fontWeight: "700", marginBottom: 2 },
  requestHandle: { color: "#a3a3a3", fontSize: 11, marginBottom: 8 },
  requestActions: { flexDirection: "column", gap: 8, alignSelf: "stretch", minWidth: 80, alignItems: "stretch" },
  acceptBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(141,235,99,0.25)", alignItems: "center", justifyContent: "center" },
  acceptBtnText: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  declineBtn: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: "rgba(252,165,165,0.4)", alignItems: "center", justifyContent: "center" },
  declineBtnText: { color: "#fca5a5", fontSize: 12, fontWeight: "700" },
  pendingSent: { color: "#737373", fontSize: 11 },
  allHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 12 },
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
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  listRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: 12,
  },
  listRowLast: { borderBottomWidth: 0 },
  avatarSmall: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarSmallImg: { width: 44, height: 44, borderRadius: 22 },
  avatarSmallText: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  listRowCenter: { flex: 1, minWidth: 0 },
  listRowName: { color: "#8DEB63", fontSize: 15, fontWeight: "600", marginBottom: 2 },
  listRowHandle: { color: "#a3a3a3", fontSize: 13 },
  noResults: { color: "#737373", fontSize: 14, padding: 16, textAlign: "center" },
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
  modalField: { marginBottom: 20 },
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
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center" },
  modalCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalAdd: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#8DEB63" },
  modalAddDisabled: { backgroundColor: "#2a2a2a", opacity: 0.9 },
  modalAddText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  modalAddTextDisabled: { color: "#737373" },
});
