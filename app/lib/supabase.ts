import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { EZSPLIT_ANON_KEY, EZSPLIT_URL } from "../config";

export const supabase = createClient(EZSPLIT_URL, EZSPLIT_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
