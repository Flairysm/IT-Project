import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { OCR_SERVER_URL } from "../config";

type SplitTotal = { name: string; amount: number };
type ReceiptDetail = {
  id: string;
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
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${OCR_SERVER_URL}/receipts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to fetch receipt");
      setReceipt(data?.receipt || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch receipt");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const togglePaidForUser = async (name: string) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const isPaid = receipt?.paid_members?.includes(name) ?? false;
      const res = await fetch(`${OCR_SERVER_URL}/receipts/${id}/paid-member`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, paid: !isPaid }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update paid status");
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
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.btnPressed]}>
          <Text style={styles.backBtnText}>Back</Text>
        </Pressable>
        <Text style={styles.title}>History Detail</Text>
        <View style={{ width: 52 }} />
      </View>

      {loading ? <Text style={styles.infoText}>Loading...</Text> : null}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {receipt ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <View style={styles.card}>
            <Text style={styles.merchant}>{receipt.merchant || "Unknown Merchant"}</Text>
            <Text style={styles.meta}>Date: {receipt.date || "-"}</Text>
            <Text style={styles.meta}>Total: {receipt.total || "-"}</Text>
            <Text style={[styles.status, receipt.paid ? styles.statusPaid : styles.statusUnpaid]}>
              {receipt.paid ? "Paid" : "Unpaid"}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Who Paid How Much</Text>
            {receipt.split_totals?.length ? (
              receipt.split_totals.map((row) => (
                <View key={row.name} style={styles.splitRow}>
                  <View style={styles.splitLeft}>
                    <Text style={styles.splitName}>{row.name}</Text>
                    <Text style={[styles.userStatus, receipt.paid_members?.includes(row.name) ? styles.statusPaid : styles.statusUnpaid]}>
                      {receipt.paid_members?.includes(row.name) ? "Paid" : "Unpaid"}
                    </Text>
                  </View>
                  <View style={styles.splitRight}>
                    <Text style={styles.splitAmount}>${Number(row.amount || 0).toFixed(2)}</Text>
                    <Pressable
                      onPress={() => void togglePaidForUser(row.name)}
                      style={({ pressed }) => [
                        styles.userPaidBtn,
                        receipt.paid_members?.includes(row.name) && styles.userPaidBtnActive,
                        pressed && styles.btnPressed,
                      ]}
                    >
                      <Text style={[styles.userPaidBtnText, receipt.paid_members?.includes(row.name) && styles.userPaidBtnTextActive]}>
                        {receipt.paid_members?.includes(row.name) ? "Unpaid" : "Paid"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ))
            ) : (
              <Text style={styles.infoText}>No split breakdown available.</Text>
            )}
          </View>

          <View style={styles.amountDueCard}>
            <Text style={styles.amountDueLabel}>Amount Due</Text>
            <Text style={styles.amountDueValue}>${receipt.amount_due}</Text>
          </View>
        </ScrollView>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a", paddingHorizontal: 16 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, marginBottom: 12 },
  backBtn: { minHeight: 34, borderRadius: 10, paddingHorizontal: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
  backBtnText: { color: "#e5e5e5", fontSize: 13, fontWeight: "600" },
  title: { color: "#e5e5e5", fontSize: 22, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
  card: { borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#141414", padding: 12, marginBottom: 12 },
  merchant: { color: "#e5e5e5", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  meta: { color: "#c5c5c5", fontSize: 13, marginBottom: 4 },
  status: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  statusPaid: { color: "#8DEB63" },
  statusUnpaid: { color: "#fca5a5" },
  sectionTitle: { color: "#e5e5e5", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  splitRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  splitLeft: { flex: 1, paddingRight: 10 },
  splitRight: { alignItems: "flex-end", gap: 6 },
  splitName: { color: "#e5e5e5", fontSize: 14 },
  userStatus: { fontSize: 12, fontWeight: "700", marginTop: 2 },
  splitAmount: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  userPaidBtn: {
    minHeight: 28,
    minWidth: 70,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.35)",
    backgroundColor: "rgba(141,235,99,0.14)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  userPaidBtnActive: {
    borderColor: "rgba(252,165,165,0.35)",
    backgroundColor: "rgba(239,68,68,0.15)",
  },
  userPaidBtnText: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  userPaidBtnTextActive: { color: "#fca5a5" },
  amountDueCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.35)",
    backgroundColor: "rgba(141,235,99,0.08)",
    padding: 14,
    marginBottom: 12,
  },
  amountDueLabel: {
    color: "#a3a3a3",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
  },
  amountDueValue: {
    color: "#8DEB63",
    fontSize: 28,
    fontWeight: "800",
  },
  infoText: { color: "#a3a3a3", fontSize: 13 },
  errorText: { color: "#fca5a5", textAlign: "center", marginBottom: 8 },
  btnPressed: { opacity: 0.9 },
});

