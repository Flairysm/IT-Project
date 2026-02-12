import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState } from "react";

type StoredAuth = {
  users: Record<string, string>;
  currentUser: string | null;
};

type AuthContextValue = {
  loading: boolean;
  user: string | null;
  signUp: (username: string, password: string, confirmPassword: string) => Promise<void>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUsername: (newUsername: string) => Promise<void>;
};

const AUTH_KEY = "receipt_app_auth_v1";
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [store, setStore] = useState<StoredAuth>({ users: {}, currentUser: null });

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<StoredAuth>;
        if (!active) return;
        setStore({
          users: parsed.users && typeof parsed.users === "object" ? parsed.users : {},
          currentUser: typeof parsed.currentUser === "string" ? parsed.currentUser : null,
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const persist = async (next: StoredAuth) => {
    setStore(next);
    await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(next));
  };

  const signUp = async (usernameRaw: string, password: string, confirmPassword: string) => {
    const username = usernameRaw.trim().toLowerCase();
    if (!username) throw new Error("Username is required");
    if (!password) throw new Error("Password is required");
    if (password !== confirmPassword) throw new Error("Passwords do not match");
    if (store.users[username]) throw new Error("Username already exists");
    const next: StoredAuth = {
      users: { ...store.users, [username]: password },
      currentUser: username,
    };
    await persist(next);
  };

  const login = async (usernameRaw: string, password: string) => {
    const username = usernameRaw.trim().toLowerCase();
    if (!username || !password) throw new Error("Enter username and password");
    if (!store.users[username] || store.users[username] !== password) throw new Error("Invalid username or password");
    const next: StoredAuth = {
      users: store.users,
      currentUser: username,
    };
    await persist(next);
  };

  const logout = async () => {
    const next: StoredAuth = { users: store.users, currentUser: null };
    await persist(next);
  };

  const updateUsername = async (newUsernameRaw: string) => {
    if (!store.currentUser) throw new Error("No active user");
    const newUsername = newUsernameRaw.trim().toLowerCase();
    if (!newUsername) throw new Error("Username is required");
    if (newUsername === store.currentUser) return;
    if (store.users[newUsername]) throw new Error("Username already exists");

    const currentPassword = store.users[store.currentUser];
    if (!currentPassword) throw new Error("Current user not found");

    const nextUsers = { ...store.users };
    delete nextUsers[store.currentUser];
    nextUsers[newUsername] = currentPassword;

    await persist({
      users: nextUsers,
      currentUser: newUsername,
    });
  };

  const value = useMemo<AuthContextValue>(
    () => ({ loading, user: store.currentUser, signUp, login, logout, updateUsername }),
    [loading, store.currentUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}

