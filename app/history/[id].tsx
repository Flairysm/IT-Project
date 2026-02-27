import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth-context";
import { formatAmount } from "../lib/currency";

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function receiptInitial(merchant: string | null): string {
  const s = (merchant || "?").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

type SplitTotal = { name: string; amount: number };
type ReceiptDetail = {
  id: string;
  host_id: string | null;
  merchant: string | null;
  date: string | null;
  total: string | null;
  paid: boolean;
  amount_due: string;
  paid_members: string[];
  split_totals: SplitTotal[];
};

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: row, error } = await supabase
        .from("receipts")
        .select("id, host_id, merchant, receipt_date, total_amount, paid, split_totals, paid_members")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      if (!row) {
        setReceipt(null);
        return;
      }
      const splitTotals = Array.isArray(row.split_totals) ? row.split_totals : [];
      const paidMembers = Array.isArray(row.paid_members) ? row.paid_members.map(String) : [];
      let amountDue = "0.00";
      if (row.paid) {
        amountDue = "0.00";
      } else if (splitTotals.length) {
        const unpaid = splitTotals.reduce((sum: number, s: { name?: string; amount?: number }) => {
          const name = String(s?.name ?? "");
          const amount = Number(s?.amount ?? 0) || 0;
          return paidMembers.includes(name) ? sum : sum + amount;
        }, 0);
        amountDue = Math.max(0, unpaid).toFixed(2);
      } else {
        amountDue = row.total_amount ? parseFloat(row.total_amount).toFixed(2) : "0.00";
      }
      setReceipt({
        id: String(row.id),
        host_id: row.host_id ?? null,
        merchant: row.merchant ?? null,
        date: row.receipt_date ?? null,
        total: row.total_amount ?? null,
        paid: Boolean(row.paid),
        amount_due: amountDue,
        paid_members: paidMembers,
        split_totals: splitTotals as SplitTotal[],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch receipt");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isHost = receipt && user?.id && receipt.host_id === user.id;
  const hostUsername = (profile?.username ?? "").trim().toLowerCase();

  const togglePaidForUser = async (name: string) => {
    if (!id || !receipt) return;
    const nameLower = name.trim().toLowerCase();
    if (isHost && nameLower === hostUsername) return;
    setLoading(true);
    setError(null);
    try {
      const isPaid = receipt.paid_members.includes(name);
      const nextPaid = isPaid ? receipt.paid_members.filter((m) => m !== name) : [...receipt.paid_members, name];
      const splitNames = receipt.split_totals.map((s) => s.name);
      const isFullyPaid = splitNames.length > 0 && splitNames.every((n) => nextPaid.includes(n));
      const { error } = await supabase
        .from("receipts")
        .update({ paid_members: nextPaid, paid: isFullyPaid })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update paid status");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.accent} />
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.btnPressed]}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Receipt</Text>
        {isHost && receipt ? (
          <Pressable
            onPress={() => router.push({ pathname: "/scan-result", params: { receiptId: receipt.id } })}
            style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
          >
            <Ionicons name="pencil" size={22} color="#8DEB63" />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {error ? (
        <View style={styles.errorBlock}>
          <Ionicons name="warning-outline" size={20} color="#fca5a5" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && !receipt ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading receipt…</Text>
        </View>
      ) : receipt ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={[styles.heroIconWrap, receipt.paid ? styles.heroIconPaid : styles.heroIconUnpaid]}>
              <Text style={[styles.heroIconText, receipt.paid ? styles.heroIconTextPaid : styles.heroIconTextUnpaid]}>
                {receiptInitial(receipt.merchant)}
              </Text>
            </View>
            <Text style={styles.heroMerchant} numberOfLines={2}>{receipt.merchant || "Unknown Merchant"}</Text>
            <Text style={styles.heroDate}>{formatDisplayDate(receipt.date)}</Text>
            <View style={styles.heroTotalRow}>
              <Text style={styles.heroTotalLabel}>Total</Text>
              <Text style={styles.heroTotalValue}>{receipt.total ? formatAmount(receipt.total, currencyCode) : "—"}</Text>
            </View>
            <View style={[styles.statusPill, receipt.paid ? styles.statusPillPaid : styles.statusPillUnpaid]}>
              <Ionicons name={receipt.paid ? "checkmark-circle" : "time"} size={16} color={receipt.paid ? "#8DEB63" : "#fbbf24"} />
              <Text style={[styles.statusPillText, receipt.paid ? styles.statusPillTextPaid : styles.statusPillTextUnpaid]}>
                {receipt.paid ? "All settled" : "Pending"}
              </Text>
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people-outline" size={18} color="#8DEB63" />
              <Text style={styles.sectionTitle}>Who paid how much</Text>
            </View>
            {receipt.split_totals?.length ? (
              <View style={styles.splitCard}>
                {receipt.split_totals.map((row, idx) => {
                  const isHostRow = isHost && row.name.trim().toLowerCase() === hostUsername;
                  const rowPaid = receipt.paid_members?.includes(row.name);
                  const isLast = idx === receipt.split_totals!.length - 1;
                  return (
                    <View key={row.name} style={[styles.splitRow, isLast && styles.splitRowLast]}>
                      <View style={styles.splitLeft}>
                        <Text style={styles.splitName}>@{row.name}</Text>
                        <View style={styles.splitMetaRow}>
                          <Text style={[styles.splitStatus, rowPaid ? styles.splitStatusPaid : styles.splitStatusUnpaid]}>
                            {rowPaid ? "Paid" : "Unpaid"}
                          </Text>
                          {isHostRow ? <Text style={styles.hostBadge}>Host</Text> : null}
                        </View>
                      </View>
                      <View style={styles.splitRight}>
                        <Text style={styles.splitAmount}>{formatAmount(Number(row.amount || 0), currencyCode)}</Text>
                        {isHostRow ? (
                          <View style={styles.autoBadge}>
                            <Ionicons name="checkmark-done" size={14} color="#8DEB63" />
                            <Text style={styles.autoBadgeText}>Auto</Text>
                          </View>
                        ) : isHost ? (
                          <Pressable
                            onPress={() => void togglePaidForUser(row.name)}
                            style={({ pressed }) => [
                              styles.toggleBtn,
                              rowPaid && styles.toggleBtnPaid,
                              pressed && styles.btnPressed,
                            ]}
                          >
                            <Text style={[styles.toggleBtnText, rowPaid && styles.toggleBtnTextPaid]}>
                              {rowPaid ? "Mark unpaid" : "Mark paid"}
                            </Text>
                          </Pressable>
                        ) : (
                          <Text style={[styles.splitStatusReadOnly, rowPaid ? styles.splitStatusPaid : styles.splitStatusUnpaid]}>
                            {rowPaid ? "Paid" : "Unpaid"}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptySplit}>
                <Ionicons name="receipt-outline" size={32} color="#525252" />
                <Text style={styles.emptySplitText}>No split breakdown</Text>
              </View>
            )}
          </View>

          {!receipt.paid && parseFloat(receipt.amount_due || "0") > 0 ? (
            <View style={styles.amountDueCard}>
              <Text style={styles.amountDueLabel}>Amount still due</Text>
              <Text style={styles.amountDueValue}>{formatAmount(receipt.amount_due, currencyCode)}</Text>
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  accent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 16 },
  backBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  headerSpacer: { width: 44 },
  editBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(141,235,99,0.15)" },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  errorBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(252,165,165,0.12)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.25)",
  },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  loadingBlock: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48 },
  loadingText: { color: "#737373", fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },

  heroCard: {
    borderRadius: 20,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 24,
    marginBottom: 24,
    alignItems: "center",
  },
  heroIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  heroIconPaid: { backgroundColor: "rgba(141,235,99,0.2)" },
  heroIconUnpaid: { backgroundColor: "rgba(251,191,36,0.2)" },
  heroIconText: { fontSize: 28, fontWeight: "800" },
  heroIconTextPaid: { color: "#8DEB63" },
  heroIconTextUnpaid: { color: "#fbbf24" },
  heroMerchant: { color: "#fff", fontSize: 22, fontWeight: "800", textAlign: "center", marginBottom: 8 },
  heroDate: { color: "#737373", fontSize: 14, marginBottom: 16 },
  heroTotalRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginBottom: 14 },
  heroTotalLabel: { color: "#a3a3a3", fontSize: 14, fontWeight: "600" },
  heroTotalValue: { color: "#e5e5e5", fontSize: 24, fontWeight: "800" },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
  },
  statusPillPaid: { backgroundColor: "rgba(141,235,99,0.15)" },
  statusPillUnpaid: { backgroundColor: "rgba(251,191,36,0.15)" },
  statusPillText: { fontSize: 14, fontWeight: "700" },
  statusPillTextPaid: { color: "#8DEB63" },
  statusPillTextUnpaid: { color: "#fbbf24" },

  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  sectionTitle: { color: "#e5e5e5", fontSize: 17, fontWeight: "700" },
  splitCard: {
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  splitRowLast: { borderBottomWidth: 0 },
  splitLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  splitName: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 4 },
  splitMetaRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  splitStatus: { fontSize: 13, fontWeight: "600" },
  splitStatusPaid: { color: "#8DEB63" },
  splitStatusUnpaid: { color: "#fbbf24" },
  splitStatusReadOnly: { fontSize: 14, fontWeight: "700" },
  hostBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8DEB63",
    backgroundColor: "rgba(141,235,99,0.2)",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: "hidden",
  },
  splitRight: { alignItems: "flex-end", gap: 8 },
  splitAmount: { color: "#8DEB63", fontSize: 17, fontWeight: "800" },
  autoBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  autoBadgeText: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },
  toggleBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "rgba(141,235,99,0.2)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.35)",
  },
  toggleBtnPaid: {
    backgroundColor: "rgba(251,191,36,0.15)",
    borderColor: "rgba(251,191,36,0.3)",
  },
  toggleBtnText: { color: "#8DEB63", fontSize: 13, fontWeight: "700" },
  toggleBtnTextPaid: { color: "#fbbf24" },
  emptySplit: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptySplitText: { color: "#737373", fontSize: 14 },

  amountDueCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    backgroundColor: "rgba(251,191,36,0.1)",
    padding: 20,
    alignItems: "center",
  },
  amountDueLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  amountDueValue: { color: "#fbbf24", fontSize: 28, fontWeight: "800" },

  btnPressed: { opacity: 0.9 },
});

