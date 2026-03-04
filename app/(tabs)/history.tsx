import { useCallback, useMemo, useState } from "react";
import {
  Alert,
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

type HistoryRow = {
  id: string;
  merchant: string | null;
  date: string | null;
  total: string | null;
  paid: boolean;
  amount_due: string;
};

type HistoryFilter = "all" | "paid" | "unpaid";

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
        .select("id, merchant, receipt_date, total_amount, paid, split_totals, paid_members")
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
    }, [loadReceipts])
  );

  const onRefreshHistory = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadReceipts();
    } finally {
      setRefreshing(false);
    }
  }, [loadReceipts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === "paid" && !row.paid) return false;
      if (filter === "unpaid" && row.paid) return false;
      if (!q) return true;
      const merchant = (row.merchant || "").toLowerCase();
      const date = (row.date || "").toLowerCase();
      const total = (row.total || "").toLowerCase();
      return merchant.includes(q) || date.includes(q) || total.includes(q) || row.id.includes(q);
    });
  }, [filter, rows, search]);

  const paidCount = useMemo(() => rows.filter((r) => r.paid).length, [rows]);
  const unpaidCount = useMemo(() => rows.filter((r) => !r.paid).length, [rows]);

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

        {rows.length > 0 ? (
          <View style={styles.summaryRow}>
            <View style={styles.summaryChip}>
              <Ionicons name="receipt-outline" size={16} color="#8DEB63" />
              <Text style={styles.summaryChipText}>{rows.length} receipt{rows.length !== 1 ? "s" : ""}</Text>
            </View>
            {unpaidCount > 0 ? (
              <View style={styles.summaryChipUnpaid}>
                <Text style={styles.summaryChipUnpaidText}>{unpaidCount} unpaid</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>Receipts</Text>
            <Pressable
              style={({ pressed }) => [styles.searchPill, pressed && styles.pressed]}
              onPress={() => setSearchFocused(true)}
            >
              <Ionicons name="search" size={16} color="#a3a3a3" />
              <Text style={styles.searchPillText}>Search</Text>
            </Pressable>
          </View>
          {searchFocused ? (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={18} color="#737373" style={styles.searchIcon} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.searchInput}
                placeholder="Merchant, date, total..."
                placeholderTextColor="#525252"
                autoFocus
                onBlur={() => setSearchFocused(!!search.trim())}
              />
              <Pressable onPress={() => { setSearch(""); setSearchFocused(false); }} style={styles.searchClear} hitSlop={8}>
                <Ionicons name="close-circle" size={20} color="#737373" />
              </Pressable>
            </View>
          ) : null}

          <View style={styles.tabRow}>
            {(["all", "paid", "unpaid"] as const).map((f) => (
              <Pressable
                key={f}
                style={[styles.tab, filter === f && styles.tabActive]}
                onPress={() => setFilter(f)}
              >
                <Text style={[styles.tabText, filter === f && styles.tabTextActive]}>
                  {f === "all" ? "All" : f === "paid" ? "Paid" : "Unpaid"}
                </Text>
                {f === "all" && rows.length > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{rows.length}</Text>
                  </View>
                ) : null}
                {f === "paid" && paidCount > 0 ? (
                  <View style={styles.tabBadge}>
                    <Text style={styles.tabBadgeText}>{paidCount}</Text>
                  </View>
                ) : null}
                {f === "unpaid" && unpaidCount > 0 ? (
                  <View style={[styles.tabBadge, styles.tabBadgeAlert]}>
                    <Text style={styles.tabBadgeText}>{unpaidCount}</Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
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
                <Pressable onPress={() => { setError(null); void loadReceipts(); }} style={({ pressed }) => [styles.errorBtn, styles.errorBtnRetry, pressed && styles.btnPressed]}>
                  <Text style={styles.errorBtnText}>Retry</Text>
                </Pressable>
              </View>
            </View>
          ) : !filtered.length ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons name="receipt-outline" size={44} color="#525252" />
              </View>
              <Text style={styles.emptyTitle}>
                {rows.length === 0 ? "No receipts yet" : search.trim() || filter !== "all" ? "No matches" : "No receipts"}
              </Text>
              <Text style={styles.emptySub}>
                {rows.length === 0
                  ? "Scan a receipt from Home to see it here."
                  : "Try a different search or filter."}
              </Text>
            </View>
          ) : (
            <View style={styles.cardList}>
              {filtered.map((row, idx) => (
                <View key={row.id} style={[styles.receiptCard, idx === filtered.length - 1 && styles.receiptCardLast]}>
                  <Pressable
                    style={styles.receiptCardMain}
                    onPress={() => router.push({ pathname: "/history/[id]", params: { id: row.id } })}
                  >
                    <View style={[styles.receiptIconWrap, row.paid ? styles.receiptIconPaid : styles.receiptIconUnpaid]}>
                      <Text style={[styles.receiptIconText, row.paid ? styles.receiptIconTextPaid : styles.receiptIconTextUnpaid]}>{receiptInitial(row.merchant)}</Text>
                    </View>
                    <View style={styles.receiptBody}>
                      <Text style={styles.receiptMerchant} numberOfLines={1}>{row.merchant || "Unknown"}</Text>
                      <Text style={styles.receiptDate}>{formatDisplayDate(row.date)}</Text>
                      <View style={styles.receiptAmounts}>
                        <Text style={styles.receiptTotal}>
                          Total {row.total ? formatAmount(row.total, currencyCode) : "—"}
                        </Text>
                        {!row.paid && parseFloat(row.amount_due) > 0 ? (
                          <Text style={styles.receiptDue}>Due {formatAmount(row.amount_due, currencyCode)}</Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={styles.receiptRight}>
                      <View style={[styles.statusPill, row.paid ? styles.statusPillPaid : styles.statusPillUnpaid]}>
                        <Text style={[styles.statusPillText, row.paid ? styles.statusPillTextPaid : styles.statusPillTextUnpaid]}>
                          {row.paid ? "Paid" : "Unpaid"}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color="#737373" />
                    </View>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.deleteBtn, pressed && styles.pressed]}
                    onPress={() => confirmDelete(row)}
                  >
                    <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                  </Pressable>
                </View>
              ))}
            </View>
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
