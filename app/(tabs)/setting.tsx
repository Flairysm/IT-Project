import { Alert, Text, StyleSheet, Pressable, View, ScrollView, Modal, TextInput } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../auth-context";
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";

export default function SettingScreen() {
  const { user, logout, updateUsername } = useAuth();
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(user || "");
  const [updatingUsername, setUpdatingUsername] = useState(false);
  const displayName = (user || "User")
    .split(/[.\-_ ]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const initials = displayName
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const onAccountSetting = () => {
    setUsernameDraft(user || "");
    setAccountModalVisible(true);
  };

  const saveUsername = async () => {
    setUpdatingUsername(true);
    try {
      await updateUsername(usernameDraft);
      setAccountModalVisible(false);
      Alert.alert("Account Setting", "Username updated successfully.");
    } catch (e) {
      Alert.alert("Account Setting", e instanceof Error ? e.message : "Failed to update username.");
    } finally {
      setUpdatingUsername(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <StatusBar style="light" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || "U"}</Text>
          </View>
          <View style={styles.headerTextWrap}>
            <Text style={styles.displayName}>{displayName}</Text>
            <Text style={styles.handle}>@{user || "user"}</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.sectionCard}>
          <SettingsRow
            icon="construct-outline"
            title="Account Setting"
            subtitle="Manage account preferences"
            onPress={onAccountSetting}
          />
        </View>

        <Pressable onPress={() => void logout()} style={({ pressed }) => [styles.logoutBtn, pressed && styles.pressed]}>
          <Ionicons name="log-out-outline" size={18} color="#fca5a5" />
          <Text style={styles.logoutBtnText}>Logout</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent visible={accountModalVisible} animationType="fade" onRequestClose={() => setAccountModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Account Setting</Text>
            <Text style={styles.modalSubtitle}>Change your username</Text>
            <TextInput
              value={usernameDraft}
              onChangeText={setUsernameDraft}
              style={styles.modalInput}
              placeholder="New username"
              placeholderTextColor="#737373"
              autoCapitalize="none"
              editable={!updatingUsername}
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setAccountModalVisible(false)}
                style={({ pressed }) => [styles.modalCancelBtn, pressed && styles.pressed]}
                disabled={updatingUsername}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void saveUsername()} style={({ pressed }) => [styles.modalSaveBtn, pressed && styles.pressed]} disabled={updatingUsername}>
                <Text style={styles.modalSaveText}>{updatingUsername ? "Saving..." : "Save"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SettingsRow({
  icon,
  title,
  subtitle,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.rowIconWrap}>
        <Ionicons name={icon} size={20} color="#e5e5e5" />
      </View>
      <View style={styles.rowTextWrap}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="#8DEB63" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 28,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 26,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "#101010",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#e5e5e5", fontSize: 24, fontWeight: "700" },
  headerTextWrap: { flex: 1, marginLeft: 12 },
  displayName: { color: "#e5e5e5", fontSize: 22, fontWeight: "800", lineHeight: 26 },
  handle: { color: "#a3a3a3", fontSize: 13, marginTop: 2 },
  sectionTitle: {
    color: "#e5e5e5",
    fontSize: 34/2,
    fontWeight: "700",
    marginBottom: 10,
  },
  sectionCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "#141414",
    paddingVertical: 4,
    marginBottom: 22,
  },
  row: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 10,
  },
  rowIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "#101010",
    alignItems: "center",
    justifyContent: "center",
  },
  rowTextWrap: { flex: 1 },
  rowTitle: {
    color: "#e5e5e5",
    fontSize: 18/1.2,
    fontWeight: "600",
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: "#a3a3a3",
  },
  logoutBtn: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(252,165,165,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  logoutBtnText: { color: "#fca5a5", fontSize: 14, fontWeight: "700" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
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
    padding: 14,
  },
  modalTitle: { color: "#e5e5e5", fontSize: 18, fontWeight: "700", marginBottom: 4 },
  modalSubtitle: { color: "#a3a3a3", fontSize: 12, marginBottom: 10 },
  modalInput: {
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#101010",
    color: "#e5e5e5",
    paddingHorizontal: 12,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 12 },
  modalCancelBtn: {
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: { color: "#e5e5e5", fontSize: 13, fontWeight: "600" },
  modalSaveBtn: {
    minHeight: 36,
    borderRadius: 8,
    backgroundColor: "#8DEB63",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: { color: "#0a0a0a", fontSize: 13, fontWeight: "700" },
  pressed: { opacity: 0.9 },
});
