import { useState } from "react";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "./auth-context";
import { supabase } from "./lib/supabase";

export default function BusinessNewBatchScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [batchName, setBatchName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleCreate = async () => {
    const name = batchName.trim();
    if (!name || !user?.id) {
      Alert.alert("Required", "Enter a project name (e.g. Pokemon Flips).");
      return;
    }
    setSaving(true);
    const { data: project, error: projectError } = await supabase
      .from("business_projects")
      .insert({ host_id: user.id, name })
      .select("id")
      .single();
    setSaving(false);
    if (projectError || !project?.id) {
      Alert.alert("Error", projectError?.message ?? "Could not create project.");
      return;
    }
    router.replace({ pathname: "/business-project-detail", params: { projectId: project.id } });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>New project</Text>
          <Text style={styles.subtitle}>One-time setup — project name (e.g. Pokemon Flips)</Text>
        </View>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.inputLabel}>Project name</Text>
        <TextInput
          style={styles.input}
          value={batchName}
          onChangeText={setBatchName}
          placeholder="e.g. Pokemon Flips"
          placeholderTextColor="#525252"
          autoCapitalize="words"
        />

        <Pressable
          style={({ pressed }) => [styles.createBtn, pressed && styles.pressed, (!batchName.trim() || saving) && styles.createBtnDisabled]}
          onPress={handleCreate}
          disabled={!batchName.trim() || saving}
        >
          <Text style={styles.createBtnText}>{saving ? "Creating…" : "Create project"}</Text>
        </Pressable>

        <Text style={styles.hint}>Project will appear in History → Business. Open it to add batches (e.g. March, TCGKL).</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  pressed: { opacity: 0.85 },
  headerText: { flex: 1 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#737373", fontSize: 14, marginTop: 2 },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 32 },
  inputLabel: { color: "#a3a3a3", fontSize: 12, fontWeight: "600", marginBottom: 8 },
  input: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    color: "#fff",
    fontSize: 16,
    paddingHorizontal: 16,
    marginBottom: 24,
  },
  createBtn: {
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: "#8DEB63",
    alignItems: "center",
  },
  createBtnDisabled: { opacity: 0.5 },
  createBtnText: { color: "#0a0a0a", fontSize: 16, fontWeight: "800" },
  hint: { color: "#737373", fontSize: 13, marginTop: 20, textAlign: "center" },
});
