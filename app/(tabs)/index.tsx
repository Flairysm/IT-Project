import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { OCR_API_KEY, OCR_SERVER_URL } from "../config";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { CURRENCIES, formatAmount, getCurrency } from "../lib/currency";

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

type OwedToYouItem = { fromUsername: string; amount: number; receiptId: string; merchant: string | null; members: string[] };
type YouOweItem = { toUsername: string; creatorDisplayName: string; amount: number; receiptId: string; merchant: string | null; members: string[] };

function memberInitial(username: string): string {
  const s = (username || "").trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, profile, updateCurrency } = useAuth();
  const displayName = profile?.username ?? user?.email ?? "User";
  const currencyCode = profile?.default_currency ?? "MYR";
  const currentCurrency = getCurrency(currencyCode);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [loadingDots, setLoadingDots] = useState("");
  const [owedToYouBreakdown, setOwedToYouBreakdown] = useState<OwedToYouItem[]>([]);
  const [youOweList, setYouOweList] = useState<YouOweItem[]>([]);
  const [obligationsLoading, setObligationsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settlementAvatarMap, setSettlementAvatarMap] = useState<Record<string, string | null>>({});

  const totalUnpaidToYou = useMemo(() => {
    const sum = historyRows.filter((r) => !r.paid).reduce((acc, r) => acc + parseFloat(r.amount_due || "0") || 0, 0);
    return sum.toFixed(2);
  }, [historyRows]);

  const loadHistory = useCallback(async () => {
    if (!user?.id) {
      setHistoryRows([]);
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const { data: rows, error } = await supabase
        .from("receipts")
        .select("id, merchant, receipt_date, total_amount, paid, split_totals, paid_members")
        .eq("host_id", user.id)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      const list = (rows || []).map((r) => {
        const totalRaw = r.total_amount;
        const splitTotals = Array.isArray(r.split_totals) ? r.split_totals : [];
        const paidMembers = Array.isArray(r.paid_members) ? r.paid_members.map(String) : [];
        let amountDue = "0.00";
        if (r.paid) {
          amountDue = "0.00";
        } else if (splitTotals.length) {
          const unpaid = splitTotals.reduce((sum: number, row: { name?: string; amount?: number }) => {
            const name = String(row?.name ?? "");
            const amount = Number(row?.amount ?? 0) || 0;
            return paidMembers.includes(name) ? sum : sum + amount;
          }, 0);
          amountDue = Math.max(0, unpaid).toFixed(2);
        } else {
          amountDue = totalRaw ? String(parseFloat(totalRaw).toFixed(2)) : "0.00";
        }
        return {
          id: String(r.id),
          merchant: r.merchant ?? null,
          date: r.receipt_date ?? null,
          total: totalRaw ?? null,
          paid: Boolean(r.paid),
          amount_due: amountDue,
        };
      });
      setHistoryRows(list);

      const breakdown: OwedToYouItem[] = [];
      for (const r of rows || []) {
        if (r.paid) continue;
        const paidMembers = Array.isArray(r.paid_members) ? r.paid_members.map(String) : [];
        const splitTotals = Array.isArray(r.split_totals) ? r.split_totals : [];
        const members = (splitTotals as { name?: string }[]).map((s) => String(s?.name ?? "").trim()).filter(Boolean);
        for (const s of splitTotals as { name?: string; amount?: number }[]) {
          const name = String(s?.name ?? "");
          const amount = Number(s?.amount ?? 0) || 0;
          if (paidMembers.includes(name)) continue;
          breakdown.push({ fromUsername: name, amount, receiptId: String(r.id), merchant: r.merchant ?? null, members });
        }
      }
      setOwedToYouBreakdown(breakdown);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Failed to fetch history");
    } finally {
      setHistoryLoading(false);
    }
  }, [user?.id]);

  const loadYouOwe = useCallback(async () => {
    if (!user?.id || !profile?.username) {
      setYouOweList([]);
      return;
    }
    setObligationsLoading(true);
    try {
      const myUsername = profile.username.toLowerCase();
      const { data: receipts } = await supabase
        .from("receipts")
        .select("id, merchant, split_totals, paid_members, host_id")
        .order("created_at", { ascending: false })
        .limit(300);
      const withHostId: { amount: number; receiptId: string; merchant: string | null; hostId: string; members: string[] }[] = [];
      const hostIds = new Set<string>();
      for (const r of receipts || []) {
        if (r.host_id === user.id) continue;
        const paidMembers = Array.isArray(r.paid_members) ? r.paid_members.map(String) : [];
        const splitTotals = Array.isArray(r.split_totals) ? r.split_totals : [];
        const myEntry = (splitTotals as { name?: string; amount?: number }[]).find((s) => String(s?.name ?? "").toLowerCase() === myUsername);
        const paidLower = paidMembers.map((m) => m.toLowerCase());
        if (!myEntry || paidLower.includes(myUsername)) continue;
        const amount = Number(myEntry?.amount ?? 0) || 0;
        const members = (splitTotals as { name?: string }[]).map((s) => String(s?.name ?? "").trim()).filter(Boolean);
        hostIds.add(String(r.host_id));
        withHostId.push({ amount, receiptId: String(r.id), merchant: r.merchant ?? null, hostId: String(r.host_id), members });
      }
      let list: YouOweItem[] = withHostId.map((item) => ({ toUsername: "Unknown", creatorDisplayName: "Unknown", amount: item.amount, receiptId: item.receiptId, merchant: item.merchant, members: item.members }));
      if (hostIds.size > 0) {
        const { data: profiles } = await supabase.from("profiles").select("id, username, display_name").in("id", Array.from(hostIds));
        const byId = Object.fromEntries((profiles || []).map((p) => [String((p as { id: string }).id), p as { username: string; display_name?: string | null }]));
        list = withHostId.map((item) => {
          const p = byId[item.hostId];
          const displayName = (p?.display_name ?? p?.username ?? "Unknown").trim() || "Unknown";
          return {
            toUsername: p?.username ?? "Unknown",
            creatorDisplayName: displayName,
            amount: item.amount,
            receiptId: item.receiptId,
            merchant: item.merchant,
            members: item.members,
          };
        });
      }
      setYouOweList(list);
    } catch {
      setYouOweList([]);
    } finally {
      setObligationsLoading(false);
    }
  }, [user?.id, profile?.username]);

  const totalYouOwe = useMemo(() => youOweList.reduce((s, i) => s + i.amount, 0).toFixed(2), [youOweList]);
  const allSettled = owedToYouBreakdown.length === 0 && youOweList.length === 0;

  useEffect(() => {
    const usernames = [
      ...new Set([
        ...owedToYouBreakdown.flatMap((i) => i.members),
        ...youOweList.flatMap((i) => i.members),
      ].filter(Boolean)),
    ];
    if (usernames.length === 0) {
      setSettlementAvatarMap({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.from("profiles").select("username, avatar_url").in("username", usernames.slice(0, 100));
        if (cancelled) return;
        const map: Record<string, string | null> = {};
        for (const p of data || []) {
          const u = (p as { username?: string }).username;
          if (u) map[u.toLowerCase()] = (p as { avatar_url?: string | null }).avatar_url ?? null;
        }
        setSettlementAvatarMap(map);
      } catch {
        if (!cancelled) setSettlementAvatarMap({});
      }
    })();
    return () => { cancelled = true; };
  }, [owedToYouBreakdown, youOweList]);

  const onRefreshHome = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadHistory(), loadYouOwe()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadHistory, loadYouOwe]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
      void loadYouOwe();
    }, [loadHistory, loadYouOwe])
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
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (OCR_API_KEY) headers["x-api-key"] = OCR_API_KEY;
      const res = await fetch(`${OCR_SERVER_URL}/ocr`, {
        method: "POST",
        headers,
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
      quality: 0.65,
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
      quality: 0.65,
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

  const onAddFriendsPress = () => router.push("/(tabs)/friends");
  const onManualSplitPress = () => router.push({ pathname: "/scan-result", params: { source: "manual" } });

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
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefreshHome} tintColor="#8DEB63" />}
      >
        <View style={styles.topSection}>
          <View style={styles.topGlow} />
          <View style={styles.topHeaderRow}>
            <View>
              <Text style={styles.greeting}>Welcome To EZSplit,</Text>
              <Text style={styles.name}>{displayName}</Text>
            </View>
            <Pressable
              onPress={() => setCurrencyModalVisible(true)}
              style={({ pressed }) => [styles.currencyButton, pressed && styles.actionBtnPressed]}
            >
              <Text style={styles.currencyFlag}>{currentCurrency.flag}</Text>
            </Pressable>
          </View>

          <Pressable
            style={({ pressed }) => [styles.scanReceiptButton, pressed && styles.actionBtnPressed]}
            onPress={onScanPress}
          >
            <Ionicons name="scan-outline" size={36} color="#0a0a0a" />
            <Text style={styles.scanReceiptButtonText}>{loading ? "Scanning..." : "Scan Receipt"}</Text>
          </Pressable>

          <View style={styles.quickActionsRow}>
            <Pressable style={({ pressed }) => [styles.quickActionBtn, pressed && styles.actionBtnPressed]} onPress={onAddFriendsPress}>
              <Ionicons name="person-add-outline" size={20} color="#0a0a0a" />
              <Text style={styles.quickActionBtnText}>Add Friends</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.quickActionBtn, pressed && styles.actionBtnPressed]} onPress={onManualSplitPress}>
              <Ionicons name="create-outline" size={20} color="#0a0a0a" />
              <Text style={styles.quickActionBtnText}>Manual Split</Text>
            </Pressable>
          </View>

          <View style={styles.obligationsCardsRow}>
            <View style={[styles.obligationCard, styles.obligationCardOwedToYou]}>
              <Text style={styles.obligationCardLabel}>You're owed</Text>
              <Text style={styles.obligationCardAmount}>{formatAmount(totalUnpaidToYou, currencyCode)}</Text>
            </View>
            <View style={[styles.obligationCard, styles.obligationCardYouOwe]}>
              <Text style={styles.obligationCardLabel}>You owe</Text>
              <Text style={styles.obligationCardAmountYouOwe}>{formatAmount(totalYouOwe, currencyCode)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Settlements</Text>
          {obligationsLoading ? (
            <Text style={styles.obligationMeta}>Loading...</Text>
          ) : allSettled ? (
            <View style={styles.settledBlock}>
              <Ionicons name="checkmark-circle" size={32} color="#8DEB63" />
              <Text style={styles.settledText}>You're all settled up</Text>
            </View>
          ) : (
            <>
              {owedToYouBreakdown.length > 0 ? (
                <>
                  <Text style={styles.obligationListTitle}>People who owe you</Text>
                  {owedToYouBreakdown.map((item, idx) => (
                    <Pressable
                      key={`${item.receiptId}-${item.fromUsername}-${idx}`}
                      style={({ pressed }) => [styles.obligationRow, styles.obligationRowOwedToYou, pressed && styles.actionBtnPressed]}
                      onPress={() => router.push({ pathname: "/history/[id]", params: { id: item.receiptId } })}
                    >
                      <View style={styles.obligationRowLeft}>
                        <Text style={styles.obligationRowMerchant} numberOfLines={1}>{item.merchant || "Receipt"}</Text>
                        <Text style={styles.obligationRowName} numberOfLines={1}>created by {profile?.display_name?.trim() || profile?.username || "You"}</Text>
                        {item.members.length > 0 ? (
                          <View style={styles.settlementAvatarsRow}>
                            {item.members.slice(0, 7).map((m, i) => (
                              <View key={`${item.receiptId}-${m}-${i}`} style={[styles.settlementAvatar, { marginLeft: i === 0 ? 0 : -6 }]}>
                                {settlementAvatarMap[m.toLowerCase()] ? (
                                  <Image source={{ uri: settlementAvatarMap[m.toLowerCase()]! }} style={styles.settlementAvatarImg} />
                                ) : (
                                  <View style={styles.settlementAvatarPlaceholder}>
                                    <Text style={styles.settlementAvatarText}>{memberInitial(m)}</Text>
                                  </View>
                                )}
                              </View>
                            ))}
                            {item.members.length > 7 ? (
                              <View style={[styles.settlementAvatar, styles.settlementAvatarMore, { marginLeft: -6 }]}>
                                <Text style={styles.settlementAvatarMoreText}>+{item.members.length - 7}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.obligationRowRight}>
                        <Text style={styles.obligationRowAmount}>{formatAmount(item.amount, currencyCode)}</Text>
                        <Ionicons name="chevron-forward" size={18} color="#737373" />
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}
              {youOweList.length > 0 ? (
                <>
                  <Text style={[styles.obligationListTitle, { marginTop: owedToYouBreakdown.length > 0 ? 14 : 0 }]}>You owe</Text>
                  {youOweList.map((item, idx) => (
                    <Pressable
                      key={`${item.receiptId}-${idx}`}
                      style={({ pressed }) => [styles.obligationRow, styles.obligationRowYouOwe, pressed && styles.actionBtnPressed]}
                      onPress={() => router.push({ pathname: "/history/[id]", params: { id: item.receiptId } })}
                    >
                      <View style={styles.obligationRowLeft}>
                        <Text style={styles.obligationRowMerchant} numberOfLines={1}>{item.merchant || "Receipt"}</Text>
                        <Text style={styles.obligationRowName} numberOfLines={1}>created by {item.creatorDisplayName}</Text>
                        {item.members.length > 0 ? (
                          <View style={styles.settlementAvatarsRow}>
                            {item.members.slice(0, 7).map((m, i) => (
                              <View key={`${item.receiptId}-${m}-${i}`} style={[styles.settlementAvatar, { marginLeft: i === 0 ? 0 : -6 }]}>
                                {settlementAvatarMap[m.toLowerCase()] ? (
                                  <Image source={{ uri: settlementAvatarMap[m.toLowerCase()]! }} style={styles.settlementAvatarImg} />
                                ) : (
                                  <View style={styles.settlementAvatarPlaceholder}>
                                    <Text style={styles.settlementAvatarText}>{memberInitial(m)}</Text>
                                  </View>
                                )}
                              </View>
                            ))}
                            {item.members.length > 7 ? (
                              <View style={[styles.settlementAvatar, styles.settlementAvatarMore, { marginLeft: -6 }]}>
                                <Text style={styles.settlementAvatarMoreText}>+{item.members.length - 7}</Text>
                              </View>
                            ) : null}
                          </View>
                        ) : null}
                      </View>
                      <View style={styles.obligationRowRight}>
                        <Text style={styles.obligationRowAmountYouOwe}>{formatAmount(item.amount, currencyCode)}</Text>
                        <Ionicons name="chevron-forward" size={18} color="#737373" />
                      </View>
                    </Pressable>
                  ))}
                </>
              ) : null}
            </>
          )}
        </View>

        {error ? (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>Scan Error</Text>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>

      <Modal transparent visible={currencyModalVisible} animationType="fade" onRequestClose={() => setCurrencyModalVisible(false)}>
        <Pressable style={styles.currencyModalBackdrop} onPress={() => setCurrencyModalVisible(false)}>
          <Pressable style={styles.currencyModalCard} onPress={() => {}}>
            <Text style={styles.currencyModalTitle}>CURRENCY</Text>
            <Text style={styles.currencyModalSubtitle}>Select Your Currency</Text>
            {CURRENCIES.map((c) => (
              <Pressable
                key={c.code}
                onPress={() => {
                  void updateCurrency(c.code);
                  setCurrencyModalVisible(false);
                }}
                style={({ pressed }) => [styles.currencyRow, c.code === currencyCode && styles.currencyRowActive, pressed && styles.actionBtnPressed]}
              >
                <Text style={styles.currencyRowFlag}>{c.flag}</Text>
                <View style={styles.currencyRowText}>
                  <Text style={styles.currencyRowLabel}>{c.label}</Text>
                  <Text style={styles.currencyRowSymbol}>{c.symbol}</Text>
                </View>
                {c.code === currencyCode ? <Text style={styles.currencyRowCheck}>✓</Text> : null}
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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
  topHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  greeting: { color: "#b7b7b7", fontSize: 14, marginBottom: 2 },
  name: { color: "#e5e5e5", fontSize: 24, fontWeight: "700" },
  currencyButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  currencyFlag: { fontSize: 36, lineHeight: 44 },
  currencyModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  currencyModalCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    padding: 16,
  },
  currencyModalTitle: { color: "#e5e5e5", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  currencyModalSubtitle: { color: "#a3a3a3", fontSize: 12, marginBottom: 14 },
  currencyRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginBottom: 4,
    gap: 12,
  },
  currencyRowActive: {
    backgroundColor: "rgba(141,235,99,0.15)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.3)",
  },
  currencyRowFlag: { fontSize: 24 },
  currencyRowText: { flex: 1 },
  currencyRowLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  currencyRowSymbol: { color: "#a3a3a3", fontSize: 12, marginTop: 2 },
  currencyRowCheck: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },

  obligationsCardsRow: { flexDirection: "row", gap: 10, marginTop: 12, marginBottom: 4 },
  obligationCard: { flex: 1, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  obligationCardOwedToYou: { borderColor: "rgba(141,235,99,0.35)", backgroundColor: "rgba(141,235,99,0.12)" },
  obligationCardYouOwe: { borderColor: "rgba(251,191,36,0.4)", backgroundColor: "rgba(251,191,36,0.1)" },
  obligationCardLabel: { color: "#a3a3a3", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4 },
  obligationCardAmount: { color: "#8DEB63", fontSize: 18, fontWeight: "800", marginTop: 4 },
  obligationCardAmountYouOwe: { color: "#fbbf24", fontSize: 18, fontWeight: "800", marginTop: 4 },
  obligationListTitle: { color: "#a3a3a3", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 8 },
  obligationMeta: { color: "#737373", fontSize: 14, marginBottom: 10 },
  obligationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
  },
  obligationRowOwedToYou: { backgroundColor: "rgba(141,235,99,0.08)", borderWidth: 1, borderColor: "rgba(141,235,99,0.25)" },
  obligationRowYouOwe: { backgroundColor: "rgba(251,191,36,0.06)", borderWidth: 1, borderColor: "rgba(251,191,36,0.15)" },
  obligationRowLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  obligationRowMerchant: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 4 },
  obligationRowName: { color: "#a3a3a3", fontSize: 15, fontWeight: "500", marginBottom: 6 },
  settlementAvatarsRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap" },
  settlementAvatar: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#141414",
    overflow: "hidden",
  },
  settlementAvatarImg: { width: "100%", height: "100%" },
  settlementAvatarPlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(141,235,99,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  settlementAvatarText: { color: "#8DEB63", fontSize: 10, fontWeight: "700" },
  settlementAvatarMore: {
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  settlementAvatarMoreText: { color: "#a3a3a3", fontSize: 10, fontWeight: "700" },
  obligationRowRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  obligationRowAmount: { color: "#8DEB63", fontSize: 15, fontWeight: "700" },
  obligationRowAmountYouOwe: { color: "#fbbf24", fontSize: 15, fontWeight: "700" },
  settledBlock: { alignItems: "center", paddingVertical: 24, gap: 8 },
  settledText: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  scanReceiptButton: {
    minHeight: 72,
    borderRadius: 18,
    backgroundColor: "#8DEB63",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 12,
    marginBottom: 4,
  },
  scanReceiptButtonText: { color: "#0a0a0a", fontSize: 20, fontWeight: "800" },
  quickActionsRow: { flexDirection: "row", gap: 10, marginTop: 10, marginBottom: 4 },
  quickActionBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
  },
  quickActionBtnText: { color: "#e5e5e5", fontSize: 14, fontWeight: "700" },
  actionBtnPressed: { opacity: 0.9 },

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
  error: { color: "#fca5a5" },
});
