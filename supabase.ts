import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  // Surfaces a clear message instead of a cryptic runtime error.
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check the web env vars.');
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: { persistSession: true, autoRefreshToken: true },
});
