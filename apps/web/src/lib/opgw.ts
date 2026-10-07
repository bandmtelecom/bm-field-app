/**
 * OPGW — the pure logic behind the OPGW form, kept out of the components so it
 * can be tested without Supabase (see test/opgw.test.ts).
 *
 * Austin, 10/6: "OPGW is much more simple." A structure is a splice or a test
 * point; nothing bills.
 */

export type OpgwKind = 'splice' | 'test';
export type SpliceType = '2way' | '3way' | 'transition' | 'termination' | 'other';
export type CableCount = '48' | '96' | '144' | 'other';
export type TestedFrom = 'structure' | 'hub';

export const SPLICE_TYPES: [SpliceType, string][] = [
  ['2way', '2-way'],
  ['3way', '3-way'],
  ['transition', 'Transition'],
  ['termination', 'Termination'],
  ['other', 'Other'],
];
export const CABLE_COUNTS: [CableCount, string][] = [
  ['48', '48'], ['96', '96'], ['144', '144'], ['other', 'Other'],
];

export interface OpgwPoint {
  id: string;
  job_id: string;
  kind: OpgwKind;
  name: string;
  tested_from: TestedFrom | null;
  splice_type: SpliceType | null;
  splice_type_other: string | null;
  cable_count: CableCount | null;
  cable_count_other: string | null;
  gps_lat: number | string | null;
  gps_lng: number | string | null;
  row_lat: number | string | null;
  row_lng: number | string | null;
  notes: string | null;
  techs: string[];
  work_date: string;
  ordinal: number;
  created_by: string | null;
}

/** "2-way", or what the tech typed under Other. */
export function spliceTypeLabel(p: Pick<OpgwPoint, 'splice_type' | 'splice_type_other'>): string {
  if (!p.splice_type) return '';
  if (p.splice_type === 'other') return (p.splice_type_other ?? '').trim() || 'Other';
  return SPLICE_TYPES.find(([k]) => k === p.splice_type)?.[1] ?? p.splice_type;
}

/** "48", or what the tech typed under Other. */
export function cableCountLabel(p: Pick<OpgwPoint, 'cable_count' | 'cable_count_other'>): string {
  if (!p.cable_count) return '';
  if (p.cable_count === 'other') return (p.cable_count_other ?? '').trim() || 'Other';
  return p.cable_count;
}

/** The customer as it should read: the typed name when the job's customer is "Other". */
export function customerLabel(name: string | null | undefined, other: string | null | undefined): string {
  const n = (name ?? '').trim();
  const o = (other ?? '').trim();
  if (n.toLowerCase() === 'other' && o) return o;
  return n;
}

/**
 * Read one coordinate the way a tech might type or paste it.
 *
 *   "32.3992940"          → 32.399294
 *   "-96.5792710"         → -96.579271
 *   "32°15'42\"N"         → 32.261667
 *   "96°21'30\"W"         → -96.358333
 *   "32 15 42 N"          → 32.261667
 *   "96 21.5 W"           → -96.358333   (degrees + decimal minutes)
 *
 * Returns null for an empty box and undefined for text that is not a
 * coordinate — the caller shows a warning instead of saving a wrong number.
 * A.J. sent 18/9 on job 25-497 as 32°15'42"N 96°21'30"W; that has to go in.
 */
export function parseCoord(s: unknown): number | null | undefined {
  const raw = s == null ? '' : String(s).trim();
  if (raw === '') return null;
  const hemi = raw.match(/[NSEW]/i)?.[0]?.toUpperCase() ?? null;
  const nums = (raw.replace(/,/g, '.').match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (!nums.length || nums.length > 3 || nums.some((n) => !Number.isFinite(n))) return undefined;
  const neg = nums[0] < 0 || hemi === 'S' || hemi === 'W';
  const [d, m = 0, sec = 0] = nums.map(Math.abs);
  if (nums.length > 1 && (m >= 60 || sec >= 60)) return undefined;
  const v = d + m / 60 + sec / 3600;
  if (v > 180) return undefined;
  return Math.round((neg ? -v : v) * 1e6) / 1e6;
}

/**
 * A whole "lat, lng" pasted into one box ("32.3992940, -96.5792710" or
 * "32°15'42\"N 96°21'30\"W"). Returns null when the text is not a pair.
 */
export function parseCoordPair(s: unknown): { lat: number; lng: number } | null {
  const raw = s == null ? '' : String(s).trim();
  if (!raw) return null;
  // DMS pair: split after the first N/S.
  const ns = raw.match(/^(.*?[NS])\s*,?\s*(.+[EW].*)$/i);
  if (ns) {
    const lat = parseCoord(ns[1]);
    const lng = parseCoord(ns[2]);
    if (typeof lat === 'number' && typeof lng === 'number') return { lat, lng };
    return null;
  }
  // Decimal pair: two numbers separated by a comma or whitespace.
  const m = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
  }
  return null;
}

/** Texas is west of Greenwich — a positive longitude is a dropped minus sign. */
export function looksEastern(lng: unknown): boolean {
  const v = parseCoord(lng);
  return typeof v === 'number' && v > 0;
}

// ---------------------------------------------------------------------------
// the form
// ---------------------------------------------------------------------------

export interface OpgwForm {
  kind: OpgwKind;
  name: string;
  tested_from: TestedFrom;
  splice_type: SpliceType;
  splice_type_other: string;
  cable_count: CableCount | '';
  cable_count_other: string;
  gps_lat: string; gps_lng: string;
  row_lat: string; row_lng: string;
  notes: string;
  techs: string;
  work_date: string;
}

export function emptyOpgwForm(today: string, crew = '', kind: OpgwKind = 'splice'): OpgwForm {
  return {
    kind,
    name: '',
    tested_from: 'structure',
    splice_type: '2way',          // 95% of them — Austin, 10/7
    splice_type_other: '',
    cable_count: '',
    cable_count_other: '',
    gps_lat: '', gps_lng: '', row_lat: '', row_lng: '',
    notes: '',
    techs: crew,
    work_date: today,
  };
}

export function formFromPoint(p: OpgwPoint): OpgwForm {
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    kind: p.kind,
    name: p.name ?? '',
    tested_from: p.tested_from ?? 'structure',
    splice_type: p.splice_type ?? '2way',
    splice_type_other: p.splice_type_other ?? '',
    cable_count: p.cable_count ?? '',
    cable_count_other: p.cable_count_other ?? '',
    gps_lat: s(p.gps_lat), gps_lng: s(p.gps_lng),
    row_lat: s(p.row_lat), row_lng: s(p.row_lng),
    notes: p.notes ?? '',
    techs: (p.techs ?? []).join(', '),
    work_date: p.work_date,
  };
}

/** Everything wrong with the form, in the crew's words. Empty = ready to save. */
export function formProblems(f: OpgwForm): string[] {
  const out: string[] = [];
  if (!f.name.trim()) out.push(f.kind === 'test' && f.tested_from === 'hub'
    ? 'Put in the hub name.' : 'Put in the structure number.');
  if (f.kind === 'splice') {
    if (f.splice_type === 'other' && !f.splice_type_other.trim()) out.push('Type what the splice is under Other.');
    if (!f.cable_count) out.push('Pick the cable count.');
    if (f.cable_count === 'other' && !f.cable_count_other.trim()) out.push('Type the cable count under Other.');
  }
  for (const [label, lat, lng] of [
    ['GPS', f.gps_lat, f.gps_lng],
    ['ROW entrance GPS', f.row_lat, f.row_lng],
  ] as const) {
    const a = parseCoord(lat), b = parseCoord(lng);
    if (a === undefined || b === undefined) out.push(`The ${label} is not a coordinate I can read.`);
    else if ((a === null) !== (b === null)) out.push(`The ${label} needs both numbers.`);
    else if (typeof a === 'number' && Math.abs(a) > 90) out.push(`The ${label} latitude is out of range.`);
  }
  if (f.kind === 'splice' && parseCoord(f.gps_lat) == null) out.push('Grab the structure GPS.');
  return out;
}

/** The row that goes to Supabase. Splice-only fields are cleared on a test point. */
export function rowFromForm(f: OpgwForm, splitNames: (s: string) => string[]) {
  const isSplice = f.kind === 'splice';
  return {
    kind: f.kind,
    name: f.name.trim(),
    tested_from: isSplice ? null : f.tested_from,
    splice_type: isSplice ? f.splice_type : null,
    splice_type_other: isSplice && f.splice_type === 'other' ? f.splice_type_other.trim() : null,
    cable_count: isSplice ? (f.cable_count || null) : null,
    cable_count_other: isSplice && f.cable_count === 'other' ? f.cable_count_other.trim() : null,
    gps_lat: parseCoord(f.gps_lat) ?? null,
    gps_lng: parseCoord(f.gps_lng) ?? null,
    row_lat: isSplice ? (parseCoord(f.row_lat) ?? null) : null,
    row_lng: isSplice ? (parseCoord(f.row_lng) ?? null) : null,
    notes: f.notes.trim() || null,
    techs: splitNames(f.techs),
    work_date: f.work_date,
  };
}

/** One line under the structure name on the job screen. */
export function pointSummary(p: OpgwPoint): string {
  if (p.kind === 'test') return `Test point · tested from ${p.tested_from === 'hub' ? 'a hub' : 'a structure'}`;
  return [spliceTypeLabel(p), cableCountLabel(p) ? `${cableCountLabel(p)} ct` : ''].filter(Boolean).join(' · ');
}
