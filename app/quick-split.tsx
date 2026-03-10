import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { QUICK_SPLIT_CATEGORIES, type QuickSplitCategory } from "./lib/quickSplitCategories";

export default function QuickSplitScreen() {
  const router = useRouter();

  const onCategory = (category: QuickSplitCategory) => {
    if (category === "travel") {
      router.push({ pathname: "/expense-group", params: { category } });
      return;
    }
    if (category === "business") {
      router.push("/business-choice");
      return;
    }
    router.push({ pathname: "/scan-result", params: { source: "manual", category } });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right", "bottom"]}>
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.backBtn, pressed && styles.pressed]} hitSlop={12}>
          <Ionicons name="arrow-back" size={24} color="#e5e5e5" />
        </Pressable>
        <View style={styles.headerText}>
          <Text style={styles.title}>Quick Split</Text>
          <Text style={styles.subtitle}>Pick a category to split an expense</Text>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Category</Text>
      <View style={styles.list}>
        {QUICK_SPLIT_CATEGORIES.map((cat) => (
          <Pressable
            key={cat.id}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
            onPress={() => onCategory(cat.id)}
          >
            <View style={styles.cardIconWrap}>
              <Ionicons name={cat.icon} size={26} color="#8DEB63" />
            </View>
            <View style={styles.cardText}>
              <Text style={styles.cardLabel}>{cat.label}</Text>
              <Text style={styles.cardSub}>{cat.subtitle}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#737373" />
          </Pressable>
        ))}
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
  sectionLabel: { color: "#737373", fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6, marginHorizontal: 16, marginBottom: 10 },
  list: { paddingHorizontal: 16, gap: 10 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#141414",
    borderRadius: 14,
    padding: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  cardPressed: { opacity: 0.85 },
  cardIconWrap: { width: 48, height: 48, borderRadius: 14, backgroundColor: "rgba(141, 235, 99, 0.1)", alignItems: "center", justifyContent: "center", marginRight: 16 },
  cardText: { flex: 1, minWidth: 0 },
  cardLabel: { color: "#fff", fontSize: 17, fontWeight: "700" },
  cardSub: { color: "#737373", fontSize: 13, marginTop: 4 },
});
