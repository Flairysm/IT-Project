import { Pressable, StyleSheet, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const DIAMOND_COLOR = "#a78bfa";

export function SubscriptionDiamond() {
  return (
    <Pressable
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      onPress={() => {}}
    >
      <Ionicons name="diamond" size={22} color={DIAMOND_COLOR} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(167,139,250,0.15)",
  },
  pressed: { opacity: 0.8 },
});
