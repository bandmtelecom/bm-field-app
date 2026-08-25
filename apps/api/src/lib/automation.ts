import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { getCaller } from '../supabase.js';

/**
 * Auth for the export routes, for humans AND for the weekly backup job.
 *
 * The export routes (backup zip, rate card, field report) were admin-only via a
 * Supabase session token. That is right for a person clicking a button, but an
 * unattended weekly backup has no browser and no session to borrow, and parking
 * a real admin's long-lived credentials in a scheduler is a bad trade — it
 * hands over the ability to write, not just to read.
 *
 * So there is a second door: a single shared secret in the API env
 * (BACKUP_TOKEN), presented as `X-Backup-Token`. It opens ONLY the read-only
 * export routes. It cannot create, edit, or complete anything.
 *
 * Fail-closed by design: if BACKUP_TOKEN is unset or looks too weak to be a
 * real secret, the automation door does not exist at all and every caller falls
 * back to needing a genuine admin session. A backup that silently opened the
 * whole rate card to the internet would be far worse than a backup that stops
 * running and makes someone ask why.
 */

/** Anything shorter than this isn't a secret, it's a guess away. */
const MIN_TOKEN_LENGTH = 32;

export type ExportCaller =
  | { kind: 'user'; id: string; role: string; full_name: string }
  | { kind: 'automation'; role: 'automation'; full_name: 'weekly backup' };

/** Length-safe constant-time compare — never leaks the token via timing. */
function secretsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch, which would itself be a leak,
  // so compare equal-length buffers and fold the length into the result.
  const len = Math.max(ab.length, bb.length);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  return timingSafeEqual(pa, pb) && ab.length === bb.length;
}

/** Is the automation door configured at all? */
export function automationEnabled(): boolean {
  const t = process.env.BACKUP_TOKEN;
  return typeof t === 'string' && t.length >= MIN_TOKEN_LENGTH;
}

function headerToken(req: Request): string | null {
  const raw = req.headers['x-backup-token'];
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === 'string' && v.length ? v : null;
}

/**
 * Who is asking for an export? Returns null if nobody legitimate is.
 *
 * `roles` lists the human roles allowed through the front door; the automation
 * token is always allowed, because these routes are read-only by construction.
 */
export async function getExportCaller(
  req: Request,
  roles: string[],
): Promise<ExportCaller | null> {
  const presented = headerToken(req);
  if (presented) {
    // A token was offered: judge it on its own merits and stop. Falling through
    // to session auth here would let a bad token quietly succeed on a browser
    // request that happened to carry cookies, hiding a broken scheduler.
    if (!automationEnabled()) return null;
    if (!secretsMatch(presented, process.env.BACKUP_TOKEN as string)) return null;
    return { kind: 'automation', role: 'automation', full_name: 'weekly backup' };
  }

  const profile = await getCaller(req.headers.authorization);
  if (!profile) return null;
  if (!roles.includes(profile.role)) return null;
  return {
    kind: 'user',
    id: profile.id,
    role: profile.role,
    full_name: profile.full_name,
  };
}
