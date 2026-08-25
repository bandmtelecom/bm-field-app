#!/usr/bin/env node
/**
 * B&M Field App — weekly backup builder.
 *
 * Produces ONE dated zip that contains everything needed to rebuild the
 * business from scratch, and drops it in an output directory. Something else
 * (a scheduled Claude session, Task Scheduler, a human) is responsible for
 * moving that zip onto the network folder — this script only builds it.
 *
 * What goes in:
 *   data/         every table as CSV, straight from the live database
 *   rate-cards/   the .xlsx we'd send the customer, per completed job
 *   reports/      the field report PDF, per completed job
 *   code/         a git bundle — the entire repo with full history, one file
 *   MANIFEST.txt  what was captured, what failed, and how to restore it
 *
 * WHY a git bundle instead of a zip of the source: a bundle restores with
 * `git clone bm-field-app.bundle`, history and all, so a bad push can be walked
 * back commit by commit. A source zip only gives you one frozen moment.
 *
 * WHY it re-fetches every completed job's rate card each week rather than only
 * new ones: the rate card is generated from the saved draft at export time, so
 * an engine fix changes what an old job's card looks like. Re-pulling keeps the
 * archive honest about what the app would produce today. It's a few dozen small
 * files; correctness is worth more than the bandwidth.
 *
 * Usage:
 *   API_BASE=https://bm-field-api.onrender.com \
 *   BACKUP_TOKEN=... \
 *   node tools/weekly-backup.mjs --out ./out [--repo .] [--skip-code]
 *
 * Exit codes: 0 = complete backup. 2 = built, but something is missing (the
 * MANIFEST says what). 1 = could not produce a backup at all.
 */

import { mkdtemp, mkdir, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// ---------------------------------------------------------------- arguments

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const FLAG = (name) => process.argv.includes(`--${name}`);

const API_BASE = (process.env.API_BASE ?? 'https://bm-field-api.onrender.com').replace(/\/+$/, '');
const TOKEN = process.env.BACKUP_TOKEN ?? '';
const OUT_DIR = resolve(arg('out', './out'));
const REPO_DIR = resolve(arg('repo', '.'));
const SKIP_CODE = FLAG('skip-code');

if (!TOKEN) {
  console.error('BACKUP_TOKEN is not set. Refusing to run — a backup that quietly');
  console.error('produced an empty archive would be worse than no backup at all.');
  process.exit(1);
}

/** Local calendar date, not UTC: a Thursday 4pm run must not be stamped Friday. */
function localDateStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const STAMP = localDateStamp();
const problems = [];
const note = (msg) => { problems.push(msg); console.warn(`  ! ${msg}`); };

// ------------------------------------------------------------------- http

/** One fetch with retries — Render free tier cold-starts, so first call is slow. */
async function get(path, { attempts = 4 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { 'X-Backup-Token': TOKEN },
        signal: AbortSignal.timeout(180_000),
      });
      if (res.status === 401 || res.status === 403) {
        // Credentials are wrong; retrying just burns time and says the same.
        throw Object.assign(new Error(`${res.status} — token rejected`), { fatal: true });
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (e.fatal) throw e;
      lastErr = e;
      if (i < attempts) {
        const wait = 5000 * i;   // 5s, 10s, 15s — enough for a cold dyno
        console.log(`    retry ${i}/${attempts - 1} for ${path} in ${wait / 1000}s (${e.message})`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr;
}

// -------------------------------------------------------------------- csv

/**
 * Minimal RFC-4180 CSV reader. The backup writes quoted fields with doubled
 * quotes and CRLF line endings; narratives contain commas and newlines, so
 * splitting on commas would silently mangle the job list.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* handled by \n */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const cols = rows[0];
  return rows.slice(1)
    .filter((r) => r.length && r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ''])));
}

/**
 * Count records in a CSV without building them.
 *
 * NOT `wc -l`. Narratives and as-found/as-built text contain real newlines
 * inside quoted fields, so line counting overstates the row count — and the
 * manifest is exactly where someone looks to decide whether a backup came out
 * right. A number that drifts up with how chatty the techs were is worse than
 * no number.
 */
function countCsvRows(text) {
  let rows = 0, quoted = false, sawContent = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') i++; else quoted = false; }
    } else if (c === '"') { quoted = true; sawContent = true; }
    else if (c === '\n') { if (sawContent) rows++; sawContent = false; }
    else if (c !== '\r') sawContent = true;
  }
  if (sawContent) rows++;
  return Math.max(0, rows - 1);   // drop the header
}

const safe = (s) => String(s ?? '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'job';

// ------------------------------------------------------------------- main

async function main() {
  const work = await mkdtemp(join(tmpdir(), 'bm-backup-'));
  const root = join(work, `bm-field-backup-${STAMP}`);
  await mkdir(root, { recursive: true });

  // 1 — the database ------------------------------------------------------
  console.log(`[1/4] data  ← ${API_BASE}/export/backup.zip`);
  const dataZip = join(work, 'data.zip');
  const dataDir = join(root, 'data');
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataZip, await get('/export/backup.zip'));
  await run('unzip', ['-q', '-o', dataZip, '-d', dataDir]);

  const jobsCsv = join(dataDir, 'jobs.csv');
  if (!existsSync(jobsCsv)) throw new Error('backup zip has no jobs.csv — export looks broken');
  const jobs = parseCsv(await readFile(jobsCsv, 'utf8'));
  const tables = (await run('ls', [dataDir])).stdout.trim().split('\n').length;
  console.log(`      ${tables} files, ${jobs.length} jobs`);

  // 2 — rate cards + reports for every completed job ----------------------
  // Only completed jobs: a rate card needs a saved draft, which is written at
  // Mark Complete. Asking for an open job's card is a guaranteed 404.
  const done = jobs.filter((j) => (j.status ?? '').toLowerCase() === 'complete');
  console.log(`[2/4] rate cards + reports for ${done.length} completed job(s)`);
  const cardsDir = join(root, 'rate-cards');
  const reportsDir = join(root, 'reports');
  await mkdir(cardsDir, { recursive: true });
  await mkdir(reportsDir, { recursive: true });

  let cards = 0, reports = 0;
  for (const j of done) {
    const label = safe(j.bm_number || j.id);
    for (const [kind, path, dir, ext] of [
      ['rate card', `/jobs/${j.id}/invoice.xlsx`, cardsDir, 'xlsx'],
      ['report', `/jobs/${j.id}/report.pdf`, reportsDir, 'pdf'],
    ]) {
      try {
        const buf = await get(path, { attempts: 2 });
        await writeFile(join(dir, `${label}.${ext}`), buf);
        if (ext === 'xlsx') cards++; else reports++;
      } catch (e) {
        if (e.fatal) throw e;
        note(`${kind} for job ${j.bm_number || j.id}: ${e.message}`);
      }
    }
  }
  console.log(`      ${cards} rate card(s), ${reports} report(s)`);

  // 3 — the code ----------------------------------------------------------
  let bundleNote = 'skipped (--skip-code)';
  if (!SKIP_CODE) {
    console.log('[3/4] code bundle');
    const codeDir = join(root, 'code');
    await mkdir(codeDir, { recursive: true });
    try {
      const { stdout: head } = await run('git', ['-C', REPO_DIR, 'rev-parse', 'HEAD']);
      await run('git', ['-C', REPO_DIR, 'bundle', 'create',
        join(codeDir, 'bm-field-app.bundle'), '--all']);
      bundleNote = `git bundle at ${head.trim().slice(0, 8)} (full history, all branches)`;
      console.log(`      ${bundleNote}`);
    } catch (e) {
      bundleNote = `FAILED: ${e.message}`;
      note(`code bundle: ${e.message}`);
    }
  } else console.log('[3/4] code bundle skipped');

  // 4 — manifest + zip ----------------------------------------------------
  console.log('[4/4] manifest + zip');
  const csvNames = (await readdir(dataDir)).filter((f) => f.endsWith('.csv')).sort();
  const countLines = [];
  let totalRows = 0;
  for (const f of csvNames) {
    const n = countCsvRows(await readFile(join(dataDir, f), 'utf8'));
    totalRows += n;
    countLines.push(`${String(n).padStart(8)}  ${f}`);
  }
  const counts = countLines.join('\n');

  await writeFile(join(root, 'MANIFEST.txt'), [
    `B&M Field App — weekly backup`,
    `Taken ${new Date().toISOString()} (local date ${STAMP})`,
    `Source ${API_BASE}`,
    '',
    'CONTENTS',
    '  data/         every table as CSV, straight from the live database',
    '  rate-cards/   the .xlsx sent to the customer, one per completed job',
    '  reports/      the field report PDF, one per completed job',
    '  code/         git bundle — whole repo, full history, one file',
    '',
    'ROWS PER TABLE',
    counts,
    `${String(totalRows).padStart(8)}  TOTAL`,
    '',
    `RATE CARDS  ${cards} of ${done.length} completed jobs`,
    `REPORTS     ${reports} of ${done.length} completed jobs`,
    `CODE        ${bundleNote}`,
    '',
    problems.length
      ? `INCOMPLETE — ${problems.length} problem(s):\n` + problems.map((p) => `  - ${p}`).join('\n')
      : 'COMPLETE — everything expected was captured.',
    '',
    'HOW TO RESTORE',
    '  Code:  git clone code/bm-field-app.bundle bm-field-app',
    '  Data:  create the tables from supabase/migrations/ in the cloned repo,',
    '         then import each CSV. Order matters — parents before children:',
    '         customers and closures, then jobs, then visits, then locations,',
    '         then cables / shots / downtime / location_units.',
    '  The CSVs are plain text. They do not need this app, or Supabase, or',
    '  anything else to still exist in order to be readable.',
  ].join('\n') + '\n');

  await mkdir(OUT_DIR, { recursive: true });
  const outZip = join(OUT_DIR, `bm-field-backup-${STAMP}.zip`);
  await rm(outZip, { force: true });
  await run('bash', ['-c',
    `cd ${JSON.stringify(work)} && zip -q -r ${JSON.stringify(outZip)} ${JSON.stringify(`bm-field-backup-${STAMP}`)}`]);

  const { stdout: size } = await run('bash', ['-c', `du -h ${JSON.stringify(outZip)} | cut -f1`]);
  await rm(work, { recursive: true, force: true });

  console.log(`\n${outZip}  (${size.trim()})`);
  if (problems.length) {
    console.log(`\nBuilt, but INCOMPLETE — ${problems.length} problem(s). See MANIFEST.txt.`);
    process.exit(2);
  }
  console.log('\nComplete.');
}

main().catch((e) => {
  console.error(`\nBackup failed: ${e.message}`);
  process.exit(1);
});
