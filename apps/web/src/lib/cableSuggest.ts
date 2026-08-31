import type { CableRow } from './closures';

/**
 * Offering a crew the cables that were in a hole last time.
 *
 * The rules only, no database and no React, so they can be unit-tested. The
 * loaders live in `closures.ts`.
 *
 * ⚠️ The reason this is a one-tap OFFER and never a silent fill: the report
 * goes to Lumen. If the app writes cable info into a report and the man never
 * looked, B&M has told the customer what is in that hole today on the strength
 * of a trip three weeks ago. Austin, 8/31: fill them in, grey them out, make him
 * tap once. One tap instead of four boxes a cable is the whole saving; the tap
 * is what keeps the report true.
 */

/** A cable row as the FORM holds it — every field a string, never null. */
export interface CableFormRow {
  direction: string;
  count: string;
  manufacturer: string;
  date_code: string;
  footage: string;
  role: string;
}

/** Anything that carries cables and a date — a location row, shaped loosely so
 *  both loaders can use it. */
export interface CableSource {
  id: string;
  visitDate: string | null;
  createdAt: string | null;
  cables: CableRow[];
}

/** What the crew is being offered, and where it came from. Provenance matters:
 *  a man deciding whether to accept needs to know how old this is. */
export interface CableSuggestion {
  cables: CableFormRow[];
  visitDate: string | null;
  bmNumber: string | null;
  closureCode: string | null;
  sourceLocationId: string;
}

const s = (v: unknown) => (v == null ? '' : String(v).trim());

/** Database row → form row. Every field, including the ones the form does not
 *  show any more (`date_code`, `role`): dropping them would quietly lose
 *  history off an old cable the moment somebody accepted the offer. */
export function cableToForm(c: CableRow): CableFormRow {
  return {
    direction: s(c.direction),
    count: s(c.count),
    manufacturer: s(c.manufacturer),
    date_code: s(c.date_code),
    footage: s(c.footage),
    role: s(c.role),
  };
}

/** Has the tech put anything in the cable list yet? An empty row that the form
 *  added but nobody typed in does not count — otherwise tapping "+ Add" once
 *  would hide the offer for good. */
export function hasAnyCableContent(rows: { [k: string]: string }[]): boolean {
  return rows.some((r) =>
    ['direction', 'count', 'manufacturer', 'date_code', 'footage', 'role']
      .some((k) => (r[k] ?? '').trim() !== ''));
}

/**
 * The most recent entry that actually recorded cables.
 *
 * Newest first by visit date, then by when the report was filed — two crews on
 * one night file the same date. Entries with no cables are skipped rather than
 * ending the search: a hole opened just to look at it should not wipe out what
 * the last man who spliced it wrote down.
 *
 * `excludeId` keeps a location from offering itself its own cables back, which
 * is what would happen on the office Edit Location screen.
 */
export function pickLatestWithCables(
  rows: CableSource[],
  excludeId?: string | null,
): CableSource | null {
  const usable = rows
    .filter((r) => r.id !== excludeId)
    .filter((r) => (r.cables ?? []).length > 0);
  if (!usable.length) return null;

  return usable.sort((a, b) => {
    const d = (b.visitDate ?? '').localeCompare(a.visitDate ?? '');
    if (d !== 0) return d;
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
  })[0];
}

/** "8/21 on 26-357" — how old this is and where it came from, in a few words. */
export function suggestionAge(sug: CableSuggestion): string {
  const when = sug.visitDate
    ? new Date(`${sug.visitDate}T12:00:00`).toLocaleDateString('en-US', {
        month: 'numeric', day: 'numeric',
      })
    : null;
  return [when, sug.bmNumber ? `on ${sug.bmNumber}` : null]
    .filter(Boolean).join(' ') || 'a previous visit';
}
