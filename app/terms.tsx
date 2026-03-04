import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function TermsScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Terms of Service</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 2025</Text>

        <Text style={styles.heading}>1. Acceptance</Text>
        <Text style={styles.body}>
          By using EZSplit ("the App"), you agree to these Terms of Service. If you do not agree, do not use the App.
        </Text>

        <Text style={styles.heading}>2. Description of Service</Text>
        <Text style={styles.body}>
          EZSplit is an app that helps you split receipts and expenses with friends and groups. You can scan receipts,
          assign items to people, track who has paid, and send reminders. The App is provided for personal or
          educational use (e.g. diploma projects).
        </Text>

        <Text style={styles.heading}>3. Account and Data</Text>
        <Text style={styles.body}>
          You must create an account to use core features. You are responsible for keeping your credentials secure.
          Data you provide (receipts, splits, profile) is stored to operate the service. We do not sell your personal
          data. See our Privacy Policy for details.
        </Text>

        <Text style={styles.heading}>4. Acceptable Use</Text>
        <Text style={styles.body}>
          You agree not to use the App for illegal purposes, to harass others, or to abuse the service (e.g. spam,
          automated scraping). We may suspend or terminate access if we detect misuse.
        </Text>

        <Text style={styles.heading}>5. Disclaimer</Text>
        <Text style={styles.body}>
          The App is provided "as is." Receipt scanning (OCR) may sometimes be inaccurate. Always verify amounts and
          details. We are not liable for any losses resulting from use of the App.
        </Text>

        <Text style={styles.heading}>6. Changes</Text>
        <Text style={styles.body}>
          We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance.
          The "Last updated" date at the top will be revised when we make changes.
        </Text>

        <Text style={styles.heading}>7. Contact</Text>
        <Text style={styles.body}>
          For questions about these Terms, contact the developer via the App Store listing or your institution if this
          is a student project.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 40 },
  updated: { color: "#737373", fontSize: 13, marginBottom: 20 },
  heading: { color: "#8DEB63", fontSize: 16, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  body: { color: "#d4d4d4", fontSize: 15, lineHeight: 22, marginBottom: 8 },
});
