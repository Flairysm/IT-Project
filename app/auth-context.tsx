import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

/** OpenAI model id for receipt scan. OCR is fallback only. */
export type OcrAiModel = "gpt-4o-mini" | "gpt-4o";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  email: string | null;
  default_currency: string;
  avatar_url: string | null;
  push_token: string | null;
  created_at: string;
  updated_at: string;
  owed_include_restaurant: boolean;
  owed_include_travel: boolean;
  owed_include_groceries: boolean;
  owed_include_business: boolean;
  owed_include_others: boolean;
  ocr_ai_model: OcrAiModel;
};

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** Sign up with password; returns { needsOtp: true } when user must verify email with OTP. */
  signUp: (email: string, password: string, confirmPassword: string, username?: string) => Promise<{ needsOtp?: boolean }>;
  login: (email: string, password: string) => Promise<void>;
  /** Verify 6-digit OTP (after sign-up) and sign in. */
  verifyOtp: (email: string, token: string) => Promise<void>;
  /** Resend sign-up verification OTP to email. */
  resendOtp: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateUsername: (newUsername: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateCurrency: (currencyCode: string) => Promise<void>;
  updateAvatarUrl: (avatarUrl: string | null) => Promise<void>;
  updateSettlementOwedPrefs: (prefs: { restaurant?: boolean; travel?: boolean; groceries?: boolean; business?: boolean; others?: boolean }) => Promise<void>;
  updateOcrAiModel: (model: OcrAiModel) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, email, default_currency, avatar_url, push_token, created_at, updated_at, owed_include_restaurant, owed_include_travel, owed_include_groceries, owed_include_business, owed_include_others, ocr_ai_model")
    .eq("id", userId)
    .single();
  if (error) return null;
  const d = data as Record<string, unknown>;
  const aiModel = d?.ocr_ai_model === "gpt-4o" ? "gpt-4o" : "gpt-4o-mini";
  return {
    ...d,
    ocr_ai_model: aiModel,
    owed_include_restaurant: d?.owed_include_restaurant !== false,
    owed_include_travel: d?.owed_include_travel !== false,
    owed_include_groceries: d?.owed_include_groceries !== false,
    owed_include_business: d?.owed_include_business !== false,
    owed_include_others: d?.owed_include_others !== false,
  } as Profile;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshProfile = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setProfile(null);
      return;
    }
    const p = await fetchProfile(user.id);
    setProfile(p);
  }, []);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, nextSession) => {
      setSession(nextSession);
      try {
        if (nextSession?.user) {
          const p = await fetchProfile(nextSession.user.id);
          setProfile(p);
        } else {
          setProfile(null);
        }
      } finally {
        setLoading(false);
      }
    });

    let cancelled = false;
    const init = async () => {
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(s);
        if (s?.user) {
          const p = await fetchProfile(s.user.id);
          if (cancelled) return;
          setProfile(p);
          if (!cancelled) setLoading(false);
          return;
        }
        // No session from first getSession() — may be async storage not ready yet.
        // Do not set loading=false here; let onAuthStateChange fire with restored session.
      } catch {
        // Ensure we never stay stuck on loading if getSession throws
        if (!cancelled) setLoading(false);
      }
    };
    init();

    const runRecheck = async () => {
      if (cancelled) return;
      try {
        const { data: { session: s } } = await supabase.auth.getSession();
        if (cancelled) return;
        setSession(s);
        if (s?.user) {
          const p = await fetchProfile(s.user.id);
          if (!cancelled) setProfile(p);
        } else {
          setProfile(null);
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Early recheck: async storage often ready by ~600ms; don't rely only on onAuthStateChange.
    const earlyT = setTimeout(() => void runRecheck(), 600);

    // Later recheck in case storage was very slow.
    const recheckT = setTimeout(() => void runRecheck(), 2000);

    // Safety: never show spinner longer than 3s; unblock even if getSession/fetchProfile hang.
    const safetyT = setTimeout(() => {
      if (!cancelled) setLoading(false);
    }, 3000);

    const maxT = setTimeout(() => {
      cancelled = true;
      setLoading((prev) => (prev ? false : prev));
    }, 8000);

    return () => {
      cancelled = true;
      clearTimeout(earlyT);
      clearTimeout(recheckT);
      clearTimeout(safetyT);
      clearTimeout(maxT);
      subscription.unsubscribe();
    };
  }, []);

  const signUp = useCallback(
    async (
      emailRaw: string,
      password: string,
      confirmPassword: string,
      username?: string
    ): Promise<{ needsOtp?: boolean }> => {
      const email = emailRaw.trim().toLowerCase();
      if (!email) throw new Error("Email is required");
      if (!password) throw new Error("Password is required");
      if (password !== confirmPassword) throw new Error("Passwords do not match");
      const displayNameInput = username?.trim() || emailRaw.split("@")[0] || email.split("@")[0];
      const rawUsername = displayNameInput.toLowerCase();
      if (!rawUsername) throw new Error("Username is required");

      const { data: avail } = await supabase.rpc("check_username_available", {
        check_username: rawUsername,
      });
      if (avail === false) throw new Error("This username is already taken.");

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            email,
            username: rawUsername,
            display_name: displayNameInput,
          },
        },
      });
      if (error) {
        const msg = error.message?.toLowerCase() || "";
        if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("already been"))
          throw new Error("This email is already registered.");
        throw error;
      }
      if (data.user?.identities != null && data.user.identities.length === 0)
        throw new Error("This email is already registered.");
      if (data.user && !data.session) {
        return { needsOtp: true };
      }
      if (data.user) await refreshProfile();
      return {};
    },
    [refreshProfile]
  );

  const login = useCallback(async (emailRaw: string, password: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email || !password) throw new Error("Enter email and password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await refreshProfile();
  }, [refreshProfile]);

  const verifyOtp = useCallback(
    async (emailRaw: string, token: string) => {
      const email = emailRaw.trim().toLowerCase();
      const code = token.trim().replace(/\s/g, "");
      if (!email) throw new Error("Email is required");
      if (!code || code.length !== 6) throw new Error("Enter the 6-digit code from your email");
      const { data, error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
      if (error) throw error;
      const user = data?.user;
      if (user?.user_metadata || user?.email) {
        const meta = (user.user_metadata || {}) as Record<string, unknown>;
        const username = typeof meta.username === "string" ? meta.username.trim().toLowerCase() : "";
        const displayName = typeof meta.display_name === "string" ? meta.display_name.trim() || null : null;
        const email = typeof meta.email === "string" ? meta.email.trim().toLowerCase() || null : (user.email?.trim().toLowerCase() || null);
        if (username || displayName !== undefined || email !== null) {
          const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
          if (username) updates.username = username;
          if (displayName !== undefined) updates.display_name = displayName;
          if (email) updates.email = email;
          await supabase.from("profiles").update(updates).eq("id", user.id);
        }
      }
      await refreshProfile();
    },
    [refreshProfile]
  );

  const resendOtp = useCallback(async (emailRaw: string) => {
    const email = emailRaw.trim().toLowerCase();
    if (!email) throw new Error("Email is required");
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) throw error;
  }, []);

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const updateUsername = useCallback(
    async (newUsernameRaw: string) => {
      const newUsername = newUsernameRaw.trim().toLowerCase();
      if (!newUsername) throw new Error("Username is required");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const currentProfile = await fetchProfile(user.id);
      if (currentProfile && currentProfile.username.toLowerCase() === newUsername) return;

      const { data: avail } = await supabase.rpc("check_username_available", {
        check_username: newUsername,
      });
      if (avail === false) throw new Error("This username is already taken.");

      const { error } = await supabase
        .from("profiles")
        .update({ username: newUsername, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) {
        if (error.code === "23505") throw new Error("This username is already taken.");
        throw error;
      }
      await refreshProfile();
    },
    [refreshProfile]
  );

  const updateDisplayName = useCallback(
    async (displayNameRaw: string) => {
      const displayName = displayNameRaw.trim() || null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile]
  );

  const updateAvatarUrl = useCallback(
    async (avatarUrl: string | null) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile]
  );

  const updateCurrency = useCallback(
    async (currencyCode: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ default_currency: currencyCode, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile]
  );

  const updateSettlementOwedPrefs = useCallback(
    async (prefs: { restaurant?: boolean; travel?: boolean; groceries?: boolean; business?: boolean; others?: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      // Optimistic update so the UI feels instant
      if (profile) {
        setProfile({
          ...profile,
          ...(prefs.restaurant !== undefined && { owed_include_restaurant: prefs.restaurant }),
          ...(prefs.travel !== undefined && { owed_include_travel: prefs.travel }),
          ...(prefs.groceries !== undefined && { owed_include_groceries: prefs.groceries }),
          ...(prefs.business !== undefined && { owed_include_business: prefs.business }),
          ...(prefs.others !== undefined && { owed_include_others: prefs.others }),
        });
      }
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (prefs.restaurant !== undefined) updates.owed_include_restaurant = prefs.restaurant;
      if (prefs.travel !== undefined) updates.owed_include_travel = prefs.travel;
      if (prefs.groceries !== undefined) updates.owed_include_groceries = prefs.groceries;
      if (prefs.business !== undefined) updates.owed_include_business = prefs.business;
      if (prefs.others !== undefined) updates.owed_include_others = prefs.others;
      const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
      if (error) {
        await refreshProfile();
        throw error;
      }
    },
    [profile, refreshProfile]
  );

  const updateOcrAiModel = useCallback(
    async (model: OcrAiModel) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");
      const { error } = await supabase
        .from("profiles")
        .update({ ocr_ai_model: model, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
      await refreshProfile();
    },
    [refreshProfile]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      signUp,
      login,
      verifyOtp,
      resendOtp,
      logout,
      refreshProfile,
      updateUsername,
      updateDisplayName,
      updateCurrency,
      updateAvatarUrl,
      updateSettlementOwedPrefs,
      updateOcrAiModel,
    }),
    [loading, session, profile, signUp, login, verifyOtp, resendOtp, logout, refreshProfile, updateUsername, updateDisplayName, updateCurrency, updateAvatarUrl, updateSettlementOwedPrefs, updateOcrAiModel]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
