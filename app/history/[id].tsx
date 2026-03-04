import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import { supabase } from "../lib/supabase";
import { useAuth } from "../auth-context";
import { formatAmount } from "../lib/currency";
import { checkRateLimit, RATE_LIMIT } from "../lib/rateLimit";

function formatDisplayDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch {
    return dateStr;
  }
}

function receiptInitial(merchant: string | null): string {
  const s = (merchant || "?").trim();
  return s ? s.charAt(0).toUpperCase() : "?";
}

function splitInitial(username: string): string {
  const s = (username || "").trim();
  if (!s) return "?";
  const parts = s.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase().slice(0, 2);
  return s.charAt(0).toUpperCase();
}

type SplitProfile = { display_name?: string | null; avatar_url?: string | null };

type SplitTotal = { name: string; amount: number };
type ReceiptDetail = {
  id: string;
  host_id: string | null;
  merchant: string | null;
  date: string | null;
  total: string | null;
  paid: boolean;
  amount_due: string;
  paid_members: string[];
  split_totals: SplitTotal[];
  image_url: string | null;
  proof_required: boolean;
  proofsByUsername: Record<string, { image_url: string }>;
};

export default function HistoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const { user, profile } = useAuth();
  const currencyCode = profile?.default_currency ?? "MYR";
  const [loading, setLoading] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [remindLoading, setRemindLoading] = useState<string | "all" | null>(null);
  const [remindMessage, setRemindMessage] = useState<string | null>(null);
  const [imageFullVisible, setImageFullVisible] = useState(false);
  const [proofImageUrl, setProofImageUrl] = useState<string | null>(null);
  const [splitProfiles, setSplitProfiles] = useState<Record<string, SplitProfile>>({});
  const [proofUploading, setProofUploading] = useState(false);
  const [markSelfPaidLoading, setMarkSelfPaidLoading] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: row, error } = await supabase
        .from("receipts")
        .select("id, host_id, merchant, receipt_date, total_amount, paid, split_totals, paid_members, image_url, proof_required")
        .eq("id", id)
        .single();
      if (error) throw new Error(error.message);
      if (!row) {
        setReceipt(null);
        return;
      }
      const splitTotals = Array.isArray(row.split_totals) ? row.split_totals : [];
      const paidMembers = Array.isArray(row.paid_members) ? row.paid_members.map(String) : [];
      let amountDue = "0.00";
      if (row.paid) {
        amountDue = "0.00";
      } else if (splitTotals.length) {
        const unpaid = splitTotals.reduce((sum: number, s: { name?: string; amount?: number }) => {
          const name = String(s?.name ?? "");
          const amount = Number(s?.amount ?? 0) || 0;
          return paidMembers.includes(name) ? sum : sum + amount;
        }, 0);
        amountDue = Math.max(0, unpaid).toFixed(2);
      } else {
        amountDue = row.total_amount ? parseFloat(row.total_amount).toFixed(2) : "0.00";
      }
      const { data: proofsRows } = await supabase
        .from("receipt_proofs")
        .select("username, image_url")
        .eq("receipt_id", id);
      const proofsByUsername: Record<string, { image_url: string }> = {};
      (proofsRows || []).forEach((p: { username?: string; image_url?: string }) => {
        const u = (p.username ?? "").trim();
        if (u && p.image_url) proofsByUsername[u.toLowerCase()] = { image_url: p.image_url };
      });

      setReceipt({
        id: String(row.id),
        host_id: row.host_id ?? null,
        merchant: row.merchant ?? null,
        date: row.receipt_date ?? null,
        total: row.total_amount ?? null,
        paid: Boolean(row.paid),
        amount_due: amountDue,
        paid_members: paidMembers,
        split_totals: splitTotals as SplitTotal[],
        image_url: row.image_url ?? null,
        proof_required: row.proof_required !== false,
        proofsByUsername,
      });
      const usernames = splitTotals.map((s: { name?: string }) => String(s?.name ?? "").trim()).filter(Boolean);
      if (usernames.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("username, display_name, avatar_url")
          .in("username", usernames);
        const map: Record<string, SplitProfile> = {};
        (profiles || []).forEach((p: { username?: string; display_name?: string | null; avatar_url?: string | null }) => {
          const u = (p.username ?? "").trim().toLowerCase();
          if (u) map[u] = { display_name: p.display_name ?? null, avatar_url: p.avatar_url ?? null };
        });
        setSplitProfiles(map);
      } else {
        setSplitProfiles({});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch receipt");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const isHost = receipt && user?.id && receipt.host_id === user.id;
  const hostUsername = (profile?.username ?? "").trim().toLowerCase();

  const sendReminder = async (username?: string) => {
    if (!id) return;
    if (!checkRateLimit("remind", RATE_LIMIT.remind)) {
      setRemindMessage("Please wait a few seconds before sending another reminder.");
      return;
    }
    setRemindMessage(null);
    setRemindLoading(username ?? "all");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setRemindMessage("Please sign in again to send reminders");
        return;
      }
      const { data, error: fnErr } = await supabase.functions.invoke("send-reminder", {
        body: { receiptId: id, ...(username ? { username } : {}) },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (fnErr) throw new Error(fnErr.message || "Failed to send reminder");
      const sent = (data as { sent?: number })?.sent ?? 0;
      if (sent > 0) setRemindMessage(`Reminder sent to ${sent} ${sent === 1 ? "person" : "people"}`);
      else setRemindMessage((data as { message?: string })?.message || "No one to remind");
    } catch (e) {
      setRemindMessage(e instanceof Error ? e.message : "Failed to send reminder");
    } finally {
      setRemindLoading(null);
    }
  };

  const toggleProofRequired = async () => {
    if (!id || !receipt || !isHost) return;
    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase
        .from("receipts")
        .update({ proof_required: !receipt.proof_required })
        .eq("id", id);
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update");
    } finally {
      setLoading(false);
    }
  };

  const markSelfPaid = async () => {
    if (!id) return;
    setMarkSelfPaidLoading(true);
    setError(null);
    try {
      const { error } = await supabase.rpc("mark_self_paid", { p_receipt_id: id });
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to mark paid");
    } finally {
      setMarkSelfPaidLoading(false);
    }
  };

  const submitProof = async () => {
    if (!id || !profile?.username) return;
    if (!checkRateLimit("submitProof", RATE_LIMIT.submitProof)) {
      setError("Please wait a few seconds before submitting again.");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      setError("Permission to access photos is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.6,
    });
    const asset = result.assets?.[0];
    if (result.canceled || !asset?.uri) return;
    setProofUploading(true);
    setError(null);
    try {
      const file = new FileSystem.File(asset.uri);
      const base64 = await file.base64();
      if (!base64 || typeof base64 !== "string") {
        throw new Error("Could not read image");
      }
      const imageUrl = "data:image/jpeg;base64," + base64;
      const { error } = await supabase
        .from("receipt_proofs")
        .upsert(
          { receipt_id: id, username: profile.username.trim(), image_url: imageUrl },
          { onConflict: "receipt_id,username" }
        );
      if (error) throw new Error(error.message);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to submit proof");
    } finally {
      setProofUploading(false);
    }
  };

  const togglePaidForUser = async (name: string) => {
    if (!id || !receipt) return;
    const nameLower = name.trim().toLowerCase();
    if (isHost && nameLower === hostUsername) return;
    setLoading(true);
    setError(null);
    try {
      const isPaid = receipt.paid_members.includes(name);
      const nextPaid = isPaid ? receipt.paid_members.filter((m) => m !== name) : [...receipt.paid_members, name];
      const splitNames = receipt.split_totals.map((s) => s.name);
      const isFullyPaid = splitNames.length > 0 && splitNames.every((n) => nextPaid.includes(n));
      const { error } = await supabase
        .from("receipts")
        .update({ paid_members: nextPaid, paid: isFullyPaid })
        .eq("id", id);
      if (error) throw new Error(error.message);
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
      <View style={styles.accent} />
      <View style={styles.headerRow}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.btnPressed]}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Receipt</Text>
        {isHost && receipt ? (
          <Pressable
            onPress={() => router.push({ pathname: "/scan-result", params: { receiptId: receipt.id } })}
            style={({ pressed }) => [styles.editBtn, pressed && styles.btnPressed]}
          >
            <Ionicons name="pencil" size={22} color="#8DEB63" />
          </Pressable>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      {error ? (
        <View style={styles.errorBlock}>
          <View style={styles.errorBlockRow}>
            <Ionicons name="warning-outline" size={20} color="#fca5a5" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={() => setError(null)} style={styles.errorDismissBtn} hitSlop={8}>
              <Ionicons name="close" size={22} color="#a3a3a3" />
            </Pressable>
          </View>
          <Pressable onPress={() => setError(null)} style={({ pressed }) => [styles.errorDismissButton, pressed && styles.btnPressed]}>
            <Text style={styles.errorDismissButtonText}>Dismiss</Text>
          </Pressable>
        </View>
      ) : null}

      {loading && !receipt ? (
        <View style={styles.loadingBlock}>
          <ActivityIndicator size="large" color="#8DEB63" />
          <Text style={styles.loadingText}>Loading receipt…</Text>
        </View>
      ) : receipt ? (
        <>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.heroCard}>
            <View style={styles.heroRow}>
              {receipt.image_url ? (
                <Pressable onPress={() => setImageFullVisible(true)} style={styles.heroThumbWrap}>
                  <Image source={{ uri: receipt.image_url }} style={styles.heroThumb} resizeMode="cover" />
                  <View style={styles.heroThumbOverlay}>
                    <Ionicons name="expand" size={20} color="rgba(255,255,255,0.9)" />
                  </View>
                </Pressable>
              ) : (
                <View style={[styles.heroIconWrap, receipt.paid ? styles.heroIconPaid : styles.heroIconUnpaid]}>
                  <Text style={[styles.heroIconText, receipt.paid ? styles.heroIconTextPaid : styles.heroIconTextUnpaid]}>
                    {receiptInitial(receipt.merchant)}
                  </Text>
                </View>
              )}
              <View style={styles.heroSummary}>
                <Text style={styles.heroMerchant} numberOfLines={2}>{receipt.merchant || "Unknown Merchant"}</Text>
                <Text style={styles.heroDate}>{formatDisplayDate(receipt.date)}</Text>
                <View style={styles.heroMetaRow}>
                  <View style={styles.heroTotalWrap}>
                    <Text style={styles.heroTotalLabel}>Total</Text>
                    <Text style={styles.heroTotalValue}>{receipt.total ? formatAmount(receipt.total, currencyCode) : "—"}</Text>
                  </View>
                  <View style={[styles.statusPill, receipt.paid ? styles.statusPillPaid : styles.statusPillUnpaid]}>
                    <Ionicons name={receipt.paid ? "checkmark-circle" : "time"} size={14} color={receipt.paid ? "#8DEB63" : "#fbbf24"} />
                    <Text style={[styles.statusPillText, receipt.paid ? styles.statusPillTextPaid : styles.statusPillTextUnpaid]}>
                      {receipt.paid ? "Settled" : "Pending"}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </View>

          {remindMessage ? (
            <View style={styles.remindMessageBlock}>
              <Ionicons name="notifications-outline" size={18} color="#8DEB63" />
              <Text style={styles.remindMessageText}>{remindMessage}</Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="people-outline" size={18} color="#8DEB63" />
              <Text style={styles.sectionTitle}>Who paid how much</Text>
            </View>
            {isHost && !receipt.paid && receipt.split_totals?.length ? (
              <View style={styles.proofToggleRow}>
                <Pressable
                  onPress={() => void toggleProofRequired()}
                  disabled={loading}
                  style={({ pressed }) => [styles.proofToggleBtn, pressed && styles.btnPressed]}
                >
                  <Ionicons name={receipt.proof_required ? "document-attach" : "document-outline"} size={16} color="#8DEB63" />
                  <Text style={styles.proofToggleBtnText}>{receipt.proof_required ? "Proof on" : "Proof off"}</Text>
                </Pressable>
                {receipt.split_totals?.some((r) => {
                  const unpaid = !receipt.paid_members?.includes(r.name);
                  const notHost = r.name.trim().toLowerCase() !== hostUsername;
                  return unpaid && notHost;
                }) ? (
                  <Pressable
                    onPress={() => void sendReminder()}
                    disabled={remindLoading !== null}
                    style={({ pressed }) => [styles.remindAllBtn, (remindLoading === "all" || pressed) && styles.btnPressed]}
                  >
                    {remindLoading === "all" ? (
                      <ActivityIndicator size="small" color="#0a0a0a" />
                    ) : (
                      <>
                        <Ionicons name="notifications" size={16} color="#0a0a0a" />
                        <Text style={styles.remindAllBtnText}>Remind all</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </View>
            ) : null}
            {receipt.split_totals?.length ? (
              <View style={styles.splitCard}>
                {receipt.split_totals.map((row, idx) => {
                  const isHostRow = isHost && row.name.trim().toLowerCase() === hostUsername;
                  const isOwerRow = !isHost && row.name.trim().toLowerCase() === hostUsername;
                  const rowPaid = receipt.paid_members?.includes(row.name);
                  const hasProof = receipt.proof_required && receipt.proofsByUsername[row.name.trim().toLowerCase()];
                  const isLast = idx === receipt.split_totals!.length - 1;
                  const prof = splitProfiles[row.name.trim().toLowerCase()];
                  const displayName = (prof?.display_name ?? "").trim() || row.name;
                  return (
                    <View key={row.name} style={[styles.splitRow, isLast && styles.splitRowLast]}>
                      <View style={styles.splitLeft}>
                        <View style={styles.splitAvatarWrap}>
                          {prof?.avatar_url ? (
                            <Image source={{ uri: prof.avatar_url }} style={styles.splitAvatar} />
                          ) : (
                            <View style={styles.splitAvatarPlaceholder}>
                              <Text style={styles.splitAvatarInitial}>{splitInitial(row.name)}</Text>
                            </View>
                          )}
                        </View>
                        <View style={styles.splitNameBlock}>
                          <Text style={styles.splitName} numberOfLines={1}>{displayName}</Text>
                          <Text style={styles.splitUsernameTag} numberOfLines={1}>@{row.name}</Text>
                          <View style={styles.splitMetaRow}>
                            <Text style={[styles.splitStatus, rowPaid ? styles.splitStatusPaid : styles.splitStatusUnpaid]}>
                              {rowPaid ? "Paid" : "Unpaid"}
                            </Text>
                            {hasProof && !rowPaid ? (
                              <Pressable onPress={() => receipt.proofsByUsername[row.name.trim().toLowerCase()] && setProofImageUrl(receipt.proofsByUsername[row.name.trim().toLowerCase()].image_url)}>
                                <Text style={styles.proofBadge}>Proof sent · View</Text>
                              </Pressable>
                            ) : null}
                            {isHostRow ? <Text style={styles.hostBadge}>Host</Text> : null}
                          </View>
                        </View>
                      </View>
                      <View style={styles.splitRight}>
                        <Text style={styles.splitAmount} numberOfLines={1}>{formatAmount(Number(row.amount || 0), currencyCode)}</Text>
                        {isHostRow ? (
                          <View style={styles.autoBadge}>
                            <Ionicons name="checkmark-done" size={14} color="#8DEB63" />
                            <Text style={styles.autoBadgeText}>Auto</Text>
                          </View>
                        ) : isHost ? (
                          <View style={styles.splitActions}>
                            {rowPaid ? (
                              <Pressable
                                onPress={() => void togglePaidForUser(row.name)}
                                style={({ pressed }) => [styles.toggleBtn, styles.toggleBtnPaid, pressed && styles.btnPressed]}
                              >
                                <Text style={[styles.toggleBtnText, styles.toggleBtnTextPaid]}>Mark unpaid</Text>
                              </Pressable>
                            ) : receipt.proof_required && !hasProof ? (
                              <Text style={styles.awaitingProofText}>Awaiting proof</Text>
                            ) : (
                              <>
                                <Pressable
                                  onPress={() => void sendReminder(row.name)}
                                  disabled={remindLoading !== null}
                                  style={({ pressed }) => [styles.remindOneBtn, (remindLoading === row.name || pressed) && styles.btnPressed]}
                                >
                                  {remindLoading === row.name ? <ActivityIndicator size="small" color="#8DEB63" /> : <><Ionicons name="notifications-outline" size={14} color="#8DEB63" /><Text style={styles.remindOneBtnText}>Remind</Text></>}
                                </Pressable>
                                <Pressable
                                  onPress={() => void togglePaidForUser(row.name)}
                                  style={({ pressed }) => [styles.toggleBtn, pressed && styles.btnPressed]}
                                >
                                  <Text style={styles.toggleBtnText}>Mark paid</Text>
                                </Pressable>
                              </>
                            )}
                          </View>
                        ) : isOwerRow ? (
                          <View style={styles.splitActions}>
                            {rowPaid ? (
                              <Text style={[styles.splitStatusReadOnly, styles.splitStatusPaid]}>Paid</Text>
                            ) : receipt.proof_required ? (
                              hasProof ? (
                                <Text style={styles.proofSubmittedText}>Proof submitted</Text>
                              ) : (
                                <Pressable
                                  onPress={() => void submitProof()}
                                  disabled={proofUploading}
                                  style={({ pressed }) => [styles.submitProofBtn, (proofUploading || pressed) && styles.btnPressed]}
                                >
                                  {proofUploading ? <ActivityIndicator size="small" color="#0a0a0a" /> : <><Ionicons name="camera" size={14} color="#0a0a0a" /><Text style={styles.submitProofBtnText}>Submit proof</Text></>}
                                </Pressable>
                              )
                            ) : (
                              <Pressable
                                onPress={() => void markSelfPaid()}
                                disabled={markSelfPaidLoading}
                                style={({ pressed }) => [styles.markSelfPaidBtn, (markSelfPaidLoading || pressed) && styles.btnPressed]}
                              >
                                {markSelfPaidLoading ? <ActivityIndicator size="small" color="#0a0a0a" /> : <Text style={styles.markSelfPaidBtnText}>I've paid</Text>}
                              </Pressable>
                            )}
                          </View>
                        ) : (
                          <Text style={[styles.splitStatusReadOnly, rowPaid ? styles.splitStatusPaid : styles.splitStatusUnpaid]}>
                            {rowPaid ? "Paid" : "Unpaid"}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={styles.emptySplit}>
                <Ionicons name="receipt-outline" size={32} color="#525252" />
                <Text style={styles.emptySplitText}>No split breakdown</Text>
              </View>
            )}
          </View>

          {!receipt.paid && parseFloat(receipt.amount_due || "0") > 0 ? (
            <View style={styles.amountDueCard}>
              <Text style={styles.amountDueLabel}>Amount still due</Text>
              <Text style={styles.amountDueValue}>{formatAmount(receipt.amount_due, currencyCode)}</Text>
            </View>
          ) : null}
        </ScrollView>

        <Modal
          visible={imageFullVisible || !!proofImageUrl}
          transparent
          animationType="fade"
          onRequestClose={() => { setImageFullVisible(false); setProofImageUrl(null); }}
        >
          <Pressable style={styles.imageFullBackdrop} onPress={() => { setImageFullVisible(false); setProofImageUrl(null); }}>
            <View style={styles.imageFullContent}>
              <Pressable
                onPress={() => { setImageFullVisible(false); setProofImageUrl(null); }}
                style={styles.imageFullClose}
                hitSlop={16}
              >
                <Ionicons name="close" size={28} color="#fff" />
              </Pressable>
              {proofImageUrl ? (
                <Image source={{ uri: proofImageUrl }} style={styles.imageFullImage} resizeMode="contain" />
              ) : receipt?.image_url ? (
                <Image
                  source={{ uri: receipt.image_url }}
                  style={styles.imageFullImage}
                  resizeMode="contain"
                />
              ) : null}
            </View>
          </Pressable>
        </Modal>
        </>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  accent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, marginBottom: 16 },
  backBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.08)" },
  headerSpacer: { width: 44 },
  editBtn: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(141,235,99,0.15)" },
  title: { flex: 1, color: "#fff", fontSize: 20, fontWeight: "800", textAlign: "center" },
  errorBlock: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    backgroundColor: "rgba(252,165,165,0.12)",
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.25)",
  },
  errorBlockRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  errorText: { color: "#fca5a5", fontSize: 14, flex: 1 },
  errorDismissBtn: { padding: 4 },
  errorDismissButton: { alignSelf: "flex-start", marginTop: 10, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.1)" },
  errorDismissButtonText: { color: "#e5e5e5", fontSize: 14, fontWeight: "600" },
  loadingBlock: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 48 },
  loadingText: { color: "#737373", fontSize: 15 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },

  heroCard: {
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    padding: 16,
    marginBottom: 24,
    overflow: "hidden",
  },
  heroRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  heroThumbWrap: {
    width: 88,
    height: 88,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    overflow: "hidden",
    position: "relative",
  },
  heroThumb: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  heroThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroSummary: { flex: 1, minWidth: 0, justifyContent: "space-between" },
  heroIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconPaid: { backgroundColor: "rgba(141,235,99,0.2)" },
  heroIconUnpaid: { backgroundColor: "rgba(251,191,36,0.2)" },
  heroIconText: { fontSize: 24, fontWeight: "800" },
  heroIconTextPaid: { color: "#8DEB63" },
  heroIconTextUnpaid: { color: "#fbbf24" },
  heroMerchant: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 4 },
  heroDate: { color: "#737373", fontSize: 13, marginBottom: 10 },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  heroTotalWrap: { flexDirection: "row", alignItems: "baseline", gap: 6 },
  heroTotalLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600" },
  heroTotalValue: { color: "#e5e5e5", fontSize: 20, fontWeight: "800" },
  heroReceiptImageWrap: {
    width: "100%",
    maxWidth: 320,
    height: 200,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    marginBottom: 16,
    overflow: "hidden",
    position: "relative",
  },
  heroReceiptImage: {
    width: "100%",
    height: "100%",
    borderRadius: 12,
  },
  heroReceiptImageOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  heroReceiptImageOverlayText: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 13,
    fontWeight: "600",
  },
  imageFullBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    alignItems: "center",
  },
  imageFullContent: {
    width: "100%",
    height: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  imageFullClose: {
    position: "absolute",
    top: 48,
    right: 24,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  imageFullImage: {
    width: "100%",
    height: "100%",
    maxWidth: 500,
    maxHeight: 700,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 10,
  },
  statusPillPaid: { backgroundColor: "rgba(141,235,99,0.15)" },
  statusPillUnpaid: { backgroundColor: "rgba(251,191,36,0.15)" },
  statusPillText: { fontSize: 12, fontWeight: "700" },
  statusPillTextPaid: { color: "#8DEB63" },
  statusPillTextUnpaid: { color: "#fbbf24" },

  remindMessageBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(141,235,99,0.1)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.2)",
  },
  remindMessageText: { color: "#8DEB63", fontSize: 14, fontWeight: "600", flex: 1 },
  section: { marginBottom: 24 },
  sectionHeader: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  sectionTitle: { color: "#e5e5e5", fontSize: 17, fontWeight: "700", flex: 1 },
  proofToggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  proofToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(141,235,99,0.15)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.3)",
  },
  proofToggleBtnText: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  remindAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#8DEB63",
  },
  remindAllBtnText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },
  remindOneBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: "rgba(141,235,99,0.15)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.3)",
  },
  remindOneBtnText: { color: "#8DEB63", fontSize: 12, fontWeight: "700" },
  splitCard: {
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  splitRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
    gap: 12,
  },
  splitRowLast: { borderBottomWidth: 0 },
  splitLeft: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12 },
  splitAvatarWrap: { width: 40, height: 40, borderRadius: 20 },
  splitAvatar: { width: 40, height: 40, borderRadius: 20 },
  splitAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  splitAvatarInitial: { color: "#8DEB63", fontSize: 14, fontWeight: "800" },
  splitNameBlock: { flex: 1, minWidth: 0, justifyContent: "center" },
  splitName: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 1 },
  splitUsernameTag: { color: "#737373", fontSize: 12, marginBottom: 4 },
  splitMetaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginTop: 2 },
  splitStatus: { fontSize: 13, fontWeight: "600" },
  splitStatusPaid: { color: "#8DEB63" },
  splitStatusUnpaid: { color: "#fbbf24" },
  splitStatusReadOnly: { fontSize: 14, fontWeight: "700" },
  hostBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#8DEB63",
    backgroundColor: "rgba(141,235,99,0.2)",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    overflow: "hidden",
  },
  proofBadge: {
    fontSize: 11,
    fontWeight: "700",
    color: "#a78bfa",
    backgroundColor: "rgba(167,139,250,0.2)",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  awaitingProofText: { color: "#737373", fontSize: 12, fontStyle: "italic" },
  proofSubmittedText: { color: "#8DEB63", fontSize: 13, fontWeight: "600" },
  submitProofBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#8DEB63",
  },
  submitProofBtnText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },
  markSelfPaidBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#8DEB63",
  },
  markSelfPaidBtnText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },
  splitRight: {
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
    gap: 6,
  },
  splitAmount: { color: "#8DEB63", fontSize: 16, fontWeight: "800" },
  autoBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  autoBadgeText: { color: "#8DEB63", fontSize: 12, fontWeight: "600" },
  splitActions: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: 6 },
  toggleBtn: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "rgba(141,235,99,0.2)",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.35)",
  },
  toggleBtnPaid: {
    backgroundColor: "rgba(251,191,36,0.15)",
    borderColor: "rgba(251,191,36,0.3)",
  },
  toggleBtnText: { color: "#8DEB63", fontSize: 13, fontWeight: "700" },
  toggleBtnTextPaid: { color: "#fbbf24" },
  emptySplit: { alignItems: "center", paddingVertical: 32, gap: 10 },
  emptySplitText: { color: "#737373", fontSize: 14 },

  amountDueCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(251,191,36,0.35)",
    backgroundColor: "rgba(251,191,36,0.1)",
    padding: 20,
    alignItems: "center",
  },
  amountDueLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 },
  amountDueValue: { color: "#fbbf24", fontSize: 28, fontWeight: "800" },

  btnPressed: { opacity: 0.9 },
});

