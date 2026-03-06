import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";
import { formatAmount, getCurrency } from "./lib/currency";
import { computeSettleUp } from "./lib/expenseSettleUp";

type Member = { id: string; username: string; avatar_url?: string | null };
type FriendOption = { id: string; username: string; display_name?: string | null; avatar_url?: string | null };

function initial(name: string): string {
  const s = (name || "").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}
type ExpenseEntry = { id: string; paid_by: string; amount: number; description: string; split_among: string[]; settled?: boolean; split_percentages?: Record<string, number> | null };

export default function ExpenseGroupScreen() {
  const { category, groupId: paramGroupId } = useLocalSearchParams<{ category: string; groupId?: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const isTravel = category === "travel";

  const [groupId, setGroupId] = useState<string | null>(paramGroupId ?? null);
  const [groupName, setGroupName] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [entries, setEntries] = useState<ExpenseEntry[]>([]);
  const [nameInput, setNameInput] = useState("");
  const [friends, setFriends] = useState<FriendOption[]>([]);
  const [friendSearchQuery, setFriendSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [paidBy, setPaidBy] = useState<string>("");
  const [splitAmongIds, setSplitAmongIds] = useState<string[]>([]);
  const [amountInput, setAmountInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [isHost, setIsHost] = useState(false);
  type TabId = "summary" | "expenses" | "settings";
  const [activeTab, setActiveTab] = useState<TabId>("summary");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [groupNameDraft, setGroupNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [detailModalMemberId, setDetailModalMemberId] = useState<string | null>(null);
  const [settleUpModalVisible, setSettleUpModalVisible] = useState(false);
  const [addMemberModalVisible, setAddMemberModalVisible] = useState(false);
  const [addMemberSearchQuery, setAddMemberSearchQuery] = useState("");
  const [selectedIdsAddMember, setSelectedIdsAddMember] = useState<string[]>([]);
  const [addingMembers, setAddingMembers] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);
  type ExpenseSplitMode = "equal" | "percentage" | "amount" | "shares";
  const [expenseSplitMode, setExpenseSplitMode] = useState<ExpenseSplitMode>("equal");
  const [expenseSplitDraft, setExpenseSplitDraft] = useState<Record<string, string>>({});
  type ExpenseModalPanel = "main" | "splitAmong" | "howToSplit";
  const [expenseModalPanel, setExpenseModalPanel] = useState<ExpenseModalPanel>("main");

  const myId = user?.id ?? "";
  const memberIds = useMemo(() => members.map((m) => m.id), [members]);

  const loadFriends = useCallback(async () => {
    if (!myId) return;
    const { data: asUser } = await supabase.from("friendships").select("friend_id").eq("user_id", myId).eq("status", "accepted");
    const { data: asFriend } = await supabase.from("friendships").select("user_id").eq("friend_id", myId).eq("status", "accepted");
    const ids = new Set<string>([myId]);
    for (const r of asUser ?? []) ids.add((r as { friend_id: string }).friend_id);
    for (const r of asFriend ?? []) ids.add((r as { user_id: string }).user_id);
    ids.delete(myId);
    const { data: profs } = await supabase.from("profiles").select("id, username, display_name, avatar_url").in("id", [...ids]);
    setFriends(
      (profs ?? []).map((p: { id: string; username: string; display_name?: string | null; avatar_url?: string | null }) => ({
        id: p.id,
        username: p.username,
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
      }))
    );
  }, [myId]);

  const filteredFriends = useMemo(() => {
    const q = friendSearchQuery.trim().toLowerCase();
    if (!q) return friends;
    return friends.filter(
      (f) =>
        (f.username || "").toLowerCase().includes(q) ||
        (f.display_name || "").toLowerCase().includes(q)
    );
  }, [friends, friendSearchQuery]);

  const loadGroup = useCallback(async () => {
    if (!paramGroupId || !myId) return;
    setLoading(true);
    setError(null);
    try {
      const { data: g, error: e1 } = await supabase.from("expense_groups").select("id, name, currency, host_id").eq("id", paramGroupId).single();
      if (e1 || !g) throw new Error("Group not found");
      const name = (g as { name: string }).name;
      setGroupName(name);
      setGroupNameDraft(name);
      setIsHost((g as { host_id: string }).host_id === myId);
      const { data: mems } = await supabase.from("expense_group_members").select("user_id").eq("group_id", paramGroupId);
      const userIds = [...new Set((mems ?? []).map((m: { user_id: string }) => m.user_id))];
      if (userIds.length === 0) {
        setMembers([]);
        setEntries([]);
        setLoading(false);
        return;
      }
      const { data: profs } = await supabase.from("profiles").select("id, username, avatar_url").in("id", userIds);
      const profileList = (profs ?? []) as { id: string; username: string; avatar_url?: string | null }[];
      const profileMap = Object.fromEntries(profileList.map((p) => [p.id, p]));
      setMembers(userIds.map((id) => {
        const p = profileMap[id];
        return { id, username: p?.username ?? "?", avatar_url: p?.avatar_url ?? null };
      }));

      const { data: ents } = await supabase.from("expense_entries").select("id, paid_by, amount, description, split_among, settled, split_percentages").eq("group_id", paramGroupId).order("created_at", { ascending: true });
      setEntries(
        (ents ?? []).map((e: { id: string; paid_by: string; amount: number; description: string; split_among: string[]; settled?: boolean; split_percentages?: Record<string, number> | null }) => ({
          id: e.id,
          paid_by: e.paid_by,
          amount: Number(e.amount),
          description: e.description ?? "",
          split_among: Array.isArray(e.split_among) ? e.split_among : [],
          settled: Boolean(e.settled),
          split_percentages: e.split_percentages && typeof e.split_percentages === "object" ? e.split_percentages : null,
        }))
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [paramGroupId, myId]);

  useEffect(() => {
    if (paramGroupId) {
      void loadGroup();
      void loadFriends();
    } else {
      setLoading(false);
      void loadFriends();
    }
  }, [paramGroupId, loadGroup, loadFriends]);

  const createGroup = async () => {
    const name = nameInput.trim();
    if (!name || !myId) return;
    const participantIds = [myId, ...selectedIds];
    if (participantIds.length < 2) {
      setError("Add at least one friend to split with.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { data: g, error: e1 } = await supabase.from("expense_groups").insert({ host_id: myId, name, category: category ?? "travel", currency: currencyCode }).select("id").single();
      if (e1) throw new Error(e1.message);
      const id = (g as { id: string }).id;
      await supabase.from("expense_group_members").insert(participantIds.map((user_id) => ({ group_id: id, user_id })));
      setGroupId(id);
      setGroupName(name);
      setMembers(participantIds.map((uid) => {
        if (uid === myId) return { id: uid, username: profile?.username ?? "You", avatar_url: profile?.avatar_url ?? null };
        const f = friends.find((x) => x.id === uid);
        return { id: uid, username: f?.username ?? "?", avatar_url: f?.avatar_url ?? null };
      }));
      setEntries([]);
      setNameInput("");
      setSelectedIds([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setSaving(false);
    }
  };

  const toSplitAmongInModal = splitAmongIds.length > 0 ? splitAmongIds : memberIds;

  const switchExpenseSplitMode = (mode: ExpenseSplitMode) => {
    setExpenseSplitMode(mode);
    const among = toSplitAmongInModal;
    if (mode === "equal") {
      setExpenseSplitDraft({});
      return;
    }
    const n = among.length || 1;
    const amt = parseFloat(amountInput.replace(/,/g, "")) || 0;
    const draft: Record<string, string> = {};
    if (mode === "percentage") {
      among.forEach((id) => { draft[id] = (100 / n).toFixed(1); });
    } else if (mode === "amount") {
      among.forEach((id) => { draft[id] = (amt / n).toFixed(2); });
    } else {
      among.forEach((id) => { draft[id] = "1"; });
    }
    setExpenseSplitDraft(draft);
  };

  const expenseSplitDraftTotal = useMemo(() => {
    const among = toSplitAmongInModal;
    if (expenseSplitMode === "percentage") {
      return among.reduce((s, id) => s + (parseFloat(expenseSplitDraft[id] ?? "0") || 0), 0);
    }
    if (expenseSplitMode === "amount") {
      return among.reduce((s, id) => s + (parseFloat(expenseSplitDraft[id] ?? "0") || 0), 0);
    }
    if (expenseSplitMode === "shares") {
      return among.reduce((s, id) => s + (parseInt(expenseSplitDraft[id] ?? "0", 10) || 0), 0);
    }
    return 0;
  }, [expenseSplitMode, expenseSplitDraft, toSplitAmongInModal]);

  const expenseAmount = parseFloat(amountInput.replace(/,/g, "")) || 0;

  const howToSplitButtonLabel = useMemo(() => {
    if (expenseSplitMode === "equal") return "Equal";
    const among = toSplitAmongInModal;
    if (among.length === 0) return "Equal";
    if (expenseSplitMode === "percentage") {
      const pcts = among.map((id) => parseFloat(expenseSplitDraft[id] ?? "0") || 0);
      return pcts.every((p) => p > 0) ? pcts.map((p) => `${Math.round(p)}%`).join(" / ") : "Custom %";
    }
    if (expenseSplitMode === "amount") return `Custom amount`;
    if (expenseSplitMode === "shares") return `Shares`;
    return "Equal";
  }, [expenseSplitMode, expenseSplitDraft, toSplitAmongInModal]);

  const buildSplitPercentagesFromModal = (): Record<string, number> | null => {
    const among = toSplitAmongInModal;
    if (among.length === 0) return null;
    if (expenseSplitMode === "equal") return null;
    const amt = parseFloat(amountInput.replace(/,/g, "")) || 0;
    if (expenseSplitMode === "percentage") {
      const pcts = among.map((id) => Math.max(0, parseFloat(expenseSplitDraft[id] ?? "0") || 0));
      const sum = pcts.reduce((a, b) => a + b, 0);
      if (sum < 0.01) return null;
      const scale = 100 / sum;
      const out: Record<string, number> = {};
      among.forEach((id, i) => { out[id] = Math.round(pcts[i]! * scale * 100) / 100; });
      return out;
    }
    if (expenseSplitMode === "amount") {
      const amounts = among.map((id) => Math.max(0, parseFloat(expenseSplitDraft[id] ?? "0") || 0));
      const sum = amounts.reduce((a, b) => a + b, 0);
      if (sum < 0.01 || amt < 0.01) return null;
      const scale = 100 / amt;
      const out: Record<string, number> = {};
      among.forEach((id, i) => { out[id] = Math.round(amounts[i]! * scale * 100) / 100; });
      return out;
    }
    if (expenseSplitMode === "shares") {
      const shares = among.map((id) => Math.max(0, parseInt(expenseSplitDraft[id] ?? "0", 10) || 0));
      const totalShares = shares.reduce((a, b) => a + b, 0);
      if (totalShares < 1) return null;
      const out: Record<string, number> = {};
      among.forEach((id, i) => { out[id] = Math.round((shares[i]! / totalShares) * 10000) / 100; });
      return out;
    }
    return null;
  };

  const addEntry = async () => {
    if (!groupId || !paidBy || members.length === 0) return;
    const toSplitAmong = splitAmongIds.length > 0 ? splitAmongIds : memberIds;
    if (toSplitAmong.length === 0) {
      setError("Select at least one person to split among.");
      return;
    }
    const amount = parseFloat(amountInput.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0.01) {
      setError("Enter a valid amount.");
      return;
    }
    if (expenseSplitMode !== "equal") {
      if (expenseSplitMode === "percentage") {
        const sum = toSplitAmong.reduce((s, id) => s + (parseFloat(expenseSplitDraft[id] ?? "0") || 0), 0);
        if (Math.abs(sum - 100) > 0.5) {
          setError("Percentages must total 100%.");
          return;
        }
      }
      if (expenseSplitMode === "amount") {
        const sum = toSplitAmong.reduce((s, id) => s + (parseFloat(expenseSplitDraft[id] ?? "0") || 0), 0);
        if (Math.abs(sum - amount) > 0.02) {
          setError(`Amounts must total ${getCurrency(currencyCode).symbol}${amount.toFixed(2)}.`);
          return;
        }
      }
    }
    const splitPct = buildSplitPercentagesFromModal();
    setSaving(true);
    setError(null);
    try {
      const { data: row, error: e1 } = await supabase
        .from("expense_entries")
        .insert({ group_id: groupId, paid_by: paidBy, amount, description: descInput.trim() || "Expense", split_among: toSplitAmong, split_percentages: splitPct })
        .select("id, paid_by, amount, description, split_among, split_percentages")
        .single();
      if (e1) throw new Error(e1.message);
      const r = row as { id: string; paid_by: string; amount: number; description: string; split_among: string[]; split_percentages?: Record<string, number> | null };
      setEntries((prev) => [...prev, { id: r.id, paid_by: r.paid_by, amount: Number(r.amount), description: r.description ?? "", split_among: Array.isArray(r.split_among) ? r.split_among : [], settled: false, split_percentages: r.split_percentages ?? null }]);
      setAmountInput("");
      setDescInput("");
      setPaidBy("");
      setSplitAmongIds(memberIds.length ? [...memberIds] : []);
      setExpenseSplitMode("equal");
      setExpenseSplitDraft({});
      setAddModalVisible(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSaving(false);
    }
  };

  const openEditEntry = (entry: ExpenseEntry) => {
    setEditingEntryId(entry.id);
    setPaidBy(entry.paid_by);
    setAmountInput(String(entry.amount));
    setDescInput(entry.description || "");
    setSplitAmongIds(entry.split_among.length > 0 ? entry.split_among : [...memberIds]);
    if (entry.split_percentages && Object.keys(entry.split_percentages).length > 0) {
      setExpenseSplitMode("percentage");
      const draft: Record<string, string> = {};
      for (const id of entry.split_among.length ? entry.split_among : memberIds) {
        draft[id] = String(entry.split_percentages![id] ?? (100 / (entry.split_among.length || memberIds.length)));
      }
      setExpenseSplitDraft(draft);
    } else {
      setExpenseSplitMode("equal");
      setExpenseSplitDraft({});
    }
    setExpenseModalPanel("main");
    setAddModalVisible(true);
  };

  const updateEntry = async () => {
    const id = editingEntryId;
    if (!groupId || !id || !paidBy || members.length === 0) return;
    const toSplitAmong = splitAmongIds.length > 0 ? splitAmongIds : memberIds;
    if (toSplitAmong.length === 0) {
      setError("Select at least one person to split among.");
      return;
    }
    const amount = parseFloat(amountInput.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0.01) {
      setError("Enter a valid amount.");
      return;
    }
    if (expenseSplitMode !== "equal") {
      if (expenseSplitMode === "percentage") {
        const sum = toSplitAmong.reduce((s, uid) => s + (parseFloat(expenseSplitDraft[uid] ?? "0") || 0), 0);
        if (Math.abs(sum - 100) > 0.5) {
          setError("Percentages must total 100%.");
          return;
        }
      }
      if (expenseSplitMode === "amount") {
        const sum = toSplitAmong.reduce((s, uid) => s + (parseFloat(expenseSplitDraft[uid] ?? "0") || 0), 0);
        if (Math.abs(sum - amount) > 0.02) {
          setError(`Amounts must total ${getCurrency(currencyCode).symbol}${amount.toFixed(2)}.`);
          return;
        }
      }
    }
    const splitPct = buildSplitPercentagesFromModal();
    setSaving(true);
    setError(null);
    try {
      const { error: e1 } = await supabase
        .from("expense_entries")
        .update({ paid_by: paidBy, amount, description: descInput.trim() || "Expense", split_among: toSplitAmong, split_percentages: splitPct })
        .eq("id", id);
      if (e1) throw new Error(e1.message);
      setEntries((prev) =>
        prev.map((e) =>
          e.id === id
            ? { id: e.id, paid_by: paidBy, amount, description: descInput.trim() || "Expense", split_among: toSplitAmong, split_percentages: splitPct ?? undefined }
            : e
        )
      );
      setEditingEntryId(null);
      setAmountInput("");
      setDescInput("");
      setExpenseSplitMode("equal");
      setExpenseSplitDraft({});
      setAddModalVisible(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setSaving(false);
    }
  };

  const deleteEntry = async (id: string) => {
    if (!groupId) return;
    Alert.alert("Delete expense?", "This expense will be removed from the trip.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setSaving(true);
          setError(null);
          try {
            const { error: e1 } = await supabase.from("expense_entries").delete().eq("id", id);
            if (e1) throw new Error(e1.message);
            setEntries((prev) => prev.filter((e) => e.id !== id));
            setEditingEntryId(null);
            setAddModalVisible(false);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to delete");
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const updateGroupName = async () => {
    const name = groupNameDraft.trim();
    if (!groupId || !name || name === groupName) return;
    setSavingName(true);
    setError(null);
    try {
      const { error: e1 } = await supabase.from("expense_groups").update({ name }).eq("id", groupId);
      if (e1) throw new Error(e1.message);
      setGroupName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update name");
    } finally {
      setSavingName(false);
    }
  };

  const markExpensePaid = async (entryId: string) => {
    setSaving(true);
    setError(null);
    try {
      const { error: e1 } = await supabase.from("expense_entries").update({ settled: true }).eq("id", entryId);
      if (e1) throw new Error(e1.message);
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, settled: true } : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as paid");
    } finally {
      setSaving(false);
    }
  };

  const markExpenseUnpaid = async (entryId: string) => {
    setSaving(true);
    setError(null);
    try {
      const { error: e1 } = await supabase.from("expense_entries").update({ settled: false }).eq("id", entryId);
      if (e1) throw new Error(e1.message);
      setEntries((prev) => prev.map((e) => (e.id === entryId ? { ...e, settled: false } : e)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark as unpaid");
    } finally {
      setSaving(false);
    }
  };

  const friendsNotInGroup = useMemo(
    () => friends.filter((f) => !memberIds.includes(f.id)),
    [friends, memberIds]
  );

  const filteredFriendsForAdd = useMemo(() => {
    const q = addMemberSearchQuery.trim().toLowerCase();
    if (!q) return friendsNotInGroup;
    return friendsNotInGroup.filter(
      (f) =>
        (f.username || "").toLowerCase().includes(q) ||
        (f.display_name || "").toLowerCase().includes(q)
    );
  }, [friendsNotInGroup, addMemberSearchQuery]);

  const addMembersToGroup = async () => {
    if (!paramGroupId || selectedIdsAddMember.length === 0) return;
    setAddingMembers(true);
    setError(null);
    try {
      const { error: e } = await supabase
        .from("expense_group_members")
        .insert(selectedIdsAddMember.map((user_id) => ({ group_id: paramGroupId, user_id })));
      if (e) throw new Error(e.message);
      setAddMemberModalVisible(false);
      setSelectedIdsAddMember([]);
      setAddMemberSearchQuery("");
      await loadGroup();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add members");
    } finally {
      setAddingMembers(false);
    }
  };

  const leaveGroup = () => {
    if (!paramGroupId) return;
    Alert.alert(
      "Leave " + (isTravel ? "trip?" : "project?"),
      `You will be removed from "${groupName}". You can be re-added by the host.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            setLeavingGroup(true);
            setError(null);
            try {
              const { error: e } = await supabase
                .from("expense_group_members")
                .delete()
                .eq("group_id", paramGroupId)
                .eq("user_id", myId);
              if (e) throw new Error(e.message);
              router.back();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to leave");
            } finally {
              setLeavingGroup(false);
            }
          },
        },
      ]
    );
  };

  const deleteGroup = async () => {
    if (!groupId || !isHost) return;
    Alert.alert(
      isTravel ? "Delete trip?" : "Delete project?",
      `"${groupName}" and all its expenses and settlements will be removed. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setSaving(true);
            setError(null);
            try {
              const { error: e } = await supabase.from("expense_groups").delete().eq("id", groupId);
              if (e) throw new Error(e.message);
              router.back();
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to delete");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  const unsettledEntries = useMemo(() => entries.filter((e) => !e.settled), [entries]);
  const settleUp = useMemo(
    () => computeSettleUp(memberIds, unsettledEntries.map((e) => ({ paid_by: e.paid_by, amount: e.amount, split_among: e.split_among, split_percentages: e.split_percentages }))),
    [memberIds, unsettledEntries]
  );

  const balances = useMemo(() => {
    const ids = members.map((m) => m.id);
    const amountPaid: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    const share: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const e of unsettledEntries) {
      amountPaid[e.paid_by] = (amountPaid[e.paid_by] ?? 0) + e.amount;
      const among = e.split_among.length ? e.split_among : ids;
      const pct = e.split_percentages && Object.keys(e.split_percentages).length > 0 ? e.split_percentages : null;
      if (pct) {
        let totalPct = 0;
        for (const id of among) if (ids.includes(id)) totalPct += pct[id] ?? 0;
        const scale = totalPct > 0 ? 100 / totalPct : 1 / among.length;
        for (const id of among) {
          if (ids.includes(id)) share[id] = (share[id] ?? 0) + e.amount * (((pct[id] ?? 0) * scale) / 100);
        }
      } else {
        const n = among.length || 1;
        const each = e.amount / n;
        for (const id of among) if (ids.includes(id)) share[id] = (share[id] ?? 0) + each;
      }
    }
    return ids.map((id) => ({ id, paid: amountPaid[id] ?? 0, share: share[id] ?? 0, balance: (amountPaid[id] ?? 0) - (share[id] ?? 0) }));
  }, [members, unsettledEntries]);

  const username = (id: string) => members.find((m) => m.id === id)?.username ?? "?";

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!groupId) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
        <StatusBar style="light" />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
            <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
          </Pressable>
          <Text style={styles.headerTitle}>{isTravel ? "New trip" : "New project"}</Text>
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {error ? <Text style={styles.errText}>{error}</Text> : null}
          <Text style={styles.sectionLabel}>{isTravel ? "Trip name" : "Project name"}</Text>
          <TextInput style={styles.input} value={nameInput} onChangeText={setNameInput} placeholder={isTravel ? "e.g. Bali trip" : "e.g. Pop-up stall"} placeholderTextColor="#737373" />
          <Text style={styles.sectionLabel}>Who's in</Text>
          <Text style={styles.hint}>You're always included. Add friends to split with.</Text>
          <View style={styles.chipRow}>
            <View style={styles.chip}>
              {profile?.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.chipAvatar} />
              ) : (
                <View style={styles.chipAvatarPlaceholder}>
                  <Text style={styles.chipAvatarInitial}>{initial(profile?.display_name || profile?.username || "You")}</Text>
                </View>
              )}
              <Text style={styles.chipText}>{profile?.display_name || profile?.username || "You"}</Text>
            </View>
            {friends.filter((f) => selectedIds.includes(f.id)).map((f) => (
              <View key={f.id} style={styles.chip}>
                {f.avatar_url ? (
                  <Image source={{ uri: f.avatar_url }} style={styles.chipAvatar} />
                ) : (
                  <View style={styles.chipAvatarPlaceholder}>
                    <Text style={styles.chipAvatarInitial}>{initial(f.display_name || f.username)}</Text>
                  </View>
                )}
                <Text style={styles.chipText}>{f.display_name || f.username}</Text>
                <Pressable onPress={() => setSelectedIds((prev) => prev.filter((id) => id !== f.id))} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#737373" />
                </Pressable>
              </View>
            ))}
          </View>
          {friends.length > 0 && (
            <>
              <View style={styles.searchWrap}>
                <Ionicons name="search" size={18} color="#737373" style={styles.searchIcon} />
                <TextInput
                  style={styles.searchInput}
                  value={friendSearchQuery}
                  onChangeText={setFriendSearchQuery}
                  placeholder="Search friends..."
                  placeholderTextColor="#737373"
                />
                {friendSearchQuery.length > 0 ? (
                  <Pressable onPress={() => setFriendSearchQuery("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color="#737373" />
                  </Pressable>
                ) : null}
              </View>
              <View style={styles.friendList}>
                {filteredFriends.map((f) => (
                  <Pressable
                    key={f.id}
                    style={[styles.friendRow, selectedIds.includes(f.id) && styles.friendRowSelected]}
                    onPress={() => setSelectedIds((prev) => (prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]))}
                  >
                    <View style={styles.friendRowLeft}>
                      {f.avatar_url ? (
                        <Image source={{ uri: f.avatar_url }} style={styles.friendAvatar} />
                      ) : (
                        <View style={styles.friendAvatarPlaceholder}>
                          <Text style={styles.friendAvatarInitial}>{initial(f.display_name || f.username)}</Text>
                        </View>
                      )}
                      <Text style={styles.friendName}>{f.display_name || f.username}</Text>
                    </View>
                    {selectedIds.includes(f.id) ? <Ionicons name="checkmark-circle" size={22} color="#8DEB63" /> : null}
                  </Pressable>
                ))}
              </View>
              {filteredFriends.length === 0 && friendSearchQuery.trim() ? (
                <Text style={styles.noResults}>No friends match "{friendSearchQuery.trim()}"</Text>
              ) : null}
            </>
          )}
          {friends.length === 0 && (
            <Pressable style={styles.friendChipsWrap} onPress={() => router.push("/(tabs)/friends")}>
              <Text style={styles.hint}>Add friends from the Friends tab, then select them here.</Text>
            </Pressable>
          )}
          <Pressable style={[styles.primaryBtn, (!nameInput.trim() || saving) && styles.primaryBtnDisabled]} onPress={createGroup} disabled={!nameInput.trim() || saving}>
            {saving ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Text style={styles.primaryBtnText}>Create {isTravel ? "trip" : "project"}</Text>}
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isEditMode = Boolean(editingEntryId);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.headerTitle} numberOfLines={1}>{groupName}</Text>
          <Text style={styles.headerSub}>{members.length} people · {entries.length} expenses</Text>
        </View>
      </View>

      <View style={styles.tabBar}>
        <Pressable style={[styles.tab, activeTab === "summary" && styles.tabActive]} onPress={() => setActiveTab("summary")}>
          <Ionicons name="pie-chart-outline" size={18} color={activeTab === "summary" ? "#8DEB63" : "#737373"} />
          <Text style={[styles.tabText, activeTab === "summary" && styles.tabTextActive]}>Summary</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === "expenses" && styles.tabActive]} onPress={() => setActiveTab("expenses")}>
          <Ionicons name="list-outline" size={18} color={activeTab === "expenses" ? "#8DEB63" : "#737373"} />
          <Text style={[styles.tabText, activeTab === "expenses" && styles.tabTextActive]}>Expenses</Text>
        </Pressable>
        <Pressable style={[styles.tab, activeTab === "settings" && styles.tabActive]} onPress={() => setActiveTab("settings")}>
          <Ionicons name="settings-outline" size={18} color={activeTab === "settings" ? "#8DEB63" : "#737373"} />
          <Text style={[styles.tabText, activeTab === "settings" && styles.tabTextActive]}>Settings</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {error ? <Text style={styles.errText}>{error}</Text> : null}

        {activeTab === "summary" && (
          <View style={styles.tabPanel}>
            {entries.length === 0 || members.length === 0 ? (
              <Text style={styles.sectionEmpty}>Add expenses in the Expenses tab to see balances.</Text>
            ) : (
              <View style={styles.summaryCardList}>
                {balances.map((b) => {
                  const m = members.find((x) => x.id === b.id);
                  return (
                    <Pressable
                      key={b.id}
                      style={({ pressed }) => [styles.summaryCard, pressed && styles.pressed]}
                      onPress={() => setDetailModalMemberId(b.id)}
                    >
                      <View style={styles.summaryCardLeft}>
                        {m?.avatar_url ? (
                          <Image source={{ uri: m.avatar_url }} style={styles.summaryAvatar} />
                        ) : (
                          <View style={styles.summaryAvatarPlaceholder}>
                            <Text style={styles.summaryAvatarInitial}>{initial(username(b.id))}</Text>
                          </View>
                        )}
                        <Text style={styles.summaryCardName} numberOfLines={1}>{username(b.id)}</Text>
                      </View>
                      <Text style={[styles.summaryCardAmount, b.balance >= 0 ? styles.balanceGets : styles.balanceOwes]}>
                        {b.balance >= 0 ? `+${formatAmount(b.balance, currencyCode)}` : `−${formatAmount(-b.balance, currencyCode)}`}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {entries.length > 0 && members.length > 0 && settleUp.length > 0 ? (
              <Pressable
                style={({ pressed }) => [styles.settleUpBtn, pressed && styles.pressed]}
                onPress={() => setSettleUpModalVisible(true)}
              >
                <Ionicons name="swap-horizontal" size={20} color="#0a0a0a" />
                <Text style={styles.settleUpBtnText}>Settle up</Text>
              </Pressable>
            ) : null}
          </View>
        )}

        {activeTab === "expenses" && (
          <View style={styles.tabPanel}>
            <Pressable style={styles.addEntryBtnTop} onPress={() => { setEditingEntryId(null); setPaidBy(members[0]?.id ?? ""); setAmountInput(""); setDescInput(""); setSplitAmongIds(memberIds.length ? [...memberIds] : []); setExpenseSplitMode("equal"); setExpenseSplitDraft({}); setExpenseModalPanel("main"); setAddModalVisible(true); }}>
              <Ionicons name="add-circle" size={22} color="#8DEB63" />
              <Text style={styles.addEntryBtnTopText}>Add expense</Text>
            </Pressable>
            <Text style={styles.sectionLabel}>Expenses</Text>
            {entries.length === 0 ? (
              <Text style={styles.sectionEmpty}>No expenses yet. Tap above to add one.</Text>
            ) : null}
            {entries.map((e) => (
              <Pressable key={e.id} style={({ pressed }) => [styles.entryCard, styles.entryCardPressable, pressed && styles.pressed]} onPress={() => openEditEntry(e)}>
                <Text style={styles.entryCardTitle} numberOfLines={1}>{e.description?.trim() || "Expense"}</Text>
                <View style={styles.entryRow}>
                  <Text style={styles.entryMeta}>{username(e.paid_by)} paid · {formatAmount(e.amount, currencyCode)}</Text>
                  <View style={styles.entryCardChevron}>
                    <Ionicons name="create-outline" size={16} color="#737373" />
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}

        {activeTab === "settings" && (
          <View style={styles.tabPanel}>
            <Text style={styles.sectionLabel}>Name</Text>
            <View style={styles.settingsNameRow}>
              <TextInput
                style={styles.settingsNameInput}
                value={groupNameDraft}
                onChangeText={setGroupNameDraft}
                placeholder={isTravel ? "Trip name" : "Project name"}
                placeholderTextColor="#737373"
              />
              <Pressable style={[styles.settingsSaveBtn, savingName && styles.primaryBtnDisabled]} onPress={updateGroupName} disabled={savingName || groupNameDraft.trim() === groupName}>
                {savingName ? <ActivityIndicator size="small" color="#0b100b" /> : <Text style={styles.settingsSaveBtnText}>Save</Text>}
              </Pressable>
            </View>
            <Text style={styles.sectionLabel}>Members</Text>
            <View style={styles.membersList}>
              {members.map((m) => (
                <View key={m.id} style={styles.memberRow}>
                  <View style={styles.memberRowLeft}>
                    {m.avatar_url ? (
                      <Image source={{ uri: m.avatar_url }} style={styles.settingsMemberAvatar} />
                    ) : (
                      <View style={styles.settingsMemberAvatarPlaceholder}>
                        <Text style={styles.settingsMemberAvatarInitial}>{initial(m.username)}</Text>
                      </View>
                    )}
                    <Text style={styles.memberName}>{m.username}</Text>
                    {m.id === myId ? <Text style={styles.memberYou}>You</Text> : null}
                  </View>
                </View>
              ))}
            </View>
            {isHost ? (
              <Pressable
                style={({ pressed }) => [styles.addMemberBtn, pressed && styles.pressed]}
                onPress={() => { setSelectedIdsAddMember([]); setAddMemberSearchQuery(""); setAddMemberModalVisible(true); }}
              >
                <Ionicons name="person-add-outline" size={20} color="#8DEB63" />
                <Text style={styles.addMemberBtnText}>Add member</Text>
              </Pressable>
            ) : null}
            <View style={styles.settingsLeaveRow}>
              <Pressable
                style={({ pressed }) => [styles.leaveGroupBtn, (pressed || leavingGroup) && styles.pressed]}
                onPress={leaveGroup}
                disabled={leavingGroup}
              >
                {leavingGroup ? <ActivityIndicator size="small" color="#fbbf24" /> : <Ionicons name="exit-outline" size={20} color="#fbbf24" />}
                <Text style={styles.leaveGroupBtnText}>Leave {isTravel ? "trip" : "project"}</Text>
              </Pressable>
            </View>
            {isHost ? (
              <>
                <Text style={[styles.sectionLabel, { marginTop: 24 }]}>Danger zone</Text>
                <Pressable style={styles.deleteGroupBtnBlock} onPress={deleteGroup} disabled={saving}>
                  <Ionicons name="trash-outline" size={20} color="#fca5a5" />
                  <Text style={styles.deleteGroupBtnBlockText}>Delete {isTravel ? "trip" : "project"}</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal visible={addMemberModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => { setAddMemberModalVisible(false); setAddMemberSearchQuery(""); setSelectedIdsAddMember([]); }}>
          <Pressable style={styles.addMemberModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.addMemberModalHeader}>
              <Text style={styles.addMemberModalTitle}>Add member</Text>
              <Pressable onPress={() => { setAddMemberModalVisible(false); setAddMemberSearchQuery(""); setSelectedIdsAddMember([]); }} hitSlop={12}>
                <Ionicons name="close" size={24} color="#a3a3a3" />
              </Pressable>
            </View>
            <Text style={styles.addMemberModalHint}>Select friends to add. They must be in your friends list.</Text>
            <View style={styles.searchWrap}>
              <Ionicons name="search" size={18} color="#737373" style={styles.searchIcon} />
              <TextInput
                style={styles.searchInput}
                value={addMemberSearchQuery}
                onChangeText={setAddMemberSearchQuery}
                placeholder="Search friends..."
                placeholderTextColor="#737373"
              />
              {addMemberSearchQuery.length > 0 ? (
                <Pressable onPress={() => setAddMemberSearchQuery("")} hitSlop={8}>
                  <Ionicons name="close-circle" size={18} color="#737373" />
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={styles.addMemberModalScroll} showsVerticalScrollIndicator={false}>
              {filteredFriendsForAdd.length === 0 ? (
                <Text style={styles.addMemberModalEmpty}>
                  {friendsNotInGroup.length === 0 ? "All your friends are already in this group." : "No friends match your search."}
                </Text>
              ) : (
                filteredFriendsForAdd.map((f) => (
                  <Pressable
                    key={f.id}
                    style={[styles.friendRow, selectedIdsAddMember.includes(f.id) && styles.friendRowSelected]}
                    onPress={() => setSelectedIdsAddMember((prev) => (prev.includes(f.id) ? prev.filter((id) => id !== f.id) : [...prev, f.id]))}
                  >
                    <View style={styles.friendRowLeft}>
                      {f.avatar_url ? (
                        <Image source={{ uri: f.avatar_url }} style={styles.friendAvatar} />
                      ) : (
                        <View style={styles.friendAvatarPlaceholder}>
                          <Text style={styles.friendAvatarInitial}>{initial(f.display_name || f.username)}</Text>
                        </View>
                      )}
                      <Text style={styles.friendName}>{f.display_name || f.username}</Text>
                    </View>
                    {selectedIdsAddMember.includes(f.id) ? <Ionicons name="checkmark-circle" size={22} color="#8DEB63" /> : <Ionicons name="ellipse-outline" size={22} color="#525252" />}
                  </Pressable>
                ))
              )}
            </ScrollView>
            <Pressable
              style={[styles.addMemberConfirmBtn, (selectedIdsAddMember.length === 0 || addingMembers) && styles.addMemberConfirmBtnDisabled]}
              onPress={addMembersToGroup}
              disabled={selectedIdsAddMember.length === 0 || addingMembers}
            >
              {addingMembers ? <ActivityIndicator size="small" color="#0b100b" /> : <Text style={styles.addMemberConfirmBtnText}>Add {selectedIdsAddMember.length > 0 ? `(${selectedIdsAddMember.length})` : ""}</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={settleUpModalVisible} transparent animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setSettleUpModalVisible(false)}>
          <Pressable style={styles.settleUpModalCard} onPress={(e) => e.stopPropagation()}>
            <View style={styles.settleUpModalHeader}>
              <Text style={styles.settleUpModalTitle}>Who pays who</Text>
              <Pressable onPress={() => setSettleUpModalVisible(false)} hitSlop={12}>
                <Ionicons name="close" size={24} color="#a3a3a3" />
              </Pressable>
            </View>
            <ScrollView style={styles.settleUpModalScroll} showsVerticalScrollIndicator={false}>
              {settleUp.map((line, idx) => (
                <View key={`${line.from}-${line.to}-${idx}`} style={styles.settleUpRow}>
                  <Text style={styles.settleUpRowFrom}>{username(line.from)}</Text>
                  <Ionicons name="arrow-forward" size={16} color="#737373" style={styles.settleUpRowArrow} />
                  <Text style={styles.settleUpRowTo}>{username(line.to)}</Text>
                  <Text style={styles.settleUpRowAmount}>{formatAmount(line.amount, currencyCode)}</Text>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={Boolean(detailModalMemberId)} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => setDetailModalMemberId(null)}>
          <Pressable style={styles.detailModalCard} onPress={() => {}}>
            <ScrollView style={styles.detailModalScroll} contentContainerStyle={styles.detailModalScrollContent} keyboardShouldPersistTaps="handled">
            {detailModalMemberId ? (() => {
              const b = balances.find((x) => x.id === detailModalMemberId);
              if (!b) return null;
              const m = members.find((x) => x.id === b.id);
              return (
                <>
                  <View style={styles.detailModalHeader}>
                    <Text style={styles.detailModalTitle}>{username(b.id)}</Text>
                    <Pressable onPress={() => setDetailModalMemberId(null)} hitSlop={12}>
                      <Ionicons name="close" size={24} color="#737373" />
                    </Pressable>
                  </View>
                  <View style={styles.detailModalAvatarRow}>
                    {m?.avatar_url ? (
                      <Image source={{ uri: m.avatar_url }} style={styles.detailModalAvatar} />
                    ) : (
                      <View style={[styles.detailModalAvatar, styles.detailModalAvatarPlaceholder]}>
                        <Text style={styles.detailModalAvatarInitial}>{initial(username(b.id))}</Text>
                      </View>
                    )}
                    <Text style={[styles.detailModalBalance, b.balance >= 0 ? styles.balanceGets : styles.balanceOwes]}>
                      {b.balance >= 0 ? `+${formatAmount(b.balance, currencyCode)}` : `−${formatAmount(-b.balance, currencyCode)}`}
                    </Text>
                  </View>
                  <Text style={styles.detailModalLabel}>Paid {formatAmount(b.paid, currencyCode)} · Share {formatAmount(b.share, currencyCode)}</Text>
                  <Text style={styles.detailModalSectionTitle}>Expenses</Text>
                  <View style={styles.detailExpenseList}>
                    {entries.map((e) => (
                      <View key={e.id} style={styles.detailExpenseRow}>
                        <View style={styles.detailExpenseLeft}>
                          <Text style={styles.detailExpenseDesc} numberOfLines={1}>{e.description || "Expense"}</Text>
                          <Text style={styles.detailExpenseMeta}>{username(e.paid_by)} · {formatAmount(e.amount, currencyCode)}</Text>
                        </View>
                        {e.settled ? (
                          isHost ? (
                            <Pressable style={[styles.detailUnpaidBtn, saving && styles.detailPaidBtnDisabled]} onPress={() => markExpenseUnpaid(e.id)} disabled={saving}>
                              {saving ? <ActivityIndicator size="small" color="#fbbf24" /> : <Text style={styles.detailUnpaidBtnText}>Unpaid</Text>}
                            </Pressable>
                          ) : (
                            <View style={styles.detailPaidBadge}>
                              <Ionicons name="checkmark-circle" size={18} color="#8DEB63" />
                              <Text style={styles.detailPaidBadgeText}>Paid</Text>
                            </View>
                          )
                        ) : (
                          <Pressable style={[styles.detailPaidBtn, saving && styles.detailPaidBtnDisabled]} onPress={() => markExpensePaid(e.id)} disabled={saving}>
                            {saving ? <ActivityIndicator size="small" color="#0b100b" /> : <Text style={styles.detailPaidBtnText}>Paid</Text>}
                          </Pressable>
                        )}
                      </View>
                    ))}
                  </View>
                </>
              );
            })() : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={addModalVisible} animationType="fade">
        <Pressable style={styles.modalBackdrop} onPress={() => { setAddModalVisible(false); setEditingEntryId(null); setExpenseModalPanel("main"); }}>
          <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
            {expenseModalPanel === "main" && (
              <>
                <ScrollView style={styles.addExpenseModalScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.modalTitle}>{isEditMode ? "Edit expense" : "Add expense"}</Text>
                  <Text style={styles.modalSectionLabel}>Who paid</Text>
                  <View style={styles.pickerWrap}>
                    {members.map((m) => (
                      <Pressable key={m.id} style={[styles.pickerOption, paidBy === m.id && styles.pickerOptionActive]} onPress={() => setPaidBy(m.id)}>
                        <Text style={styles.pickerOptionText}>{m.username}</Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text style={styles.modalSectionLabel}>Amount</Text>
                  <TextInput style={styles.modalInputField} value={amountInput} onChangeText={setAmountInput} placeholder={`${getCurrency(currencyCode).symbol} 0.00`} placeholderTextColor="#737373" keyboardType="decimal-pad" />
                  <Text style={styles.modalSectionLabel}>Description</Text>
                  <TextInput style={styles.modalInputField} value={descInput} onChangeText={setDescInput} placeholder={isTravel ? "e.g. Hotel, Food" : "e.g. Materials, Fees"} placeholderTextColor="#737373" />
                  <Text style={styles.modalSectionLabel}>Split</Text>
                  <Pressable style={styles.expenseModalRowBtn} onPress={() => setExpenseModalPanel("splitAmong")}>
                    <View style={styles.expenseModalRowBtnLeft}>
                      <Text style={styles.expenseModalRowBtnLabel}>Split among</Text>
                      <View style={styles.expenseModalRowAvatars}>
                        {toSplitAmongInModal.slice(0, 4).map((uid, idx) => {
                          const m = members.find((x) => x.id === uid);
                          return m ? (
                            <View key={uid} style={[styles.expenseModalAvatarWrap, idx === 0 && { marginLeft: 0 }]}>
                              {m.avatar_url ? (
                                <Image source={{ uri: m.avatar_url }} style={styles.expenseModalAvatar} />
                              ) : (
                                <View style={styles.expenseModalAvatarPlaceholder}>
                                  <Text style={styles.expenseModalAvatarInitial}>{initial(m.username)}</Text>
                                </View>
                              )}
                            </View>
                          ) : null;
                        })}
                        {toSplitAmongInModal.length > 4 ? (
                          <View style={styles.expenseModalAvatarMore}>
                            <Text style={styles.expenseModalAvatarMoreText}>+{toSplitAmongInModal.length - 4}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Text style={styles.expenseModalRowBtnSub}>{toSplitAmongInModal.length} people</Text>
                    <Ionicons name="chevron-forward" size={18} color="#737373" />
                  </Pressable>
                  <Pressable style={styles.expenseModalRowBtn} onPress={() => setExpenseModalPanel("howToSplit")} disabled={toSplitAmongInModal.length < 2}>
                    <Text style={styles.expenseModalRowBtnLabel}>How to split</Text>
                    <View style={styles.expenseModalRowBtnRight}>
                      <Text style={styles.expenseModalRowBtnSub}>{toSplitAmongInModal.length < 2 ? "Select 2+ people" : howToSplitButtonLabel}</Text>
                      <Ionicons name="chevron-forward" size={18} color="#737373" />
                    </View>
                  </Pressable>
                </ScrollView>
                <View style={styles.modalBtnsCondensed}>
                  {isEditMode ? (
                    <Pressable style={styles.modalDeleteBtnSmall} onPress={() => editingEntryId && deleteEntry(editingEntryId)} disabled={saving}>
                      <Ionicons name="trash-outline" size={16} color="#fca5a5" />
                    </Pressable>
                  ) : null}
                  <Pressable style={styles.modalCancelSmall} onPress={() => { setAddModalVisible(false); setEditingEntryId(null); setExpenseModalPanel("main"); }}>
                    <Text style={styles.modalCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.modalAddSmall, saving && styles.modalAddDisabled]} onPress={isEditMode ? updateEntry : addEntry} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color="#0b100b" /> : <Text style={styles.modalAddText}>{isEditMode ? "Save" : "Add"}</Text>}
                  </Pressable>
                </View>
              </>
            )}

            {expenseModalPanel === "splitAmong" && (
              <>
                <View style={styles.panelHeaderRow}>
                  <Pressable onPress={() => setExpenseModalPanel("main")} style={styles.panelBackBtn} hitSlop={12}>
                    <Ionicons name="arrow-back" size={24} color="#8DEB63" />
                  </Pressable>
                  <Text style={[styles.modalTitle, styles.panelTitleCenter]}>Split among</Text>
                  <View style={styles.panelHeaderSpacer} />
                </View>
                <Text style={styles.modalHintInline}>Tap to include or exclude. At least one person required.</Text>
                <ScrollView style={styles.addExpenseModalScroll} contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false}>
                  {members.map((m) => {
                    const current = splitAmongIds.length > 0 ? splitAmongIds : memberIds;
                    const isSelected = current.includes(m.id);
                    const toggle = () => {
                      const cur = splitAmongIds.length > 0 ? splitAmongIds : memberIds;
                      if (cur.includes(m.id)) {
                        const next = cur.filter((id) => id !== m.id);
                        setSplitAmongIds(next.length > 0 ? next : cur);
                      } else {
                        setSplitAmongIds(splitAmongIds.length > 0 ? [...splitAmongIds, m.id] : [...memberIds, m.id]);
                      }
                    };
                    return (
                      <Pressable key={m.id} style={[styles.splitAmongModalRow, isSelected && styles.splitAmongRowSelected]} onPress={toggle}>
                        {m.avatar_url ? (
                          <Image source={{ uri: m.avatar_url }} style={styles.splitAmongModalAvatar} />
                        ) : (
                          <View style={styles.splitAmongModalAvatarPlaceholder}>
                            <Text style={styles.splitAmongModalAvatarInitial}>{initial(m.username)}</Text>
                          </View>
                        )}
                        <Text style={styles.splitAmongName} numberOfLines={1}>{m.username}</Text>
                        {isSelected ? <Ionicons name="checkmark-circle" size={24} color="#8DEB63" /> : <Ionicons name="ellipse-outline" size={24} color="#525252" />}
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <View style={styles.modalBtnsCondensed}>
                  <Pressable style={styles.modalDoneFull} onPress={() => setExpenseModalPanel("main")}>
                    <Text style={styles.modalAddText}>Done</Text>
                  </Pressable>
                </View>
              </>
            )}

            {expenseModalPanel === "howToSplit" && (
              <>
                <View style={styles.panelHeaderRow}>
                  <Pressable onPress={() => setExpenseModalPanel("main")} style={styles.panelBackBtn} hitSlop={12}>
                    <Ionicons name="arrow-back" size={24} color="#8DEB63" />
                  </Pressable>
                  <Text style={[styles.modalTitle, styles.panelTitleCenter]}>How to split</Text>
                  <View style={styles.panelHeaderSpacer} />
                </View>
                <Text style={styles.modalSectionLabel}>Split type</Text>
                <View style={styles.expenseSplitModeRow}>
                  <Pressable style={[styles.expenseSplitModeTab, expenseSplitMode === "equal" && styles.expenseSplitModeTabActive]} onPress={() => switchExpenseSplitMode("equal")}>
                    <Text style={[styles.expenseSplitModeTabText, expenseSplitMode === "equal" && styles.expenseSplitModeTabTextActive]}>Equal</Text>
                  </Pressable>
                  <Pressable style={[styles.expenseSplitModeTab, expenseSplitMode === "percentage" && styles.expenseSplitModeTabActive]} onPress={() => switchExpenseSplitMode("percentage")}>
                    <Text style={[styles.expenseSplitModeTabText, expenseSplitMode === "percentage" && styles.expenseSplitModeTabTextActive]}>%</Text>
                  </Pressable>
                  <Pressable style={[styles.expenseSplitModeTab, expenseSplitMode === "amount" && styles.expenseSplitModeTabActive]} onPress={() => switchExpenseSplitMode("amount")}>
                    <Text style={[styles.expenseSplitModeTabText, expenseSplitMode === "amount" && styles.expenseSplitModeTabTextActive]}>Amount</Text>
                  </Pressable>
                  <Pressable style={[styles.expenseSplitModeTab, expenseSplitMode === "shares" && styles.expenseSplitModeTabActive]} onPress={() => switchExpenseSplitMode("shares")}>
                    <Text style={[styles.expenseSplitModeTabText, expenseSplitMode === "shares" && styles.expenseSplitModeTabTextActive]}>Shares</Text>
                  </Pressable>
                </View>
                {expenseSplitMode !== "equal" ? (
                  <>
                    <Text style={styles.modalSectionLabel}>Amount per person</Text>
                    <Text style={styles.modalHintInline}>
                      {expenseSplitMode === "percentage" && "Set share % per person. Total must equal 100%."}
                      {expenseSplitMode === "amount" && `Enter amount each pays. Total: ${getCurrency(currencyCode).symbol}${expenseAmount.toFixed(2)}`}
                      {expenseSplitMode === "shares" && "Enter whole-number shares (e.g. 1, 2, 3). Split is proportional."}
                    </Text>
                    <View style={styles.expenseSplitTotalRow}>
                      <Text style={styles.expenseSplitTotalLabel}>Total</Text>
                      <Text style={[styles.expenseSplitTotalValue, (expenseSplitMode === "percentage" ? Math.abs(expenseSplitDraftTotal - 100) < 0.5 : expenseSplitMode === "amount" ? Math.abs(expenseSplitDraftTotal - expenseAmount) < 0.02 : expenseSplitDraftTotal > 0) && styles.expenseSplitTotalOk]}>
                        {expenseSplitMode === "percentage" && `${expenseSplitDraftTotal.toFixed(1)}%`}
                        {expenseSplitMode === "amount" && `${getCurrency(currencyCode).symbol}${expenseSplitDraftTotal.toFixed(2)}`}
                        {expenseSplitMode === "shares" && `${expenseSplitDraftTotal} share${expenseSplitDraftTotal !== 1 ? "s" : ""}`}
                      </Text>
                    </View>
                    <ScrollView style={styles.howToSplitInputsScroll} contentContainerStyle={styles.panelScrollContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                      {toSplitAmongInModal.map((uid) => {
                        const m = members.find((x) => x.id === uid);
                        return (
                          <View key={uid} style={styles.expenseSplitInputRow}>
                            <Text style={styles.expenseSplitInputLabel} numberOfLines={1}>{m?.username ?? "?"}</Text>
                            <TextInput
                              style={styles.expenseSplitInput}
                              value={expenseSplitDraft[uid] ?? ""}
                              onChangeText={(t) => setExpenseSplitDraft((prev) => ({ ...prev, [uid]: t }))}
                              placeholder={expenseSplitMode === "shares" ? "1" : "0"}
                              placeholderTextColor="#737373"
                              keyboardType={expenseSplitMode === "shares" ? "number-pad" : "decimal-pad"}
                            />
                            {expenseSplitMode === "percentage" ? <Text style={styles.expenseSplitSuffix}>%</Text> : null}
                            {expenseSplitMode === "amount" ? <Text style={styles.expenseSplitSuffix}>{getCurrency(currencyCode).symbol}</Text> : null}
                            {expenseSplitMode === "shares" ? <Text style={styles.expenseSplitSuffix}>share(s)</Text> : null}
                          </View>
                        );
                      })}
                    </ScrollView>
                  </>
                ) : (
                  <Text style={styles.modalHintInline}>Cost is split equally among selected people.</Text>
                )}
                <View style={styles.modalBtnsCondensed}>
                  <Pressable style={styles.modalDoneFull} onPress={() => setExpenseModalPanel("main")}>
                    <Text style={styles.modalAddText}>Done</Text>
                  </Pressable>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 12 },
  loadingText: { color: "#a3a3a3", fontSize: 14 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  deleteGroupBtn: { padding: 8 },
  pressed: { opacity: 0.7 },
  headerText: { flex: 1, minWidth: 0 },
  headerTitle: { color: "#fafafa", fontSize: 20, fontWeight: "800" },
  headerSub: { color: "#737373", fontSize: 13, marginTop: 2 },
  tabBar: { flexDirection: "row", paddingHorizontal: 16, paddingVertical: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  tab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: 10 },
  tabActive: { backgroundColor: "rgba(141,235,99,0.12)" },
  tabText: { color: "#737373", fontSize: 14, fontWeight: "600" },
  tabTextActive: { color: "#8DEB63" },
  tabPanel: { paddingTop: 8 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  errText: { color: "#fca5a5", fontSize: 14, marginBottom: 12 },
  label: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 6 },
  input: { backgroundColor: "#0f1410", borderRadius: 12, padding: 14, color: "#fafafa", fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  hint: { color: "#737373", fontSize: 13, marginBottom: 10 },
  friendChipsWrap: { marginBottom: 8 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "#141a14", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  chipAvatar: { width: 24, height: 24, borderRadius: 12 },
  chipAvatarPlaceholder: { width: 24, height: 24, borderRadius: 12, backgroundColor: "rgba(141,235,99,0.15)", justifyContent: "center", alignItems: "center" },
  chipAvatarInitial: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  chipText: { color: "#e5e5e5", fontSize: 14 },
  searchWrap: { flexDirection: "row", alignItems: "center", backgroundColor: "#0f1410", borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", paddingHorizontal: 12 },
  searchIcon: { marginRight: 8 },
  searchInput: { flex: 1, paddingVertical: 12, color: "#fafafa", fontSize: 15 },
  friendList: { marginBottom: 20 },
  friendRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#141a14", marginBottom: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  friendRowSelected: { borderColor: "#8DEB63", backgroundColor: "rgba(141,235,99,0.08)" },
  friendRowLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  friendAvatar: { width: 36, height: 36, borderRadius: 18 },
  friendAvatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(141,235,99,0.15)", justifyContent: "center", alignItems: "center" },
  friendAvatarInitial: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  friendName: { color: "#e5e5e5", fontSize: 15 },
  noResults: { color: "#737373", fontSize: 14, marginBottom: 12 },
  primaryBtn: { backgroundColor: "#8DEB63", paddingVertical: 14, borderRadius: 14, alignItems: "center" },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: "#0b100b", fontSize: 16, fontWeight: "700" },
  section: { marginBottom: 28 },
  sectionLabel: { color: "#737373", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 10 },
  sectionEmpty: { color: "#525252", fontSize: 14, marginBottom: 12 },
  sectionTitle: { color: "#e5e5e5", fontSize: 16, fontWeight: "700", marginBottom: 12 },
  entryCard: { backgroundColor: "#141a14", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  entryCardPressable: { position: "relative" },
  entryCardTitle: { color: "#fafafa", fontSize: 17, fontWeight: "700", marginBottom: 4 },
  entryCardChevron: {},
  entryRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  entryMeta: { color: "#737373", fontSize: 14, flex: 1, marginRight: 8 },
  entryPaid: { color: "#a3a3a3", fontSize: 13 },
  entryAmount: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  entryDesc: { color: "#737373", fontSize: 12, marginTop: 4 },
  addEntryBtnTop: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 14, paddingHorizontal: 20, marginBottom: 16, borderRadius: 14, backgroundColor: "rgba(141,235,99,0.12)", borderWidth: 1, borderColor: "rgba(141,235,99,0.35)" },
  addEntryBtnTopText: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  settingsNameRow: { flexDirection: "row", gap: 10, marginBottom: 20 },
  settingsNameInput: { flex: 1, backgroundColor: "#141a14", borderRadius: 12, padding: 14, color: "#fafafa", fontSize: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  settingsSaveBtn: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 12, backgroundColor: "#8DEB63", justifyContent: "center" },
  settingsSaveBtnText: { color: "#0b100b", fontSize: 15, fontWeight: "700" },
  membersList: { gap: 8 },
  memberRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 14, backgroundColor: "#141a14", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  memberRowLeft: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  memberName: { color: "#e5e5e5", fontSize: 15 },
  memberYou: { color: "#737373", fontSize: 12, fontWeight: "600", marginLeft: 6 },
  settingsMemberAvatar: { width: 36, height: 36, borderRadius: 18 },
  settingsMemberAvatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  settingsMemberAvatarInitial: { color: "#8DEB63", fontSize: 14, fontWeight: "700" },
  addMemberBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(141,235,99,0.12)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.35)",
  },
  addMemberBtnText: { color: "#8DEB63", fontSize: 15, fontWeight: "600" },
  settingsLeaveRow: { marginTop: 20 },
  leaveGroupBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.4)",
    backgroundColor: "rgba(251,191,36,0.1)",
  },
  leaveGroupBtnText: { color: "#fbbf24", fontSize: 15, fontWeight: "700" },
  addMemberModalCard: { backgroundColor: "#141a14", borderRadius: 20, padding: 22, marginHorizontal: 24, maxWidth: 400, maxHeight: "85%", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  addMemberModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  addMemberModalTitle: { color: "#fafafa", fontSize: 20, fontWeight: "800" },
  addMemberModalHint: { color: "#737373", fontSize: 13, marginBottom: 14 },
  addMemberModalScroll: { maxHeight: 280, marginBottom: 16 },
  addMemberModalEmpty: { color: "#737373", fontSize: 14, paddingVertical: 24, textAlign: "center" },
  addMemberConfirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 12, backgroundColor: "#8DEB63", borderWidth: 1, borderColor: "rgba(141,235,99,0.5)" },
  addMemberConfirmBtnDisabled: { opacity: 0.5 },
  addMemberConfirmBtnText: { color: "#0b100b", fontSize: 16, fontWeight: "700" },
  deleteGroupBtnBlock: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: "rgba(252,165,165,0.3)", backgroundColor: "rgba(239,68,68,0.08)", marginTop: 8 },
  deleteGroupBtnBlockText: { color: "#fca5a5", fontSize: 15, fontWeight: "700" },
  addEntryBtn: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 12, marginTop: 4 },
  addEntryBtnText: { color: "#8DEB63", fontSize: 15, fontWeight: "600" },
  summaryCardList: { gap: 10 },
  summaryCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#141a14",
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  summaryCardLeft: { flexDirection: "row", alignItems: "center", gap: 14, flex: 1, minWidth: 0 },
  summaryAvatar: { width: 44, height: 44, borderRadius: 22 },
  summaryAvatarPlaceholder: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  summaryAvatarInitial: { color: "#8DEB63", fontSize: 18, fontWeight: "700" },
  summaryCardName: { color: "#e5e5e5", fontSize: 16, fontWeight: "600", flex: 1 },
  summaryCardAmount: { fontSize: 17, fontWeight: "800" },
  balanceRow: { backgroundColor: "#141a14", borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  balanceName: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  balanceMeta: { color: "#737373", fontSize: 12, marginTop: 2 },
  balanceVal: { fontSize: 14, fontWeight: "700", marginTop: 4 },
  balanceGets: { color: "#8DEB63" },
  balanceOwes: { color: "#fbbf24" },
  settleUpBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 20,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.5)",
  },
  settleUpBtnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "700" },
  settleUpModalCard: { backgroundColor: "#141a14", borderRadius: 20, padding: 22, marginHorizontal: 24, maxWidth: 400, maxHeight: "80%", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  settleUpModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  settleUpModalTitle: { color: "#fafafa", fontSize: 20, fontWeight: "800" },
  settleUpModalScroll: { maxHeight: 360 },
  settleUpRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    marginBottom: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  settleUpRowFrom: { color: "#e5e5e5", fontSize: 15, fontWeight: "600", flex: 1 },
  settleUpRowArrow: { marginHorizontal: 8 },
  settleUpRowTo: { color: "#e5e5e5", fontSize: 15, fontWeight: "600", flex: 1 },
  settleUpRowAmount: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  detailModalCard: { backgroundColor: "#141a14", borderRadius: 20, padding: 22, marginHorizontal: 24, maxWidth: 400, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  detailModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  detailModalTitle: { color: "#fafafa", fontSize: 20, fontWeight: "800" },
  detailModalAvatarRow: { flexDirection: "row", alignItems: "center", gap: 16, marginBottom: 8 },
  detailModalAvatar: { width: 56, height: 56, borderRadius: 28 },
  detailModalAvatarPlaceholder: { width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(141,235,99,0.2)", alignItems: "center", justifyContent: "center" },
  detailModalAvatarInitial: { color: "#8DEB63", fontSize: 22, fontWeight: "700" },
  detailModalBalance: { fontSize: 24, fontWeight: "800" },
  detailModalLabel: { color: "#737373", fontSize: 14, marginBottom: 20 },
  detailModalScroll: { maxHeight: 400 },
  detailModalScrollContent: { paddingBottom: 16 },
  detailModalSection: { marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.06)" },
  detailModalSectionTitle: { color: "#8DEB63", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  detailModalLine: { color: "#e5e5e5", fontSize: 14, marginBottom: 6 },
  detailExpenseList: { gap: 8 },
  detailExpenseRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 14, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  detailExpenseLeft: { flex: 1, minWidth: 0, marginRight: 12 },
  detailExpenseDesc: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  detailExpenseMeta: { color: "#737373", fontSize: 13, marginTop: 2 },
  detailPaidBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  detailPaidBadgeText: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },
  detailPaidBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(141,235,99,0.25)", borderWidth: 1, borderColor: "rgba(141,235,99,0.5)" },
  detailPaidBtnDisabled: { opacity: 0.6 },
  detailPaidBtnText: { color: "#0b100b", fontSize: 13, fontWeight: "700" },
  detailUnpaidBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(251,191,36,0.2)", borderWidth: 1, borderColor: "rgba(251,191,36,0.5)" },
  detailUnpaidBtnText: { color: "#fbbf24", fontSize: 13, fontWeight: "700" },
  settleBlock: { marginTop: 14, padding: 16, backgroundColor: "rgba(141,235,99,0.06)", borderRadius: 14, borderWidth: 1, borderColor: "rgba(141,235,99,0.2)" },
  settleLabel: { color: "#8DEB63", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  settleTitle: { color: "#8DEB63", fontSize: 14, fontWeight: "700", marginBottom: 8 },
  settleLine: { color: "#e5e5e5", fontSize: 14, marginBottom: 6 },
  settledText: { color: "#8DEB63", fontSize: 14, marginTop: 8 },
  saveSettlementBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, backgroundColor: "rgba(141,235,99,0.25)", borderWidth: 1, borderColor: "rgba(141,235,99,0.5)" },
  saveSettlementBtnDisabled: { opacity: 0.7 },
  saveSettlementBtnText: { color: "#0b100b", fontSize: 14, fontWeight: "600" },
  settlementSavedBadge: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 12, paddingVertical: 10 },
  settlementSavedText: { color: "#8DEB63", fontSize: 15, fontWeight: "600" },
  savedSettlementBlock: { marginTop: 16, padding: 14, backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 12, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  savedSettlementTitle: { color: "#8DEB63", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 },
  savedSettlementDate: { color: "#737373", fontSize: 12, marginBottom: 8 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "center", padding: 20 },
  modalCard: { backgroundColor: "#141a14", borderRadius: 18, padding: 22, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", maxWidth: 400, maxHeight: "85%" },
  addExpenseModalScroll: { maxHeight: 400 },
  modalTitle: { color: "#fafafa", fontSize: 20, fontWeight: "800", marginBottom: 20 },
  modalSectionLabel: { color: "#737373", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  modalLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 6, marginTop: 10 },
  modalInputField: { backgroundColor: "#0b100b", borderRadius: 12, padding: 14, color: "#fafafa", fontSize: 16, marginBottom: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalHintInline: { color: "#525252", fontSize: 12, marginBottom: 10 },
  modalHint: { color: "#737373", fontSize: 12, marginTop: 6, marginBottom: 16 },
  pickerWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  pickerOption: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "#1a1f1a", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  pickerOptionActive: { backgroundColor: "rgba(141,235,99,0.2)", borderColor: "#8DEB63" },
  pickerOptionText: { color: "#e5e5e5", fontSize: 14 },
  splitAmongList: { marginBottom: 8 },
  splitAmongRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, backgroundColor: "#0f1410", marginBottom: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  splitAmongRowSelected: { borderColor: "rgba(141,235,99,0.4)", backgroundColor: "rgba(141,235,99,0.08)" },
  expenseModalRowBtn: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, backgroundColor: "#0f1410", marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  expenseModalRowBtnLeft: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 },
  expenseModalRowBtnLabel: { color: "#e5e5e5", fontSize: 15, fontWeight: "600", marginRight: 10 },
  expenseModalRowAvatars: { flexDirection: "row", alignItems: "center" },
  expenseModalAvatarWrap: { marginLeft: -6, borderWidth: 2, borderColor: "#141a14", borderRadius: 14 },
  expenseModalAvatar: { width: 28, height: 28, borderRadius: 14 },
  expenseModalAvatarPlaceholder: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(141,235,99,0.2)", justifyContent: "center", alignItems: "center" },
  expenseModalAvatarInitial: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  expenseModalAvatarMore: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(115,115,115,0.3)", justifyContent: "center", alignItems: "center", marginLeft: 4 },
  expenseModalAvatarMoreText: { color: "#a3a3a3", fontSize: 11, fontWeight: "600" },
  expenseModalRowBtnSub: { color: "#737373", fontSize: 13, marginRight: 6 },
  expenseModalRowBtnRight: { flexDirection: "row", alignItems: "center" },
  modalBtnsCondensed: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "nowrap" },
  modalDeleteBtnSmall: { paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: "rgba(252,165,165,0.3)" },
  modalCancelSmall: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, backgroundColor: "#1a1f1a", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalAddSmall: { flex: 1, paddingVertical: 10, alignItems: "center", borderRadius: 10, backgroundColor: "#8DEB63" },
  panelHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 20 },
  panelBackBtn: { padding: 4, marginRight: 8 },
  panelTitleCenter: { flex: 1, textAlign: "center" },
  panelHeaderSpacer: { width: 40 },
  panelScrollContent: { paddingBottom: 24 },
  modalDoneFull: { flex: 1, paddingVertical: 10, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#8DEB63" },
  howToSplitInputsScroll: { maxHeight: 260 },
  subModalCard: { backgroundColor: "#141a14", borderRadius: 18, padding: 20, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)", maxWidth: 400, maxHeight: "80%" },
  subModalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  subModalTitle: { color: "#fafafa", fontSize: 18, fontWeight: "700" },
  subModalHint: { color: "#737373", fontSize: 13, marginBottom: 12 },
  subModalScroll: { maxHeight: 280, marginBottom: 16 },
  subModalDoneBtn: { backgroundColor: "#8DEB63", paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  subModalDoneText: { color: "#0b100b", fontSize: 16, fontWeight: "700" },
  splitAmongModalRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 12, borderRadius: 12, backgroundColor: "#0f1410", marginBottom: 8, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)", gap: 12 },
  splitAmongModalAvatar: { width: 40, height: 40, borderRadius: 20 },
  splitAmongModalAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(141,235,99,0.2)", justifyContent: "center", alignItems: "center" },
  splitAmongModalAvatarInitial: { color: "#8DEB63", fontSize: 16, fontWeight: "700" },
  expenseSplitModeRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  expenseSplitModeTab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: "#0f1410", alignItems: "center", borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  expenseSplitModeTabActive: { borderColor: "rgba(141,235,99,0.4)", backgroundColor: "rgba(141,235,99,0.08)" },
  expenseSplitModeTabText: { color: "#737373", fontSize: 13, fontWeight: "600" },
  expenseSplitModeTabTextActive: { color: "#8DEB63" },
  expenseSplitInputsWrap: { marginTop: 8, marginBottom: 8 },
  expenseSplitHint: { color: "#525252", fontSize: 12, marginBottom: 10 },
  expenseSplitTotalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, paddingVertical: 6 },
  expenseSplitTotalLabel: { color: "#a3a3a3", fontSize: 13, fontWeight: "600" },
  expenseSplitTotalValue: { color: "#737373", fontSize: 14 },
  expenseSplitTotalOk: { color: "#8DEB63" },
  expenseSplitInputRow: { flexDirection: "row", alignItems: "center", marginBottom: 8, gap: 8 },
  expenseSplitInputLabel: { color: "#e5e5e5", fontSize: 14, width: 80 },
  expenseSplitInput: { flex: 1, backgroundColor: "#0f1410", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 12, color: "#fafafa", fontSize: 15, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  expenseSplitSuffix: { color: "#737373", fontSize: 13, minWidth: 48 },
  splitAmongName: { color: "#e5e5e5", fontSize: 15 },
  modalBtns: { flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" },
  modalDeleteBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: "rgba(252,165,165,0.3)" },
  modalDeleteBtnText: { color: "#fca5a5", fontSize: 15, fontWeight: "600" },
  modalCancel: { flex: 1, minWidth: 80, paddingVertical: 12, alignItems: "center", borderRadius: 12, backgroundColor: "#1a1f1a", borderWidth: 1, borderColor: "rgba(255,255,255,0.08)" },
  modalCancelText: { color: "#e5e5e5", fontSize: 15 },
  modalAdd: { flex: 1, minWidth: 80, paddingVertical: 12, alignItems: "center", borderRadius: 12, backgroundColor: "#8DEB63" },
  modalAddDisabled: { opacity: 0.6 },
  modalAddText: { color: "#0b100b", fontWeight: "700", fontSize: 15 },
});
