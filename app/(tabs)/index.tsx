import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Image as RNImage, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { OCR_API_KEY, OCR_SERVER_URL } from "../config";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { useAuth } from "../auth-context";
import { supabase } from "../lib/supabase";
import { CURRENCIES, formatAmount, getCurrency } from "../lib/currency";
import { checkRateLimit, RATE_LIMIT } from "../lib/rateLimit";
import { SubscriptionDiamond } from "../components/SubscriptionDiamond";
import { QUICK_SPLIT_CATEGORIES, SCAN_RECEIPT_CATEGORIES, type QuickSplitCategory } from "../lib/quickSplitCategories";
import { computeSettleUp } from "../lib/expenseSettleUp";

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

type OwedToYouItem = { fromUsername: string; amount: number; receiptId: string; merchant: string | null; date: string | null; members: string[]; tripGroupId?: string; category?: string; _fromUserId?: string; _fromUsernameKey?: string; _hostUsernameKey?: string; createdBy?: string };
type YouOweItem = { toUsername: string; creatorDisplayName: string; amount: number; receiptId: string; merchant: string | null; date: string | null; members: string[]; tripGroupId?: string; category?: string; _toUserId?: string; _toUsernameKey?: string; _hostUsernameKey?: string; createdBy?: string };

function formatSettlementDate(dateStr: string | null): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function memberInitial(username: string): string {
  const s = (username || "").trim();
  if (!s) return "?";
  return s.charAt(0).toUpperCase();
}

function getCategoryIcon(category: string | undefined): keyof typeof Ionicons.glyphMap {
  const cat = category ?? "others";
  const found = QUICK_SPLIT_CATEGORIES.find((c) => c.id === cat);
  return found?.icon ?? "ellipsis-horizontal-circle-outline";
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, profile, updateCurrency } = useAuth();
  const displayName = profile?.username ?? user?.email ?? "User";
  const currencyCode = profile?.default_currency ?? "MYR";
  const currentCurrency = getCurrency(currencyCode);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [scanCategoryModalVisible, setScanCategoryModalVisible] = useState(false);
  const [pendingScanCategory, setPendingScanCategory] = useState<QuickSplitCategory | null>(null);
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
  const [tripOwedToMe, setTripOwedToMe] = useState<OwedToYouItem[]>([]);
  const [tripIOwe, setTripIOwe] = useState<YouOweItem[]>([]);
  type SettlementCategory = "all" | "restaurant" | "travel" | "groceries" | "business" | "others";
  const [settlementTab, setSettlementTab] = useState<SettlementCategory>("all");

  const totalUnpaidToYou = useMemo(() => {
    const inc = (key: "restaurant" | "travel" | "groceries" | "business" | "others") => profile?.[`owed_include_${key}` as keyof typeof profile] !== false;
    let sum = 0;
    if (inc("restaurant")) sum += owedToYouBreakdown.filter((i) => i.category === "restaurant").reduce((a, i) => a + i.amount, 0) + tripOwedToMe.filter((t) => t.category === "restaurant").reduce((a, t) => a + t.amount, 0);
    if (inc("travel")) sum += tripOwedToMe.filter((t) => t.category === "travel").reduce((a, t) => a + t.amount, 0);
    if (inc("groceries")) sum += owedToYouBreakdown.filter((i) => i.category === "groceries").reduce((a, i) => a + i.amount, 0);
    if (inc("business")) sum += tripOwedToMe.filter((t) => t.category === "business").reduce((a, t) => a + t.amount, 0);
    if (inc("others")) sum += owedToYouBreakdown.filter((i) => i.category === "others" || !i.category).reduce((a, i) => a + i.amount, 0);
    return sum.toFixed(2);
  }, [owedToYouBreakdown, tripOwedToMe, profile?.owed_include_restaurant, profile?.owed_include_travel, profile?.owed_include_groceries, profile?.owed_include_business, profile?.owed_include_others]);

  const totalYouOwe = useMemo(
    () => (youOweList.reduce((s, i) => s + i.amount, 0) + tripIOwe.reduce((s, i) => s + i.amount, 0)).toFixed(2),
    [youOweList, tripIOwe]
  );

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
        .select("id, merchant, receipt_date, created_at, total_amount, paid, split_totals, paid_members, category")
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
          breakdown.push({ fromUsername: name, amount, receiptId: String(r.id), merchant: r.merchant ?? null, date: r.created_at ?? null, members, category: (r as { category?: string }).category ?? "others", createdBy: undefined });
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
        .select("id, merchant, created_at, split_totals, paid_members, host_id, category")
        .order("created_at", { ascending: false })
        .limit(300);
      const withHostId: { amount: number; receiptId: string; merchant: string | null; date: string | null; hostId: string; members: string[]; category: string }[] = [];
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
        withHostId.push({ amount, receiptId: String(r.id), merchant: r.merchant ?? null, date: r.created_at ?? null, hostId: String(r.host_id), members, category: (r as { category?: string }).category ?? "others" });
      }
      let list: YouOweItem[] = withHostId.map((item) => ({ toUsername: "Unknown", creatorDisplayName: "Unknown", amount: item.amount, receiptId: item.receiptId, merchant: item.merchant, date: item.date, members: item.members, category: item.category }));
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
            date: item.date,
            members: item.members,
            category: item.category,
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

  const allSettled = owedToYouBreakdown.length === 0 && youOweList.length === 0 && tripOwedToMe.length === 0 && tripIOwe.length === 0;

  const owedFiltered = useMemo(
    () => [...owedToYouBreakdown, ...tripOwedToMe].filter((item) => {
      if (settlementTab === "all") return true;
      const cat = item.category ?? "others";
      return cat === settlementTab;
    }),
    [owedToYouBreakdown, tripOwedToMe, settlementTab]
  );
  const youOweFiltered = useMemo(
    () => [...youOweList, ...tripIOwe].filter((item) => {
      if (settlementTab === "all") return true;
      const cat = item.category ?? "others";
      return cat === settlementTab;
    }),
    [youOweList, tripIOwe, settlementTab]
  );

  const loadTripObligations = useCallback(async () => {
    if (!user?.id) {
      setTripOwedToMe([]);
      setTripIOwe([]);
      return;
    }
    try {
      const { data: groups, error: eg } = await supabase.from("expense_groups").select("id, name, category, created_at, host_id").order("created_at", { ascending: false });
      if (eg || !groups?.length) {
        setTripOwedToMe([]);
        setTripIOwe([]);
        return;
      }
      const groupIds = (groups as { id: string }[]).map((g) => g.id);
      const { data: entries } = await supabase.from("expense_entries").select("group_id, paid_by, amount, split_among, settled, split_percentages").in("group_id", groupIds);
      const { data: mems } = await supabase.from("expense_group_members").select("group_id, user_id").in("group_id", groupIds);

      const membersByGroup: Record<string, string[]> = {};
      const entriesByGroup: Record<string, { paid_by: string; amount: number; split_among: string[]; split_percentages?: Record<string, number> | null }[]> = {};
      for (const id of groupIds) {
        membersByGroup[id] = [];
        entriesByGroup[id] = [];
      }
      for (const m of mems ?? []) {
        const gid = (m as { group_id: string }).group_id;
        const uid = (m as { user_id: string }).user_id;
        if (membersByGroup[gid]) membersByGroup[gid].push(uid);
      }
      for (const e of entries ?? []) {
        const gid = (e as { group_id: string }).group_id;
        const row = e as { paid_by: string; amount: number; split_among: string[]; settled?: boolean; split_percentages?: Record<string, number> | null };
        if (row.settled) continue;
        if (entriesByGroup[gid]) entriesByGroup[gid].push({ paid_by: row.paid_by, amount: Number(row.amount), split_among: Array.isArray(row.split_among) ? row.split_among : [], split_percentages: row.split_percentages ?? null });
      }

      const owedToMe: OwedToYouItem[] = [];
      const iOwe: YouOweItem[] = [];
      const userIdsToResolve = new Set<string>();
      const hostIds = new Set<string>();
      for (const gr of groups as { host_id?: string }[]) {
        if (gr.host_id) hostIds.add(gr.host_id);
      }
      let hostProfiles: Record<string, { username: string; display_name: string | null }> = {};
      if (hostIds.size > 0) {
        const { data: hostProfs } = await supabase.from("profiles").select("id, username, display_name").in("id", [...hostIds]);
        hostProfiles = Object.fromEntries((hostProfs ?? []).map((p: { id: string; username: string; display_name?: string | null }) => [p.id, { username: p.username, display_name: p.display_name ?? null }]));
      }
      const getHostCreatedBy = (gr: { host_id?: string }) => {
        if (!gr.host_id) return "—";
        const p = hostProfiles[gr.host_id];
        return p?.display_name?.trim() || p?.username || "—";
      };

      for (const g of groups as { id: string; name: string; category: string; created_at: string; host_id?: string }[]) {
        const memberIds = membersByGroup[g.id] ?? [];
        if (memberIds.length === 0) continue;
        const groupEntries = entriesByGroup[g.id] ?? [];
        const settleUp = computeSettleUp(memberIds, groupEntries);
        const hostCreatedBy = getHostCreatedBy(g);
        const hostUsername = g.host_id ? hostProfiles[g.host_id]?.username : undefined;
        for (const line of settleUp) {
          if (line.to === user.id) {
            userIdsToResolve.add(line.from);
            owedToMe.push({
              fromUsername: "?",
              amount: line.amount,
              receiptId: g.id,
              merchant: g.name,
              date: g.created_at,
              members: [],
              tripGroupId: g.id,
              category: g.category ?? "travel",
              _fromUserId: line.from,
              createdBy: hostCreatedBy,
              _hostUsernameKey: hostUsername,
            });
          } else if (line.from === user.id) {
            userIdsToResolve.add(line.to);
            iOwe.push({
              toUsername: "?",
              creatorDisplayName: "?",
              amount: line.amount,
              receiptId: g.id,
              merchant: g.name,
              date: g.created_at,
              members: [],
              tripGroupId: g.id,
              category: g.category ?? "travel",
              _toUserId: line.to,
              createdBy: hostCreatedBy,
              _hostUsernameKey: hostUsername,
            });
          }
        }
      }

      if (userIdsToResolve.size > 0) {
        const { data: profs } = await supabase.from("profiles").select("id, username, display_name").in("id", [...userIdsToResolve]);
        const byId = Object.fromEntries((profs ?? []).map((p: { id: string; username: string; display_name?: string | null }) => [p.id, { username: p.username, display_name: p.display_name ?? null }]));
        for (const item of owedToMe) {
          const id = (item as OwedToYouItem & { _fromUserId?: string })._fromUserId;
          if (id) {
            const p = byId[id] as { username: string; display_name: string | null } | undefined;
            item.fromUsername = p?.display_name?.trim() || p?.username || "?";
            item._fromUsernameKey = p?.username;
          }
        }
        for (const item of iOwe) {
          const id = (item as YouOweItem & { _toUserId?: string })._toUserId;
          if (id) {
            const p = byId[id] as { username: string; display_name: string | null } | undefined;
            item.toUsername = p?.display_name?.trim() || p?.username || "?";
            item.creatorDisplayName = item.toUsername;
            item._toUsernameKey = p?.username;
          }
        }
      }

      setTripOwedToMe(owedToMe);
      setTripIOwe(iOwe);
    } catch {
      setTripOwedToMe([]);
      setTripIOwe([]);
    }
  }, [user?.id]);

  useEffect(() => {
    const usernames = [
      ...new Set([
        ...owedToYouBreakdown.flatMap((i) => i.members),
        ...youOweList.flatMap((i) => i.members),
        ...tripOwedToMe.map((i) => (i as OwedToYouItem & { _fromUsernameKey?: string })._fromUsernameKey).filter(Boolean) as string[],
        ...tripOwedToMe.map((i) => (i as OwedToYouItem & { _hostUsernameKey?: string })._hostUsernameKey).filter(Boolean) as string[],
        ...tripIOwe.map((i) => (i as YouOweItem & { _toUsernameKey?: string })._toUsernameKey).filter(Boolean) as string[],
        ...tripIOwe.map((i) => (i as YouOweItem & { _hostUsernameKey?: string })._hostUsernameKey).filter(Boolean) as string[],
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
  }, [owedToYouBreakdown, youOweList, tripOwedToMe, tripIOwe]);

  const onRefreshHome = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([loadHistory(), loadYouOwe(), loadTripObligations()]);
    } finally {
      setRefreshing(false);
    }
  }, [loadHistory, loadYouOwe, loadTripObligations]);

  useFocusEffect(
    useCallback(() => {
      void loadHistory();
      void loadYouOwe();
      void loadTripObligations();
    }, [loadHistory, loadYouOwe, loadTripObligations])
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
    if (!checkRateLimit("scan", RATE_LIMIT.scan)) {
      setError("Please wait a few seconds before scanning again.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Resize and compress on device for faster upload and server processing (target 5–10s)
      const maxPx = 1024;
      const getSize = (): Promise<{ width: number; height: number }> =>
        new Promise((resolve, reject) => {
          RNImage.getSize(imageUri, (w, h) => resolve({ width: w, height: h }), reject);
        });
      const { width, height } = await getSize();
      const actions: ImageManipulator.Action[] =
        Math.max(width, height) > maxPx
          ? [{ resize: { width: Math.round((width * maxPx) / Math.max(width, height)), height: Math.round((height * maxPx) / Math.max(width, height)) } }]
          : [];
      const manipulated = await ImageManipulator.manipulateAsync(imageUri, actions, {
        compress: 0.65,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
      });
      const base64 = manipulated.base64 ?? (await new FileSystem.File(manipulated.uri).base64());

      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (OCR_API_KEY) headers["x-api-key"] = OCR_API_KEY;
      const res = await fetchWithTimeout(`${OCR_SERVER_URL}/ocr`, {
        method: "POST",
        headers,
        body: JSON.stringify({ imageBase64: base64 }),
        timeoutMs: 90000,
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
          category: pendingScanCategory ?? "others",
        },
      });
      setPendingScanCategory(null);
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
    setScanCategoryModalVisible(true);
  };

  const onScanCategorySelected = (category: QuickSplitCategory) => {
    setPendingScanCategory(category);
    setScanCategoryModalVisible(false);
    Alert.alert("Scan Receipt", "Choose image source", [
      { text: "Take Photo", onPress: () => void takePhoto() },
      { text: "Choose from Library", onPress: () => void pickFromLibrary() },
      { text: "Cancel", style: "cancel", onPress: () => setPendingScanCategory(null) },
    ]);
  };

  const onAddFriendsPress = () => router.push("/(tabs)/friends");
  const onQuickSplitPress = () => router.push("/quick-split");

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
            <View style={styles.topHeaderLeft}>
              <Text style={styles.greeting}>Welcome To EZSplit,</Text>
              <Text style={styles.name}>{displayName}</Text>
              <Pressable onPress={() => setCurrencyModalVisible(true)} style={({ pressed }) => [styles.currencyChip, pressed && styles.actionBtnPressed]}>
                <Text style={styles.currencyChipText}>{currentCurrency.flag} {currentCurrency.symbol}</Text>
              </Pressable>
            </View>
            <SubscriptionDiamond />
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
            <Pressable style={({ pressed }) => [styles.quickActionBtn, pressed && styles.actionBtnPressed]} onPress={onQuickSplitPress}>
              <Ionicons name="create-outline" size={20} color="#0a0a0a" />
              <Text style={styles.quickActionBtnText}>Quick Split</Text>
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
              <View style={styles.settlementTabRow}>
                <Pressable style={[styles.settlementTab, settlementTab === "all" && styles.settlementTabActive]} onPress={() => setSettlementTab("all")}>
                  <Ionicons name="apps-outline" size={16} color={settlementTab === "all" ? "#8DEB63" : "#737373"} />
                  <Text style={[styles.settlementTabText, settlementTab === "all" && styles.settlementTabTextActive]}>All</Text>
                </Pressable>
                {QUICK_SPLIT_CATEGORIES.map((cat) => (
                  <Pressable key={cat.id} style={[styles.settlementTab, settlementTab === cat.id && styles.settlementTabActive]} onPress={() => setSettlementTab(cat.id)}>
                    <Ionicons name={cat.icon} size={16} color={settlementTab === cat.id ? "#8DEB63" : "#737373"} />
                    <Text style={[styles.settlementTabText, settlementTab === cat.id && styles.settlementTabTextActive]} numberOfLines={1}>{cat.label}</Text>
                  </Pressable>
                ))}
              </View>
              {owedFiltered.length > 0 ? (
                <>
                  <Text style={styles.obligationListTitle}>People who owe you</Text>
                  {owedFiltered.map((item, idx) => {
                    const createdByText = item.tripGroupId ? (item.createdBy ?? "—") : (profile?.display_name?.trim() || profile?.username || "You");
                    const avatarKeys = item.tripGroupId
                      ? [...new Set([item._fromUsernameKey, item._hostUsernameKey].filter(Boolean) as string[])]
                      : [...new Set([...item.members, profile?.username].filter(Boolean) as string[])];
                    return (
                    <Pressable
                      key={item.tripGroupId ? `trip-${item.tripGroupId}-${item.fromUsername}-${idx}` : `${item.receiptId}-${item.fromUsername}-${idx}`}
                      style={({ pressed }) => [styles.obligationRow, styles.obligationRowOwedToYou, pressed && styles.actionBtnPressed]}
                      onPress={() => {
                        if (item.tripGroupId && item.category) {
                          router.push({ pathname: "/expense-group", params: { groupId: item.tripGroupId, category: item.category } });
                        } else {
                          router.push({ pathname: "/history/[id]", params: { id: item.receiptId } });
                        }
                      }}
                    >
                      <View style={styles.obligationRowIconWrap}>
                        <Ionicons name={getCategoryIcon(item.category)} size={22} color="#8DEB63" />
                      </View>
                      <View style={styles.obligationRowLeft}>
                        <Text style={styles.obligationRowMerchant} numberOfLines={1}>{item.merchant || "Receipt"}</Text>
                        {formatSettlementDate(item.date) ? (
                          <Text style={styles.obligationRowDate}>{formatSettlementDate(item.date)}</Text>
                        ) : null}
                        <Text style={styles.obligationRowCreatedBy}>Created by {createdByText}</Text>
                        {avatarKeys.length > 0 ? (
                          <View style={styles.settlementAvatarsRow}>
                            {avatarKeys.slice(0, 7).map((m, i) => (
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
                            {avatarKeys.length > 7 ? (
                              <View style={[styles.settlementAvatar, styles.settlementAvatarMore, { marginLeft: -6 }]}>
                                <Text style={styles.settlementAvatarMoreText}>+{avatarKeys.length - 7}</Text>
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
                  ); })}
                </>
              ) : null}
              {youOweFiltered.length > 0 ? (
                <>
                  <Text style={[styles.obligationListTitle, { marginTop: owedFiltered.length > 0 ? 14 : 0 }]}>You owe</Text>
                  {youOweFiltered.map((item, idx) => {
                    const createdByText = item.createdBy ?? item.creatorDisplayName;
                    const avatarKeys = item.tripGroupId
                      ? [...new Set([item._toUsernameKey, item._hostUsernameKey].filter(Boolean) as string[])]
                      : [...new Set([...item.members, item.toUsername].filter(Boolean) as string[])];
                    return (
                    <Pressable
                      key={item.tripGroupId ? `trip-${item.tripGroupId}-${idx}` : `receipt-${item.receiptId}-${idx}`}
                      style={({ pressed }) => [styles.obligationRow, styles.obligationRowYouOwe, pressed && styles.actionBtnPressed]}
                      onPress={() => {
                        if (item.tripGroupId && item.category) {
                          router.push({ pathname: "/expense-group", params: { groupId: item.tripGroupId, category: item.category } });
                        } else {
                          router.push({ pathname: "/history/[id]", params: { id: item.receiptId } });
                        }
                      }}
                    >
                      <View style={styles.obligationRowIconWrap}>
                        <Ionicons name={getCategoryIcon(item.category)} size={22} color="#fbbf24" />
                      </View>
                      <View style={styles.obligationRowLeft}>
                        <Text style={styles.obligationRowMerchant} numberOfLines={1}>{item.merchant || "Receipt"}</Text>
                        {formatSettlementDate(item.date) ? (
                          <Text style={styles.obligationRowDate}>{formatSettlementDate(item.date)}</Text>
                        ) : null}
                        <Text style={styles.obligationRowCreatedBy}>Created by {createdByText}</Text>
                        {avatarKeys.length > 0 ? (
                          <View style={styles.settlementAvatarsRow}>
                            {avatarKeys.slice(0, 7).map((m, i) => (
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
                            {avatarKeys.length > 7 ? (
                              <View style={[styles.settlementAvatar, styles.settlementAvatarMore, { marginLeft: -6 }]}>
                                <Text style={styles.settlementAvatarMoreText}>+{avatarKeys.length - 7}</Text>
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
                  ); })}
                </>
              ) : null}
              {owedFiltered.length === 0 && youOweFiltered.length === 0 && !allSettled ? (
                <Text style={styles.obligationMeta}>No obligations in this category</Text>
              ) : null}
            </>
          )}
        </View>

        {error ? (
          <View style={styles.sectionCard}>
            <View style={styles.errorHeaderRow}>
              <Ionicons name="warning-outline" size={20} color="#fca5a5" />
              <Text style={styles.errorCardTitle}>Something went wrong</Text>
              <Pressable onPress={() => setError(null)} style={({ pressed }) => [styles.errorDismissBtn, pressed && styles.actionBtnPressed]}>
                <Ionicons name="close" size={22} color="#a3a3a3" />
              </Pressable>
            </View>
            <Text style={styles.error}>{error}</Text>
            <Pressable onPress={() => setError(null)} style={({ pressed }) => [styles.errorTryAgainBtn, pressed && styles.actionBtnPressed]}>
              <Text style={styles.errorTryAgainText}>Dismiss</Text>
            </Pressable>
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

      <Modal transparent visible={scanCategoryModalVisible} animationType="fade" onRequestClose={() => setScanCategoryModalVisible(false)}>
        <Pressable style={styles.currencyModalBackdrop} onPress={() => setScanCategoryModalVisible(false)}>
          <Pressable style={styles.currencyModalCard} onPress={() => {}}>
            <Text style={styles.currencyModalTitle}>SCAN RECEIPT</Text>
            <Text style={styles.currencyModalSubtitle}>Restaurant or groceries only. For trips or business, use Quick Split.</Text>
            {SCAN_RECEIPT_CATEGORIES.map((cat) => (
              <Pressable
                key={cat.id}
                onPress={() => onScanCategorySelected(cat.id)}
                style={({ pressed }) => [styles.scanCategoryRow, pressed && styles.actionBtnPressed]}
              >
                <View style={styles.scanCategoryIconWrap}>
                  <Ionicons name={cat.icon} size={22} color="#8DEB63" />
                </View>
                <View style={styles.scanCategoryText}>
                  <Text style={styles.scanCategoryLabel}>{cat.label}</Text>
                  <Text style={styles.scanCategorySub}>{cat.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#737373" />
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
  topHeaderLeft: { flex: 1, minWidth: 0 },
  greeting: { color: "#b7b7b7", fontSize: 14, marginBottom: 2 },
  name: { color: "#e5e5e5", fontSize: 24, fontWeight: "700", marginBottom: 4 },
  currencyChip: {
    alignSelf: "flex-start",
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  currencyChipText: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
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
  scanCategoryRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
  },
  scanCategoryIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "rgba(141,235,99,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  scanCategoryText: { flex: 1 },
  scanCategoryLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  scanCategorySub: { color: "#a3a3a3", fontSize: 12, marginTop: 2 },

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
  obligationRowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  obligationRowLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  obligationRowMerchant: { color: "#fff", fontSize: 17, fontWeight: "700", marginBottom: 2 },
  obligationRowDate: { color: "#737373", fontSize: 13, marginBottom: 2 },
  obligationRowCreatedBy: { color: "#737373", fontSize: 12, marginBottom: 2 },
  obligationRowName: { color: "#a3a3a3", fontSize: 15, fontWeight: "500", marginBottom: 4 },
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
  settlementTabRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 14 },
  settlementTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  settlementTabActive: { backgroundColor: "rgba(141,235,99,0.15)", borderColor: "rgba(141,235,99,0.35)" },
  settlementTabText: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", maxWidth: 72 },
  settlementTabTextActive: { color: "#8DEB63", fontWeight: "700" },
  error: { color: "#fca5a5", marginBottom: 12 },
  errorCardTitle: { color: "#e5e5e5", fontSize: 16, fontWeight: "700", flex: 1 },
  errorHeaderRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  errorDismissBtn: { marginLeft: "auto", padding: 4 },
  errorTryAgainBtn: { alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  errorTryAgainText: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
});
