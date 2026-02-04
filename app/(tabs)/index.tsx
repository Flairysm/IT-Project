import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActionSheetIOS,
  Alert,
  Platform,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { Image as ExpoImage } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { OCR_SERVER_URL } from "../config";
import { supabase } from "../lib/supabase";

type LineItem = {
  name: string;
  price: string;
  qty: number;
};

type TotalCheck = {
  subtotal: number | null;
  serviceCharge: number | null;
  sst: number | null;
  total: number | null;
  expectedTotal: number | null;
  match: boolean;
} | null;

type ExtractedInfo = {
  rawLines: string[];
  total: string | null;
  subtotal: string | null;
  tax: string | null;
  date: string | null;
  merchant: string | null;
  items: LineItem[];
  totalQtyFromReceipt: number | null;
  sumItemQty: number | null;
  totalCheck: TotalCheck;
};

type OcrResult = {
  text: string;
  extracted: ExtractedInfo;
  source?: "vision" | "ocr";
};

// item index -> array of member indices who share this item
type Assignments = Record<number, number[]>;

export default function HomeScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [addMemberVisible, setAddMemberVisible] = useState(false);
  const [newMemberName, setNewMemberName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  const requestPermissions = async () => {
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (cameraStatus !== "granted" || libraryStatus !== "granted") {
      Alert.alert(
        "Permissions needed",
        "Please allow camera and photo library access to scan receipts."
      );
      return false;
    }
    return true;
  };

  const pickImage = async (useCamera: boolean) => {
    if (!(await requestPermissions())) return;

    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.9,
      base64: false,
    };

    const result = useCamera
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

    if (result.canceled) return;

    const uri = result.assets[0].uri;
    setImageUri(uri);
    setOcrResult(null);
    setError(null);
    await runOcr(uri);
  };

  const runOcr = async (uri: string) => {
    setLoading(true);
    setError(null);
    try {
      const file = new FileSystem.File(uri);
      const base64 = await file.base64();
      const response = await fetch(`${OCR_SERVER_URL}/ocr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64 }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "OCR request failed");
      setOcrResult({ text: data.text, extracted: data.extracted, source: data.source });
      setAssignments({});
      setSavedId(null);
      setSaveError(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const isNetworkError =
        err instanceof TypeError ||
        msg === "Network request failed" ||
        msg.includes("fetch");
      const message = isNetworkError
        ? "Can't reach the OCR server. On a physical device, set OCR_SERVER_URL in app/config.ts to your computer's IP and ensure the server is running (npm run ocr)."
        : msg || "Could not read receipt";
      setError(message);
      setOcrResult(null);
    } finally {
      setLoading(false);
    }
  };

  const onScanPress = () => {
    const options = ["Take Photo", "Choose from Library", "Cancel"];
    const cancelIndex = 2;

    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex },
        (i) => {
          if (i === 0) pickImage(true);
          else if (i === 1) pickImage(false);
        }
      );
    } else {
      Alert.alert("Scan Receipt", "Choose source", [
        { text: "Take Photo", onPress: () => pickImage(true) },
        { text: "Choose from Library", onPress: () => pickImage(false) },
        { text: "Cancel", style: "cancel" },
      ]);
    }
  };

  const clearResult = () => {
    setImageUri(null);
    setOcrResult(null);
    setError(null);
    setMembers([]);
    setAssignments({});
    setSavedId(null);
    setSaveError(null);
  };

  const saveReceipt = async () => {
    if (!ocrResult?.extracted?.items?.length) return;
    setSaving(true);
    setSaveError(null);
    try {
      const { data: row, error: err } = await supabase
        .from("saved_receipts")
        .insert({
          merchant: ocrResult.extracted.merchant ?? null,
          date: ocrResult.extracted.date ?? null,
          total: ocrResult.extracted.total ?? null,
          items: ocrResult.extracted.items,
          total_check: ocrResult.extracted.totalCheck ?? null,
          source: ocrResult.source ?? null,
          members,
          assignments,
        })
        .select("id")
        .single();
      if (err) throw err;
      setSavedId(row?.id ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSaveError(msg || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const addMember = () => {
    const name = newMemberName.trim();
    if (name && !members.includes(name)) {
      setMembers((m) => [...m, name]);
      setNewMemberName("");
      setAddMemberVisible(false);
    }
  };

  const removeMember = (index: number) => {
    setMembers((m) => m.filter((_, i) => i !== index));
    setAssignments((a) => {
      const next = { ...a };
      Object.keys(next).forEach((key) => {
        const k = Number(key);
        next[k] = next[k].filter((i) => i !== index).map((i) => (i > index ? i - 1 : i));
        if (next[k].length === 0) delete next[k];
      });
      return next;
    });
  };

  const toggleAssignment = (itemIndex: number, memberIndex: number) => {
    setAssignments((a) => {
      const current = a[itemIndex] ?? [];
      const has = current.includes(memberIndex);
      const next = has ? current.filter((i) => i !== memberIndex) : [...current, memberIndex];
      const out = { ...a };
      if (next.length === 0) delete out[itemIndex];
      else out[itemIndex] = next;
      return out;
    });
  };

  const getPerPersonTotals = (): { name: string; amount: number }[] => {
    if (!hasItems || members.length === 0) return [];
    const totals: number[] = new Array(members.length).fill(0);
    items.forEach((item, i) => {
      const assignees = assignments[i] ?? [];
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
  };

  const items = ocrResult?.extracted?.items ?? [];
  const hasItems = items.length > 0;

  if (imageUri || ocrResult || error) {
    return (
      <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
        <StatusBar style="light" />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {imageUri && (
            <View style={styles.imageCard}>
              <ExpoImage source={{ uri: imageUri }} style={styles.preview} contentFit="cover" />
            </View>
          )}
          {loading && (
            <View style={styles.loadingCard}>
              <Ionicons name="receipt-outline" size={32} color="#00d97e" />
              <Text style={styles.loadingText}>Reading receipt…</Text>
            </View>
          )}
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {ocrResult && !loading && (
            <View style={styles.resultCard}>
              {ocrResult.source && (
                <View style={styles.sourceBadgeWrap}>
                  <Text style={[styles.sourceBadge, ocrResult.source === "vision" ? styles.sourceBadgeAI : styles.sourceBadgeOCR]}>
                    {ocrResult.source === "vision" ? "Extracted with AI" : "Extracted with OCR"}
                  </Text>
                </View>
              )}
              {(ocrResult.extracted.merchant || ocrResult.extracted.date || ocrResult.extracted.total) && (
                <View style={styles.summaryRow}>
                  {ocrResult.extracted.merchant && (
                    <Text style={styles.merchantName} numberOfLines={1}>{ocrResult.extracted.merchant}</Text>
                  )}
                  <View style={styles.metaRow}>
                    {ocrResult.extracted.date && (
                      <Text style={styles.metaText}>{ocrResult.extracted.date}</Text>
                    )}
                    {ocrResult.extracted.total && (
                      <Text style={styles.totalBadge}>${ocrResult.extracted.total}</Text>
                    )}
                  </View>
                </View>
              )}
              <Text style={styles.itemsSectionTitle}>Items</Text>
              {hasItems ? (
                <View style={styles.itemsTable}>
                  <View style={styles.tableHeader}>
                    <Text style={[styles.tableHeaderText, styles.colName]}>Item</Text>
                    <Text style={[styles.tableHeaderText, styles.colQty]}>Qty</Text>
                    <Text style={[styles.tableHeaderText, styles.colPrice]}>Price</Text>
                  </View>
                  {items.map((item, i) => (
                    <View key={i} style={styles.tableRowWrap}>
                      <View style={styles.tableRow}>
                        <Text style={[styles.cellText, styles.colName]} numberOfLines={2}>{item.name}</Text>
                        <Text style={[styles.cellText, styles.colQty]}>{item.qty ?? 1}</Text>
                        <Text style={[styles.cellText, styles.colPrice]}>${item.price}</Text>
                      </View>
                      {members.length > 0 && (
                        <View style={styles.assignRow}>
                          <Text style={styles.assignLabel}>Who had this?</Text>
                          <View style={styles.assignChips}>
                            {members.map((name, mi) => {
                              const selected = (assignments[i] ?? []).includes(mi);
                              return (
                                <Pressable
                                  key={mi}
                                  onPress={() => toggleAssignment(i, mi)}
                                  style={[styles.assignChip, selected && styles.assignChipSelected]}
                                >
                                  <Text style={[styles.assignChipText, selected && styles.assignChipTextSelected]}>{name}</Text>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              ) : (
                <Text style={styles.noItems}>No line items detected. Raw text may be in a different format.</Text>
              )}
              {hasItems && (
                <View style={styles.splitSection}>
                  <Text style={styles.itemsSectionTitle}>Split among friends</Text>
                  <View style={styles.membersRow}>
                    <Pressable
                      style={({ pressed }) => [styles.addMemberBtn, pressed && styles.addMemberBtnPressed]}
                      onPress={() => setAddMemberVisible(true)}
                    >
                      <Ionicons name="person-add-outline" size={18} color="#00d97e" />
                      <Text style={styles.addMemberBtnText}>Add member</Text>
                    </Pressable>
                    {members.length > 0 && (
                      <View style={styles.memberChips}>
                        {members.map((name, idx) => (
                          <View key={idx} style={styles.memberChipWrap}>
                            <Text style={styles.memberChipText}>{name}</Text>
                            <Pressable
                              hitSlop={8}
                              onPress={() => removeMember(idx)}
                              style={styles.memberChipRemove}
                            >
                              <Ionicons name="close-circle" size={18} color="#737373" />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  {members.length > 0 && getPerPersonTotals().some((p) => p.amount > 0) && (
                    <View style={styles.splitSummary}>
                      <Text style={styles.splitSummaryTitle}>Each pays</Text>
                      {getPerPersonTotals()
                        .filter((p) => p.amount > 0)
                        .map((p, i) => (
                          <View key={i} style={styles.splitSummaryRow}>
                            <Text style={styles.splitSummaryName}>{p.name}</Text>
                            <Text style={styles.splitSummaryAmount}>${p.amount.toFixed(2)}</Text>
                          </View>
                        ))}
                    </View>
                  )}
                </View>
              )}
              {ocrResult.extracted.totalCheck && (ocrResult.extracted.totalCheck.subtotal != null || ocrResult.extracted.totalCheck.total != null) && (
                <View style={styles.totalCheckRow}>
                  <Text style={styles.totalCheckLabel}>Total check</Text>
                  <Text style={styles.totalCheckValue}>
                    Subtotal + Service + SST = {ocrResult.extracted.totalCheck.expectedTotal ?? "—"}
                    {ocrResult.extracted.totalCheck.total != null && (
                      <> · Receipt total: {ocrResult.extracted.totalCheck.total}</>
                    )}
                  </Text>
                  <Text
                    style={[
                      styles.totalCheckStatus,
                      ocrResult.extracted.totalCheck.match ? styles.qtyCheckOk : styles.qtyCheckMismatch,
                    ]}
                  >
                    {ocrResult.extracted.totalCheck.match ? "✓ Match" : "≠ Mismatch"}
                  </Text>
                </View>
              )}
              {hasItems && (ocrResult.extracted.totalQtyFromReceipt != null || ocrResult.extracted.sumItemQty != null) && (
                <View style={styles.qtyCheckRow}>
                  <Text style={styles.qtyCheckLabel}>Qty check</Text>
                  <Text style={styles.qtyCheckValue}>
                    Sum of items: {ocrResult.extracted.sumItemQty ?? 0}
                    {ocrResult.extracted.totalQtyFromReceipt != null && (
                      <> · Receipt total: {ocrResult.extracted.totalQtyFromReceipt}</>
                    )}
                  </Text>
                  {ocrResult.extracted.totalQtyFromReceipt != null && ocrResult.extracted.sumItemQty != null && (
                    <Text
                      style={[
                        styles.qtyCheckStatus,
                        Math.abs((ocrResult.extracted.sumItemQty ?? 0) - ocrResult.extracted.totalQtyFromReceipt) < 0.02
                          ? styles.qtyCheckOk
                          : styles.qtyCheckMismatch,
                      ]}
                    >
                      {Math.abs((ocrResult.extracted.sumItemQty ?? 0) - ocrResult.extracted.totalQtyFromReceipt) < 0.02
                        ? "✓ Match"
                        : "≠ Mismatch"}
                    </Text>
                  )}
                </View>
              )}
            </View>
          )}
          {ocrResult && hasItems && (
            <View style={styles.saveRow}>
              <Pressable
                style={({ pressed }) => [styles.saveBtn, pressed && styles.saveBtnPressed, saving && styles.saveBtnDisabled]}
                onPress={saveReceipt}
                disabled={saving}
              >
                {saving ? (
                  <Text style={styles.saveBtnText}>Saving…</Text>
                ) : savedId ? (
                  <>
                    <Ionicons name="checkmark-circle" size={20} color="#0a0a0a" />
                    <Text style={styles.saveBtnText}>Saved</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="cloud-upload-outline" size={20} color="#0a0a0a" />
                    <Text style={styles.saveBtnText}>Save to history</Text>
                  </>
                )}
              </Pressable>
              {saveError && <Text style={styles.saveError}>{saveError}</Text>}
            </View>
          )}
          <Pressable
            style={({ pressed }) => [styles.scanBtn, pressed && styles.scanBtnPressed]}
            onPress={clearResult}
          >
            <Ionicons name="scan-outline" size={20} color="#0a0a0a" />
            <Text style={styles.scanBtnText}>Scan another</Text>
          </Pressable>
          <Modal
            visible={addMemberVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setAddMemberVisible(false)}
          >
            <Pressable style={styles.modalBackdrop} onPress={() => setAddMemberVisible(false)}>
              <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.modalTitle}>Add member</Text>
                <TextInput
                  style={styles.modalInput}
                  placeholder="Name"
                  placeholderTextColor="#737373"
                  value={newMemberName}
                  onChangeText={setNewMemberName}
                  autoCapitalize="words"
                  autoCorrect={false}
                  onSubmitEditing={addMember}
                />
                <View style={styles.modalActions}>
                  <Pressable
                    style={({ pressed }) => [styles.modalBtn, styles.modalBtnCancel, pressed && styles.modalBtnPressed]}
                    onPress={() => { setAddMemberVisible(false); setNewMemberName(""); }}
                  >
                    <Text style={styles.modalBtnCancelText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [styles.modalBtn, styles.modalBtnAdd, pressed && styles.modalBtnPressed]}
                    onPress={addMember}
                  >
                    <Text style={styles.modalBtnAddText}>Add</Text>
                  </Pressable>
                </View>
              </Pressable>
            </Pressable>
          </Modal>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <View style={styles.hero}>
        <View style={styles.iconWrap}>
          <Ionicons name="receipt-outline" size={40} color="#00d97e" />
        </View>
        <Text style={styles.title}>Receipts</Text>
        <Text style={styles.subtitle}>Scan and keep your receipts in one place</Text>
      </View>
      <Pressable
        style={({ pressed }) => [styles.scanBtn, pressed && styles.scanBtnPressed]}
        onPress={onScanPress}
        disabled={loading}
      >
        <Ionicons name="scan-outline" size={22} color="#0a0a0a" />
        <Text style={styles.scanBtnText}>{loading ? "Reading…" : "Scan Receipt"}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  scroll: { flex: 1, width: "100%" },
  scrollContent: { paddingVertical: 20, paddingBottom: 40, alignItems: "stretch" },
  hero: {
    alignItems: "center",
    marginBottom: 40,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: "rgba(0, 217, 126, 0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#e5e5e5",
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    color: "#737373",
    lineHeight: 22,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  saveRow: {
    width: "100%",
    marginBottom: 12,
    alignItems: "center",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
  },
  saveBtnPressed: { opacity: 0.9 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#e5e5e5",
  },
  saveError: {
    marginTop: 8,
    fontSize: 13,
    color: "#f59e0b",
    textAlign: "center",
  },
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#00d97e",
    paddingVertical: 16,
    paddingHorizontal: 28,
    borderRadius: 14,
    shadowColor: "#00d97e",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  scanBtnPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  scanBtnText: {
    color: "#0a0a0a",
    fontSize: 16,
    fontWeight: "600",
  },
  imageCard: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#141414",
    marginBottom: 16,
  },
  preview: {
    width: "100%",
    height: 200,
  },
  loadingCard: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    backgroundColor: "#141414",
    borderRadius: 16,
    marginBottom: 16,
  },
  loadingText: {
    color: "#00d97e",
    fontSize: 16,
    marginTop: 12,
  },
  errorCard: {
    padding: 16,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#fca5a5",
    fontSize: 14,
    textAlign: "center",
  },
  resultCard: {
    width: "100%",
    padding: 20,
    backgroundColor: "#141414",
    borderRadius: 16,
    marginBottom: 20,
  },
  sourceBadgeWrap: {
    marginBottom: 12,
  },
  sourceBadge: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sourceBadgeAI: { color: "#00d97e" },
  sourceBadgeOCR: { color: "#737373" },
  summaryRow: {
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  merchantName: {
    fontSize: 18,
    fontWeight: "600",
    color: "#e5e5e5",
    marginBottom: 6,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  metaText: {
    fontSize: 13,
    color: "#737373",
  },
  totalBadge: {
    fontSize: 16,
    fontWeight: "700",
    color: "#00d97e",
  },
  itemsSectionTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#737373",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  itemsTable: {
    width: "100%",
  },
  tableHeader: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  tableHeaderText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  tableRowWrap: {
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  assignRow: {
    paddingHorizontal: 8,
    paddingBottom: 12,
    paddingTop: 4,
  },
  assignLabel: {
    fontSize: 11,
    color: "#737373",
    marginBottom: 6,
  },
  assignChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assignChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  assignChipSelected: {
    backgroundColor: "rgba(0, 217, 126, 0.2)",
    borderColor: "#00d97e",
  },
  assignChipText: {
    fontSize: 12,
    color: "#a3a3a3",
  },
  assignChipTextSelected: {
    color: "#00d97e",
    fontWeight: "600",
  },
  cellText: {
    fontSize: 13,
    color: "#e5e5e5",
  },
  colName: { flex: 1, paddingRight: 12 },
  colQty: { width: 32, textAlign: "center" },
  colPrice: { width: 64, textAlign: "right", fontWeight: "600" },
  totalCheckRow: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  totalCheckLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  totalCheckValue: {
    fontSize: 13,
    color: "#a3a3a3",
    marginBottom: 4,
  },
  totalCheckStatus: {
    fontSize: 13,
    fontWeight: "600",
  },
  qtyCheckRow: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  qtyCheckLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 4,
  },
  qtyCheckValue: {
    fontSize: 13,
    color: "#a3a3a3",
    marginBottom: 4,
  },
  qtyCheckStatus: {
    fontSize: 13,
    fontWeight: "600",
  },
  qtyCheckOk: { color: "#00d97e" },
  qtyCheckMismatch: { color: "#f59e0b" },
  noItems: {
    fontSize: 14,
    color: "#737373",
    fontStyle: "italic",
  },
  splitSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },
  membersRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  addMemberBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#00d97e",
    borderStyle: "dashed",
  },
  addMemberBtnPressed: { opacity: 0.8 },
  addMemberBtnText: {
    fontSize: 14,
    color: "#00d97e",
    fontWeight: "600",
  },
  memberChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  memberChipWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.1)",
    paddingLeft: 12,
    paddingVertical: 6,
    paddingRight: 4,
    borderRadius: 20,
    gap: 4,
  },
  memberChipText: {
    fontSize: 13,
    color: "#e5e5e5",
  },
  memberChipRemove: {
    padding: 2,
  },
  splitSummary: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "rgba(0, 217, 126, 0.08)",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(0, 217, 126, 0.2)",
  },
  splitSummaryTitle: {
    fontSize: 11,
    fontWeight: "600",
    color: "#737373",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    marginBottom: 8,
  },
  splitSummaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
  },
  splitSummaryName: {
    fontSize: 15,
    color: "#e5e5e5",
    fontWeight: "500",
  },
  splitSummaryAmount: {
    fontSize: 15,
    color: "#00d97e",
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  modalContent: {
    width: "100%",
    maxWidth: 320,
    backgroundColor: "#1a1a1a",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#e5e5e5",
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: "#0a0a0a",
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: "#e5e5e5",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    marginBottom: 20,
  },
  modalActions: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "flex-end",
  },
  modalBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  modalBtnPressed: { opacity: 0.9 },
  modalBtnCancel: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  modalBtnCancelText: {
    fontSize: 15,
    color: "#a3a3a3",
  },
  modalBtnAdd: {
    backgroundColor: "#00d97e",
  },
  modalBtnAddText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#0a0a0a",
  },
});
