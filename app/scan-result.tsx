import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { OCR_SERVER_URL } from "./config";

type ResultItem = { name?: string; qty?: number; price?: string };
type Assignments = Record<number, number[]>;
type DynamicPercentages = Record<number, Record<number, number>>;
type MemberGroup = { id: string; name: string; members: string[] };

export default function ScanResultScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ merchant?: string; date?: string; total?: string; source?: string; imageUri?: string; items?: string }>();
  const merchant = params.merchant || "-";
  const date = params.date || "-";
  const total = params.total || "-";
  const source = params.source || "ocr";
  const imageUri = params.imageUri;
  const items: ResultItem[] = (() => {
    try { return params.items ? (JSON.parse(params.items) as ResultItem[]) : []; } catch { return []; }
  })();

  const [members, setMembers] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [dynamicPercentages, setDynamicPercentages] = useState<DynamicPercentages>({});
  const [dynamicModalVisible, setDynamicModalVisible] = useState(false);
  const [dynamicItemIndex, setDynamicItemIndex] = useState<number | null>(null);
  const [dynamicAssignees, setDynamicAssignees] = useState<number[]>([]);
  const [dynamicDraft, setDynamicDraft] = useState<Record<number, string>>({});
  const [groupPickerVisible, setGroupPickerVisible] = useState(false);
  const [groups, setGroups] = useState<MemberGroup[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const hasAssignedMembers = Object.values(assignments).some((memberIndexes) => memberIndexes.length > 0);

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

    // Reconcile to receipt total so tax, discounts, service fees, etc. are included.
    const itemsSubtotal = items.reduce((sum, item) => sum + (parseFloat(item.price || "0") || 0), 0);
    const receiptTotal = parseFloat(total || "0") || 0;
    const adjustment = receiptTotal - itemsSubtotal;
    const assignedBaseSum = baseTotals.reduce((sum, value) => sum + value, 0);
    const totals = [...baseTotals];

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

    return members.map((name, i) => ({ name, amount: Math.round(totals[i] * 100) / 100 }));
  }, [assignments, dynamicPercentages, items, members, total]);

  const addMember = () => {
    Alert.prompt(
      "Add Member",
      "Enter member name",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Add",
          onPress: (value?: string) => {
            const name = (value || "").trim();
            if (!name) return;
            if (members.includes(name)) {
              setSaveError("Member name already exists.");
              return;
            }
            setMembers((prev) => [...prev, name]);
            setSaveError(null);
          },
        },
      ],
      "plain-text"
    );
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
    setGroupsLoading(true);
    setSaveError(null);
    try {
      const res = await fetch(`${OCR_SERVER_URL}/groups`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load groups");
      setGroups(Array.isArray(data?.groups) ? data.groups : []);
      setGroupPickerVisible(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to load groups");
    } finally {
      setGroupsLoading(false);
    }
  };

  const applyGroupMembers = (group: MemberGroup) => {
    setMembers((prev) => {
      const merged = Array.from(new Set([...prev, ...group.members.map((x) => x.trim()).filter(Boolean)]));
      return merged;
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

    const existing = dynamicPercentages[itemIndex] || {};
    const sorted = [...assignees].sort((a, b) => a - b);
    const draft: Record<number, number> = {};
    const equal = sorted.length ? 100 / sorted.length : 0;

    sorted.forEach((memberIdx) => {
      const value = existing[memberIdx];
      draft[memberIdx] = Number.isFinite(value) ? value : Number(equal.toFixed(2));
    });

    setDynamicItemIndex(itemIndex);
    setDynamicAssignees(sorted);
    const draftText: Record<number, string> = {};
    Object.entries(draft).forEach(([memberIdx, value]) => {
      draftText[Number(memberIdx)] = value.toFixed(2);
    });
    setDynamicDraft(draftText);
    setDynamicModalVisible(true);
  };

  const updateDynamicDraft = (memberIndex: number, input: string) => {
    // Keep typing smooth (including backspace) and only validate on Apply.
    if (!/^\d*\.?\d*$/.test(input)) return;
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

  const applyDynamicSplit = () => {
    if (dynamicItemIndex == null || !dynamicAssignees.length) {
      setDynamicModalVisible(false);
      return;
    }
    const out: Record<number, number> = {};

    if (dynamicAssignees.length === 1) {
      out[dynamicAssignees[0]] = 100;
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

    // If non-last entries overflow 100, scale them down on Apply.
    if (nonLastSum > 100) {
      const factor = 100 / nonLastSum;
      nonLastValues = nonLastValues.map((value) => Number((value * factor).toFixed(2)));
      nonLastSum = nonLastValues.reduce((sum, value) => sum + value, 0);
    }

    nonLastMembers.forEach((memberIndex, idx) => {
      out[memberIndex] = nonLastValues[idx];
    });

    // Last user keeps total in check to reach exactly 100%.
    const remainder = Number((100 - nonLastSum).toFixed(2));
    out[lastMemberIndex] = remainder < 0 ? 0 : remainder;

    setDynamicPercentages((prev) => ({ ...prev, [dynamicItemIndex]: out }));
    setDynamicModalVisible(false);
  };

  const saveReceipt = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedId(null);
    try {
      const response = await fetch(`${OCR_SERVER_URL}/receipts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: merchant === "-" ? null : merchant,
          date: date === "-" ? null : date,
          total: total === "-" ? null : total,
          source,
          items,
          members,
          assignments,
          split_totals: splitTotals,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || "Failed to save receipt");
      setSavedId(String(data?.id || ""));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save receipt.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Text style={styles.title}>Scan Result</Text>
        {imageUri ? <Image source={{ uri: imageUri }} style={styles.preview} resizeMode="cover" /> : null}

        <View style={styles.card}>
          <View style={styles.splitSection}>
            <Text style={styles.sectionLabel}>QUICK ACTION</Text>
            <View style={styles.memberInputRow}>
              <Pressable onPress={addMember} style={({ pressed }) => [styles.addBtn, pressed && styles.addBtnPressed]}>
                <Ionicons name="person-add-outline" size={18} color="#0a0a0a" />
                <Text style={styles.addBtnText}>Add Member</Text>
              </Pressable>
              <Pressable onPress={addGroup} style={({ pressed }) => [styles.groupBtn, pressed && styles.addBtnPressed]}>
                <Ionicons name="people-outline" size={18} color="#e5e5e5" />
                <Text style={styles.groupBtnText}>Add Group</Text>
              </Pressable>
            </View>
            {members.length ? (
              <View style={styles.memberChips}>
                {members.map((member, idx) => (
                  <View key={`${member}-${idx}`} style={styles.memberChipWrap}>
                    <Text style={styles.memberChipText}>{member}</Text>
                    <Pressable onPress={() => removeMember(idx)} hitSlop={8}><Ionicons name="close-circle" size={16} color="#a3a3a3" /></Pressable>
                  </View>
                ))}
              </View>
            ) : <Text style={styles.emptyText}></Text>}
          </View>

          <Pressable style={({ pressed }) => [styles.clearBtn, pressed && styles.clearBtnPressed]} onPress={clearAllAssignments}>
            <Ionicons name="refresh-outline" size={16} color="#fca5a5" />
            <Text style={styles.clearBtnText}>Clear All Assignments</Text>
          </Pressable>

          <View style={styles.summaryRow}>
            <Text style={styles.merchantName} numberOfLines={1}>{merchant}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>{date}</Text>
              <Text style={styles.totalBadge}>{total === "-" ? "-" : `$${total}`}</Text>
            </View>
          </View>

          <Text style={styles.sectionLabel}>Items</Text>
          {items.length ? items.map((item, index) => (
            <View key={`${item.name || "item"}-${index}`} style={styles.itemWrap}>
              <View style={styles.itemRow}>
                <View style={styles.itemLeft}>
                  <Text style={styles.itemName}>{item.name || "-"}</Text>
                  <Text style={styles.itemQty}>Qty {item.qty ?? 1}</Text>
                </View>
                <Text style={styles.itemPrice}>{item.price ? `$${item.price}` : "-"}</Text>
              </View>
              {members.length ? (
                <View style={styles.assignRow}>
                  <Text style={styles.assignLabel}>Assign to</Text>
                  <View style={styles.assignChips}>
                    {(() => {
                      const allSelected = members.length > 0 && (assignments[index] || []).length === members.length;
                      return (
                        <Pressable
                          key={`all-${index}`}
                          onPress={() => toggleAssignAllForItem(index)}
                          style={({ pressed }) => [styles.assignChip, allSelected && styles.assignChipSelected, pressed && styles.assignChipPressed]}
                        >
                          <Text style={[styles.assignChipText, allSelected && styles.assignChipTextSelected]}>All</Text>
                        </Pressable>
                      );
                    })()}
                    {members.map((member, memberIndex) => {
                      const selected = (assignments[index] || []).includes(memberIndex);
                      return (
                        <Pressable key={`${member}-${memberIndex}`} onPress={() => toggleAssignment(index, memberIndex)} style={({ pressed }) => [styles.assignChip, selected && styles.assignChipSelected, pressed && styles.assignChipPressed]}>
                          <Text style={[styles.assignChipText, selected && styles.assignChipTextSelected]}>{member}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {(assignments[index] || []).length > 0 ? (
                    <Pressable onPress={() => openDynamicSplitModal(index)} style={({ pressed }) => [styles.dynamicBtn, pressed && styles.assignChipPressed]}>
                      <Ionicons name="options-outline" size={14} color="#e5e5e5" />
                      <Text style={styles.dynamicBtnText}>Dynamic Splitting</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          )) : <Text style={styles.emptyText}>No line items found.</Text>}

          {hasAssignedMembers && splitTotals.length ? (
            <View style={styles.totalsBox}>
              <Text style={styles.adjustmentNote}>Includes tax, discounts, and fees.</Text>
              {splitTotals.map((entry) => (
                <View key={entry.name} style={styles.totalRow}>
                  <Text style={styles.totalName}>{entry.name}</Text>
                  <Text style={styles.totalAmount}>${entry.amount.toFixed(2)}</Text>
                </View>
              ))}
            </View>
          ) : null}

        </View>
        <Modal transparent visible={dynamicModalVisible} animationType="fade" onRequestClose={() => setDynamicModalVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Dynamic Splitting</Text>
              <Text style={styles.modalHint}>You can edit all users. Apply will enforce total = 100%.</Text>
              <Text style={styles.modalTotal}>Total: {dynamicDraftTotal.toFixed(2)}%</Text>

              {dynamicAssignees.map((memberIndex, idx) => {
                const value = dynamicDraft[memberIndex] ?? "";
                return (
                  <View key={`dynamic-${memberIndex}`} style={styles.modalRow}>
                    <Text style={styles.modalMember}>{members[memberIndex] || `Member ${memberIndex + 1}`}</Text>
                    <View style={styles.modalInputWrap}>
                      <TextInput
                        keyboardType="decimal-pad"
                        value={value}
                        onChangeText={(txt) => updateDynamicDraft(memberIndex, txt)}
                        style={styles.modalInput}
                      />
                      <Text style={styles.modalPercent}>%</Text>
                    </View>
                  </View>
                );
              })}

              <View style={styles.modalActions}>
                <Pressable onPress={() => setDynamicModalVisible(false)} style={({ pressed }) => [styles.modalBtnGhost, pressed && styles.addBtnPressed]}>
                  <Text style={styles.modalBtnGhostText}>Cancel</Text>
                </Pressable>
                <Pressable onPress={applyDynamicSplit} style={({ pressed }) => [styles.modalBtnPrimary, pressed && styles.addBtnPressed]}>
                  <Text style={styles.modalBtnPrimaryText}>Apply</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Modal transparent visible={groupPickerVisible} animationType="fade" onRequestClose={() => setGroupPickerVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>Add Group</Text>
              <Text style={styles.modalHint}>Choose a group to quickly add members.</Text>
              {groupsLoading ? <Text style={styles.modalHint}>Loading groups...</Text> : null}
              {!groupsLoading && !groups.length ? <Text style={styles.modalHint}>No groups created yet.</Text> : null}
              <ScrollView style={{ maxHeight: 220 }}>
                {groups.map((group) => (
                  <Pressable key={group.id} onPress={() => applyGroupMembers(group)} style={({ pressed }) => [styles.groupPickRow, pressed && styles.addBtnPressed]}>
                    <Text style={styles.groupPickName}>{group.name}</Text>
                    <Text style={styles.groupPickMembers} numberOfLines={1}>
                      {group.members.join(", ")}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.modalActions}>
                <Pressable onPress={() => setGroupPickerVisible(false)} style={({ pressed }) => [styles.modalBtnGhost, pressed && styles.addBtnPressed]}>
                  <Text style={styles.modalBtnGhostText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        <Pressable style={({ pressed }) => [styles.saveButton, pressed && styles.buttonPressed, saving && styles.saveButtonDisabled]} onPress={saveReceipt} disabled={saving}>
          <Ionicons name="save-outline" size={18} color="#0a0a0a" />
          <Text style={styles.buttonText}>{saving ? "Saving..." : (savedId ? "Saved successfully" : "Save Receipt")}</Text>
        </Pressable>
        {saveError ? <Text style={styles.saveError}>{saveError}</Text> : null}

        <Pressable style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={18} color="#0a0a0a" />
          <Text style={styles.buttonText}>Back to Home</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  scroll: { flex: 1 },
  content: { paddingTop: 12, paddingBottom: 28, paddingHorizontal: 20 },
  title: { color: "#e5e5e5", fontSize: 28, fontWeight: "700", marginBottom: 16 },
  preview: { width: "100%", height: 210, borderRadius: 16, marginBottom: 14, backgroundColor: "#141414" },
  card: { borderRadius: 16, padding: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.12)", backgroundColor: "#141414", marginBottom: 16 },
  summaryRow: { marginBottom: 14, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  merchantName: { color: "#e5e5e5", fontSize: 20, fontWeight: "600", marginBottom: 6 },
  metaRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  metaText: { color: "#a3a3a3", fontSize: 13 },
  totalBadge: { color: "#00d97e", fontSize: 18, fontWeight: "700" },
  sectionLabel: { color: "#737373", fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.4 },
  itemWrap: { borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.06)" },
  itemRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10 },
  itemLeft: { flex: 1, paddingRight: 12 },
  itemName: { color: "#e5e5e5", fontSize: 14, fontWeight: "500" },
  itemQty: { color: "#737373", fontSize: 12, marginTop: 2 },
  itemPrice: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
  assignRow: { paddingBottom: 10 },
  assignLabel: { color: "#737373", fontSize: 11, marginBottom: 6 },
  assignChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  assignChip: { borderRadius: 18, paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(255,255,255,0.06)" },
  assignChipSelected: { borderColor: "#00d97e", backgroundColor: "rgba(0,217,126,0.18)" },
  assignChipPressed: { opacity: 0.9 },
  assignChipText: { color: "#a3a3a3", fontSize: 12 },
  assignChipTextSelected: { color: "#00d97e", fontWeight: "600" },
  dynamicBtn: {
    marginTop: 8,
    minHeight: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
  },
  dynamicBtnText: { color: "#e5e5e5", fontSize: 12, fontWeight: "600" },
  emptyText: { color: "#737373", fontSize: 14, fontStyle: "italic" },
  splitSection: { marginTop: 14, paddingTop: 10 },
  memberInputRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  addBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 8,
  },
  groupBtn: {
    flex: 1,
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 8,
  },
  groupBtnText: { color: "#e5e5e5", fontWeight: "700", fontSize: 13 },
  addBtnPressed: { opacity: 0.9 },
  addBtnText: { color: "#0a0a0a", fontWeight: "700", fontSize: 14 },
  memberChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  memberChipWrap: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.1)", paddingVertical: 6, paddingHorizontal: 10 },
  memberChipText: { color: "#e5e5e5", fontSize: 12 },
  totalsBox: { marginTop: 4, borderRadius: 12, borderWidth: 1, borderColor: "rgba(0,217,126,0.25)", backgroundColor: "rgba(0,217,126,0.08)", padding: 10 },
  adjustmentNote: { color: "#a3a3a3", fontSize: 12, marginBottom: 4 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  totalName: { color: "#e5e5e5", fontSize: 14 },
  totalAmount: { color: "#00d97e", fontSize: 14, fontWeight: "700" },
  saveButton: { minHeight: 48, borderRadius: 12, backgroundColor: "#8DEB63", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, marginBottom: 8 },
  saveButtonDisabled: { opacity: 0.7 },
  clearBtn: {
    minHeight: 40,
    borderRadius: 10,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  clearBtnPressed: { opacity: 0.9 },
  clearBtnText: { color: "#fca5a5", fontSize: 13, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#141414",
    padding: 16,
  },
  modalTitle: { color: "#e5e5e5", fontSize: 20, fontWeight: "700", marginBottom: 6 },
  modalHint: { color: "#a3a3a3", fontSize: 12, marginBottom: 12 },
  modalTotal: { color: "#8DEB63", fontSize: 13, fontWeight: "700", marginBottom: 10 },
  modalRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  modalMember: { color: "#e5e5e5", fontSize: 14, flex: 1, paddingRight: 10 },
  modalInputWrap: { flexDirection: "row", alignItems: "center", gap: 6 },
  modalInput: {
    minWidth: 72,
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "#101010",
    color: "#e5e5e5",
    textAlign: "right",
    paddingHorizontal: 8,
  },
  modalPercent: { color: "#a3a3a3", fontSize: 13 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  modalBtnGhost: {
    minHeight: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnGhostText: { color: "#e5e5e5", fontWeight: "600", fontSize: 13 },
  modalBtnPrimary: {
    minHeight: 38,
    borderRadius: 10,
    backgroundColor: "#8DEB63",
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBtnPrimaryText: { color: "#0a0a0a", fontWeight: "700", fontSize: 13 },
  groupPickRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#101010",
    padding: 10,
    marginBottom: 8,
  },
  groupPickName: { color: "#e5e5e5", fontSize: 14, fontWeight: "700", marginBottom: 4 },
  groupPickMembers: { color: "#a3a3a3", fontSize: 12 },
  button: { minHeight: 48, borderRadius: 12, backgroundColor: "#8DEB63", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  buttonPressed: { opacity: 0.9 },
  buttonText: { color: "#0a0a0a", fontSize: 16, fontWeight: "700" },
  saveError: { color: "#fca5a5", fontSize: 13, marginBottom: 8, textAlign: "center" },
});
