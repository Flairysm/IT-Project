import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function PrivacyScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <Text style={styles.title}>Privacy Policy</Text>
        <View style={styles.backBtn} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.updated}>Last updated: 2025</Text>

        <Text style={styles.heading}>1. Who we are</Text>
        <Text style={styles.body}>
          EZSplit is a receipt-splitting app. This policy describes how we handle your information. The App may be
          operated as a student or diploma project; your data is still treated as described here.
        </Text>

        <Text style={styles.heading}>2. Data we collect</Text>
        <Text style={styles.body}>
          • Account: email address, password (hashed), and optional username and display name.{"\n"}
          • Profile: default currency, profile photo if you upload one, and optionally a push notification token if
          you enable reminders.{"\n"}
          • Receipts and splits: photos you take or upload for scanning, and the data we extract (merchant, date,
          items, amounts) and any assignments you make to friends or groups.{"\n"}
          • Usage: we use Supabase and optionally an OCR service; their respective privacy policies apply to
          processing.
        </Text>

        <Text style={styles.heading}>3. How we use it</Text>
        <Text style={styles.body}>
          We use your data to provide the App: to create and manage your account, store your receipts and splits, show
          you obligations and send reminders, and allow you to invite friends and use groups. We do not sell your
          personal data or use it for advertising.
        </Text>

        <Text style={styles.heading}>4. Sharing</Text>
        <Text style={styles.body}>
          Data you add (e.g. receipts, splits) is visible to the people you invite or add to groups, as intended by the
          app. We do not share your data with third parties for marketing. Service providers (e.g. Supabase, Expo,
          hosting for OCR) process data to run the service.
        </Text>

        <Text style={styles.heading}>5. Security and retention</Text>
        <Text style={styles.body}>
          We use industry-standard practices (e.g. HTTPS, secure auth). You can delete your account at any time from
          Settings; we will remove your account and associated data. Some data may remain in backups for a limited
          period before being purged.
        </Text>

        <Text style={styles.heading}>6. Your rights</Text>
        <Text style={styles.body}>
          You can access and update your profile in the App. You can delete your account to have your data removed. If
          you are in the EEA/UK, you may have additional rights (access, rectification, erasure, etc.) under applicable
          law; contact us using the details in the App or App Store listing.
        </Text>

        <Text style={styles.heading}>7. Changes</Text>
        <Text style={styles.body}>
          We may update this Privacy Policy. The "Last updated" date will change when we do. Continued use after
          changes means you accept the updated policy.
        </Text>

        <Text style={styles.heading}>8. Contact</Text>
        <Text style={styles.body}>
          For privacy-related questions, contact the developer via the App Store listing or your institution if this is
          a student project.
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
