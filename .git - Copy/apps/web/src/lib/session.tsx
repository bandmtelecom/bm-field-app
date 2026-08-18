import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { supabase } from './supabase';
import type { Profile } from './types';

interface SessionState {
  loading: boolean;
  userId: string | null;
  profile: Profile | null;
  signIn: (email: string, password: string) => Promise<{ error?: string }>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<SessionState>(null as any);
export const useSession = () => useContext(Ctx);

/** Wipes any cached data on logout/deactivation (offline security requirement). */
async function purgeLocalCaches() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch { /* noop */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  async function loadProfile(uid: string) {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, initials, role, is_active')
      .eq('id', uid).single();
    // Kill-switch: a deactivated account is signed out immediately + cache wiped.
    if (!data || data.is_active === false) {
      await purgeLocalCaches();
      await supabase.auth.signOut();
      setUserId(null); setProfile(null);
      return;
    }
    setProfile(data as Profile);
  }

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user.id ?? null;
      setUserId(uid);
      if (uid) await loadProfile(uid);
      setLoading(false);
    }).catch(() => setLoading(false)); // always render the login screen, even if misconfigured
    const { data: sub } = supabase.auth.onAuthStateChange(async (_e, session) => {
      const uid = session?.user.id ?? null;
      setUserId(uid);
      if (uid) await loadProfile(uid); else setProfile(null);
    });

    // Re-read the profile whenever the app comes back to the foreground. A role
    // change (tech → admin) or a lock-out then takes effect on the next glance
    // at the phone instead of requiring a sign-out/sign-in.
    async function refresh() {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id ?? null;
      if (uid) await loadProfile(uid);
    }
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);

    return () => {
      sub.subscription.unsubscribe();
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, []);

  const value: SessionState = {
    loading, userId, profile,
    signIn: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error: error?.message };
    },
    signOut: async () => {
      await purgeLocalCaches();
      await supabase.auth.signOut();
    },
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
