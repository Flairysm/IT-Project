import { Ionicons } from "@expo/vector-icons";

export type QuickSplitCategory = "restaurant" | "travel" | "groceries" | "business" | "others";

export const QUICK_SPLIT_CATEGORIES: {
  id: QuickSplitCategory;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
}[] = [
  { id: "restaurant", label: "Restaurant", subtitle: "Dining out, café, food", icon: "restaurant-outline" },
  { id: "travel", label: "Travel", subtitle: "Trips, transport, accommodation", icon: "airplane-outline" },
  { id: "groceries", label: "Groceries", subtitle: "Supermarket, market, food shop", icon: "cart-outline" },
  { id: "business", label: "Business", subtitle: "Expenses, projects, client costs", icon: "briefcase-outline" },
  { id: "others", label: "Others", subtitle: "Any other shared expense", icon: "ellipsis-horizontal-circle-outline" },
];

/** Categories that support Scan Receipt (camera/OCR). Travel, Business, Others use Quick Split only. */
export const SCAN_RECEIPT_CATEGORY_IDS: QuickSplitCategory[] = ["restaurant", "groceries"];

export const SCAN_RECEIPT_CATEGORIES = QUICK_SPLIT_CATEGORIES.filter((c) =>
  SCAN_RECEIPT_CATEGORY_IDS.includes(c.id)
);
