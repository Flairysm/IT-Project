import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as FileSystem from "expo-file-system";
import { Ionicons } from "@expo/vector-icons";
import { Image as ExpoImage } from "expo-image";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";
import { formatAmount, getCurrency } from "./lib/currency";

const RECEIPT_IMAGES_BUCKET = "receipt-images";

async function uploadReceiptImage(imageUri: string, userId: string, receiptId: string): Promise<string | null> {
  try {
    const file = new FileSystem.File(imageUri);
    const base64 = await file.base64();
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const path = `${userId}/${receiptId}.jpg`;
    const { error } = await supabase.storage.from(RECEIPT_IMAGES_BUCKET).upload(path, bytes, {
      contentType: "image/jpeg",
      upsert: true,
    });
    if (error) return null;
    const { data } = supabase.storage.from(RECEIPT_IMAGES_BUCKET).getPublicUrl(path);
    return data?.publicUrl ?? null;
  } catch {
    return null;
  }
}

type ResultItem = { name?: string; qty?: number; price?: string };
type Assignments = Record<number, number[]>;
type DynamicPercentages = Record<number, Record<number, number>>;
type GroupMemberInfo = { username: string; display_name?: string | null; avatar_url?: string | null };
type MemberGroup = { id: string; name: string; avatar_url?: string | null; members: GroupMemberInfo[] };
type ScanMember = { username: string; avatar_url?: string | null };

function receiptInitial(merchant: string): string {
  const s = (merchant || "?").trim();
  return s && s !== "-" ? s.charAt(0).toUpperCase() : "R";
}

function groupInitial(name: string): string {
  const s = name.trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function displayName(m: GroupMemberInfo): string {
  const d = (m.display_name || "").trim();
  return d || m.username || "?";
}

export default function ScanResultScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const params = useLocalSearchParams<{ merchant?: string; date?: string; total?: string; source?: string; imageUri?: string; items?: string; receiptId?: string; category?: string }>();
  const source = params.source || "ocr";
  const category = (params.category as "restaurant" | "travel" | "groceries" | "business" | "others") || "others";
  const imageUri = params.imageUri;
  const receiptId = params.receiptId?.trim() || null;
  const isEditMode = Boolean(receiptId);
  const isManualMode = source === "manual" && !receiptId;

  const quickSplitLabels = {
    restaurant: { titlePlaceholder: "Restaurant name", subtitle: "One person pays the bill; split precisely among friends." },
    travel: { titlePlaceholder: "Trip or expense name", subtitle: "Enter trip details and split the cost" },
    groceries: { titlePlaceholder: "Store name", subtitle: "Enter store and total, then split" },
    business: { titlePlaceholder: "Expense / project name", subtitle: "Enter expense details and split" },
    others: { titlePlaceholder: "Title", subtitle: "Enter details and split" },
  };
  const manualLabels = quickSplitLabels[category] || quickSplitLabels.others;
  const categoryLabel = { restaurant: "Restaurant", travel: "Travel", groceries: "Groceries", business: "Business", others: "Others" }[category] || "";

  const isRestaurantOrGroceriesManual = isManualMode && !receiptId && (category === "restaurant" || category === "groceries");
  const todayDateString = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const [merchant, setMerchant] = useState(params.merchant || "");
  const [date, setDate] = useState(params.date || "");
  const [total, setTotal] = useState(params.total || "");
  const [items, setItems] = useState<ResultItem[]>(() => {
    try { return params.items ? (JSON.parse(params.items) as ResultItem[]) : []; } catch { return []; }
  });

  const calculatedTotalFromItems = useMemo(
    () =>
      items.reduce((sum, item) => sum + (parseFloat(item.price || "0") || 0), 0).toFixed(2),
    [items]
  );

  const [members, setMembers] = useState<ScanMember[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [editItemsMode, setEditItemsMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dynamicPercentages, setDynamicPercentages] = useState<DynamicPercentages>({});
  const [dynamicModalVisible, setDynamicModalVisible] = useState(false);
  const [dynamicItemIndex, setDynamicItemIndex] = useState<number | null>(null);
  const [dynamicAssignees, setDynamicAssignees] = useState<number[]>([]);
  const [dynamicDraft, setDynamicDraft] = useState<Record<number, string>>({});
  type DynamicSplitMode = "percentage" | "amount" | "shares";
  const [dynamicSplitMode, setDynamicSplitMode] = useState<DynamicSplitMode>("percentage");
  const [groupPickerVisible, setGroupPickerVisible] = useState(false);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [friendsList, setFriendsList] = useState<{ id: string; username: string; display_name?: string | null; avatar_url?: string | null }[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [editLoading, setEditLoading] = useState(false);
  const hasAssignedMembers = Object.values(assignments).some((memberIndexes) => memberIndexes.length > 0);

  const loadReceiptForEdit = useCallback(async () => {
    if (!receiptId || !user?.id) return;
    setEditLoading(true);
    setSaveError(null);
    try {
      const { data: rec, error: recErr } = await supabase
        .from("receipts")
        .select("id, host_id, merchant, receipt_date, total_amount, currency, split_totals")
        .eq("id", receiptId)
        .single();
      if (recErr) throw new Error(recErr.message);
      if (!rec || (rec.host_id && rec.host_id !== user.id)) {
        setSaveError("Receipt not found or you can't edit it.");
        setEditLoading(false);
        return;
      }
      setMerchant(String(rec.merchant ?? "").trim());
      setDate(String(rec.receipt_date ?? "").trim());
      setTotal(String(rec.total_amount ?? "").trim());

      const { data: rows, error: itemsErr } = await supabase
        .from("receipt_items")
        .select("id, name, qty, unit_price")
        .eq("receipt_id", receiptId)
        .order("created_at", { ascending: true });
      if (itemsErr) throw new Error(itemsErr.message);
      const rowsList = rows || [];
      const itemIds = rowsList.map((r: { id?: string }) => r.id as string);
      const loadedItems: ResultItem[] = rowsList.map((r: { name?: string; qty?: number; unit_price?: string }) => {
        const qty = Number(r.qty) || 1;
        const unitPrice = parseFloat(r.unit_price ?? "0") || 0;
        const lineTotal = (unitPrice * qty).toFixed(2);
        return { name: r.name ?? "", qty, price: lineTotal };
      });
      setItems(loadedItems.length ? loadedItems : [{ name: "", qty: 1, price: "0" }]);

      const splitTotalsRaw = Array.isArray(rec.split_totals) ? rec.split_totals : [];
      const usernames = splitTotalsRaw.map((s: { name?: string }) => String(s?.name ?? "").trim()).filter(Boolean);
      const membersList: ScanMember[] = [];
      for (const uname of usernames) {
        const { data: prof } = await supabase.from("profiles").select("username, avatar_url").ilike("username", uname).maybeSingle();
        const p = prof as { username?: string; avatar_url?: string | null } | null;
        membersList.push({ username: p?.username ?? uname, avatar_url: p?.avatar_url ?? null });
      }
      setMembers(membersList);

      const assignAll: Assignments = {};
      const initialDynamic: DynamicPercentages = {};
      const itemIdToIndex: Record<string, number> = {};
      itemIds.forEach((id, idx) => { itemIdToIndex[id] = idx; });

      const { data: assignRows } = await supabase
        .from("receipt_assignments")
        .select("item_id, user_id, share_amount")
        .eq("receipt_id", receiptId);
      const assignmentList = (assignRows || []) as { item_id: string; user_id: string; share_amount: number }[];

      if (assignmentList.length > 0 && membersList.length > 0) {
        const userIds = [...new Set(assignmentList.map((a) => a.user_id))];
        const { data: profs } = await supabase.from("profiles").select("id, username").in("id", userIds);
        const userIdToUsername: Record<string, string> = {};
        (profs || []).forEach((p: { id?: string; username?: string }) => {
          if (p?.id && p?.username) userIdToUsername[p.id] = p.username;
        });
        const usernameToMemberIndex: Record<string, number> = {};
        membersList.forEach((m, j) => { usernameToMemberIndex[m.username.toLowerCase()] = j; });

        loadedItems.forEach((_, idx) => { assignAll[idx] = []; });
        assignmentList.forEach((a) => {
          const itemIndex = itemIdToIndex[a.item_id];
          if (itemIndex == null) return;
          const username = userIdToUsername[a.user_id];
          if (username == null) return;
          const memberIndex = usernameToMemberIndex[username.toLowerCase()];
          if (memberIndex == null) return;
          if (!assignAll[itemIndex].includes(memberIndex)) assignAll[itemIndex].push(memberIndex);
          const itemTotal = parseFloat(loadedItems[itemIndex]?.price ?? "0") || 0.01;
          const pct = Number(((Number(a.share_amount) / itemTotal) * 100).toFixed(2));
          if (!initialDynamic[itemIndex]) initialDynamic[itemIndex] = {};
          initialDynamic[itemIndex][memberIndex] = pct;
        });
        Object.keys(assignAll).forEach((k) => { assignAll[Number(k)].sort((a, b) => a - b); });
      } else {
        const receiptTotal = parseFloat(String(rec.total_amount ?? "0")) || 0;
        const amounts = splitTotalsRaw.map((s: { amount?: number }) => Number(s?.amount ?? 0) || 0);
        const totalSaved = amounts.reduce((a: number, b: number) => a + b, 0) || receiptTotal || 1;
        const sharePct = membersList.length ? amounts.map((amt: number) => (amt / totalSaved) * 100) : [];
        loadedItems.forEach((_, idx) => {
          assignAll[idx] = membersList.length ? membersList.map((_, i) => i) : [];
          if (membersList.length && sharePct.length === membersList.length) {
            const pctSum = sharePct.reduce((a: number, b: number) => a + b, 0);
            const normalized = pctSum > 0 ? sharePct.map((p: number) => Number((p * 100 / pctSum).toFixed(2))) : sharePct.map(() => 100 / membersList.length);
            const obj: Record<number, number> = {};
            normalized.forEach((p: number, i: number) => { obj[i] = p; });
            initialDynamic[idx] = obj;
          }
        });
      }
      setAssignments(assignAll);
      setDynamicPercentages(initialDynamic);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to load receipt");
    } finally {
      setEditLoading(false);
    }
  }, [receiptId, user?.id]);

  useEffect(() => {
    if (isEditMode && user?.id) void loadReceiptForEdit();
  }, [isEditMode, user?.id, loadReceiptForEdit]);

  useEffect(() => {
    if (isManualMode && items.length === 0) {
      setItems([{ name: "", qty: 1, price: "0" }]);
      setEditItemsMode(true);
    }
  }, [isManualMode]);

  useEffect(() => {
    if (isRestaurantOrGroceriesManual && members.length === 0 && profile?.username) {
      setMembers([{ username: profile.username, avatar_url: profile.avatar_url ?? null }]);
    }
  }, [isRestaurantOrGroceriesManual, members.length, profile?.username, profile?.avatar_url]);

  const filteredFriends = useMemo(() => {
    const q = friendSearchQuery.trim().toLowerCase();
    if (!q) return friendsList;
    return friendsList.filter(
      (f) =>
        f.username.toLowerCase().includes(q) ||
        (f.display_name || "").toLowerCase().includes(q)
    );
  }, [friendsList, friendSearchQuery]);

  const splitTotals = useMemo(() => {
    const baseTotals = new Array(members.length).fill(0);
    items.forEach((item, itemIndex) => {
      const assignees = assignments[itemIndex] || [];
      if (!assignees.length) return;
      const price = parseFloat(item.price || "0") || 0;
      const dynamicForItem = dynamicPercentages[itemIndex];
      if (dynamicForItem) {
        assignees.forEach((memberIndex) => {
          const pct = dynamicForItem[memberIndex] ?? 0;
          baseTotals[memberIndex] += price * (pct / 100);
        });
      } else {
        const share = price / assignees.length;
        assignees.forEach((memberIndex) => {
          baseTotals[memberIndex] += share;
        });
      }
    });

    const totals = [...baseTotals];

    // For scanned receipts, reconcile to receipt total so tax, discounts, fees are included. For manual, no adjustment — user adds tax as a line item.
    if (!isManualMode) {
      const itemsSubtotal = items.reduce((sum, item) => sum + (parseFloat(item.price || "0") || 0), 0);
      const effectiveTotal = isRestaurantOrGroceriesManual ? calculatedTotalFromItems : total;
      const receiptTotal = parseFloat(effectiveTotal || "0") || 0;
      const adjustment = receiptTotal - itemsSubtotal;
      const assignedBaseSum = baseTotals.reduce((sum, value) => sum + value, 0);

      if (Math.abs(adjustment) > 0.0001 && members.length) {
        if (assignedBaseSum > 0.0001) {
          totals.forEach((amount, idx) => {
            totals[idx] = amount + adjustment * (amount / assignedBaseSum);
          });
        } else {
          const evenShare = adjustment / members.length;
          totals.forEach((_, idx) => {
            totals[idx] = evenShare;
          });
        }
      }
    }

    return members.map((m, i) => ({ name: m.username, amount: Math.round(totals[i] * 100) / 100 }));
  }, [assignments, dynamicPercentages, items, members, total, isRestaurantOrGroceriesManual, calculatedTotalFromItems, isManualMode]);

  const loadFriendsForMember = async () => {
    if (!user?.id) return;
    setFriendsLoading(true);
    setSaveError(null);
    try {
      const myId = user.id;
      const { data: asUser, error: e1 } = await supabase.from("friendships").select("id, friend_id, status").eq("user_id", myId).eq("status", "accepted");
      if (e1) throw new Error(e1.message);
      const { data: asFriend, error: e2 } = await supabase.from("friendships").select("id, user_id, status").eq("friend_id", myId).eq("status", "accepted");
      if (e2) throw new Error(e2.message);
      const ids = new Set<string>();
      (asUser || []).forEach((r) => ids.add(r.friend_id));
      (asFriend || []).forEach((r) => ids.add(r.user_id));
      const list: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }[] = [];
      for (const id of ids) {
        const { data: prof } = await supabase.from("profiles").select("username, display_name, avatar_url").eq("id", id).single();
        const p = prof as { username?: string; display_name?: string | null; avatar_url?: string | null } | null;
        if (p?.username) list.push({ id, username: p.username, display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null });
      }
      setFriendsList(list);
      setAddMemberModalVisible(true);
      setFriendSearchQuery("");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to load friends");
    } finally {
      setFriendsLoading(false);
    }
  };

  const addMemberFromFriend = (friend: { username: string; avatar_url?: string | null }) => {
    const u = friend.username.trim().toLowerCase();
    if (!u || members.some((m) => m.username.toLowerCase() === u)) return;
    setMembers((prev) => [...prev, { username: friend.username.trim(), avatar_url: friend.avatar_url ?? null }]);
    setAddMemberModalVisible(false);
    setSaveError(null);
  };

  const updateItem = (index: number, field: keyof ResultItem, value: string | number) => {
    setItems((prev) => {
      const next = [...prev];
      if (!next[index]) return next;
      if (field === "qty") {
        const num = typeof value === "number" ? value : (String(value).trim() === "" ? 0 : parseInt(String(value).replace(/\D/g, ""), 10));
        next[index] = { ...next[index], qty: Number.isNaN(num) ? 0 : num };
      } else if (field === "price") next[index] = { ...next[index], price: String(value) };
      else next[index] = { ...next[index], name: String(value) };
      return next;
    });
  };

  const addItem = () => {
    setItems((prev) => [...prev, { name: "", qty: 1, price: "0.00" }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setAssignments((prev) => {
      const next: Assignments = {};
      Object.entries(prev).forEach(([key, memberIndexes]) => {
        const idx = Number(key);
        if (idx === index) return;
        next[idx > index ? idx - 1 : idx] = memberIndexes;
      });
      return next;
    });
    setDynamicPercentages((prev) => {
      const next: DynamicPercentages = {};
      Object.entries(prev).forEach(([key, pct]) => {
        const idx = Number(key);
        if (idx === index) return;
        next[idx > index ? idx - 1 : idx] = pct;
      });
      return next;
    });
  };

  const removeMember = (memberIndex: number) => {
    setMembers((prev) => prev.filter((_, i) => i !== memberIndex));
    setAssignments((prev) => {
      const next: Assignments = {};
      Object.keys(prev).forEach((key) => {
        const itemIndex = Number(key);
        const updated = (prev[itemIndex] || []).filter((i) => i !== memberIndex).map((i) => (i > memberIndex ? i - 1 : i));
        if (updated.length) next[itemIndex] = updated;
      });
      return next;
    });
    setDynamicPercentages((prev) => {
      const out: DynamicPercentages = {};
      Object.keys(prev).forEach((k) => {
        const itemIdx = Number(k);
        const remapped: Record<number, number> = {};
        Object.entries(prev[itemIdx] || {}).forEach(([memberIdxRaw, pct]) => {
          const memberIdx = Number(memberIdxRaw);
          if (memberIdx === memberIndex) return;
          remapped[memberIdx > memberIndex ? memberIdx - 1 : memberIdx] = pct;
        });
        if (Object.keys(remapped).length) out[itemIdx] = remapped;
      });
      return out;
    });
  };

  const addGroup = () => {
    void openGroupPicker();
  };

  const openGroupPicker = async () => {
    if (!user?.id) return;
    setGroupsLoading(true);
    setSaveError(null);
    try {
      const { data: rows, error } = await supabase
        .from("groups")
        .select("id, name, avatar_url, group_members(user_id, status, profiles(username, display_name, avatar_url))");
      if (error) throw new Error(error.message);
      type Gm = { status?: string; profiles?: { username?: string; display_name?: string | null; avatar_url?: string | null } | null };
      type GroupRow = { id: string; name: string; avatar_url?: string | null; group_members?: Gm[] };
      const list = ((rows || []) as GroupRow[])
        .map((g) => {
          const acceptedOnly = (g.group_members || []).filter((gm) => (gm as Gm).status === "accepted");
          return {
            id: String(g.id),
            name: g.name,
            avatar_url: g.avatar_url ?? null,
            members: acceptedOnly
              .map((gm) => {
                const p = (gm as Gm).profiles;
                if (!p?.username) return null;
                return {
                  username: p.username,
                  display_name: p.display_name ?? null,
                  avatar_url: p.avatar_url ?? null,
                } as GroupMemberInfo;
              })
              .filter(Boolean) as GroupMemberInfo[],
          };
        })
        .filter((g) => g.members.length > 0);
      setGroups(list);
      setGroupPickerVisible(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setGroupsLoading(false);
    }
  };

  const applyGroupMembers = (group: MemberGroup) => {
    setMembers((prev) => {
      const next = [...prev];
      const existing = new Set(next.map((m) => m.username.toLowerCase()));
      group.members.forEach((m) => {
        const u = m.username.trim().toLowerCase();
        if (u && !existing.has(u)) {
          existing.add(u);
          next.push({ username: m.username.trim(), avatar_url: m.avatar_url ?? null });
        }
      });
      return next;
    });
    setGroupPickerVisible(false);
  };

  const toggleAssignment = (itemIndex: number, memberIndex: number) => {
    setAssignments((prev) => {
      const current = prev[itemIndex] || [];
      const has = current.includes(memberIndex);
      const updated = has ? current.filter((i) => i !== memberIndex) : [...current, memberIndex];
      const next = { ...prev };
      if (updated.length) next[itemIndex] = updated; else delete next[itemIndex];
      return next;
    });
    setDynamicPercentages((prev) => {
      const next = { ...prev };
      delete next[itemIndex];
      return next;
    });
  };

  const toggleAssignAllForItem = (itemIndex: number) => {
    setAssignments((prev) => {
      const current = prev[itemIndex] || [];
      const allMemberIndexes = members.map((_, idx) => idx);
      const isAllSelected = members.length > 0 && current.length === members.length;
      const next = { ...prev };
      if (isAllSelected) {
        delete next[itemIndex];
      } else {
        next[itemIndex] = allMemberIndexes;
      }
      return next;
    });
    setDynamicPercentages((prev) => {
      const next = { ...prev };
      delete next[itemIndex];
      return next;
    });
  };

  const clearAllAssignments = () => {
    setAssignments({});
    setDynamicPercentages({});
  };

  const openDynamicSplitModal = (itemIndex: number) => {
    const assignees = assignments[itemIndex] || [];
    if (!assignees.length) {
      Alert.alert("Dynamic Splitting", "Assign at least one member first.");
      return;
    }

    const itemTotal = parseFloat(items[itemIndex]?.price ?? "0") || 0;
    const existing = dynamicPercentages[itemIndex] || {};
    const sorted = [...assignees].sort((a, b) => a - b);
    const n = sorted.length;
    const draftText: Record<number, string> = {};

    if (dynamicSplitMode === "percentage") {
      const equal = n ? 100 / n : 0;
      sorted.forEach((memberIdx) => {
        const value = existing[memberIdx];
        draftText[memberIdx] = Number.isFinite(value) ? value.toFixed(2) : equal.toFixed(2);
      });
    } else if (dynamicSplitMode === "amount") {
      const equalAmt = n ? itemTotal / n : 0;
      sorted.forEach((memberIdx) => {
        const pct = existing[memberIdx];
        const amt = Number.isFinite(pct) ? (itemTotal * pct) / 100 : equalAmt;
        draftText[memberIdx] = amt.toFixed(2);
      });
    } else {
      sorted.forEach((memberIdx) => {
        draftText[memberIdx] = "1";
      });
    }

    setDynamicItemIndex(itemIndex);
    setDynamicAssignees(sorted);
    setDynamicDraft(draftText);
    setDynamicModalVisible(true);
  };

  const updateDynamicDraft = (memberIndex: number, input: string) => {
    if (dynamicSplitMode === "shares") {
      if (!/^\d*$/.test(input)) return;
    } else {
      if (!/^\d*\.?\d*$/.test(input)) return;
    }
    setDynamicDraft((prev) => ({ ...prev, [memberIndex]: input }));
  };

  const dynamicDraftTotal = useMemo(() => {
    const total = dynamicAssignees.reduce((sum, memberIndex) => {
      const raw = dynamicDraft[memberIndex] ?? "0";
      const value = Number.parseFloat(raw);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
    return Number(total.toFixed(2));
  }, [dynamicAssignees, dynamicDraft]);

  const dynamicItemTotal = useMemo(() => {
    if (dynamicItemIndex == null) return 0;
    return parseFloat(items[dynamicItemIndex]?.price ?? "0") || 0;
  }, [dynamicItemIndex, items]);

  const switchDynamicMode = (mode: DynamicSplitMode) => {
    setDynamicSplitMode(mode);
    const n = dynamicAssignees.length;
    const itemTotal = dynamicItemTotal;
    const existing = dynamicItemIndex != null ? dynamicPercentages[dynamicItemIndex] || {} : {};
    const draftText: Record<number, string> = {};
    if (mode === "percentage") {
      const equal = n ? 100 / n : 0;
      dynamicAssignees.forEach((memberIdx) => {
        const value = existing[memberIdx];
        draftText[memberIdx] = Number.isFinite(value) ? value.toFixed(2) : equal.toFixed(2);
      });
    } else if (mode === "amount") {
      const equalAmt = n ? itemTotal / n : 0;
      dynamicAssignees.forEach((memberIdx) => {
        const pct = existing[memberIdx];
        const amt = Number.isFinite(pct) ? (itemTotal * pct) / 100 : equalAmt;
        draftText[memberIdx] = amt.toFixed(2);
      });
    } else {
      dynamicAssignees.forEach((memberIdx) => {
        draftText[memberIdx] = "1";
      });
    }
    setDynamicDraft(draftText);
  };

  const applyDynamicSplit = () => {
    if (dynamicItemIndex == null || !dynamicAssignees.length) {
      setDynamicModalVisible(false);
      return;
    }
    const out: Record<number, number> = {};
    const itemTotal = dynamicItemTotal;

    if (dynamicAssignees.length === 1) {
      out[dynamicAssignees[0]] = 100;
      setDynamicPercentages((prev) => ({ ...prev, [dynamicItemIndex]: out }));
      setDynamicModalVisible(false);
      return;
    }

    if (dynamicSplitMode === "amount") {
      const amounts = dynamicAssignees.map((memberIndex) => parseFloat(dynamicDraft[memberIndex] ?? "0") || 0);
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum <= 0) {
        setDynamicModalVisible(false);
        return;
      }
      dynamicAssignees.forEach((memberIndex, idx) => {
        out[memberIndex] = Number(((amounts[idx] / sum) * 100).toFixed(2));
      });
      const lastIdx = dynamicAssignees[dynamicAssignees.length - 1];
      const totalPct = Object.values(out).reduce((a, b) => a + b, 0);
      out[lastIdx] = Number((100 - (totalPct - (out[lastIdx] ?? 0))).toFixed(2));
      setDynamicPercentages((prev) => ({ ...prev, [dynamicItemIndex]: out }));
      setDynamicModalVisible(false);
      return;
    }

    if (dynamicSplitMode === "shares") {
      const shares = dynamicAssignees.map((memberIndex) => Math.max(0, parseInt(dynamicDraft[memberIndex] ?? "0", 10) || 0));
      const totalShares = shares.reduce((a, b) => a + b, 0);
      if (totalShares <= 0) {
        setDynamicModalVisible(false);
        return;
      }
      dynamicAssignees.forEach((memberIndex, idx) => {
        out[memberIndex] = Number(((shares[idx] / totalShares) * 100).toFixed(2));
      });
      const totalPct = Object.values(out).reduce((a, b) => a + b, 0);
      const lastIdx = dynamicAssignees[dynamicAssignees.length - 1];
      out[lastIdx] = Number((100 - (totalPct - (out[lastIdx] ?? 0))).toFixed(2));
      setDynamicPercentages((prev) => ({ ...prev, [dynamicItemIndex]: out }));
      setDynamicModalVisible(false);
      return;
    }

    const toSafePercent = (raw: string | undefined) => {
      const parsed = Number.parseFloat(raw || "0");
      if (!Number.isFinite(parsed)) return 0;
      if (parsed < 0) return 0;
      if (parsed >= 100) return 99.99;
      return Number(parsed.toFixed(2));
    };

    const lastMemberIndex = dynamicAssignees[dynamicAssignees.length - 1];
    const nonLastMembers = dynamicAssignees.slice(0, -1);
    let nonLastValues = nonLastMembers.map((memberIndex) => toSafePercent(dynamicDraft[memberIndex]));
    let nonLastSum = nonLastValues.reduce((sum, value) => sum + value, 0);

    if (nonLastSum > 100) {
      const factor = 100 / nonLastSum;
      nonLastValues = nonLastValues.map((value) => Number((value * factor).toFixed(2)));
      nonLastSum = nonLastValues.reduce((sum, value) => sum + value, 0);
    }

    nonLastMembers.forEach((memberIndex, idx) => {
      out[memberIndex] = nonLastValues[idx];
    });

    const remainder = Number((100 - nonLastSum).toFixed(2));
    out[lastMemberIndex] = remainder < 0 ? 0 : remainder;

    setDynamicPercentages((prev) => ({ ...prev, [dynamicItemIndex]: out }));
    setDynamicModalVisible(false);
  };

  const saveReceipt = async () => {
    if (!user?.id) {
      setSaveError("You must be signed in to save.");
      return;
    }
    setSaving(true);
    setSaveError(null);
    setSavedId(null);
    try {
      const totalAmount = isRestaurantOrGroceriesManual ? calculatedTotalFromItems : ((total || "0").trim() || "0");
      const receiptDateValue = isRestaurantOrGroceriesManual ? todayDateString : (date || "").trim() || null;
      const newSplitTotals = splitTotals.map((s) => ({ name: s.name, amount: s.amount }));

      const getMemberUserIds = async (): Promise<string[]> => {
        if (members.length === 0) return [];
        const usernames = members.map((m) => m.username);
        const { data: profs } = await supabase.from("profiles").select("id, username").in("username", usernames);
        const list = (profs || []) as { id: string; username: string }[];
        return members.map((m) => list.find((p) => p.username?.toLowerCase() === m.username?.toLowerCase())?.id).filter(Boolean) as string[];
      };

      const insertReceiptAssignments = async (rid: string, itemIdsInOrder: string[]) => {
        const memberIds = await getMemberUserIds();
        if (memberIds.length === 0) return;
        for (let i = 0; i < items.length; i++) {
          const assignees = assignments[i] || [];
          if (assignees.length === 0) continue;
          const itemId = itemIdsInOrder[i];
          if (!itemId) continue;
          const it = items[i];
          const itemTotal = parseFloat(it?.price ?? "0") || 0;
          const dyn = dynamicPercentages[i];
          for (const memberIndex of assignees) {
            const userId = memberIds[memberIndex];
            if (!userId) continue;
            const pct = dyn?.[memberIndex];
            const shareAmount = pct != null ? (itemTotal * pct) / 100 : itemTotal / assignees.length;
            await supabase.from("receipt_assignments").insert({
              receipt_id: rid,
              item_id: itemId,
              user_id: userId,
              share_amount: Math.round(shareAmount * 100) / 100,
            });
          }
        }
      };

      if (isEditMode && receiptId) {
        const { data: existing } = await supabase.from("receipts").select("paid_members").eq("id", receiptId).single();
        const currentPaid = Array.isArray((existing as { paid_members?: string[] })?.paid_members) ? (existing as { paid_members: string[] }).paid_members.map(String) : [];
        const newNames = new Set(newSplitTotals.map((s) => s.name.trim().toLowerCase()));
        const paidMembers = currentPaid.filter((n) => newNames.has(n.trim().toLowerCase()));
        const paid = newSplitTotals.length > 0 && newSplitTotals.every((s) => paidMembers.includes(s.name));

        const { error: updateErr } = await supabase
          .from("receipts")
          .update({
            merchant: (merchant || "").trim() || null,
            receipt_date: receiptDateValue,
            total_amount: totalAmount,
            currency: currencyCode || "MYR",
            split_totals: newSplitTotals,
            paid_members: paidMembers,
            paid,
            category: category || "others",
          })
          .eq("id", receiptId)
          .eq("host_id", user.id);
        if (updateErr) throw new Error(updateErr.message);

        const { error: delAssignErr } = await supabase.from("receipt_assignments").delete().eq("receipt_id", receiptId);
        if (delAssignErr) throw new Error(delAssignErr.message);
        const { error: delErr } = await supabase.from("receipt_items").delete().eq("receipt_id", receiptId);
        if (delErr) throw new Error(delErr.message);

        for (const item of items) {
          const qty = Number(item.qty) || 1;
          const lineTotal = parseFloat(item.price ?? "0") || 0;
          const unitPrice = qty > 0 ? (lineTotal / qty).toFixed(2) : "0";
          await supabase.from("receipt_items").insert({
            receipt_id: receiptId,
            name: item.name ?? "",
            qty,
            unit_price: unitPrice,
            total_price: lineTotal.toFixed(2),
          });
        }
        const { data: itemRows } = await supabase.from("receipt_items").select("id").eq("receipt_id", receiptId).order("created_at", { ascending: true });
        const itemIdsInOrder = (itemRows || []).map((r: { id: string }) => r.id);
        await insertReceiptAssignments(receiptId, itemIdsInOrder);
        setSavedId(receiptId);
      } else {
        const hostUsername = (profile?.username ?? "").trim();
        const initialPaidMembers = hostUsername ? [hostUsername] : [];
        const { data: receiptRow, error: receiptError } = await supabase
          .from("receipts")
          .insert({
            host_id: user.id,
            merchant: (merchant || "").trim() || null,
            receipt_date: receiptDateValue,
            total_amount: totalAmount,
            currency: currencyCode || "MYR",
            source: source as "vision" | "ocr" | "manual",
            split_totals: newSplitTotals,
            paid_members: initialPaidMembers,
            paid: false,
            category: category || "others",
          })
          .select("id")
          .single();
        if (receiptError) throw new Error(receiptError.message);
        const newId = receiptRow?.id;
        if (!newId) throw new Error("No receipt id returned");
        for (const item of items) {
          const qty = Number(item.qty) || 1;
          const lineTotal = parseFloat(item.price ?? "0") || 0;
          const unitPrice = qty > 0 ? (lineTotal / qty).toFixed(2) : "0";
          await supabase.from("receipt_items").insert({
            receipt_id: newId,
            name: item.name ?? "",
            qty,
            unit_price: unitPrice,
            total_price: lineTotal.toFixed(2),
          });
        }
        const { data: itemRows } = await supabase.from("receipt_items").select("id").eq("receipt_id", newId).order("created_at", { ascending: true });
        const itemIdsInOrder = (itemRows || []).map((r: { id: string }) => r.id);
        await insertReceiptAssignments(String(newId), itemIdsInOrder);
        if (imageUri && user?.id) {
          const imageUrl = await uploadReceiptImage(imageUri, user.id, String(newId));
          if (imageUrl) {
            await supabase.from("receipts").update({ image_url: imageUrl }).eq("id", newId);
          }
        }
        setSavedId(String(newId));
      }
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  if (editLoading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading receipt…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.accent} />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
            <Ionicons name="arrow-back" size={22} color="#e5e5e5" />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={styles.title}>{isEditMode ? "Edit receipt" : isManualMode ? "Quick Split" : "Review receipt"}</Text>
            <Text style={styles.subtitle}>
              {isEditMode ? "Edit details and split" : isManualMode ? manualLabels.subtitle : categoryLabel ? `Assign items and save · ${categoryLabel}` : "Assign items and save"}
            </Text>
          </View>
        </View>

        {/* Receipt hero - no image in manual mode */}
        <View style={styles.heroCard}>
          {!isManualMode && (imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.heroImage} resizeMode="cover" />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="receipt-outline" size={48} color="#525252" />
            </View>
          ))}
          <View style={styles.heroStrip}>
            <View style={styles.heroInitialWrap}>
              <Text style={styles.heroInitial}>{receiptInitial(merchant || "-")}</Text>
            </View>
            <View style={styles.heroMeta}>
              {isManualMode ? (
                <>
                  <TextInput
                    style={styles.heroMerchantInput}
                    value={merchant}
                    onChangeText={setMerchant}
                    placeholder={manualLabels.titlePlaceholder}
                    placeholderTextColor="#525252"
                  />
                  {isRestaurantOrGroceriesManual ? (
                    <Text style={styles.heroDate}>Today</Text>
                  ) : (
                    <TextInput
                      style={styles.heroDateInput}
                      value={date}
                      onChangeText={setDate}
                      placeholder="Date"
                      placeholderTextColor="#525252"
                    />
                  )}
                </>
              ) : (
                <>
                  <Text style={styles.heroMerchant} numberOfLines={1}>{merchant || "—"}</Text>
                  <Text style={styles.heroDate}>{date || "—"}</Text>
                </>
              )}
            </View>
            {isManualMode ? (
              isRestaurantOrGroceriesManual ? (
                <Text style={styles.heroTotal}>{calculatedTotalFromItems ? formatAmount(calculatedTotalFromItems, currencyCode) : "0.00"}</Text>
              ) : (
                <TextInput
                  style={styles.heroTotalInput}
                  value={total}
                  onChangeText={setTotal}
                  placeholder="0.00"
                  placeholderTextColor="#737373"
                  keyboardType="decimal-pad"
                />
              )
            ) : (
              <Text style={styles.heroTotal}>{total ? formatAmount(total, currencyCode) : "—"}</Text>
            )}
          </View>
        </View>

        {/* Who's splitting */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, styles.whoSplittingLabel]}>Who's splitting?</Text>
          <View style={styles.quickActions}>
            <Pressable onPress={loadFriendsForMember} style={({ pressed }) => [styles.quickBtnPrimary, pressed && styles.pressed]} disabled={friendsLoading}>
              <Ionicons name="person-add-outline" size={20} color="#0a0a0a" />
              <Text style={styles.quickBtnPrimaryText}>{friendsLoading ? "Loading…" : "Add member"}</Text>
            </Pressable>
            <Pressable onPress={addGroup} style={({ pressed }) => [styles.quickBtnSecondary, pressed && styles.pressed]}>
              <Ionicons name="people-outline" size={20} color="#e5e5e5" />
              <Text style={styles.quickBtnSecondaryText}>From group</Text>
            </Pressable>
          </View>
          {members.length > 0 ? (
            <View style={styles.memberChips}>
              {members.map((member, idx) => (
                <View key={`${member.username}-${idx}`} style={styles.memberChipWrap}>
                  {member.avatar_url ? (
                    <ExpoImage source={{ uri: member.avatar_url }} style={styles.memberChipAvatar} />
                  ) : (
                    <View style={styles.memberChipAvatarPlaceholder}>
                      <Text style={styles.memberChipAvatarText}>{groupInitial(member.username)}</Text>
                    </View>
                  )}
                  <Text style={styles.memberChipText}>{member.username}</Text>
                  {isRestaurantOrGroceriesManual && member.username?.toLowerCase() === profile?.username?.toLowerCase() ? null : (
                    <Pressable onPress={() => removeMember(idx)} hitSlop={8}>
                      <Ionicons name="close-circle" size={18} color="#737373" />
                    </Pressable>
                  )}
                </View>
              ))}
            </View>
          ) : null}
          {hasAssignedMembers ? (
            <Pressable style={({ pressed }) => [styles.clearLink, pressed && styles.pressed]} onPress={clearAllAssignments}>
              <Ionicons name="refresh-outline" size={14} color="#a3a3a3" />
              <Text style={styles.clearLinkText}>Clear all assignments</Text>
            </Pressable>
          ) : null}
        </View>

        {/* Items */}
        <View style={styles.section}>
          <View style={styles.sectionHeaderRow}>
            <Text style={styles.sectionLabel}>Items ({items.length})</Text>
            <Pressable onPress={() => setEditItemsMode((v) => !v)} style={({ pressed }) => [styles.sectionEditBtn, pressed && styles.pressed]}>
              <Ionicons name={editItemsMode ? "checkmark" : "pencil"} size={16} color="#8DEB63" />
              <Text style={styles.sectionEditBtnText}>{editItemsMode ? "Done" : "Edit"}</Text>
            </Pressable>
          </View>
          {items.length > 0 ? (
            <View style={styles.itemsCard}>
              {items.map((item, index) => (
                <View key={`item-${index}`} style={[styles.itemCard, index === items.length - 1 && styles.itemCardLast]}>
                  <View style={styles.itemRow}>
                    <View style={styles.itemLeft}>
                      {editItemsMode ? (
                        <>
                          <TextInput
                            style={styles.itemNameInput}
                            value={item.name ?? ""}
                            onChangeText={(v) => updateItem(index, "name", v)}
                            placeholder="Item name"
                            placeholderTextColor="#525252"
                          />
                          <View style={styles.itemQtyRow}>
                            <Text style={styles.itemQtyLabel}>Qty</Text>
                            <TextInput
                              style={styles.itemQtyInput}
                              value={item.qty === 0 || item.qty === undefined ? "" : String(item.qty)}
                              onChangeText={(v) => updateItem(index, "qty", v)}
                              placeholder="1"
                              placeholderTextColor="#525252"
                              keyboardType="number-pad"
                            />
                          </View>
                        </>
                      ) : (
                        <>
                          <Text style={styles.itemName}>{item.name || "—"}</Text>
                          <Text style={styles.itemQty}>Qty {item.qty ?? 1}</Text>
                        </>
                      )}
                    </View>
                    <View style={styles.itemPriceRow}>
                      {editItemsMode ? (
                        <>
                          <TextInput
                            style={styles.itemPriceInput}
                            value={item.price ?? ""}
                            onChangeText={(v) => updateItem(index, "price", v)}
                            placeholder="0.00"
                            placeholderTextColor="#525252"
                            keyboardType="decimal-pad"
                          />
                          <Pressable onPress={() => removeItem(index)} style={({ pressed }) => [styles.itemRemoveBtn, pressed && styles.pressed]} hitSlop={8}>
                            <Ionicons name="trash-outline" size={18} color="#fca5a5" />
                          </Pressable>
                        </>
                      ) : (
                        <Text style={styles.itemPrice}>{item.price ? formatAmount(item.price, currencyCode) : "—"}</Text>
                      )}
                    </View>
                  </View>
                  {members.length > 0 ? (
                    <View style={styles.assignBlock}>
                      <Text style={styles.assignLabel}>Assign to</Text>
                      <View style={styles.assignChips}>
                        <Pressable
                          onPress={() => toggleAssignAllForItem(index)}
                          style={({ pressed }) => [
                            styles.assignChip,
                            (assignments[index] || []).length === members.length && styles.assignChipSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={[
                            styles.assignChipText,
                            (assignments[index] || []).length === members.length && styles.assignChipTextSelected,
                          ]}>All</Text>
                        </Pressable>
                        {members.map((member, memberIndex) => {
                          const selected = (assignments[index] || []).includes(memberIndex);
                          return (
                            <Pressable
                              key={`${member.username}-${memberIndex}`}
                              onPress={() => toggleAssignment(index, memberIndex)}
                              style={({ pressed }) => [styles.assignChip, selected && styles.assignChipSelected, pressed && styles.pressed]}
                            >
                              <Text style={[styles.assignChipText, selected && styles.assignChipTextSelected]}>{member.username}</Text>
                            </Pressable>
                          );
                        })}
                      </View>
                      {(assignments[index] || []).length > 0 ? (
                        <Pressable onPress={() => openDynamicSplitModal(index)} style={({ pressed }) => [styles.dynamicBtn, pressed && styles.pressed]}>
                          <Ionicons name="pie-chart-outline" size={14} color="#8DEB63" />
                          <Text style={styles.dynamicBtnText}>Split by %</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              ))}
              {editItemsMode ? (
                <Pressable onPress={addItem} style={({ pressed }) => [styles.addItemBtn, pressed && styles.pressed]}>
                  <Ionicons name="add-circle-outline" size={20} color="#8DEB63" />
                  <Text style={styles.addItemBtnText}>Add item</Text>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <View style={styles.emptyItems}>
              <Ionicons name="list-outline" size={32} color="#525252" />
              <Text style={styles.emptyItemsText}>No line items yet</Text>
              <Pressable onPress={() => { addItem(); setEditItemsMode(true); }} style={({ pressed }) => [styles.addItemBtn, pressed && styles.pressed]}>
                <Ionicons name="add-circle-outline" size={20} color="#8DEB63" />
                <Text style={styles.addItemBtnText}>Add item</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Split summary */}
        {hasAssignedMembers && splitTotals.length > 0 ? (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, styles.splitSummaryLabel]}>Split summary</Text>
            <View style={styles.totalsCard}>
              <Text style={styles.adjustmentNote}>
                {isManualMode ? "Add tax, tips or fees as a line item if needed." : "Includes tax, discounts & fees"}
              </Text>
              {splitTotals.map((entry) => (
                <View key={entry.name} style={styles.totalRow}>
                  <Text style={styles.totalName}>{entry.name}</Text>
                  <Text style={styles.totalAmount}>{formatAmount(entry.amount, currencyCode)}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {/* Modals */}
        <Modal transparent visible={dynamicModalVisible} animationType="fade" onRequestClose={() => setDynamicModalVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setDynamicModalVisible(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalAccent} />
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Ionicons name="pie-chart-outline" size={22} color="#8DEB63" />
                  <Text style={styles.modalTitle}>Dynamic split</Text>
                </View>
                <View style={styles.dynamicModeRow}>
                  <Pressable style={[styles.dynamicModeTab, dynamicSplitMode === "percentage" && styles.dynamicModeTabActive]} onPress={() => switchDynamicMode("percentage")}>
                    <Text style={[styles.dynamicModeTabText, dynamicSplitMode === "percentage" && styles.dynamicModeTabTextActive]}>%</Text>
                  </Pressable>
                  <Pressable style={[styles.dynamicModeTab, dynamicSplitMode === "amount" && styles.dynamicModeTabActive]} onPress={() => switchDynamicMode("amount")}>
                    <Text style={[styles.dynamicModeTabText, dynamicSplitMode === "amount" && styles.dynamicModeTabTextActive]}>Amount</Text>
                  </Pressable>
                  <Pressable style={[styles.dynamicModeTab, dynamicSplitMode === "shares" && styles.dynamicModeTabActive]} onPress={() => switchDynamicMode("shares")}>
                    <Text style={[styles.dynamicModeTabText, dynamicSplitMode === "shares" && styles.dynamicModeTabTextActive]}>Shares</Text>
                  </Pressable>
                </View>
                <Text style={styles.modalHint}>
                  {dynamicSplitMode === "percentage" && "Set share % per person. Total must equal 100%."}
                  {dynamicSplitMode === "amount" && `Enter amount each pays. Line total: ${getCurrency(currencyCode).symbol}${dynamicItemTotal.toFixed(2)}`}
                  {dynamicSplitMode === "shares" && "Enter whole-number shares (e.g. 1, 2, 3). Split is proportional."}
                </Text>
                <View style={styles.modalTotalRow}>
                  <Text style={styles.modalTotalLabel}>Total</Text>
                  <Text style={[styles.modalTotal, (dynamicSplitMode === "percentage" ? dynamicDraftTotal === 100 : dynamicSplitMode === "amount" ? (dynamicItemTotal > 0 && Math.abs(dynamicDraftTotal - dynamicItemTotal) < 0.02) : dynamicDraftTotal > 0) && styles.modalTotalOk]}>
                    {dynamicSplitMode === "percentage" && `${dynamicDraftTotal.toFixed(1)}%`}
                    {dynamicSplitMode === "amount" && `${getCurrency(currencyCode).symbol}${dynamicDraftTotal.toFixed(2)}`}
                    {dynamicSplitMode === "shares" && `${dynamicDraftTotal} share${dynamicDraftTotal !== 1 ? "s" : ""}`}
                  </Text>
                </View>
                {dynamicAssignees.map((memberIndex) => (
                  <View key={`dynamic-${memberIndex}`} style={styles.modalRow}>
                    <Text style={styles.modalMember} numberOfLines={1}>{members[memberIndex]?.username ?? `Member ${memberIndex + 1}`}</Text>
                    <View style={styles.modalInputWrap}>
                      <TextInput
                        keyboardType={dynamicSplitMode === "shares" ? "number-pad" : "decimal-pad"}
                        value={dynamicDraft[memberIndex] ?? ""}
                        onChangeText={(txt) => updateDynamicDraft(memberIndex, txt)}
                        style={styles.modalInput}
                        placeholder={dynamicSplitMode === "shares" ? "1" : "0"}
                        placeholderTextColor="#525252"
                      />
                      <Text style={styles.modalSuffix}>
                        {dynamicSplitMode === "percentage" && "%"}
                        {dynamicSplitMode === "amount" && getCurrency(currencyCode).symbol}
                        {dynamicSplitMode === "shares" && " share(s)"}
                      </Text>
                    </View>
                  </View>
                ))}
                <View style={styles.modalActions}>
                  <Pressable onPress={() => setDynamicModalVisible(false)} style={({ pressed }) => [styles.modalBtnGhost, pressed && styles.pressed]}>
                    <Text style={styles.modalBtnGhostText}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={applyDynamicSplit} style={({ pressed }) => [styles.modalBtnPrimary, pressed && styles.pressed]}>
                    <Text style={styles.modalBtnPrimaryText}>Apply</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </Modal>

        <Modal transparent visible={groupPickerVisible} animationType="fade" onRequestClose={() => setGroupPickerVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setGroupPickerVisible(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalAccent} />
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Ionicons name="people-outline" size={22} color="#8DEB63" />
                  <Text style={styles.modalTitle}>Add from group</Text>
                </View>
                <Text style={styles.modalHint}>Choose a group to add its members to the split.</Text>
                {groupsLoading ? (
                  <Text style={styles.modalHint}>Loading…</Text>
                ) : !groups.length ? (
                  <Text style={styles.modalHint}>No groups yet. Create one from the Groups tab.</Text>
                ) : (
                  <ScrollView style={styles.groupList} nestedScrollEnabled>
                    {groups.map((group) => (
                      <Pressable key={group.id} onPress={() => applyGroupMembers(group)} style={({ pressed }) => [styles.groupPickRow, pressed && styles.pressed]}>
                        <View style={styles.groupPickLeft}>
                          {group.avatar_url ? (
                            <ExpoImage source={{ uri: group.avatar_url }} style={styles.groupPickAvatarImg} />
                          ) : (
                            <View style={styles.groupPickAvatar}>
                              <Ionicons name="people" size={22} color="#8DEB63" />
                            </View>
                          )}
                          <View style={styles.groupPickInfo}>
                            <Text style={styles.groupPickName}>{group.name}</Text>
                            <View style={styles.groupPickMembersRow}>
                              {group.members.slice(0, 4).map((m, i) => (
                                <View key={`${group.id}-${m.username}-${i}`} style={styles.groupPickMemberChip}>
                                  {m.avatar_url ? (
                                    <ExpoImage source={{ uri: m.avatar_url }} style={styles.groupPickMemberChipImg} />
                                  ) : (
                                    <View style={styles.groupPickMemberChipPlaceholder}>
                                      <Text style={styles.groupPickMemberChipText}>{groupInitial(m.username)}</Text>
                                    </View>
                                  )}
                                  <Text style={styles.groupPickMemberName} numberOfLines={1}>{displayName(m)}</Text>
                                </View>
                              ))}
                              {group.members.length > 4 ? (
                                <Text style={styles.groupPickMemberMore}>+{group.members.length - 4}</Text>
                              ) : null}
                            </View>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color="#737373" />
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <Pressable onPress={() => setGroupPickerVisible(false)} style={({ pressed }) => [styles.modalBtnGhost, styles.modalBtnFull, pressed && styles.pressed]}>
                  <Text style={styles.modalBtnGhostText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal transparent visible={addMemberModalVisible} animationType="fade" onRequestClose={() => setAddMemberModalVisible(false)}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setAddMemberModalVisible(false)} />
            <View style={styles.modalCard}>
              <View style={styles.modalAccent} />
              <View style={styles.modalBody}>
                <View style={styles.modalTitleRow}>
                  <Ionicons name="person-add-outline" size={22} color="#8DEB63" />
                  <Text style={styles.modalTitle}>Add member</Text>
                </View>
                <Text style={styles.modalHint}>Search by username. Only friends can be added.</Text>
                <View style={styles.friendSearchWrap}>
                  <Ionicons name="search" size={18} color="#737373" style={styles.friendSearchIcon} />
                  <TextInput
                    value={friendSearchQuery}
                    onChangeText={setFriendSearchQuery}
                    style={styles.friendSearchInput}
                    placeholder="Search username..."
                    placeholderTextColor="#525252"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
                <ScrollView style={styles.friendListScroll} nestedScrollEnabled>
                  {filteredFriends.length === 0 ? (
                    <Text style={styles.modalHint}>
                      {friendsList.length === 0 ? "No friends yet. Add friends from the Friends tab." : "No matching username."}
                    </Text>
                  ) : (
                    filteredFriends.map((f) => {
                      const added = members.some((m) => m.username.toLowerCase() === f.username.toLowerCase());
                      return (
                        <Pressable
                          key={f.id}
                          onPress={() => addMemberFromFriend(f)}
                          style={({ pressed }) => [styles.friendPickRow, pressed && styles.pressed, added && styles.friendPickRowDisabled]}
                          disabled={added}
                        >
                          {f.avatar_url ? (
                            <ExpoImage source={{ uri: f.avatar_url }} style={styles.friendPickAvatar} />
                          ) : (
                            <View style={styles.friendPickAvatarPlaceholder}>
                              <Text style={styles.friendPickAvatarText}>{groupInitial(f.username)}</Text>
                            </View>
                          )}
                          <View style={styles.friendPickInfo}>
                            <Text style={styles.friendPickName}>@{f.username}</Text>
                            {f.display_name ? <Text style={styles.friendPickDisplay} numberOfLines={1}>{f.display_name}</Text> : null}
                          </View>
                          {added ? (
                            <View style={styles.friendPickAddedBadge}>
                              <Ionicons name="checkmark-circle" size={18} color="#8DEB63" />
                              <Text style={styles.friendPickAdded}>Added</Text>
                            </View>
                          ) : (
                            <Ionicons name="chevron-forward" size={18} color="#737373" />
                          )}
                        </Pressable>
                      );
                    })
                  )}
                </ScrollView>
                <Pressable onPress={() => setAddMemberModalVisible(false)} style={({ pressed }) => [styles.modalBtnGhost, styles.modalBtnFull, pressed && styles.pressed]}>
                  <Text style={styles.modalBtnGhostText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* Actions */}
        <View style={styles.actions}>
          {saveError ? <View style={styles.saveErrorWrap}><Ionicons name="warning-outline" size={16} color="#fca5a5" /><Text style={styles.saveError}>{saveError}</Text></View> : null}
          <Pressable
            style={({ pressed }) => [styles.saveButton, pressed && styles.pressed, saving && styles.saveButtonDisabled]}
            onPress={saveReceipt}
            disabled={saving}
          >
            {savedId ? <Ionicons name="checkmark-circle" size={22} color="#0a0a0a" /> : <Ionicons name={isEditMode ? "pencil" : "save-outline"} size={22} color="#0a0a0a" />}
            <Text style={styles.saveButtonText}>
              {saving ? (isEditMode ? "Updating…" : "Saving…") : savedId ? (isEditMode ? "Updated" : "Saved") : isEditMode ? "Update receipt" : "Save receipt"}
            </Text>
          </Pressable>
          {savedId ? (
            <Pressable style={({ pressed }) => [styles.backToHomeBtn, pressed && styles.pressed]} onPress={() => router.replace(`/history/${savedId}`)}>
              <Text style={styles.backToHomeText}>View receipt</Text>
            </Pressable>
          ) : null}
          <Pressable style={({ pressed }) => [styles.backToHomeBtn, pressed && styles.pressed]} onPress={() => router.back()}>
            <Text style={styles.backToHomeText}>{savedId ? "Back to Home" : "Cancel"}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1 },
  content: { paddingBottom: 40, paddingHorizontal: 20 },
  pressed: { opacity: 0.88 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#a3a3a3", fontSize: 15 },

  accent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 16 },
  header: { flexDirection: "row", alignItems: "center", marginBottom: 20, gap: 12 },
  backBtn: { padding: 6 },
  headerTextWrap: { flex: 1 },
  title: { color: "#e5e5e5", fontSize: 24, fontWeight: "700" },
  subtitle: { color: "#a3a3a3", fontSize: 14, marginTop: 2 },

  heroCard: { borderRadius: 16, overflow: "hidden", backgroundColor: "#141414", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", marginBottom: 28 },
  heroImage: { width: "100%", height: 180, backgroundColor: "#1a1a1a" },
  heroPlaceholder: { width: "100%", height: 140, alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a1a" },
  heroStrip: { flexDirection: "row", alignItems: "center", padding: 16, gap: 14 },
  heroInitialWrap: { width: 44, height: 44, borderRadius: 12, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  heroInitial: { color: "#8DEB63", fontSize: 18, fontWeight: "700" },
  heroMeta: { flex: 1, minWidth: 0 },
  heroMerchant: { color: "#e5e5e5", fontSize: 16, fontWeight: "600" },
  heroDate: { color: "#737373", fontSize: 13, marginTop: 2 },
  heroTotal: { color: "#8DEB63", fontSize: 18, fontWeight: "700" },
  heroMerchantInput: { color: "#e5e5e5", fontSize: 16, fontWeight: "600", padding: 0, margin: 0, minHeight: 22 },
  heroDateInput: { color: "#737373", fontSize: 13, padding: 0, marginTop: 4, minHeight: 18 },
  heroTotalInput: { color: "#8DEB63", fontSize: 18, fontWeight: "700", padding: 0, minWidth: 72, textAlign: "right" },

  section: { marginBottom: 28 },
  sectionLabel: { color: "#737373", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  splitSummaryLabel: { marginBottom: 12 },
  whoSplittingLabel: { marginBottom: 18 },
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionEditBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10 },
  sectionEditBtnText: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },
  quickActions: { flexDirection: "row", gap: 12, marginBottom: 14 },
  quickBtnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#8DEB63",
  },
  quickBtnPrimaryText: { color: "#0a0a0a", fontWeight: "700", fontSize: 14 },
  quickBtnSecondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  quickBtnSecondaryText: { color: "#e5e5e5", fontWeight: "600", fontSize: 14 },
  memberChips: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 10 },
  memberChipWrap: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.1)", paddingVertical: 9, paddingHorizontal: 14 },
  memberChipAvatar: { width: 24, height: 24, borderRadius: 12 },
  memberChipAvatarPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(141,235,99,0.3)", alignItems: "center", justifyContent: "center" },
  memberChipAvatarText: { color: "#8DEB63", fontSize: 11, fontWeight: "700" },
  memberChipText: { color: "#e5e5e5", fontSize: 13 },
  clearLink: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingVertical: 8 },
  clearLinkText: { color: "#a3a3a3", fontSize: 13 },

  itemsCard: { borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", backgroundColor: "#141414", overflow: "hidden" },
  itemCard: {
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  itemCardLast: { borderBottomWidth: 0 },
  itemRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  itemLeft: { flex: 1, minWidth: 0, paddingRight: 16 },
  itemName: { color: "#e5e5e5", fontSize: 16, fontWeight: "500", lineHeight: 22 },
  itemQty: { color: "#737373", fontSize: 13, marginTop: 4 },
  itemPrice: { color: "#8DEB63", fontSize: 16, fontWeight: "600" },
  itemNameInput: { color: "#e5e5e5", fontSize: 16, fontWeight: "500", paddingVertical: 2, paddingHorizontal: 0 },
  itemQtyRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  itemQtyLabel: { color: "#737373", fontSize: 13 },
  itemQtyInput: { color: "#a3a3a3", fontSize: 13, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, minWidth: 44, textAlign: "center" },
  itemPriceRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  itemPriceInput: { color: "#8DEB63", fontSize: 16, fontWeight: "600", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", borderRadius: 8, paddingVertical: 6, paddingHorizontal: 10, minWidth: 72, textAlign: "right" },
  itemRemoveBtn: { padding: 6 },
  addItemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, marginHorizontal: 18, marginBottom: 14, borderWidth: 1, borderColor: "rgba(141,235,99,0.3)", borderRadius: 12, borderStyle: "dashed" },
  addItemBtnText: { color: "#8DEB63", fontSize: 14, fontWeight: "600" },
  assignBlock: {
    marginTop: 14,
    paddingTop: 14,
    paddingHorizontal: 14,
    paddingBottom: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  assignLabel: {
    color: "#737373",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  assignChips: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  assignChip: {
    borderRadius: 20,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  assignChipSelected: { borderColor: "#8DEB63", backgroundColor: "rgba(141,235,99,0.18)" },
  assignChipText: { color: "#a3a3a3", fontSize: 13 },
  assignChipTextSelected: { color: "#8DEB63", fontWeight: "600" },
  dynamicBtn: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(141,235,99,0.12)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
  },
  dynamicBtnText: { color: "#8DEB63", fontSize: 12, fontWeight: "600" },
  emptyItems: { alignItems: "center", paddingVertical: 32, backgroundColor: "#141414", borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  emptyItemsText: { color: "#737373", fontSize: 14, marginTop: 10 },

  totalsCard: { borderRadius: 16, borderWidth: 1, borderColor: "rgba(141,235,99,0.25)", backgroundColor: "rgba(141,235,99,0.08)", padding: 18 },
  adjustmentNote: { color: "#a3a3a3", fontSize: 12, marginBottom: 12 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  totalName: { color: "#e5e5e5", fontSize: 15 },
  totalAmount: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", paddingHorizontal: 20 },
  modalCard: { borderRadius: 16, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "#141414", maxHeight: "80%" },
  modalAccent: { height: 4, backgroundColor: "#8DEB63" },
  modalBody: { padding: 18 },
  modalTitleRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 6 },
  modalTitle: { color: "#e5e5e5", fontSize: 18, fontWeight: "700" },
  modalHint: { color: "#a3a3a3", fontSize: 13, marginBottom: 12 },
  modalTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10 },
  modalTotalLabel: { color: "#a3a3a3", fontSize: 13 },
  modalTotal: { color: "#e5e5e5", fontSize: 15, fontWeight: "700" },
  modalTotalOk: { color: "#8DEB63" },
  modalRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  modalMember: { color: "#e5e5e5", fontSize: 14, flex: 1, paddingRight: 12 },
  modalInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  modalInput: { minWidth: 72, minHeight: 40, borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", backgroundColor: "#0a0a0a", color: "#e5e5e5", fontSize: 15, textAlign: "right", paddingHorizontal: 10 },
  modalPercent: { color: "#737373", fontSize: 14 },
  modalSuffix: { color: "#737373", fontSize: 14, minWidth: 52 },
  dynamicModeRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  dynamicModeTab: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center" },
  dynamicModeTabActive: { backgroundColor: "rgba(141,235,99,0.15)", borderColor: "rgba(141,235,99,0.4)" },
  dynamicModeTabText: { color: "#737373", fontSize: 13, fontWeight: "600" },
  dynamicModeTabTextActive: { color: "#8DEB63", fontWeight: "700" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 16 },
  modalBtnGhost: { minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  modalBtnFull: { width: "100%" },
  modalBtnGhostText: { color: "#e5e5e5", fontWeight: "600", fontSize: 14 },
  modalBtnPrimary: { minHeight: 44, borderRadius: 12, backgroundColor: "#8DEB63", paddingHorizontal: 18, alignItems: "center", justifyContent: "center" },
  modalBtnPrimaryText: { color: "#0a0a0a", fontWeight: "700", fontSize: 14 },
  groupList: { maxHeight: 280, marginBottom: 12 },
  groupPickRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  groupPickLeft: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0, gap: 12 },
  groupPickAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupPickAvatarImg: { width: 48, height: 48, borderRadius: 24 },
  groupPickInfo: { flex: 1, minWidth: 0 },
  groupPickName: { color: "#e5e5e5", fontSize: 15, fontWeight: "600", marginBottom: 6 },
  groupPickMembersRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  groupPickMemberChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 120,
  },
  groupPickMemberChipPlaceholder: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(141,235,99,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  groupPickMemberChipImg: { width: 24, height: 24, borderRadius: 12 },
  groupPickMemberChipText: { color: "#8DEB63", fontSize: 11, fontWeight: "700" },
  groupPickMemberName: { color: "#a3a3a3", fontSize: 12, flex: 1 },
  groupPickMemberMore: { color: "#737373", fontSize: 12 },

  friendSearchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,255,0.06)", borderRadius: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", marginBottom: 12 },
  friendSearchIcon: { marginLeft: 12 },
  friendSearchInput: { flex: 1, color: "#e5e5e5", fontSize: 15, paddingVertical: 12, paddingHorizontal: 10 },
  friendListScroll: { maxHeight: 260, marginBottom: 12 },
  friendPickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    gap: 14,
  },
  friendPickRowDisabled: { opacity: 0.85 },
  friendPickAvatar: { width: 44, height: 44, borderRadius: 22 },
  friendPickAvatarPlaceholder: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  friendPickAvatarText: { color: "#8DEB63", fontSize: 18, fontWeight: "700" },
  friendPickInfo: { flex: 1, minWidth: 0 },
  friendPickName: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  friendPickDisplay: { color: "#a3a3a3", fontSize: 13, marginTop: 2 },
  friendPickAddedBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  friendPickAdded: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },

  actions: { marginTop: 8 },
  saveErrorWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10, paddingHorizontal: 4 },
  saveError: { color: "#fca5a5", fontSize: 13, flex: 1 },
  saveButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 52, borderRadius: 14, backgroundColor: "#8DEB63", marginBottom: 10 },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { color: "#0a0a0a", fontSize: 16, fontWeight: "700" },
  backToHomeBtn: { alignItems: "center", paddingVertical: 14 },
  backToHomeText: { color: "#737373", fontSize: 14 },
});
