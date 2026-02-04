import { useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { supabase, type ReceiptRow } from "../lib/supabase";

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function perPersonTotals(
  items: { price: string }[],
  members: string[],
  assignments: Record<string, number[]>
): { name: string; amount: number }[] {
  if (!members.length) return [];
  const totals: number[] = new Array(members.length).fill(0);
  items.forEach((item, i) => {
    const key = String(i);
    const assignees = assignments[key] ?? [];
    if (assignees.length === 0) return;
    const price = parseFloat(item.price) || 0;
    const share = price / assignees.length;
    assignees.forEach((mi) => {
      totals[mi] = (totals[mi] || 0) + share;
    });
  });
  return members.map((name, i) => ({
    name,
    amount: Math.round((totals[i] || 0) * 100) / 100,
  }));
}

export default function HistoryScreen() {
  const [receipts, setReceipts] = useState<ReceiptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReceiptRow | null>(null);

  const fetchReceipts = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("saved_receipts")
        .select("*")
        .order("created_at", { ascending: false });
      if (err) throw err;
      setReceipts((data ?? []) as ReceiptRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      fetchReceipts();
    }, [fetchReceipts])
  );

  const onRefresh = useCallback(() => {
    fetchReceipts(true);
  }, [fetchReceipts]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Text style={styles.title}>History</Text>
        <Text style={styles.subtitle}>Saved receipts</Text>
      </View>
      {error && (
        <View style={styles.errorCard}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00d97e" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      ) : receipts.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="receipt-outline" size={48} color="#404040" />
          <Text style={styles.emptyTitle}>No saved receipts</Text>
          <Text style={styles.emptySubtitle}>Scan a receipt on Home and tap Save to history</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#00d97e" />}
        >
          {receipts.map((r) => (
            <Pressable
              key={r.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => setDetail(r)}
            >
              <View style={styles.cardMain}>
                <Text style={styles.cardMerchant} numberOfLines={1}>
                  {r.merchant || "Receipt"}
                </Text>
                <Text style={styles.cardMeta}>
                  {r.date ? formatDate(r.date) : formatDate(r.created_at)}
                  {r.total != null && r.total !== "" && ` · $${r.total}`}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#737373" />
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Modal
        visible={detail != null}
        transparent
        animationType="slide"
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
              {detail && (
                <>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle} numberOfLines={1}>
                      {detail.merchant || "Receipt"}
                    </Text>
                    <Pressable hitSlop={16} onPress={() => setDetail(null)} style={styles.modalClose}>
                      <Ionicons name="close" size={24} color="#737373" />
                    </Pressable>
                  </View>
                  <Text style={styles.modalDate}>
                    {detail.date ? formatDate(detail.date) : formatDate(detail.created_at)}
                    {detail.total != null && detail.total !== "" && ` · Total $${detail.total}`}
                  </Text>
                  <Text style={styles.sectionTitle}>Items</Text>
                  {(detail.items ?? []).map((item, i) => (
                    <View key={i} style={styles.detailRow}>
                      <Text style={styles.detailName} numberOfLines={2}>
                        {item.name}
                      </Text>
                      <Text style={styles.detailPrice}>${item.price}</Text>
                    </View>
                  ))}
                  {detail.members?.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Split</Text>
                      {perPersonTotals(
                        detail.items ?? [],
                        detail.members,
                        (detail.assignments ?? {}) as Record<string, number[]>
                      )
                        .filter((p) => p.amount > 0)
                        .map((p, i) => (
                          <View key={i} style={styles.detailRow}>
                            <Text style={styles.detailName}>{p.name}</Text>
                            <Text style={styles.detailPrice}>${p.amount.toFixed(2)}</Text>
                          </View>
                        ))}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#e5e5e5",
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: "#737373",
  },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  errorCard: {
    marginHorizontal: 20,
    marginBottom: 12,
    padding: 12,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: { color: "#fca5a5", fontSize: 14 },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 15,
    color: "#737373",
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#525252",
    marginTop: 16,
  },
  emptySubtitle: {
    fontSize: 14,
    color: "#737373",
    marginTop: 8,
    textAlign: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardPressed: { opacity: 0.9 },
  cardMain: { flex: 1 },
  cardMerchant: {
    fontSize: 16,
    fontWeight: "600",
    color: "#e5e5e5",
    marginBottom: 4,
  },
  cardMeta: {
    fontSize: 13,
    color: "#737373",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  modalSheet: {
    backgroundColor: "#0a0a0a",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: "85%",
  },
  modalHandle: {
    width: 40,
    height: 4,
    backgroundColor: "#404040",
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 12,
    marginBottom: 8,
  },
  modalScroll: { maxHeight: "100%" },
  modalContent: { padding: 20, paddingBottom: 40 },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  modalTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: "700",
    color: "#e5e5e5",
  },
  modalClose: { padding: 4 },
  modalDate: {
    fontSize: 14,
    color: "#737373",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 8,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  detailName: { flex: 1, fontSize: 15, color: "#e5e5e5", marginRight: 12 },
  detailPrice: { fontSize: 15, fontWeight: "600", color: "#00d97e" },
});
