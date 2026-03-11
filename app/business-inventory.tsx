import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter, Redirect } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";
import { formatAmount, getCurrency } from "./lib/currency";

type Batch = { id: string; name: string; created_at: string };
type BusinessItem = {
  id: string;
  batch_id: string;
  item_name: string;
  set_name: string | null;
  item_date: string | null;
  remarks: string | null;
  purchase_price: number;
  currency: string;
  sold_price: number | null;
  sold_at: string | null;
  created_at: string;
  batch_name?: string;
};

type TabId = "inventory" | "profits" | "logs";
type LogFilterId = "all" | "added" | "sold" | "expense" | "income";

type LedgerEntry = {
  id: string;
  batch_id: string;
  type: "expense" | "income";
  amount: number;
  currency: string;
  description: string | null;
  date: string;
  created_at: string;
};

export default function BusinessInventoryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ batchId?: string; projectId?: string }>();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";

  const [batches, setBatches] = useState<Batch[]>([]);
  const [items, setItems] = useState<BusinessItem[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("inventory");
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(params.batchId ?? null);

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [soldModalVisible, setSoldModalVisible] = useState(false);
  const [datePickerVisible, setDatePickerVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [profitSearchQuery, setProfitSearchQuery] = useState("");
  const [logFilter, setLogFilter] = useState<LogFilterId>("all");

  const [itemName, setItemName] = useState("");
  const [setName, setSetName] = useState("");
  const [itemDate, setItemDate] = useState("");
  const [remarks, setRemarks] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [soldPrice, setSoldPrice] = useState("");
  const [soldAtDate, setSoldAtDate] = useState("");
  const [soldDatePickerVisible, setSoldDatePickerVisible] = useState(false);
  const [soldItem, setSoldItem] = useState<BusinessItem | null>(null);
  const [editSoldVisible, setEditSoldVisible] = useState(false);
  const [editSoldItem, setEditSoldItem] = useState<BusinessItem | null>(null);
  const [editSoldPrice, setEditSoldPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [batchSettingsVisible, setBatchSettingsVisible] = useState(false);
  const [batchEditName, setBatchEditName] = useState("");
  const [deletingBatch, setDeletingBatch] = useState(false);
  const [isHost, setIsHost] = useState(true);

  const [ledgerModalVisible, setLedgerModalVisible] = useState(false);
  const [editLedgerEntry, setEditLedgerEntry] = useState<LedgerEntry | null>(null);
  const [ledgerType, setLedgerType] = useState<"expense" | "income">("expense");
  const [ledgerAmount, setLedgerAmount] = useState("");
  const [ledgerDescription, setLedgerDescription] = useState("");
  const [ledgerDate, setLedgerDate] = useState("");
  const [ledgerDatePickerVisible, setLedgerDatePickerVisible] = useState(false);

  const loadBatches = useCallback(async (): Promise<string | null> => {
    if (!user?.id) return null;
    const batchId = params.batchId;
    const projectId = params.projectId;
    if (batchId) {
      const { data: batchRow, error } = await supabase
        .from("business_batches")
        .select("id, name, created_at, host_id")
        .eq("id", batchId)
        .single();
      if (error || !batchRow) {
        setBatches([]);
        return null;
      }
      const b = batchRow as Batch & { host_id?: string };
      setIsHost(b.host_id === user.id);
      setBatches([{ id: b.id, name: b.name, created_at: b.created_at }]);
      setSelectedBatchId(b.id);
      return b.id;
    }
    if (projectId) {
      const { data: proj, error: projErr } = await supabase
        .from("business_projects")
        .select("id, host_id")
        .eq("id", projectId)
        .single();
      if (projErr || !proj) {
        setBatches([]);
        return null;
      }
      const projRow = proj as { id: string; host_id: string };
      const isProjectHost = projRow.host_id === user.id;
      if (!isProjectHost) {
        const { data: memberRow } = await supabase
          .from("business_project_members")
          .select("user_id")
          .eq("project_id", projectId)
          .eq("user_id", user.id)
          .maybeSingle();
        if (!memberRow) {
          setBatches([]);
          return null;
        }
      }
      setIsHost(isProjectHost);
      const { data: batchList, error } = await supabase
        .from("business_batches")
        .select("id, name, created_at")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) {
        setBatches([]);
        return null;
      }
      const list = (batchList ?? []) as Batch[];
      setBatches(list);
      const firstId = list.length > 0 ? list[0].id : null;
      setSelectedBatchId(firstId);
      return firstId;
    }
    const { data, error } = await supabase
      .from("business_batches")
      .select("id, name, created_at")
      .eq("host_id", user.id)
      .order("created_at", { ascending: false });
    if (error) return null;
    const list = (data as Batch[]) ?? [];
    setBatches(list);
    const firstId = list.length > 0 ? list[0].id : null;
    if (list.length > 0 && !selectedBatchId) setSelectedBatchId(firstId);
    return firstId;
  }, [user?.id, params.batchId, params.projectId, selectedBatchId]);

  const loadItems = useCallback(async (overrideBatchId?: string | null) => {
    const batchId = overrideBatchId ?? params.batchId ?? selectedBatchId;
    if (batchId) {
      const { data: batchRow } = await supabase.from("business_batches").select("id, name").eq("id", batchId).single();
      const batchMap = batchRow ? { [batchId]: (batchRow as { name: string }).name } : {};
      const { data, error } = await supabase
        .from("business_items")
        .select("id, batch_id, item_name, set_name, item_date, remarks, purchase_price, currency, sold_price, sold_at, created_at")
        .eq("batch_id", batchId)
        .order("created_at", { ascending: false });
      if (error) return;
      const list = ((data ?? []) as Omit<BusinessItem, "batch_name">[]).map((r) => ({
        ...r,
        item_date: r.item_date ? String(r.item_date).slice(0, 10) : null,
        batch_name: batchMap[r.batch_id] ?? "—",
      }));
      setItems(list);
      return;
    }
    const { data: batchRows } = await supabase.from("business_batches").select("id, name").eq("host_id", user?.id ?? "");
    const batchMap = Object.fromEntries(((batchRows ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]));
    const { data, error } = await supabase
      .from("business_items")
      .select("id, batch_id, item_name, set_name, item_date, remarks, purchase_price, currency, sold_price, sold_at, created_at")
      .order("created_at", { ascending: false });
    if (error) return;
    const list = ((data ?? []) as Omit<BusinessItem, "batch_name">[]).map((r) => ({
      ...r,
      item_date: r.item_date ? String(r.item_date).slice(0, 10) : null,
      batch_name: batchMap[r.batch_id] ?? "—",
    }));
    setItems(list);
  }, [user?.id, params.batchId, selectedBatchId]);

  const loadLedger = useCallback(async (overrideBatchId?: string | null) => {
    const batchId = overrideBatchId ?? params.batchId ?? selectedBatchId;
    if (!batchId) {
      setLedger([]);
      return;
    }
    const { data, error } = await supabase
      .from("business_ledger")
      .select("id, batch_id, type, amount, currency, description, date, created_at")
      .eq("batch_id", batchId)
      .order("date", { ascending: false });
    if (error) {
      setLedger([]);
      return;
    }
    setLedger(((data ?? []) as LedgerEntry[]).map((r) => ({ ...r, date: String(r.date).slice(0, 10) })));
  }, [params.batchId, selectedBatchId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const effectiveBatchId = await loadBatches();
      await loadItems(effectiveBatchId);
      await loadLedger(effectiveBatchId);
      setLoading(false);
    })();
  }, [loadBatches, loadItems, loadLedger]);

  useEffect(() => {
    if (params.batchId && batches.some((b) => b.id === params.batchId)) setSelectedBatchId(params.batchId);
  }, [params.batchId, batches]);

  function getTodayISO(): string {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  const openAddModal = () => {
    setItemDate(getTodayISO());
    setItemName("");
    setSetName("");
    setRemarks("");
    setPurchasePrice("");
    setDatePickerVisible(false);
    setAddModalVisible(true);
  };

  const inventoryItems = items.filter((i) => i.sold_at == null);
  const soldItems = items.filter((i) => i.sold_at != null);
  const filteredInventory = selectedBatchId ? inventoryItems.filter((i) => i.batch_id === selectedBatchId) : inventoryItems;
  const filteredProfits = selectedBatchId ? soldItems.filter((i) => i.batch_id === selectedBatchId) : soldItems;
  const currentBatchName = batches.find((b) => b.id === selectedBatchId)?.name ?? "Batch";

  const searchLower = searchQuery.trim().toLowerCase();
  const searchFilteredInventory = useMemo(() => {
    if (!searchLower) return filteredInventory;
    return filteredInventory.filter(
      (i) =>
        (i.item_name && i.item_name.toLowerCase().includes(searchLower)) ||
        (i.set_name && i.set_name.toLowerCase().includes(searchLower)) ||
        (i.remarks && i.remarks.toLowerCase().includes(searchLower))
    );
  }, [filteredInventory, searchLower]);

  const totalCost = filteredProfits.reduce((sum, i) => sum + Number(i.purchase_price), 0);
  const totalRevenue = filteredProfits.reduce((sum, i) => sum + Number(i.sold_price ?? 0), 0);
  const itemProfit = totalRevenue - totalCost;

  const filteredLedger = selectedBatchId ? ledger.filter((e) => e.batch_id === selectedBatchId) : ledger;

  const profitSearchLower = profitSearchQuery.trim().toLowerCase();
  const profitSearchFilteredSold = useMemo(() => {
    if (!profitSearchLower) return filteredProfits;
    return filteredProfits.filter(
      (i) =>
        (i.item_name && i.item_name.toLowerCase().includes(profitSearchLower)) ||
        (i.set_name && i.set_name.toLowerCase().includes(profitSearchLower)) ||
        (i.remarks && i.remarks.toLowerCase().includes(profitSearchLower)) ||
        (i.batch_name && i.batch_name.toLowerCase().includes(profitSearchLower))
    );
  }, [filteredProfits, profitSearchLower]);
  const profitSearchFilteredLedger = useMemo(() => {
    if (!profitSearchLower) return filteredLedger;
    return filteredLedger.filter(
      (e) =>
        (e.description && e.description.toLowerCase().includes(profitSearchLower)) ||
        (e.type === "income" && "income".includes(profitSearchLower)) ||
        (e.type === "expense" && "expense".includes(profitSearchLower))
    );
  }, [filteredLedger, profitSearchLower]);

  const totalIncome = filteredLedger.filter((e) => e.type === "income").reduce((s, e) => s + Number(e.amount), 0);
  const totalExpense = filteredLedger.filter((e) => e.type === "expense").reduce((s, e) => s + Number(e.amount), 0);
  const totalProfit = itemProfit + totalIncome - totalExpense;

  const profitDisplaySold = profitSearchLower ? profitSearchFilteredSold : filteredProfits;
  const profitDisplayLedger = profitSearchLower ? profitSearchFilteredLedger : filteredLedger;
  const profitDisplayCost = profitDisplaySold.reduce((sum, i) => sum + Number(i.purchase_price), 0);
  const profitDisplayRevenue = profitDisplaySold.reduce((sum, i) => sum + Number(i.sold_price ?? 0), 0);
  const profitDisplayItemProfit = profitDisplayRevenue - profitDisplayCost;
  const profitDisplayIncome = profitDisplayLedger.filter((e) => e.type === "income").reduce((s, e) => s + Number(e.amount), 0);
  const profitDisplayExpense = profitDisplayLedger.filter((e) => e.type === "expense").reduce((s, e) => s + Number(e.amount), 0);
  const profitDisplayTotal = profitDisplayItemProfit + profitDisplayIncome - profitDisplayExpense;

  const inventoryTotalCost = filteredInventory.reduce((sum, i) => sum + Number(i.purchase_price), 0);

  const logs = useCallback(() => {
    type LogEntry =
      | { type: "added" | "sold"; date: string; text: string; item: BusinessItem }
      | { type: "expense" | "income"; date: string; text: string; ledger: LedgerEntry };
    const entries: LogEntry[] = [];
    items.forEach((item) => {
      entries.push({
        type: "added",
        date: item.created_at,
        text: `Bought ${item.item_name} for ${formatAmount(item.purchase_price, item.currency)}`,
        item,
      });
      if (item.sold_at) {
        entries.push({
          type: "sold",
          date: item.sold_at,
          text: `Sold "${item.item_name}" for ${formatAmount(item.sold_price!, currencyCode)}`,
          item,
        });
      }
    });
    ledger.forEach((l) => {
      const label = l.description?.trim() || (l.type === "income" ? "Income" : "Expense");
      entries.push({
        type: l.type,
        date: l.date + "T12:00:00.000Z",
        text: l.type === "income" ? `Income: ${label} — ${formatAmount(l.amount, l.currency)}` : `Expense: ${label} — ${formatAmount(l.amount, l.currency)}`,
        ledger: l,
      });
    });
    entries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return entries;
  }, [items, ledger, currencyCode]);

  const logEntries = logs();
  const filteredLogsByBatch = selectedBatchId
    ? logEntries.filter((e) => ("item" in e ? e.item.batch_id === selectedBatchId : e.ledger.batch_id === selectedBatchId))
    : logEntries;
  const searchFilteredLogs = useMemo(() => {
    if (!searchLower) return filteredLogsByBatch;
    return filteredLogsByBatch.filter((e) => e.text.toLowerCase().includes(searchLower));
  }, [filteredLogsByBatch, searchLower]);

  const typeFilteredLogs = useMemo(() => {
    if (logFilter === "all") return searchFilteredLogs;
    return searchFilteredLogs.filter((e) => e.type === logFilter);
  }, [logFilter, searchFilteredLogs]);

  const openSoldModal = (item: BusinessItem) => {
    setSoldItem(item);
    setSoldPrice("");
    setSoldAtDate(getTodayISO());
    setSoldDatePickerVisible(false);
    setSoldModalVisible(true);
  };

  const openLedgerModal = (type: "expense" | "income") => {
    setEditLedgerEntry(null);
    setLedgerType(type);
    setLedgerAmount("");
    setLedgerDescription("");
    setLedgerDate(getTodayISO());
    setLedgerDatePickerVisible(false);
    setLedgerModalVisible(true);
  };

  const openEditLedgerModal = (entry: LedgerEntry) => {
    setEditLedgerEntry(entry);
    setLedgerType(entry.type);
    setLedgerAmount(String(entry.amount));
    setLedgerDescription(entry.description?.trim() ?? "");
    setLedgerDate(entry.date);
    setLedgerDatePickerVisible(false);
    setLedgerModalVisible(true);
  };

  const closeLedgerModal = () => {
    setLedgerModalVisible(false);
    setLedgerDatePickerVisible(false);
    setEditLedgerEntry(null);
    setLedgerAmount("");
    setLedgerDescription("");
    setLedgerDate("");
  };

  const handleAddLedgerEntry = async () => {
    const batchId = selectedBatchId ?? params.batchId;
    if (!batchId) return;
    const raw = ledgerAmount.trim().replace(/,/g, ".");
    if (raw === "") {
      Alert.alert("Required", "Enter an amount.");
      return;
    }
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      Alert.alert("Invalid", "Enter a valid positive amount.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("business_ledger").insert({
      batch_id: batchId,
      type: ledgerType,
      amount,
      currency: currencyCode,
      description: ledgerDescription.trim() || null,
      date: ledgerDate.trim() || getTodayISO(),
    });
    setSaving(false);
    closeLedgerModal();
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setProfitSearchQuery("");
    await loadLedger();
  };

  const handleUpdateLedgerEntry = async () => {
    if (!editLedgerEntry) return;
    const raw = ledgerAmount.trim().replace(/,/g, ".");
    if (raw === "") {
      Alert.alert("Required", "Enter an amount.");
      return;
    }
    const amount = parseFloat(raw);
    if (!Number.isFinite(amount) || amount < 0) {
      Alert.alert("Invalid", "Enter a valid positive amount.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("business_ledger")
      .update({
        type: ledgerType,
        amount,
        description: ledgerDescription.trim() || null,
        date: ledgerDate.trim() || getTodayISO(),
      })
      .eq("id", editLedgerEntry.id);
    setSaving(false);
    closeLedgerModal();
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setProfitSearchQuery("");
    await loadLedger();
  };

  const confirmDeleteLedgerEntry = (entry: LedgerEntry) => {
    Alert.alert("Delete?", `Remove this ${entry.type} entry?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("business_ledger").delete().eq("id", entry.id);
          if (error) {
            const msg = error.message ?? "";
            if (msg.includes("PGRST116") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("0 rows")) {
              closeLedgerModal();
              await loadLedger();
              return;
            }
            Alert.alert("Error", error.message);
            return;
          }
          closeLedgerModal();
          await loadLedger();
        },
      },
    ]);
  };

  const handleAddItem = async () => {
    const batchId = selectedBatchId ?? params.batchId;
    if (!batchId || !itemName.trim()) {
      Alert.alert("Required", "Enter item name.");
      return;
    }
    const priceRaw = purchasePrice.trim().replace(/,/g, ".");
    if (priceRaw === "") {
      Alert.alert("Required", "Enter a purchase price.");
      return;
    }
    const price = parseFloat(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      Alert.alert("Invalid", "Enter a valid positive purchase price.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("business_items").insert({
      batch_id: batchId,
      item_name: itemName.trim(),
      set_name: setName.trim() || null,
      item_date: itemDate.trim() || null,
      remarks: remarks.trim() || null,
      purchase_price: price,
      currency: currencyCode,
    });
    setSaving(false);
    setAddModalVisible(false);
    setItemName("");
    setSetName("");
    setItemDate("");
    setRemarks("");
    setPurchasePrice("");
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    await loadItems();
  };

  const openEditSoldModal = (item: BusinessItem) => {
    setEditSoldItem(item);
    setEditSoldPrice(String(item.sold_price ?? ""));
    setEditSoldVisible(true);
  };

  const handleEditSold = async () => {
    if (!editSoldItem) return;
    const priceRaw = editSoldPrice.trim().replace(/,/g, ".");
    if (priceRaw === "") {
      Alert.alert("Required", "Enter a sold price.");
      return;
    }
    const price = parseFloat(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      Alert.alert("Invalid", "Enter a valid positive sold price.");
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("business_items")
      .update({ sold_price: price, updated_at: new Date().toISOString() })
      .eq("id", editSoldItem.id);
    setSaving(false);
    setEditSoldVisible(false);
    setEditSoldItem(null);
    setEditSoldPrice("");
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    await loadItems();
  };

  const openBatchSettings = () => {
    setBatchEditName(currentBatchName);
    setBatchSettingsVisible(true);
  };

  const handleSaveBatchName = async () => {
    const name = batchEditName.trim();
    const batchId = selectedBatchId ?? params.batchId;
    if (!name || !batchId || !user?.id) return;
    setSaving(true);
    const { error } = await supabase.from("business_batches").update({ name, updated_at: new Date().toISOString() }).eq("id", batchId).eq("host_id", user.id);
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setBatchSettingsVisible(false);
    await loadBatches();
  };

  const handleDeleteBatch = async () => {
    const batchId = selectedBatchId ?? params.batchId;
    if (!batchId || !user?.id) return;
    Alert.alert("Delete batch", "This will delete this batch and all its items. This cannot be undone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setDeletingBatch(true);
          setBatchSettingsVisible(false);
          const { error: itemsErr } = await supabase.from("business_items").delete().eq("batch_id", batchId);
          if (itemsErr) {
            setDeletingBatch(false);
            Alert.alert("Error", itemsErr.message);
            return;
          }
          await supabase.from("business_batch_members").delete().eq("batch_id", batchId);
          const { error } = await supabase.from("business_batches").delete().eq("id", batchId).eq("host_id", user.id);
          setDeletingBatch(false);
          if (error) {
            Alert.alert("Error", error.message + " You may need to refresh.");
            await loadBatches();
            return;
          }
          router.back();
        },
      },
    ]);
  };

  const confirmDeleteItem = (item: BusinessItem, fromProfitEdit?: boolean) => {
    Alert.alert("Delete item", `Remove "${item.item_name}"? This cannot be undone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          if (fromProfitEdit) setEditSoldVisible(false);
          const { error } = await supabase.from("business_items").delete().eq("id", item.id);
          if (error) {
            const msg = error.message ?? "";
            if (msg.includes("PGRST116") || msg.toLowerCase().includes("not found") || msg.toLowerCase().includes("0 rows")) {
              await loadItems();
              return;
            }
            Alert.alert("Error", error.message);
            return;
          }
          await loadItems();
        },
      },
    ]);
  };

  const handleMarkSold = async () => {
    if (!soldItem) return;
    const priceRaw = soldPrice.trim().replace(/,/g, ".");
    if (priceRaw === "") {
      Alert.alert("Required", "Enter a sold price.");
      return;
    }
    const price = parseFloat(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      Alert.alert("Invalid", "Enter a valid positive sold price.");
      return;
    }
    const soldAtISO = soldAtDate ? `${soldAtDate}T12:00:00.000Z` : new Date().toISOString();
    setSaving(true);
    const { error } = await supabase
      .from("business_items")
      .update({ sold_price: price, sold_at: soldAtISO, updated_at: new Date().toISOString() })
      .eq("id", soldItem.id);
    setSaving(false);
    setSoldModalVisible(false);
    setSoldItem(null);
    setSoldPrice("");
    setSoldAtDate("");
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setProfitSearchQuery("");
    await loadItems();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!params.batchId && !params.projectId) {
    return <Redirect href="/(tabs)/history" />;
  }
  if (params.batchId && batches.length === 0 && !loading) {
    return <Redirect href="/(tabs)/history" />;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}
          hitSlop={12}
        >
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>{currentBatchName}</Text>
          <Text style={styles.subtitle}>{isHost ? "Inventory · Profits · Logs" : "View only"}</Text>
        </View>
        {isHost && (
          <Pressable onPress={openBatchSettings} style={({ pressed }) => [styles.headerIconBtn, pressed && styles.pressed]} hitSlop={8}>
            <Ionicons name="settings-outline" size={24} color="#a3a3a3" />
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        {(["inventory", "profits", "logs"] as TabId[]).map((tab) => (
          <Pressable
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Text>
          </Pressable>
        ))}
      </View>

      {(activeTab === "inventory" || activeTab === "logs" || activeTab === "profits") && (
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={18} color="#737373" style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            value={activeTab === "profits" ? profitSearchQuery : searchQuery}
            onChangeText={activeTab === "profits" ? setProfitSearchQuery : setSearchQuery}
            placeholder={
              activeTab === "inventory" ? "Search inventory…" : activeTab === "profits" ? "Search sales & expenses…" : "Search activity…"
            }
            placeholderTextColor="#525252"
          />
          {(activeTab === "profits" ? profitSearchQuery : searchQuery).length > 0 ? (
            <Pressable
              onPress={() => (activeTab === "profits" ? setProfitSearchQuery("") : setSearchQuery(""))}
              style={styles.searchClear}
              hitSlop={8}
            >
              <Ionicons name="close-circle" size={20} color="#737373" />
            </Pressable>
          ) : null}
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {activeTab === "inventory" && (
          <>
            <View style={styles.toolbar}>
              <Text style={styles.sectionLabel}>Current inventory ({searchFilteredInventory.length}{searchQuery.trim() ? ` of ${filteredInventory.length}` : ""})</Text>
              {isHost && (
                <Pressable
                  style={({ pressed }) => [styles.addBtn, pressed && styles.pressed]}
                  onPress={openAddModal}
                >
                  <Ionicons name="add" size={20} color="#0a0a0a" />
                  <Text style={styles.addBtnText}>Add item</Text>
                </Pressable>
              )}
            </View>
            {filteredInventory.length > 0 && (
              <View style={styles.inventoryTotalCostWrap}>
                <Text style={styles.inventoryTotalCostLabel}>Total cost (inventory)</Text>
                <Text style={styles.inventoryTotalCostValue}>{formatAmount(inventoryTotalCost, currencyCode)}</Text>
              </View>
            )}
            {isHost && (
              <View style={styles.ledgerButtonsRow}>
                <Pressable style={({ pressed }) => [styles.ledgerBtn, styles.ledgerBtnExpense, pressed && styles.pressed]} onPress={() => openLedgerModal("expense")}>
                  <Ionicons name="remove-circle-outline" size={18} color="#f97373" />
                  <Text style={styles.ledgerBtnTextExpense}>Add expense</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.ledgerBtn, styles.ledgerBtnIncome, pressed && styles.pressed]} onPress={() => openLedgerModal("income")}>
                  <Ionicons name="add-circle-outline" size={18} color="#60a5fa" />
                  <Text style={styles.ledgerBtnTextIncome}>Add income</Text>
                </Pressable>
              </View>
            )}
            {searchFilteredInventory.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="cube-outline" size={48} color="#525252" />
                <Text style={styles.emptyText}>{filteredInventory.length === 0 ? "No items in inventory" : "No matches"}</Text>
                <Text style={styles.emptySub}>{filteredInventory.length === 0 ? "Add items and mark them sold when you sell." : "Try different keywords."}</Text>
              </View>
            ) : (
              searchFilteredInventory.map((item) => (
                <View key={item.id} style={styles.itemCard}>
                  <View style={styles.itemMain}>
                    <Text style={styles.itemName}>{item.item_name}</Text>
                    {item.set_name ? <Text style={styles.itemSet}>Set: {item.set_name}</Text> : null}
                    {item.item_date ? <Text style={styles.itemMeta}>Date: {item.item_date}</Text> : null}
                    {item.remarks ? <Text style={styles.itemRemarks}>{item.remarks}</Text> : null}
                    <Text style={styles.itemPrice}>{formatAmount(item.purchase_price, item.currency)} (cost)</Text>
                  </View>
                  {isHost && (
                    <View style={styles.itemCardActions}>
                      <Pressable onPress={() => confirmDeleteItem(item)} style={({ pressed }) => [styles.deleteItemBtn, pressed && styles.pressed]} hitSlop={8}>
                        <Ionicons name="trash-outline" size={20} color="#f97373" />
                      </Pressable>
                      <Pressable style={({ pressed }) => [styles.soldBtn, pressed && styles.pressed]} onPress={() => openSoldModal(item)}>
                        <Text style={styles.soldBtnText}>SOLD</Text>
                      </Pressable>
                    </View>
                  )}
                </View>
              ))
            )}
          </>
        )}

        {activeTab === "profits" && (
          <>
            {(filteredProfits.length > 0 || filteredLedger.length > 0) ? (
              <View style={styles.profitSummaryWrap}>
                {filteredProfits.length > 0 && (
                  <View style={styles.profitBubbleRow}>
                    <View style={[styles.profitBubble, styles.profitBubbleRevenue]}>
                      <Text style={styles.profitBubbleLabelRevenue}>REVENUE</Text>
                      <Text style={styles.profitBubbleValueRevenue}>{formatAmount(profitDisplayRevenue, currencyCode)}</Text>
                    </View>
                    <View style={[styles.profitBubble, styles.profitBubbleCost]}>
                      <Text style={styles.profitBubbleLabelCost}>COST</Text>
                      <Text style={styles.profitBubbleValueCost}>{formatAmount(profitDisplayCost, currencyCode)}</Text>
                    </View>
                  </View>
                )}
                {filteredLedger.length > 0 && (
                  <View style={styles.profitBubbleRow}>
                    <View style={[styles.profitBubble, styles.profitBubbleRevenue]}>
                      <Text style={styles.profitBubbleLabelRevenue}>INCOME</Text>
                      <Text style={styles.profitBubbleValueRevenue}>{formatAmount(profitDisplayIncome, currencyCode)}</Text>
                    </View>
                    <View style={[styles.profitBubble, styles.profitBubbleCost]}>
                      <Text style={styles.profitBubbleLabelCost}>EXPENSE</Text>
                      <Text style={styles.profitBubbleValueCost}>{formatAmount(profitDisplayExpense, currencyCode)}</Text>
                    </View>
                  </View>
                )}
                <View style={styles.profitTotalCard}>
                  <Text style={styles.profitTotalLabel}>TOTAL PROFIT{profitSearchLower ? " (filtered)" : ""}</Text>
                  <Text style={[styles.profitTotalValue, profitDisplayTotal >= 0 ? styles.profitTotalPositive : styles.profitTotalNegative]}>
                    {formatAmount(profitDisplayTotal, currencyCode)}
                  </Text>
                </View>
              </View>
            ) : null}
            {filteredProfits.length === 0 && filteredLedger.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="trending-up-outline" size={48} color="#525252" />
                <Text style={styles.emptyText}>No sales yet</Text>
                <Text style={styles.emptySub}>Mark items as SOLD in Inventory, or add expense/income to track profit.</Text>
              </View>
            ) : (profitDisplaySold.length === 0 && profitDisplayLedger.length === 0) ? (
              <View style={styles.empty}>
                <Ionicons name="search-outline" size={48} color="#525252" />
                <Text style={styles.emptyText}>No matches</Text>
                <Text style={styles.emptySub}>Try different keywords.</Text>
              </View>
            ) : (
              <>
                {profitDisplaySold.map((item) => {
                const profit = Number(item.sold_price ?? 0) - Number(item.purchase_price);
                const profitAbs = Math.abs(profit);
                const profitLabel = profit >= 0 ? "PROFIT" : "LOSS";
                return (
                  <View key={item.id} style={styles.profitCard}>
                    <View style={styles.profitCardMain}>
                      <Text style={styles.itemName} numberOfLines={1}>{item.item_name}</Text>
                      {item.set_name ? <Text style={styles.itemSet} numberOfLines={1}>Set: {item.set_name}</Text> : null}
                      <Text style={styles.profitArrowText} numberOfLines={1}>
                        {formatAmount(item.purchase_price, item.currency)} → {formatAmount(item.sold_price!, item.currency)}
                      </Text>
                      <Text
                        style={[
                          styles.profitResultText,
                          profit >= 0 ? styles.profitPositive : styles.profitNegative,
                        ]}
                        numberOfLines={1}
                      >
                        {formatAmount(profitAbs, item.currency)} {profitLabel}
                      </Text>
                    </View>
                    {isHost && (
                      <Pressable style={({ pressed }) => [styles.editSoldBtn, pressed && styles.pressed]} onPress={() => openEditSoldModal(item)}>
                        <Ionicons name="pencil" size={18} color="#0a0a0a" />
                      </Pressable>
                    )}
                  </View>
                );
                })}
                {profitDisplayLedger.length > 0 && (
                  <>
                    <Text style={[styles.sectionLabel, { marginTop: 8, marginBottom: 10 }]}>
                      Expense & income{profitSearchLower ? ` (${profitDisplayLedger.length})` : ""}
                    </Text>
                    {profitDisplayLedger.map((entry) => (
                      <View key={entry.id} style={styles.profitCard}>
                        <View style={styles.profitCardMain}>
                          <Text style={styles.itemName} numberOfLines={1}>
                            {entry.type === "income" ? "Income" : "Expense"}: {entry.description?.trim() || "—"}
                          </Text>
                          <Text style={[styles.profitResultText, entry.type === "income" ? styles.profitPositive : styles.profitNegative]}>
                            {entry.type === "income" ? "+" : "−"} {formatAmount(entry.amount, entry.currency)}
                          </Text>
                          <Text style={styles.itemMeta}>{entry.date}</Text>
                        </View>
                        {isHost && (
                          <Pressable style={({ pressed }) => [styles.editSoldBtn, pressed && styles.pressed]} onPress={() => openEditLedgerModal(entry)}>
                            <Ionicons name="pencil" size={18} color="#0a0a0a" />
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </>
                )}
              </>
            )}
          </>
        )}

        {activeTab === "logs" && (
          <>
            <View style={styles.logsToolbar}>
              <Text style={styles.sectionLabel}>Activity{searchQuery.trim() ? ` (${typeFilteredLogs.length} of ${filteredLogsByBatch.length})` : ""}</Text>
              <View style={styles.logFilterRow}>
                {(["all", "added", "sold", "expense", "income"] as LogFilterId[]).map((f) => (
                  <Pressable
                    key={f}
                    style={[styles.logFilterChip, logFilter === f && styles.logFilterChipActive]}
                    onPress={() => setLogFilter(f)}
                  >
                    <Text style={[styles.logFilterChipText, logFilter === f && styles.logFilterChipTextActive]}>
                      {f === "all" ? "All" : f === "added" ? "Added" : f === "sold" ? "Sold" : f === "expense" ? "Expense" : "Income"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {typeFilteredLogs.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name={filteredLogsByBatch.length === 0 ? "list-outline" : "search-outline"} size={48} color="#525252" />
                <Text style={styles.emptyText}>
                  {filteredLogsByBatch.length === 0 ? "No activity yet" : searchQuery.trim() ? `No activity matches "${searchQuery.trim()}"` : "No matches"}
                </Text>
                <Text style={styles.emptySub}>
                  {filteredLogsByBatch.length === 0 ? "" : "Try different keywords or filter, or clear search."}
                </Text>
                {filteredLogsByBatch.length > 0 && searchQuery.trim() ? (
                  <Pressable style={({ pressed }) => [styles.clearSearchBtn, pressed && styles.pressed]} onPress={() => setSearchQuery("")}>
                    <Text style={styles.clearSearchBtnText}>Clear search</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : (
              typeFilteredLogs.map((entry, idx) => (
                <View
                  key={"item" in entry ? `${entry.item.id}-${entry.type}-${idx}` : `ledger-${entry.ledger.id}`}
                  style={styles.logRow}
                >
                  <View
                    style={[
                      styles.logDot,
                      entry.type === "sold" && styles.logDotSold,
                      entry.type === "added" && styles.logDotAdded,
                      entry.type === "income" && styles.logDotIncome,
                      entry.type === "expense" && styles.logDotExpense,
                    ]}
                  />
                  <View style={styles.logContent}>
                    <Text style={styles.logText}>{entry.text}</Text>
                    <Text style={styles.logDate}>{new Date(entry.date).toLocaleString()}</Text>
                  </View>
                </View>
              ))
            )}
          </>
        )}
      </ScrollView>

      {/* Add item modal */}
      <Modal visible={addModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => { setAddModalVisible(false); setDatePickerVisible(false); }}>
          <Pressable style={[styles.modalCard, styles.modalCardWide]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Add item</Text>
              <Text style={styles.modalSub}>Item name, set, price, date, remarks</Text>
              <TextInput style={styles.input} value={itemName} onChangeText={setItemName} placeholder="Item name *" placeholderTextColor="#525252" />
              <TextInput style={styles.input} value={setName} onChangeText={setSetName} placeholder="Set" placeholderTextColor="#525252" />
              <TextInput
                style={styles.input}
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                placeholder={`Price (${getCurrency(currencyCode).symbol})`}
                placeholderTextColor="#525252"
                keyboardType="decimal-pad"
              />
              <Text style={styles.inputLabel}>Date</Text>
              <Pressable
                style={styles.datePressable}
                onPress={() => setDatePickerVisible(true)}
              >
                <Text style={styles.datePressableText}>
                  {itemDate ? (itemDate === getTodayISO() ? "Today — " + itemDate : itemDate) : "Tap to set date"}
                </Text>
                <Ionicons name="calendar-outline" size={20} color="#8DEB63" />
              </Pressable>
              {datePickerVisible && (
                <DateTimePicker
                  value={itemDate ? new Date(itemDate + "T12:00:00") : new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, selectedDate) => {
                    if (Platform.OS === "android") setDatePickerVisible(false);
                    if (selectedDate) {
                      const y = selectedDate.getFullYear();
                      const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
                      const d = String(selectedDate.getDate()).padStart(2, "0");
                      setItemDate(`${y}-${m}-${d}`);
                    }
                  }}
                />
              )}
              <TextInput style={styles.input} value={remarks} onChangeText={setRemarks} placeholder="Remarks" placeholderTextColor="#525252" />
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => { setAddModalVisible(false); setDatePickerVisible(false); }}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleAddItem} disabled={saving}>
                  <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Add"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Sold price modal */}
      <Modal visible={soldModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => { setSoldModalVisible(false); setSoldDatePickerVisible(false); }}>
          <Pressable style={[styles.modalCard, styles.modalCardWide]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>Mark as sold</Text>
              {soldItem && (
                <>
                  <Text style={styles.modalSub}>{soldItem.item_name} — cost {formatAmount(soldItem.purchase_price, soldItem.currency)}</Text>
                  <TextInput
                    style={styles.input}
                    value={soldPrice}
                    onChangeText={setSoldPrice}
                    placeholder={`Sold price (${getCurrency(soldItem.currency).symbol})`}
                    placeholderTextColor="#525252"
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.inputLabel}>Sold on</Text>
                  <Pressable style={styles.datePressable} onPress={() => setSoldDatePickerVisible(true)}>
                    <Text style={styles.datePressableText}>
                      {soldAtDate ? (soldAtDate === getTodayISO() ? "Today — " + soldAtDate : soldAtDate) : "Tap to set date"}
                    </Text>
                    <Ionicons name="calendar-outline" size={20} color="#8DEB63" />
                  </Pressable>
                  {soldDatePickerVisible && (
                    <DateTimePicker
                      value={soldAtDate ? new Date(soldAtDate + "T12:00:00") : new Date()}
                      mode="date"
                      display={Platform.OS === "ios" ? "spinner" : "default"}
                      onChange={(_, selectedDate) => {
                        if (Platform.OS === "android") setSoldDatePickerVisible(false);
                        if (selectedDate) {
                          const y = selectedDate.getFullYear();
                          const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
                          const d = String(selectedDate.getDate()).padStart(2, "0");
                          setSoldAtDate(`${y}-${m}-${d}`);
                        }
                      }}
                    />
                  )}
                </>
              )}
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => { setSoldModalVisible(false); setSoldDatePickerVisible(false); }}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleMarkSold} disabled={saving || !soldPrice.trim()}>
                  <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Save"}</Text>
                </Pressable>
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Edit sold price modal */}
      <Modal visible={editSoldVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setEditSoldVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Edit sold price</Text>
            {editSoldItem && (
              <>
                <Text style={styles.modalSub}>{editSoldItem.item_name} — cost {formatAmount(editSoldItem.purchase_price, editSoldItem.currency)}</Text>
                <TextInput
                  style={styles.input}
                  value={editSoldPrice}
                  onChangeText={setEditSoldPrice}
                  placeholder={`Revenue / sold price (${getCurrency(editSoldItem.currency).symbol})`}
                  placeholderTextColor="#525252"
                  keyboardType="decimal-pad"
                />
              </>
            )}
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setEditSoldVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleEditSold} disabled={saving || !editSoldPrice.trim()}>
                <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Save"}</Text>
              </Pressable>
            </View>
            {editSoldItem ? (
              <Pressable style={styles.deleteItemInModalBtn} onPress={() => confirmDeleteItem(editSoldItem, true)}>
                <Ionicons name="trash-outline" size={18} color="#f97373" />
                <Text style={styles.deleteItemInModalText}>Delete item</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add expense / Add income modal */}
      <Modal visible={ledgerModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => closeLedgerModal()}>
          <Pressable style={[styles.modalCard, styles.modalCardWide]} onPress={() => {}}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.modalTitle}>
                {editLedgerEntry ? (ledgerType === "income" ? "Edit income" : "Edit expense") : ledgerType === "income" ? "Add income" : "Add expense"}
              </Text>
              <Text style={styles.modalSub}>
                {editLedgerEntry ? "Update amount, description, or date." : `Company-related ${ledgerType}. Contributes to Profit tab.`}
              </Text>
              {editLedgerEntry ? (
                <View style={styles.ledgerTypeRow}>
                  <Pressable
                    style={[styles.ledgerTypeChip, ledgerType === "expense" && styles.ledgerTypeChipActive]}
                    onPress={() => setLedgerType("expense")}
                  >
                    <Text style={[styles.ledgerTypeChipText, ledgerType === "expense" && styles.ledgerTypeChipTextActive]}>Expense</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.ledgerTypeChip, ledgerType === "income" && styles.ledgerTypeChipActive]}
                    onPress={() => setLedgerType("income")}
                  >
                    <Text style={[styles.ledgerTypeChipText, ledgerType === "income" && styles.ledgerTypeChipTextActive]}>Income</Text>
                  </Pressable>
                </View>
              ) : null}
              <Text style={styles.inputLabel}>Amount ({getCurrency(currencyCode).symbol})</Text>
              <TextInput
                style={styles.input}
                value={ledgerAmount}
                onChangeText={setLedgerAmount}
                placeholder="0"
                placeholderTextColor="#525252"
                keyboardType="decimal-pad"
              />
              <Text style={styles.inputLabel}>Description (optional)</Text>
              <TextInput
                style={styles.input}
                value={ledgerDescription}
                onChangeText={setLedgerDescription}
                placeholder={ledgerType === "income" ? "e.g. Refund, other income" : "e.g. Shipping, fees"}
                placeholderTextColor="#525252"
              />
              <Text style={styles.inputLabel}>Date</Text>
              <Pressable style={styles.datePressable} onPress={() => setLedgerDatePickerVisible(true)}>
                <Text style={styles.datePressableText}>
                  {ledgerDate ? (ledgerDate === getTodayISO() ? "Today — " + ledgerDate : ledgerDate) : "Tap to set date"}
                </Text>
                <Ionicons name="calendar-outline" size={20} color="#8DEB63" />
              </Pressable>
              {ledgerDatePickerVisible && (
                <DateTimePicker
                  value={ledgerDate ? new Date(ledgerDate + "T12:00:00") : new Date()}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={(_, selectedDate) => {
                    if (Platform.OS === "android") setLedgerDatePickerVisible(false);
                    if (selectedDate) {
                      const y = selectedDate.getFullYear();
                      const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
                      const d = String(selectedDate.getDate()).padStart(2, "0");
                      setLedgerDate(`${y}-${m}-${d}`);
                    }
                  }}
                />
              )}
              <View style={styles.modalActions}>
                <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={closeLedgerModal}>
                  <Text style={styles.modalBtnCancelText}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalBtn, styles.modalBtnSave]}
                  onPress={editLedgerEntry ? handleUpdateLedgerEntry : handleAddLedgerEntry}
                  disabled={saving || !ledgerAmount.trim()}
                >
                  <Text style={styles.modalBtnSaveText}>{saving ? "…" : editLedgerEntry ? "Save" : "Add"}</Text>
                </Pressable>
              </View>
              {editLedgerEntry ? (
                <Pressable style={styles.deleteItemInModalBtn} onPress={() => confirmDeleteLedgerEntry(editLedgerEntry)}>
                  <Ionicons name="trash-outline" size={18} color="#f97373" />
                  <Text style={styles.deleteItemInModalText}>Delete entry</Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Batch settings modal */}
      <Modal visible={batchSettingsVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setBatchSettingsVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Batch settings</Text>
            <Text style={styles.modalSub}>Edit name or delete this batch</Text>
            <Text style={styles.inputLabel}>Batch name</Text>
            <TextInput
              style={styles.input}
              value={batchEditName}
              onChangeText={setBatchEditName}
              placeholder="e.g. Batch name"
              placeholderTextColor="#525252"
            />
            <View style={styles.modalActions}>
              <Pressable style={[styles.modalBtn, styles.modalBtnCancel]} onPress={() => setBatchSettingsVisible(false)}>
                <Text style={styles.modalBtnCancelText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, styles.modalBtnSave]} onPress={handleSaveBatchName} disabled={saving || !batchEditName.trim()}>
                <Text style={styles.modalBtnSaveText}>{saving ? "…" : "Save"}</Text>
              </Pressable>
            </View>
            <Pressable style={styles.deleteBatchBtn} onPress={handleDeleteBatch} disabled={deletingBatch}>
              <Ionicons name="trash-outline" size={20} color="#f97373" />
              <Text style={styles.deleteBatchBtnText}>{deletingBatch ? "Deleting…" : "Delete batch"}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#737373", fontSize: 15 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  pressed: { opacity: 0.85 },
  headerText: { flex: 1, minWidth: 0 },
  headerIconBtn: { padding: 4 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#737373", fontSize: 14, marginTop: 2 },
  batchRow: { paddingHorizontal: 16, marginBottom: 12 },
  batchChips: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  batchChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  batchChipActive: { backgroundColor: "rgba(141,235,99,0.2)", borderColor: "#8DEB63" },
  batchChipText: { color: "#a3a3a3", fontSize: 14, fontWeight: "600", maxWidth: 120 },
  batchChipTextActive: { color: "#8DEB63" },
  batchChipNew: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: "#8DEB63", borderStyle: "dashed" },
  batchChipNewText: { color: "#8DEB63", fontSize: 14, fontWeight: "600" },
  tabs: { flexDirection: "row", paddingHorizontal: 16, marginBottom: 16, gap: 4 },
  tab: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: 10 },
  tabActive: { backgroundColor: "rgba(141,235,99,0.15)" },
  tabText: { color: "#737373", fontSize: 15, fontWeight: "600" },
  tabTextActive: { color: "#8DEB63" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  sectionLabel: { color: "#737373", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  inventoryTotalCostWrap: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: "rgba(141,235,99,0.08)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(141,235,99,0.2)" },
  inventoryTotalCostLabel: { color: "#8DEB63", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  inventoryTotalCostValue: { color: "#fff", fontSize: 16, fontWeight: "800" },
  addBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, backgroundColor: "#8DEB63" },
  addBtnText: { color: "#0a0a0a", fontSize: 14, fontWeight: "700" },
  ledgerButtonsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  ledgerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1 },
  ledgerBtnExpense: { backgroundColor: "rgba(249,115,115,0.12)", borderColor: "rgba(249,115,115,0.4)" },
  ledgerBtnIncome: { backgroundColor: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.4)" },
  ledgerBtnTextExpense: { color: "#f97373", fontSize: 14, fontWeight: "700" },
  ledgerBtnTextIncome: { color: "#60a5fa", fontSize: 14, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 48, gap: 12 },
  emptyText: { color: "#a3a3a3", fontSize: 16, fontWeight: "600" },
  emptySub: { color: "#737373", fontSize: 14 },
  clearSearchBtn: { marginTop: 14, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "rgba(141,235,99,0.12)", borderWidth: 1, borderColor: "rgba(141,235,99,0.3)" },
  clearSearchBtnText: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  itemCard: {
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  itemMain: { flex: 1, minWidth: 0 },
  itemCardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  deleteItemBtn: { padding: 8 },
  itemName: { color: "#fff", fontSize: 16, fontWeight: "700" },
  itemSet: { color: "#a3a3a3", fontSize: 13, marginTop: 4 },
  itemMeta: { color: "#737373", fontSize: 13, marginTop: 2 },
  itemRemarks: { color: "#737373", fontSize: 13, marginTop: 2, fontStyle: "italic" },
  itemPrice: { color: "#8DEB63", fontSize: 14, fontWeight: "600", marginTop: 6 },
  profitRow: { marginTop: 4 },
  profitGreen: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  soldBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "#8DEB63" },
  soldBtnText: { color: "#0a0a0a", fontSize: 13, fontWeight: "800" },
  profitSummary: { marginBottom: 16 },
  profitSummaryWrap: { marginBottom: 20 },
  profitBubbleRow: { flexDirection: "row", gap: 12, marginBottom: 12 },
  profitBubble: {
    flex: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  profitBubbleCost: { backgroundColor: "rgba(249,115,115,0.12)", borderColor: "rgba(249,115,115,0.35)" },
  profitBubbleRevenue: { backgroundColor: "rgba(96,165,250,0.12)", borderColor: "rgba(96,165,250,0.4)" },
  profitBubbleLabel: { color: "#a3a3a3", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  profitBubbleLabelCost: { color: "rgba(249,115,115,0.9)", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  profitBubbleLabelRevenue: { color: "rgba(96,165,250,0.95)", fontSize: 11, fontWeight: "800", letterSpacing: 0.8 },
  profitBubbleValue: { color: "#fff", fontSize: 16, fontWeight: "700", marginTop: 6 },
  profitBubbleValueCost: { color: "#fca5a5", fontSize: 16, fontWeight: "700", marginTop: 6 },
  profitBubbleValueRevenue: { color: "#93c5fd", fontSize: 16, fontWeight: "700", marginTop: 6 },
  profitTotalCard: {
    width: "100%",
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderRadius: 20,
    backgroundColor: "rgba(20,20,20,0.95)",
    borderWidth: 2,
    borderColor: "rgba(141,235,99,0.5)",
    alignItems: "center",
    justifyContent: "center",
  },
  profitTotalLabel: { color: "#8DEB63", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  profitTotalValue: { fontSize: 28, fontWeight: "800", marginTop: 6 },
  profitTotalPositive: { color: "#8DEB63" },
  profitTotalNegative: { color: "#f97373" },
  profitSummaryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  profitSummaryRowTotal: { borderTopWidth: 1, borderTopColor: "rgba(141,235,99,0.3)", marginTop: 4, paddingTop: 12 },
  profitSummaryLabel: { color: "#a3a3a3", fontSize: 14, fontWeight: "600" },
  profitSummaryValue: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  profitLabel: { color: "#8DEB63", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  profitAmount: { color: "#fff", fontSize: 22, fontWeight: "800" },
  profitCard: {
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  profitCardMain: { flex: 1, minWidth: 0 },
  profitCardRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 6, gap: 12 },
  profitCardLabel: { color: "#737373", fontSize: 13 },
  profitCardValue: { color: "#e5e5e5", fontSize: 13, fontWeight: "600", flex: 1, textAlign: "right" },
  profitArrowText: { color: "#e5e5e5", fontSize: 13, marginTop: 6 },
  profitResultText: { marginTop: 4, fontSize: 13, fontWeight: "700" },
  profitPositive: { color: "#8DEB63" },
  profitNegative: { color: "#f97373" },
  editSoldBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8DEB63",
  },
  logRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: 22, gap: 12 },
  logDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  logDotAdded: { backgroundColor: "#737373" },
  logDotSold: { backgroundColor: "#8DEB63" },
  logDotIncome: { backgroundColor: "#60a5fa" },
  logDotExpense: { backgroundColor: "#f97373" },
  logsToolbar: { marginBottom: 14 },
  logFilterRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
  logFilterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.08)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  logFilterChipActive: { backgroundColor: "rgba(141,235,99,0.2)", borderColor: "#8DEB63" },
  logFilterChipText: { color: "#a3a3a3", fontSize: 14, fontWeight: "600" },
  logFilterChipTextActive: { color: "#8DEB63" },
  logContent: { flex: 1, minWidth: 0, paddingVertical: 4 },
  logText: { color: "#e5e5e5", fontSize: 14, lineHeight: 20 },
  logDate: { color: "#737373", fontSize: 12, marginTop: 6 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#141414", borderRadius: 12, marginHorizontal: 16, marginBottom: 14, paddingHorizontal: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, color: "#fff", fontSize: 16, paddingVertical: 12, minHeight: 44 },
  searchClear: { padding: 4 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: { width: "100%", maxWidth: 360, borderRadius: 24, backgroundColor: "#1a1a1a", padding: 24, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalCardWide: { maxWidth: 400 },
  modalTitle: { color: "#fff", fontSize: 20, fontWeight: "800" },
  modalSub: { color: "#a3a3a3", fontSize: 14, marginTop: 4, marginBottom: 20 },
  input: { minHeight: 48, borderRadius: 12, backgroundColor: "#0f0f0f", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", color: "#fff", fontSize: 16, paddingHorizontal: 16, marginBottom: 14 },
  inputLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  datePressable: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 48, borderRadius: 12, backgroundColor: "#0f0f0f", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 16, marginBottom: 14 },
  datePressableText: { color: "#fff", fontSize: 16 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalBtn: { flex: 1, paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  modalBtnCancel: { borderWidth: 1, borderColor: "rgba(255,255,255,0.2)" },
  modalBtnCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalBtnSave: { backgroundColor: "#8DEB63" },
  modalBtnSaveText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
  ledgerTypeRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  ledgerTypeChip: { flex: 1, paddingVertical: 12, borderRadius: 12, alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#141414" },
  ledgerTypeChipActive: { borderColor: "#8DEB63", backgroundColor: "rgba(141,235,99,0.15)" },
  ledgerTypeChipText: { color: "#a3a3a3", fontSize: 15, fontWeight: "600" },
  ledgerTypeChipTextActive: { color: "#8DEB63" },
  deleteItemInModalBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 16, paddingVertical: 12, borderWidth: 1, borderColor: "rgba(249,115,115,0.4)", borderRadius: 12 },
  deleteItemInModalText: { color: "#f97373", fontSize: 14, fontWeight: "600" },
  deleteBatchBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 20, paddingVertical: 14, borderWidth: 1, borderColor: "rgba(249,115,115,0.5)", borderRadius: 12 },
  deleteBatchBtnText: { color: "#f97373", fontSize: 15, fontWeight: "700" },
});
