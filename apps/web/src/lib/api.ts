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

/** Office/admin: put a completed job back on the roster. */
export async function reopenJob(jobId: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}/reopen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
  });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not reopen the job');
  }
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

/** The customer-facing field report (.pdf). No prices on it. */
export async function downloadFieldReport(jobId: string, bmNumber: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}/report.pdf`, { headers: await authHeader() });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not build the report');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bmNumber || 'job'}-field-report.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/**
 * Download the draft laid onto the customer's full rate card (.xlsx).
 * Goes through fetch rather than a plain link because the endpoint is
 * office/admin-only and needs the auth header.
 */
export async function downloadRateCardXlsx(jobId: string, bmNumber: string) {
  const res = await fetch(`${BASE}/jobs/${jobId}/invoice.xlsx`, { headers: await authHeader() });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({})))?.error ?? 'Could not build the rate card');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${bmNumber || 'job'}-rate-card.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Admin: the whole database as CSVs in a zip, for the office network. */
export async function downloadBackup() {
  const res = await fetch(`${BASE}/export/backup.zip`, { headers: await authHeader() });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => ({})))?.error ?? 'Backup failed');
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bm-field-backup-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- admin: user management ------------------------------------------------
export interface AdminUser {
  id: string; email: string; full_name: string;
  role: 'tech' | 'office' | 'admin'; is_active: boolean; last_sign_in_at: string | null;
}

export async function listUsers(): Promise<AdminUser[]> {
  const res = await fetch(`${BASE}/admin/users`, { headers: await authHeader() });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to load users');
  return (await res.json()).users as AdminUser[];
}

export async function createUser(body: { email: string; password: string; full_name: string; role: string }) {
  const res = await fetch(`${BASE}/admin/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to create user');
  return res.json();
}

export async function updateUser(id: string, patch: { role?: string; is_active?: boolean; password?: string }) {
  const res = await fetch(`${BASE}/admin/users/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'Failed to update user');
  return res.json();
}
