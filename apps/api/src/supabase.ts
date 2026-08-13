import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Set them in the API env (see .env.example).',
  );
}

/**
 * Service-role client — BYPASSES row-level security. Used only here on the
 * server to read prices + all captured units and to write invoice drafts.
 * This key must never ship to the browser/phone.
 *
 * We pass a `ws` transport because supabase-js initializes a realtime client on
 * construction, and Node < 22 has no global WebSocket. We never use realtime;
 * this just satisfies the constructor. (Node 22+ wouldn't need it.)
 */
export const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws as unknown as any },
});

/** Verify a caller's Supabase access token → their profile (id, role, active). */
export async function getCaller(authHeader?: string) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice('Bearer '.length);
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await admin
    .from('profiles')
    .select('id, role, is_active, full_name')
    .eq('id', data.user.id)
    .single();
  if (!profile || !profile.is_active) return null;
  return profile as { id: string; role: string; is_active: boolean; full_name: string };
}
