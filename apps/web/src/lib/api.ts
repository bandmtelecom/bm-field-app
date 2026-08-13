import { supabase } from './supabase';

const BASE = (import.meta.env.VITE_API_BASE_URL as string) ?? '';

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Mark a job complete → the backend drafts the invoice (prices stay server-side). */
export async function markJobComplete(jobId: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}/invoice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to mark complete');
  return res.json();
}

/** Office/admin: fetch the priced draft for a job. */
export async function getInvoiceDraft(jobId: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}/invoice`, { headers: await authHeader() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('Failed to load invoice');
  return res.json();
}

export function kmlUrl() {
  return `${BASE}/closures.kml`;
}
