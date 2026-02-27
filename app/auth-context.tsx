import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";

export type Profile = {
  id: string;
  username: string;
  display_name: string | null;
  default_currency: string;
  avatar_url: string | null;
  push_token: string | null;
  created_at: string;
  updated_at: string;
};

type AuthContextValue = {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  signUp: (email: string, password: string, confirmPassword: string, username?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateUsername: (newUsername: string) => Promise<void>;
  updateDisplayName: (displayName: string) => Promise<void>;
  updateCurrency: (currencyCode: string) => Promise<void>;
  updateAvatarUrl: (avatarUrl: string | null) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, username, display_name, default_currency, avatar_url, push_token, created_at, updated_at")
    .eq("id", userId)
    .single();
  if (error) return null;
  return data as Profile;
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
      if (nextSession?.user) {
        const p = await fetchProfile(nextSession.user.id);
        setProfile(p);
      } else {
        setProfile(null);
      }
      setLoading(false);
    });

    (async () => {
      const { data: { session: s } } = await supabase.auth.getSession();
      setSession(s);
      if (s?.user) {
        const p = await fetchProfile(s.user.id);
        setProfile(p);
      }
      setLoading(false);
    })();

    return () => subscription.unsubscribe();
  }, []);

  const signUp = useCallback(
    async (emailRaw: string, password: string, confirmPassword: string, username?: string) => {
      const email = emailRaw.trim().toLowerCase();
      if (!email) throw new Error("Email is required");
      if (!password) throw new Error("Password is required");
      if (password !== confirmPassword) throw new Error("Passwords do not match");
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            username: username?.trim() || email.split("@")[0],
            display_name: username?.trim() || email.split("@")[0],
          },
        },
      });
      if (error) throw error;
      if (data.user && !data.session) {
        throw new Error("Check your email to confirm your account.");
      }
      if (data.user) await refreshProfile();
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
      const { error } = await supabase
        .from("profiles")
        .update({ username: newUsername, updated_at: new Date().toISOString() })
        .eq("id", user.id);
      if (error) throw error;
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

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      signUp,
      login,
      logout,
      refreshProfile,
      updateUsername,
      updateDisplayName,
      updateCurrency,
      updateAvatarUrl,
    }),
    [loading, session, profile, signUp, login, logout, refreshProfile, updateUsername, updateDisplayName, updateCurrency, updateAvatarUrl]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
