import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type ReceiptRow = {
  id: string;
  created_at: string;
  merchant: string | null;
  date: string | null;
  total: string | null;
  items: { name: string; price: string; qty: number }[];
  total_check: Record<string, unknown> | null;
  source: string | null;
  members: string[];
  assignments: Record<number, number[]>;
};
