import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

export default function BusinessChoiceScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Business</Text>
          <Text style={styles.subtitle}>Choose what you want to do</Text>
        </View>
      </View>

      <View style={styles.cards}>
        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push({ pathname: "/expense-group", params: { category: "business" } })}
        >
          <View style={styles.cardIconWrap}>
            <Ionicons name="people-outline" size={28} color="#8DEB63" />
          </View>
          <Text style={styles.cardLabel}>Expense group</Text>
          <Text style={styles.cardSub}>Split costs with others (trips, projects)</Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          onPress={() => router.push("/business-new-batch")}
        >
          <View style={styles.cardIconWrap}>
            <Ionicons name="cube-outline" size={28} color="#8DEB63" />
          </View>
          <Text style={styles.cardLabel}>Sales & Inventory</Text>
          <Text style={styles.cardSub}>Track inventory, batches, and profits</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b100b" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { padding: 4 },
  pressed: { opacity: 0.7 },
  headerText: { flex: 1 },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  subtitle: { color: "#737373", fontSize: 14, marginTop: 2 },
  cards: { padding: 16, gap: 14 },
  card: {
    backgroundColor: "#141414",
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardPressed: { opacity: 0.85 },
  cardIconWrap: { width: 52, height: 52, borderRadius: 14, backgroundColor: "rgba(141,235,99,0.12)", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  cardLabel: { color: "#fff", fontSize: 18, fontWeight: "700" },
  cardSub: { color: "#737373", fontSize: 13, marginTop: 6 },
});
