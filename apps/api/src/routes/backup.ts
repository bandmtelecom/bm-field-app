import { Router } from 'express';
import JSZip from 'jszip';
import { admin, getCaller } from '../supabase.js';

export const backup = Router();

/**
 * Full data export — every row of every table, as CSVs in one zip.
 *
 * Everything B&M has lives in Supabase and nowhere else. Austin wants a copy on
 * the office network. This is that copy: plain CSV, readable in Excel forever,
 * no dependency on this app or on Supabase still existing.
 *
 * Runs through the service-role client so it bypasses RLS and genuinely gets
 * everything — a backup that quietly skipped the priced rows would be worse
 * than no backup at all.
 */

/** Order matters: parents before children, so the zip reads like the model. */
const TABLES = [
  'customers',
  'profiles',
  'closures',
  'jobs',
  'visits',
  'locations',
  'cables',
  'shots',
  'panel_ports',
  'downtime',
  'location_units',
  'timeline_events',
  'attachments',
  'invoice_drafts',
  'invoice_lines',
  'rate_card',
];

const PAGE = 1000;   // Supabase caps a single select; page through it

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return csvCell(v.join('; '));
  if (typeof v === 'object') return csvCell(JSON.stringify(v));
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';   // CRLF so Excel is happy
}

/** Pull an entire table, a page at a time. */
async function fetchAll(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const batch = (data as any[]) ?? [];
    out.push(...batch);
    if (batch.length < PAGE) break;
  }
  return out;
}

/**
 * GET /export/backup.zip — the whole database as CSVs.
 * Admin only: this is every price and every customer record in one file.
 */
backup.get('/export/backup.zip', async (req, res) => {
  const caller = await getCaller(req.headers.authorization);
  if (!caller) return res.status(401).json({ error: 'unauthorized' });
  if (caller.role !== 'admin') return res.status(403).json({ error: 'admins only' });

  try {
    const zip = new JSZip();
    const stamp = new Date().toISOString().slice(0, 10);
    const counts: string[] = [];

    for (const t of TABLES) {
      const rows = await fetchAll(t);
      counts.push(`${String(rows.length).padStart(7)}  ${t}`);
      // an empty table still gets a file, so a missing one is obviously wrong
      zip.file(`${t}.csv`, toCsv(rows) || '(no rows)\r\n');
    }

    zip.file('README.txt',
      [
        'B&M Field App — full data backup',
        `Taken ${new Date().toISOString()}`,
        '',
        'One CSV per table, every row, straight from the database.',
        'Open them in Excel. They do not need this app or Supabase to be readable.',
        '',
        'Rows:',
        ...counts,
        '',
        'Restoring: these are plain CSVs, so a rebuild means creating the tables',
        'from supabase/migrations/ and importing each file. Parents first —',
        'customers and closures before jobs, jobs before visits, visits before',
        'locations, locations before cables/shots/downtime.',
      ].join('\r\n') + '\r\n');

    const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition',
      `attachment; filename="bm-field-backup-${stamp}.zip"`);
    res.setHeader('Content-Length', String(out.length));
    return res.end(out);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? 'backup failed' });
  }
});
