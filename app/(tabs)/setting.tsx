import { useCallback, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth-context";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { File } from "expo-file-system";
import { supabase } from "../lib/supabase";
import { CURRENCIES, getCurrency } from "../lib/currency";

function initials(displayName: string, username: string): string {
  if (displayName && displayName.trim()) {
    const parts = displayName.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase().slice(0, 2);
    return displayName.slice(0, 2).toUpperCase();
  }
  const u = (username || "u").trim();
  return u.slice(0, 2).toUpperCase();
}

export default function SettingScreen() {
  const { profile, user, logout, updateUsername, updateDisplayName, updateCurrency, updateAvatarUrl } = useAuth();
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState(profile?.display_name ?? "");
  const [usernameDraft, setUsernameDraft] = useState(profile?.username ?? "");
  const [currencyDraft, setCurrencyDraft] = useState(profile?.default_currency ?? "MYR");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  const displayName = (profile?.display_name || profile?.username || "User").trim();
  const username = profile?.username ?? "user";
  const currentCurrency = getCurrency(profile?.default_currency);

  const openAccountModal = useCallback(() => {
    setDisplayNameDraft(profile?.display_name ?? "");
    setUsernameDraft(profile?.username ?? "");
    setError(null);
    setAccountModalVisible(true);
  }, [profile?.display_name, profile?.username]);

  const openCurrencyModal = useCallback(() => {
    setCurrencyDraft(profile?.default_currency ?? "MYR");
    setCurrencyModalVisible(true);
  }, [profile?.default_currency]);

  const saveAccount = async () => {
    const displayTrim = displayNameDraft.trim();
    const usernameTrim = usernameDraft.trim().toLowerCase();
    if (!usernameTrim) {
      setError("Username is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateUsername(usernameTrim);
      await updateDisplayName(displayTrim || usernameTrim);
      setAccountModalVisible(false);
      Alert.alert("Account", "Your account has been updated.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update account.");
    } finally {
      setSaving(false);
    }
  };

  const saveCurrency = async () => {
    setSaving(true);
    try {
      await updateCurrency(currencyDraft);
      setCurrencyModalVisible(false);
      Alert.alert("Currency", "Default currency updated.");
    } catch (e) {
      Alert.alert("Currency", e instanceof Error ? e.message : "Failed to update currency.");
    } finally {
      setSaving(false);
    }
  };

  const pickAndUploadAvatar = async () => {
    if (!user?.id) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission", "Permission to access photos is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const uri = result.assets[0].uri;
    setUploadingAvatar(true);
    try {
      const path = `${user.id}/avatar-${Date.now()}.jpg`;
      const file = new File(uri);
      const arrayBuffer = await file.arrayBuffer();
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, arrayBuffer, { contentType: "image/jpeg", upsert: true });
      if (uploadErr) throw new Error(uploadErr.message);
      const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
      await updateAvatarUrl(urlData.publicUrl);
    } catch (e) {
      Alert.alert("Photo", e instanceof Error ? e.message : "Failed to upload photo.");
    } finally {
      setUploadingAvatar(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.accent} />
        <View style={styles.profileHeader}>
          <Pressable
            style={styles.avatarWrap}
            onPress={pickAndUploadAvatar}
            disabled={uploadingAvatar}
          >
            {uploadingAvatar ? (
              <View style={styles.avatarPlaceholder}>
                <ActivityIndicator size="large" color="#8DEB63" />
              </View>
            ) : profile?.avatar_url ? (
              <Image source={{ uri: profile.avatar_url }} style={styles.avatarImg} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarInitial}>{initials(displayName, username)}</Text>
              </View>
            )}
            <View style={styles.avatarBadge}>
              <Ionicons name="camera" size={14} color="#0a0a0a" />
            </View>
          </Pressable>
          <Text style={styles.profileName}>{displayName || username}</Text>
          <Text style={styles.profileHandle}>@{username}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Preferences</Text>
          <View style={styles.card}>
            <Pressable style={({ pressed }) => [styles.cardRow, pressed && styles.pressed]} onPress={openCurrencyModal}>
              <View style={styles.cardRowIcon}>
                <Ionicons name="cash-outline" size={20} color="#8DEB63" />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Default currency</Text>
                <Text style={styles.cardRowSub}>{currentCurrency.flag} {currentCurrency.label} ({currentCurrency.symbol})</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#737373" />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.cardRow, pressed && styles.pressed]} onPress={openAccountModal}>
              <View style={styles.cardRowIcon}>
                <Ionicons name="person-outline" size={20} color="#8DEB63" />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Account</Text>
                <Text style={styles.cardRowSub}>Username & display name</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#737373" />
            </Pressable>
            <View style={[styles.cardRow, styles.cardRowLast]}>
              <View style={styles.cardRowIcon}>
                <Ionicons name="notifications-outline" size={20} color="#737373" />
              </View>
              <View style={styles.cardRowText}>
                <Text style={styles.cardRowTitle}>Notifications</Text>
                <Text style={styles.cardRowSub}>Coming soon</Text>
              </View>
            </View>
          </View>
        </View>

        <Pressable style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]} onPress={() => void logout()}>
          <Ionicons name="log-out-outline" size={20} color="#fca5a5" />
          <Text style={styles.logoutBtnText}>Log out</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent visible={accountModalVisible} animationType="fade" onRequestClose={() => setAccountModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAccountModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalAccent} />
            <Text style={styles.modalTitle}>Account</Text>
            <Text style={styles.modalSub}>Update your display name and username</Text>

            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Display name</Text>
              <TextInput
                value={displayNameDraft}
                onChangeText={setDisplayNameDraft}
                style={styles.modalInput}
                placeholder="How you want to be shown"
                placeholderTextColor="#525252"
                editable={!saving}
              />
            </View>
            <View style={styles.modalField}>
              <Text style={styles.modalFieldLabel}>Username</Text>
              <TextInput
                value={usernameDraft}
                onChangeText={setUsernameDraft}
                style={styles.modalInput}
                placeholder="username"
                placeholderTextColor="#525252"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!saving}
              />
            </View>

            {error ? (
              <View style={styles.modalErrorWrap}>
                <Ionicons name="warning-outline" size={14} color="#fca5a5" />
                <Text style={styles.modalError}>{error}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}
                onPress={() => setAccountModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalSave, pressed && styles.pressed]}
                onPress={() => void saveAccount()}
                disabled={saving}
              >
                <Text style={styles.modalSaveText}>{saving ? "Saving..." : "Save"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal transparent visible={currencyModalVisible} animationType="fade" onRequestClose={() => setCurrencyModalVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setCurrencyModalVisible(false)}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalAccent} />
            <Text style={styles.modalTitle}>Currency</Text>
            <Text style={styles.modalSub}>Choose your default currency for amounts</Text>

            <View style={styles.modalField}>
              <View style={styles.currencyGrid}>
                {CURRENCIES.map((c) => (
                  <Pressable
                    key={c.code}
                    style={[styles.currencyChip, currencyDraft === c.code && styles.currencyChipActive]}
                    onPress={() => setCurrencyDraft(c.code)}
                  >
                    <Text style={styles.currencyChipFlag}>{c.flag}</Text>
                    <Text style={[styles.currencyChipText, currencyDraft === c.code && styles.currencyChipTextActive]}>{c.code}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            <View style={styles.modalActions}>
              <Pressable
                style={({ pressed }) => [styles.modalCancel, pressed && styles.pressed]}
                onPress={() => setCurrencyModalVisible(false)}
                disabled={saving}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.modalSave, pressed && styles.pressed]}
                onPress={() => void saveCurrency()}
                disabled={saving}
              >
                <Text style={styles.modalSaveText}>{saving ? "Saving..." : "Save"}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0a0a0a" },
  pressed: { opacity: 0.9 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  accent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 24 },
  profileHeader: {
    alignItems: "center",
    paddingHorizontal: 20,
    marginBottom: 28,
  },
  avatarWrap: { position: "relative", marginBottom: 12 },
  avatarPlaceholder: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "rgba(141,235,99,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImg: { width: 96, height: 96, borderRadius: 48 },
  avatarInitial: { color: "#8DEB63", fontSize: 32, fontWeight: "800" },
  avatarBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 4 },
  profileHandle: { color: "#737373", fontSize: 15 },
  section: { marginBottom: 24, paddingHorizontal: 20 },
  sectionLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 10 },
  card: {
    borderRadius: 16,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  cardRowLast: { borderBottomWidth: 0 },
  cardRowIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(141,235,99,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardRowText: { flex: 1, minWidth: 0 },
  cardRowTitle: { color: "#e5e5e5", fontSize: 16, fontWeight: "600" },
  cardRowSub: { color: "#737373", fontSize: 13, marginTop: 2 },
  logoutBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginHorizontal: 20,
    paddingVertical: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.3)",
    backgroundColor: "rgba(239,68,68,0.1)",
  },
  logoutBtnText: { color: "#fca5a5", fontSize: 16, fontWeight: "700" },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "center", alignItems: "center", padding: 24 },
  modalCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 24,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  modalAccent: { height: 4, backgroundColor: "#8DEB63", marginBottom: 20 },
  modalTitle: { color: "#fff", fontSize: 22, fontWeight: "800", marginBottom: 6 },
  modalSub: { color: "#a3a3a3", fontSize: 14, marginBottom: 24 },
  modalField: { marginBottom: 18 },
  modalFieldLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 },
  modalInput: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "rgba(141,235,99,0.25)",
    color: "#e5e5e5",
    fontSize: 16,
    paddingHorizontal: 16,
  },
  currencyGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  currencyChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#0f0f0f",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  currencyChipActive: { backgroundColor: "rgba(141,235,99,0.2)", borderColor: "rgba(141,235,99,0.4)" },
  currencyChipFlag: { fontSize: 18 },
  currencyChipText: { color: "#a3a3a3", fontSize: 14, fontWeight: "600" },
  currencyChipTextActive: { color: "#8DEB63" },
  modalErrorWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(252,165,165,0.12)",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.2)",
  },
  modalError: { color: "#fca5a5", fontSize: 13, flex: 1 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 8 },
  modalCancel: { flex: 1, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.2)", alignItems: "center" },
  modalCancelText: { color: "#e5e5e5", fontSize: 15, fontWeight: "600" },
  modalSave: { flex: 1, paddingVertical: 14, borderRadius: 14, backgroundColor: "#8DEB63", alignItems: "center" },
  modalSaveText: { color: "#0a0a0a", fontSize: 15, fontWeight: "700" },
});
