import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { formatAmount } from "../lib/currency";
import { SubscriptionDiamond } from "../components/SubscriptionDiamond";
import { QUICK_SPLIT_CATEGORIES } from "../lib/quickSplitCategories";

type HistoryRow = {
  id: string;
  merchant: string | null;
  date: string | null;
  total: string | null;
  paid: boolean;
  amount_due: string;
  category?: string | null;
  split_totals?: { name?: string }[];
};
type ExpenseGroupRow = { id: string; name: string; category: string; created_at: string; entryCount: number; memberCount: number; host_id?: string; member_ids: string[] };

type HistoryFilter = "all" | "paid" | "unpaid";
type HistoryCategoryTab = "all" | "restaurant" | "travel" | "groceries" | "business" | "others";

type HistoryListItem =
  | { type: "receipt"; id: string; title: string; date: string; category: string; meta: string; amountLabel: string; row: HistoryRow }
  | { type: "trip"; id: string; title: string; date: string; category: string; meta: string; amountLabel: string; group: ExpenseGroupRow };

function getCategoryIcon(category: string): keyof typeof Ionicons.glyphMap {
  const found = QUICK_SPLIT_CATEGORIES.find((c) => c.id === category);
  return found?.icon ?? "ellipsis-horizontal-circle-outline";
}

function memberInitial(name: string): string {
  const s = (name || "?").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function receiptInitial(merchant: string | null): string {
  const s = (merchant || "?").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isThisYear = d.getFullYear() === now.getFullYear();
    return isThisYear
      ? d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

export default function HistoryTabScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [expenseGroups, setExpenseGroups] = useState<ExpenseGroupRow[]>([]);
  const [categoryTab, setCategoryTab] = useState<HistoryCategoryTab>("all");
  const [historyHostProfiles, setHistoryHostProfiles] = useState<Record<string, { username: string; avatar_url: string | null }>>({});
  const [historyReceiptAvatarMap, setHistoryReceiptAvatarMap] = useState<Record<string, string | null>>({});

  const loadExpenseGroups = useCallback(async () => {
    if (!user?.id) {
      setExpenseGroups([]);
      setHistoryHostProfiles({});
      return;
    }
    try {
      const { data: groups, error } = await supabase.from("expense_groups").select("id, name, category, created_at, host_id").order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const ids = (groups ?? []).map((g: { id: string }) => g.id);
      if (ids.length === 0) {
        setExpenseGroups([]);
        setHistoryHostProfiles({});
        return;
      }
      const { data: entries } = await supabase.from("expense_entries").select("group_id").in("group_id", ids);
      const { data: mems } = await supabase.from("expense_group_members").select("group_id, user_id").in("group_id", ids);
      const entryCountByGroup: Record<string, number> = {};
      const memberCountByGroup: Record<string, number> = {};
      const memberIdsByGroup: Record<string, string[]> = {};
      for (const id of ids) {
        entryCountByGroup[id] = 0;
        memberCountByGroup[id] = 0;
        memberIdsByGroup[id] = [];
      }
      for (const e of entries ?? []) {
        const gid = (e as { group_id: string }).group_id;
        if (gid) entryCountByGroup[gid] = (entryCountByGroup[gid] ?? 0) + 1;
      }
      for (const m of mems ?? []) {
        const gid = (m as { group_id: string }).group_id;
        const uid = (m as { user_id: string }).user_id;
        if (gid) memberCountByGroup[gid] = (memberCountByGroup[gid] ?? 0) + 1;
        if (gid && uid) (memberIdsByGroup[gid] ??= []).push(uid);
      }
      const hostIds = [...new Set((groups as { host_id?: string }[]).map((g) => g.host_id).filter(Boolean))] as string[];
      const allUserIds = new Set(hostIds);
      for (const mids of Object.values(memberIdsByGroup)) mids.forEach((id) => allUserIds.add(id));
      let hostProfiles: Record<string, { username: string; avatar_url: string | null }> = {};
      if (allUserIds.size > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, username, avatar_url").in("id", [...allUserIds]);
        for (const p of profiles ?? []) {
          const id = (p as { id: string }).id;
          hostProfiles[id] = {
            username: (p as { username?: string }).username ?? "—",
            avatar_url: (p as { avatar_url?: string | null }).avatar_url ?? null,
          };
        }
      }
      setHistoryHostProfiles(hostProfiles);
      setExpenseGroups(
        (groups ?? []).map((g: { id: string; name: string; category: string; created_at: string; host_id?: string }) => ({
          id: g.id,
          name: g.name,
          category: g.category ?? "travel",
          created_at: g.created_at,
          entryCount: entryCountByGroup[g.id] ?? 0,
          memberCount: memberCountByGroup[g.id] ?? 0,
          host_id: g.host_id,
          member_ids: memberIdsByGroup[g.id] ?? [],
        }))
      );
    } catch {
      setExpenseGroups([]);
      setHistoryHostProfiles({});
    }
  }, [user?.id]);

  const loadReceipts = useCallback(async () => {
    if (!user?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data: raw, error: e } = await supabase
        .from("receipts")
        .select("id, merchant, receipt_date, total_amount, paid, split_totals, paid_members, category")
        .eq("host_id", user.id)
        .order("created_at", { ascending: false });
      if (e) throw new Error(e.message);
      const list = (raw || []).map((r) => {
        const totalRaw = r.total_amount;
        const splitTotals = Array.isArray(r.split_totals) ? r.split_totals : [];
        const paidMembers = Array.isArray(r.paid_members) ? r.paid_members.map(String) : [];
        let amountDue = "0.00";
        if (r.paid) amountDue = "0.00";
        else if (splitTotals.length) {
          const unpaid = splitTotals.reduce((sum: number, row: { name?: string; amount?: number }) => {
            const name = String(row?.name ?? "");
            const amount = Number(row?.amount ?? 0) || 0;
            return paidMembers.includes(name) ? sum : sum + amount;
          }, 0);
          amountDue = Math.max(0, unpaid).toFixed(2);
        } else amountDue = totalRaw ? String(parseFloat(totalRaw).toFixed(2)) : "0.00";
        return {
          id: String(r.id),
          merchant: r.merchant ?? null,
          date: r.receipt_date ?? null,
          total: totalRaw ?? null,
          paid: Boolean(r.paid),
          amount_due: amountDue,
          category: (r as { category?: string | null }).category ?? "others",
          split_totals: splitTotals,
        };
      });
      setRows(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      void loadReceipts();
      void loadExpenseGroups();
    }, [loadReceipts, loadExpenseGroups])
  );

  const onRefreshHistory = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadReceipts(), loadExpenseGroups()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadReceipts, loadExpenseGroups]);

  useEffect(() => {
    const usernames = new Set<string>();
    if (profile?.username) usernames.add(profile.username);
    for (const row of rows) {
      for (const s of row.split_totals ?? []) {
        const name = s?.name?.trim();
        if (name) usernames.add(name);
      }
    }
    const list = [...usernames];
    if (list.length === 0) {
      setHistoryReceiptAvatarMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("profiles").select("username, avatar_url").in("username", list.slice(0, 100));
        if (cancelled) return;
        const map: Record<string, string | null> = {};
        if (profile?.username) map[profile.username.toLowerCase()] = profile.avatar_url ?? null;
        for (const p of data ?? []) {
          const u = (p as { username?: string }).username;
          if (u) map[u.toLowerCase()] = (p as { avatar_url?: string | null }).avatar_url ?? null;
        }
        setHistoryReceiptAvatarMap(map);
      } catch {
        if (!cancelled) setHistoryReceiptAvatarMap({});
      }
    })();
    return () => { cancelled = true; };
  }, [rows, profile?.username, profile?.avatar_url]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (categoryTab !== "all") {
        const rowCat = row.category ?? "others";
        if (rowCat !== categoryTab) return false;
      }
      if (filter === "paid" && !row.paid) return false;
      if (filter === "unpaid" && row.paid) return false;
      if (!q) return true;
      const merchant = (row.merchant || "").toLowerCase();
      const date = (row.date || "").toLowerCase();
      const total = (row.total || "").toLowerCase();
      return merchant.includes(q) || date.includes(q) || total.includes(q) || row.id.includes(q);
    });
  }, [categoryTab, filter, rows, search]);

  const filteredGroups = useMemo(() => {
    if (categoryTab === "all") return expenseGroups;
    if (categoryTab === "travel") return expenseGroups.filter((g) => g.category === "travel");
    if (categoryTab === "business") return expenseGroups.filter((g) => g.category === "business");
    return [];
  }, [categoryTab, expenseGroups]);

  const paidCount = useMemo(() => rows.filter((r) => r.paid).length, [rows]);
  const unpaidCount = useMemo(() => rows.filter((r) => !r.paid).length, [rows]);

  const historyListItems = useMemo((): HistoryListItem[] => {
    const receiptItems: HistoryListItem[] = filtered.map((row) => ({
      type: "receipt",
      id: row.id,
      title: row.merchant || "Receipt",
      date: row.date || "",
      category: row.category ?? "others",
      meta: row.paid ? "Paid" : "Unpaid",
      amountLabel: row.total ? formatAmount(row.total, currencyCode) : "—",
      row,
    }));
    const tripItems: HistoryListItem[] = filteredGroups.map((g) => ({
      type: "trip",
      id: g.id,
      title: g.name,
      date: g.created_at,
      category: g.category,
      meta: `${g.memberCount} people · ${g.entryCount} expense${g.entryCount !== 1 ? "s" : ""}`,
      amountLabel: "—",
      group: g,
    }));
    const combined = [...receiptItems, ...tripItems];
    combined.sort((a, b) => {
      const da = new Date(a.date).getTime();
      const db = new Date(b.date).getTime();
      return db - da;
    });
    return combined;
  }, [filtered, filteredGroups, currencyCode]);

  const deleteReceipt = useCallback(
    async (id: string) => {
      if (!user?.id) return;
      try {
        const { error: e } = await supabase.from("receipts").delete().eq("id", id).eq("host_id", user.id);
        if (e) throw new Error(e.message);
        setRows((prev) => prev.filter((r) => r.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to delete");
      }
    },
    [user?.id]
  );

  const confirmDelete = (row: HistoryRow) => {
    Alert.alert("Delete receipt", `Remove "${row.merchant || "this receipt"}" from history?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void deleteReceipt(row.id) },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshHistory} tintColor="#8DEB63" />}
      >
        <View style={styles.accent} />
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>History</Text>
            <Text style={styles.subtitle}>Your receipt history</Text>
          </View>
          <SubscriptionDiamond />
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>History</Text>
          <View style={styles.settlementTabRow}>
            <Pressable style={[styles.settlementTab, categoryTab === "all" && styles.settlementTabActive]} onPress={() => setCategoryTab("all")}>
              <Ionicons name="apps-outline" size={16} color={categoryTab === "all" ? "#8DEB63" : "#737373"} />
              <Text style={[styles.settlementTabText, categoryTab === "all" && styles.settlementTabTextActive]} numberOfLines={1}>All</Text>
            </Pressable>
            {QUICK_SPLIT_CATEGORIES.map((cat) => (
              <Pressable key={cat.id} style={[styles.settlementTab, categoryTab === cat.id && styles.settlementTabActive]} onPress={() => setCategoryTab(cat.id)}>
                <Ionicons name={cat.icon} size={16} color={categoryTab === cat.id ? "#8DEB63" : "#737373"} />
                <Text style={[styles.settlementTabText, categoryTab === cat.id && styles.settlementTabTextActive]} numberOfLines={1}>{cat.label}</Text>
              </Pressable>
            ))}
          </View>
          {searchFocused ? (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color="#737373" style={styles.searchIcon} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder="Search merchant, date..."
                placeholderTextColor="#525252"
                autoFocus
                onBlur={() => setSearchFocused(!!search.trim())}
              />
              <Pressable onPress={() => { setSearch(""); setSearchFocused(false); }} style={styles.searchClear} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#737373" />
              </Pressable>
            </View>
          ) : null}
          {!searchFocused ? (
            <Pressable style={({ pressed }) => [styles.searchPill, pressed && styles.pressed]} onPress={() => setSearchFocused(true)}>
              <Ionicons name="search" size={16} color="#a3a3a3" />
              <Text style={styles.searchPillText}>Search</Text>
            </Pressable>
          ) : null}

          {loading ? (
            <Text style={styles.historyMeta}>Loading...</Text>
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
                <Pressable onPress={() => { setError(null); void loadReceipts(); }} style={({ pressed }) => [styles.errorBtn, styles.errorBtnRetry, pressed && styles.btnPressed]}>
                  <Text style={styles.errorBtnText}>Retry</Text>
                </Pressable>
              </View>
            </View>
          ) : !historyListItems.length ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="receipt-outline" size={44} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>
                {categoryTab !== "all"
                  ? `Nothing in ${QUICK_SPLIT_CATEGORIES.find((c) => c.id === categoryTab)?.label ?? categoryTab}`
                  : "No history yet"}
              </Text>
              <Text style={styles.emptySub}>
                {categoryTab !== "all" ? "Try another category or add from Home." : "Scan a receipt or create a trip from Home."}
              </Text>
            </View>
          ) : (
            <>
              {historyListItems.map((item) => {
                const createdByName = item.type === "receipt"
                  ? (profile?.display_name?.trim() || profile?.username || "You")
                  : (item.group.host_id ? historyHostProfiles[item.group.host_id]?.username ?? "—" : "—");
                const avatarKeysReceipt = item.type === "receipt"
                  ? [...new Set([profile?.username, ...(item.row.split_totals ?? []).map((s) => s?.name).filter(Boolean)] as string[])]
                  : [];
                const avatarIdsTrip = item.type === "trip"
                  ? [...new Set([item.group.host_id, ...(item.group.member_ids ?? [])].filter(Boolean) as string[])]
                  : [];
                return (
                  <Pressable
                    key={item.type === "receipt" ? `r-${item.id}` : `t-${item.id}`}
                    style={({ pressed }) => [styles.historyRow, pressed && styles.actionBtnPressed]}
                    onPress={() => {
                      if (item.type === "receipt") {
                        router.push({ pathname: "/history/[id]", params: { id: item.id } });
                      } else {
                        router.push({ pathname: "/expense-group", params: { groupId: item.id, category: item.category } });
                      }
                    }}
                  >
                    <View style={styles.historyRowIconWrap}>
                      <Ionicons name={getCategoryIcon(item.category)} size={22} color="#8DEB63" />
                    </View>
                    <View style={styles.historyRowLeft}>
                      <Text style={styles.historyRowTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.historyRowDate}>{formatDisplayDate(item.date)}</Text>
                      <Text style={styles.historyRowCreatedBy}>Created by {createdByName}</Text>
                      <View style={styles.historyAvatarsRow}>
                        {item.type === "receipt"
                          ? avatarKeysReceipt.slice(0, 7).map((username, i) => {
                              const url = username ? historyReceiptAvatarMap[username.toLowerCase()] : null;
                              const initial = memberInitial(username ?? "?");
                              return (
                                <View key={`${item.id}-${username}-${i}`} style={[styles.historyAvatar, { marginLeft: i === 0 ? 0 : -6 }]}>
                                  {url ? (
                                    <Image source={{ uri: url }} style={styles.historyAvatarImg} />
                                  ) : (
                                    <View style={styles.historyAvatarPlaceholder}>
                                      <Text style={styles.historyAvatarText}>{initial}</Text>
                                    </View>
                                  )}
                                </View>
                              );
                            })
                          : avatarIdsTrip.slice(0, 7).map((uid, i) => {
                              const prof = uid ? historyHostProfiles[uid] : null;
                              const url = prof?.avatar_url ?? null;
                              const initial = memberInitial(prof?.username ?? "?");
                              return (
                                <View key={`${item.id}-${uid}-${i}`} style={[styles.historyAvatar, { marginLeft: i === 0 ? 0 : -6 }]}>
                                  {url ? (
                                    <Image source={{ uri: url }} style={styles.historyAvatarImg} />
                                  ) : (
                                    <View style={styles.historyAvatarPlaceholder}>
                                      <Text style={styles.historyAvatarText}>{initial}</Text>
                                    </View>
                                  )}
                                </View>
                              );
                            })}
                        {(item.type === "receipt" ? avatarKeysReceipt.length : avatarIdsTrip.length) > 7 ? (
                          <View style={[styles.historyAvatarMore, { marginLeft: -6 }]}>
                            <Text style={styles.historyAvatarMoreText}>
                              +{(item.type === "receipt" ? avatarKeysReceipt.length : avatarIdsTrip.length) - 7}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.historyRowRight}>
                      <Text style={styles.historyRowAmount}>{item.amountLabel}</Text>
                      {item.type === "receipt" ? (
                        <Pressable
                          style={({ pressed: p }) => [styles.historyRowDelete, p && styles.pressed]}
                          onPress={(e) => { e.stopPropagation(); confirmDelete(item.row); }}
                          hitSlop={8}
                        >
                          <Ionicons name="trash-outline" size={18} color="#737373" />
                        </Pressable>
                      ) : null}
                      <Ionicons name="chevron-forward" size={18} color="#737373" />
                    </View>
                  </Pressable>
                );
              })}
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  pressed: { opacity: 0.9 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  accent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 20 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, marginBottom: 16 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginBottom: 4 },
  subtitle: { color: "#a3a3a3", fontSize: 14 },
  categoryTabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 20, marginBottom: 16 },
  categoryTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  categoryTabActive: { backgroundColor: "rgba(141,235,99,0.12)", borderColor: "rgba(141,235,99,0.35)" },
  categoryTabText: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
  categoryTabTextActive: { color: "#8DEB63", fontWeight: "700" },
  summaryRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 20, marginBottom: 20 },
  summaryChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(141,235,99,0.12)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
  },
  summaryChipText: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },
  summaryChipUnpaid: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(251,191,36,0.15)",
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.3)",
  },
  summaryChipUnpaidText: { color: "#fbbf24", fontSize: 12, fontWeight: "600" },
  sectionCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "#141414",
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sectionTitle: { color: "#e5e5e5", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  settlementTabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  settlementTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  settlementTabActive: { backgroundColor: "rgba(141,235,99,0.15)", borderColor: "rgba(141,235,99,0.35)" },
  settlementTabText: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", maxWidth: 72 },
  settlementTabTextActive: { color: "#8DEB63", fontWeight: "700" },
  historyMeta: { color: "#737373", fontSize: 14, marginBottom: 10 },
  historyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
  },
  historyRowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  historyRowLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  historyRowTitle: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 2 },
  historyRowDate: { color: "#737373", fontSize: 13, marginBottom: 2 },
  historyRowCreatedBy: { color: "#737373", fontSize: 12, marginBottom: 4 },
  historyRowMeta: { color: "#737373", fontSize: 12, marginBottom: 0 },
  historyAvatarsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  historyAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#141414",
    overflow: "hidden",
  },
  historyAvatarImg: { width: "100%", height: "100%" },
  historyAvatarPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(141,235,99,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  historyAvatarText: { color: "#8DEB63", fontSize: 10, fontWeight: "700" },
  historyAvatarMore: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#141414",
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  historyAvatarMoreText: { color: "#a3a3a3", fontSize: 10, fontWeight: "700" },
  historyRowRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  historyRowAmount: { color: "#a3a3a3", fontSize: 15, fontWeight: "600" },
  historyRowDelete: { padding: 4 },
  actionBtnPressed: { opacity: 0.9 },
  section: { paddingHorizontal: 20 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "700" },
  searchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    marginBottom: 12,
  },
  searchPillText: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.2)",
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: "#e5e5e5", fontSize: 15, paddingVertical: 10 },
  searchClear: { padding: 4 },
  tabRow: { flexDirection: "row", gap: 8, marginBottom: 16 },
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
  meta: { color: "#737373", fontSize: 14, marginBottom: 12 },
  errorWrap: {
    backgroundColor: "rgba(252,165,165,0.12)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.2)",
  },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  errorDismissIcon: { padding: 4 },
  errorActions: { flexDirection: "row", gap: 10, marginTop: 10 },
  errorBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  errorBtnRetry: { backgroundColor: "rgba(141,235,99,0.2)" },
  errorBtnText: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
  btnPressed: { opacity: 0.8 },
  emptyState: { alignItems: "center", paddingVertical: 48, paddingHorizontal: 24 },
  emptyIconWrap: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  emptyTitle: { color: "#e5e5e5", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  emptySub: { color: "#737373", fontSize: 14, textAlign: "center" },
  cardList: {
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  receiptCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  receiptCardLast: { borderBottomWidth: 0 },
  receiptCardMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: 14, minWidth: 0 },
  receiptIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptIconPaid: { backgroundColor: "rgba(141,235,99,0.2)" },
  receiptIconUnpaid: { backgroundColor: "rgba(251,191,36,0.2)" },
  receiptIconText: { fontSize: 20, fontWeight: "800" },
  receiptIconTextPaid: { color: "#8DEB63" },
  receiptIconTextUnpaid: { color: "#fbbf24" },
  receiptBody: { flex: 1, minWidth: 0 },
  receiptMerchant: { color: "#fff", fontSize: 16, fontWeight: "700", marginBottom: 2 },
  receiptDate: { color: "#737373", fontSize: 13, marginBottom: 6 },
  receiptAmounts: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  receiptTotal: { color: "#a3a3a3", fontSize: 13 },
  receiptDue: { color: "#fbbf24", fontSize: 13, fontWeight: "600" },
  tripsSubtitle: { color: "#737373", fontSize: 13, marginBottom: 12 },
  tripMeta: { color: "#a3a3a3", fontSize: 13, marginTop: 2 },
  receiptRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  statusPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
  },
  statusPillPaid: { backgroundColor: "rgba(141,235,99,0.2)" },
  statusPillUnpaid: { backgroundColor: "rgba(251,191,36,0.2)" },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  statusPillTextPaid: { color: "#8DEB63" },
  statusPillTextUnpaid: { color: "#fbbf24" },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(239,68,68,0.1)",
  },
});
