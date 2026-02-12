import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { OCR_SERVER_URL } from "../config";
import { useAuth } from "../auth-context";

type OcrResponse = {
  extracted?: {
    merchant?: string | null;
    date?: string | null;
    total?: string | null;
    items?: Array<{ name?: string; qty?: number; price?: string }>;
  };
  source?: "vision" | "ocr";
};

type HistoryRow = {
  id: string;
  merchant: string | null;
  date: string | null;
  total: string | null;
  paid: boolean;
  amount_due: string;
};

type HistoryFilter = "all" | "paid" | "unpaid";

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDots, setLoadingDots] = useState("");

  const filteredHistoryRows = useMemo(() => {
    const q = historySearch.trim().toLowerCase();
    return historyRows.filter((row) => {
      if (historyFilter === "paid" && !row.paid) return false;
      if (historyFilter === "unpaid" && row.paid) return false;
      if (!q) return true;
      const merchant = (row.merchant || "").toLowerCase();
      const date = (row.date || "").toLowerCase();
      const total = (row.total || "").toLowerCase();
      return merchant.includes(q) || date.includes(q) || total.includes(q) || row.id.includes(q);
    });
  }, [historyFilter, historyRows, historySearch]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch(`${OCR_SERVER_URL}/receipts`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to fetch history");
      setHistoryRows(Array.isArray(data?.receipts) ? data.receipts : []);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Failed to fetch history");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const deleteHistoryRow = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`${OCR_SERVER_URL}/receipts/${id}`, { method: "DELETE" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Failed to delete receipt");
        setHistoryRows((prev) => prev.filter((row) => row.id !== id));
      } catch (e) {
        setHistoryError(e instanceof Error ? e.message : "Failed to delete receipt");
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
    }, [loadHistory])
  );

  useEffect(() => {
    if (!loading) {
      setLoadingProgress(0);
      setLoadingDots("");
      return;
    }

    const dotTimer = setInterval(() => {
      setLoadingDots((prev) => (prev.length >= 3 ? "" : `${prev}.`));
    }, 350);

    const progressTimer = setInterval(() => {
      setLoadingProgress((prev) => {
        // Fake progressive loading until request completes.
        if (prev >= 94) return prev;
        const step = prev < 40 ? 5 : prev < 70 ? 3 : 1.5;
        return Math.min(94, Number((prev + step).toFixed(1)));
      });
    }, 250);

    return () => {
      clearInterval(dotTimer);
      clearInterval(progressTimer);
    };
  }, [loading]);

  const processPickedImage = async (imageUri: string) => {
    setLoading(true);
    setError(null);
    try {
      const file = new FileSystem.File(imageUri);
      const base64 = await file.base64();
      const res = await fetch(`${OCR_SERVER_URL}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "OCR failed");
      const parsed = data as OcrResponse;
      const extracted = parsed?.extracted ?? {};
      router.push({
        pathname: "/scan-result",
        params: {
          merchant: extracted.merchant ?? "",
          date: extracted.date ?? "",
          total: extracted.total ?? "",
          source: parsed?.source ?? "ocr",
          imageUri,
          items: JSON.stringify(extracted.items ?? []),
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to scan receipt.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const pickFromLibrary = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow photos permission to scan receipts.");
      return;
    }

    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: false,
    });
    if (pick.canceled) return;
    await processPickedImage(pick.assets[0].uri);
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Allow camera permission to take receipt photos.");
      return;
    }

    const capture = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.8,
      base64: false,
    });
    if (capture.canceled) return;
    await processPickedImage(capture.assets[0].uri);
  };

  const onScanPress = () => {
    Alert.alert("Scan Receipt", "Choose image source", [
      { text: "Take Photo", onPress: () => void takePhoto() },
      { text: "Choose from Library", onPress: () => void pickFromLibrary() },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const onManageGroupsPress = () => {
    router.push("/manage-groups");
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingPage} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.loadingCard}>
          <Text style={styles.loadingTitle}>Scanning{loadingDots}</Text>
          <Text style={styles.loadingSubtitle}>Please wait while we process your image.</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${loadingProgress}%` }]} />
          </View>
          <Text style={styles.progressText}>{Math.round(loadingProgress)}%</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.topSection}>
          <View style={styles.topGlow} />
          <Text style={styles.greeting}>Hello</Text>
          <Text style={styles.name}>{user || "User"}</Text>

          <View style={styles.actionCard}>
            <Text style={styles.actionTitle}>Quick Actions</Text>
            <View style={styles.actionsRow}>
              <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]} onPress={onScanPress}>
                <Ionicons name="scan-outline" size={20} color="#0a0a0a" />
                <Text style={styles.actionBtnText}>{loading ? "Scanning..." : "Scan Receipt"}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]} onPress={onManageGroupsPress}>
                <Ionicons name="people-outline" size={20} color="#0a0a0a" />
                <Text style={styles.actionBtnText}>Manage Groups</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionTitle}>History</Text>
            <Pressable onPress={() => void loadHistory()} style={({ pressed }) => [styles.refreshBtn, pressed && styles.actionBtnPressed]}>
              <Text style={styles.refreshBtnText}>Refresh</Text>
            </Pressable>
          </View>
          <TextInput
            value={historySearch}
            onChangeText={setHistorySearch}
            style={styles.searchInput}
            placeholder="Search by merchant, date, total, or id"
            placeholderTextColor="#777"
          />
          <View style={styles.filterRow}>
            {(["all", "paid", "unpaid"] as const).map((filter) => {
              const active = historyFilter === filter;
              return (
                <Pressable
                  key={filter}
                  onPress={() => setHistoryFilter(filter)}
                  style={({ pressed }) => [styles.filterChip, active && styles.filterChipActive, pressed && styles.actionBtnPressed]}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {filter === "all" ? "All" : filter === "paid" ? "Paid" : "Unpaid"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {historyLoading ? <Text style={styles.historyMeta}>Loading history...</Text> : null}
          {historyError ? <Text style={styles.error}>{historyError}</Text> : null}
          {!historyLoading && !filteredHistoryRows.length ? <Text style={styles.historyMeta}>No receipts match your search/filter.</Text> : null}

          {filteredHistoryRows.slice(0, 8).map((row) => (
            <View key={row.id} style={styles.historyCardWrap}>
              <Pressable
                style={({ pressed }) => [styles.historyCard, pressed && styles.actionBtnPressed]}
                onPress={() => router.push({ pathname: "/history/[id]", params: { id: row.id } })}
              >
                <View style={styles.historyTopRow}>
                  <Text style={styles.historyTitle} numberOfLines={1}>{row.merchant || "Unknown Merchant"}</Text>
                  <Text style={[styles.historyStatus, row.paid ? styles.historyStatusPaid : styles.historyStatusUnpaid]}>
                    {row.paid ? "Paid" : "Unpaid"}
                  </Text>
                </View>
                <Text style={styles.historyMeta}>Date: {row.date || "-"}</Text>
                <View style={styles.historyAmountsRow}>
                  <Text style={styles.historySub}>Total: {row.total || "-"}</Text>
                  <Text style={styles.historyDue}>Due: ${row.amount_due}</Text>
                </View>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.binBtn, pressed && styles.actionBtnPressed]}
                onPress={() =>
                  Alert.alert("Delete Receipt", "Delete this history card?", [
                    { text: "Cancel", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => void deleteHistoryRow(row.id) },
                  ])
                }
              >
                <Ionicons name="trash-outline" size={16} color="#fca5a5" />
              </Pressable>
            </View>
          ))}
        </View>

        {error ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Scan Error</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  loadingPage: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  loadingCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 16,
    paddingVertical: 24,
    paddingHorizontal: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#141414",
    alignItems: "center",
  },
  loadingTitle: { color: "#e5e5e5", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  loadingSubtitle: { color: "#a3a3a3", fontSize: 14, textAlign: "center" },
  progressTrack: {
    marginTop: 16,
    width: "100%",
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#8DEB63",
  },
  progressText: {
    marginTop: 8,
    color: "#8DEB63",
    fontSize: 13,
    fontWeight: "700",
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },

  topSection: {
    backgroundColor: "#112416",
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 24,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    overflow: "hidden",
  },
  topGlow: {
    position: "absolute",
    top: -80,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(0,217,126,0.35)",
  },
  greeting: { color: "#b7b7b7", fontSize: 14, marginBottom: 2 },
  name: { color: "#e5e5e5", fontSize: 24, fontWeight: "700", marginBottom: 16 },

  actionCard: {
    backgroundColor: "#8DEB63",
    borderRadius: 18,
    padding: 14,
  },
  actionTitle: { color: "#17301f", fontSize: 15, fontWeight: "600", marginBottom: 12 },
  actionsRow: { flexDirection: "row", gap: 10 },
  actionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#7ddd58",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },
  actionBtnPressed: { opacity: 0.9 },
  actionBtnText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },

  sectionCard: {
    marginTop: 16,
    marginHorizontal: 16,
    borderRadius: 18,
    backgroundColor: "#141414",
    padding: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  searchInput: {
    minHeight: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#101010",
    color: "#e5e5e5",
    fontSize: 13,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  filterRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  filterChip: {
    minHeight: 30,
    borderRadius: 16,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  filterChipActive: {
    borderColor: "#8DEB63",
    backgroundColor: "rgba(141,235,99,0.18)",
  },
  filterChipText: { color: "#bdbdbd", fontSize: 12, fontWeight: "600" },
  filterChipTextActive: { color: "#8DEB63", fontWeight: "700" },
  sectionTitle: { color: "#e5e5e5", fontSize: 20, fontWeight: "700", marginBottom: 10 },
  refreshBtn: {
    minHeight: 30,
    borderRadius: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  refreshBtnText: { color: "#e5e5e5", fontSize: 12, fontWeight: "600" },

  historyCard: {
    borderRadius: 14,
    backgroundColor: "#101010",
    padding: 12,
    paddingRight: 50,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 8,
  },
  historyCardWrap: { position: "relative" },
  binBtn: {
    position: "absolute",
    right: 10,
    bottom: 18,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  historyTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 },
  historyTitle: { color: "#f5f5f5", fontSize: 16, fontWeight: "700", flex: 1 },
  historySub: { color: "#cfcfcf", fontSize: 13, fontWeight: "600" },
  historyMeta: { color: "#8f8f8f", fontSize: 12, marginBottom: 8 },
  historyAmountsRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  historyDue: { color: "#8DEB63", fontSize: 13, fontWeight: "800" },
  historyStatus: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
  historyStatusPaid: { color: "#8DEB63" },
  historyStatusUnpaid: { color: "#fca5a5" },

  error: { color: "#fca5a5" },
});
