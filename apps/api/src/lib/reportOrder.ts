/**
 * The ORDER of a field report — pure arithmetic, no PDF and no database.
 *
 * Jason (Lumen), 10/27, on a report whose locations printed as
 * 13, 11, 12, 8.5, 9, 8, 3, 7, 4, 5, 5.5, 10, 6, 2, 1, 3, 0, 0.5, 4, 12, 10:
 * "Tell me if this would make your head spin." The report used to print day by
 * day, and inside each day in the order the techs saved, so every return trip
 * and every added hole scrambled it.
 *
 * Austin's rules, 10/27:
 *   1. Locations print once each, in number order: 0, 0.5, 1, 2, 3, 5, 5.5 …
 *   2. Return trips sit under their location, in date order (Trip 1, Trip 2).
 *      Revisits to a repair sit under that repair.
 *   3. Then Repair 1, 2, 3 …, then Roll-around location 1, 2, 3 …
 *   4. Anything where no splicing was done — testing only, a building entry, a
 *      hole opened to look — goes to the very bottom. A location stays up top
 *      if ANY trip to it spliced.
 *   5. A second enclosure in a hole already on the report prints under the same
 *      location ("Enclosure 2"), not as 5.5.
 *
 * "The same location" is decided by the number the customer reads. Every row
 * resolves to the row it ultimately points at (a revisit or a second enclosure
 * points back), then groups on that row's kind + number. Two rows the techs
 * both typed "3" are one location on the customer's plan, so they group too.
 */

export type LocationKind = 'mop' | 'repair' | 'rollaround';

export interface OrderInput {
  id: string;
  kind: LocationKind;
  pmLocationNo: string | null;
  jobLocationNo: number | null;
  revisitOf: string | null;
  enclosureOf: string | null;
  /** Position of the row's visit in time — date, then when it was started. */
  visitIndex: number;
  /** Position of the row within its visit. */
  ordinal: number;
  spliceCount: number;
}

export interface Trip<T> { visitIndex: number; rows: T[]; }
export interface Place<T> {
  key: string;
  kind: LocationKind;
  number: string;
  label: string;
  spliced: boolean;
  trips: Trip<T>[];
}
export type SectionId = 'mop' | 'repair' | 'rollaround' | 'nosplice';
export interface Section<T> { id: SectionId; title: string; places: Place<T>[]; }

export const SECTION_TITLES: Record<SectionId, string> = {
  mop: 'Locations',
  repair: 'Repair locations',
  rollaround: 'Roll-around locations',
  nosplice: 'Testing & entries — no splicing',
};

const DECIMAL = /^\d+(\.\d+)?$/;

/** "Location 5" / "Location 5.5" / "1950 Stemmons" / "Repair 2" / "Roll-around location 1". */
export function kindLabel(kind: LocationKind, number: string | null | undefined): string {
  const n = (number ?? '').trim();
  if (kind === 'repair') return n ? `Repair ${n}` : 'Repair';
  if (kind === 'rollaround') return n ? `Roll-around location ${n}` : 'Roll-around location';
  if (!n) return 'Location';
  return DECIMAL.test(n) ? `Location ${n}` : n;
}

/** "Location 3", "location 3 " and "3" are the same location. */
export function normNumber(s: string): string {
  return s.trim().toLowerCase().replace(/^location\s*/, '').replace(/\s+/g, ' ');
}

/**
 * Sort key for a location number: numbers first by value (0, 0.5, 1, 2, 10 —
 * never 1, 10, 2), with any trailing letters after ("1" before "1a" before
 * "1b"), then names alphabetically.
 */
export function compareNumbers(a: string, b: string): number {
  const pa = normNumber(a).match(/^(\d+(?:\.\d+)?)(.*)$/);
  const pb = normNumber(b).match(/^(\d+(?:\.\d+)?)(.*)$/);
  if (pa && pb) {
    const d = Number(pa[1]) - Number(pb[1]);
    if (d) return d;
    return pa[2].localeCompare(pb[2]);
  }
  if (pa) return -1;
  if (pb) return 1;
  return normNumber(a).localeCompare(normNumber(b));
}

export function orderReport<T extends OrderInput>(rows: T[]): Section<T>[] {
  const byId = new Map(rows.map((r) => [r.id, r]));

  const root = (r: T): T => {
    let cur = r;
    const seen = new Set<string>();
    for (;;) {
      seen.add(cur.id);
      const up = cur.enclosureOf ?? cur.revisitOf;
      const next = up ? byId.get(up) : undefined;
      if (!next || seen.has(next.id)) return cur;
      cur = next;
    }
  };

  const numberOf = (r: T) =>
    (r.pmLocationNo ?? '').trim() || (r.jobLocationNo != null ? String(r.jobLocationNo) : '');

  // time order of every row, used for ties
  const sorted = [...rows].sort((a, b) => a.visitIndex - b.visitIndex || a.ordinal - b.ordinal);
  const firstSeen = new Map<string, number>();

  const places = new Map<string, Place<T>>();
  sorted.forEach((r, i) => {
    const top = root(r);
    const num = numberOf(top);
    const key = num ? `${top.kind}|${normNumber(num)}` : `${top.kind}|row:${top.id}`;
    let p = places.get(key);
    if (!p) {
      p = { key, kind: top.kind, number: num, label: kindLabel(top.kind, num), spliced: false, trips: [] };
      places.set(key, p);
      firstSeen.set(key, i);
    }
    if ((r.spliceCount ?? 0) > 0) p.spliced = true;
    let trip = p.trips.find((t) => t.visitIndex === r.visitIndex);
    if (!trip) { trip = { visitIndex: r.visitIndex, rows: [] }; p.trips.push(trip); }
    trip.rows.push(r);
  });

  const order: SectionId[] = ['mop', 'repair', 'rollaround', 'nosplice'];
  const sections = order.map((id) => ({ id, title: SECTION_TITLES[id], places: [] as Place<T>[] }));
  const sectionOf = (p: Place<T>): SectionId => (p.spliced ? p.kind : 'nosplice');

  for (const p of places.values()) {
    p.trips.sort((a, b) => a.visitIndex - b.visitIndex);
    // inside a trip: the enclosure that was there first, then the second
    for (const t of p.trips) {
      t.rows.sort((a, b) => {
        const aIsEnc = a.enclosureOf ? 1 : 0, bIsEnc = b.enclosureOf ? 1 : 0;
        return aIsEnc - bIsEnc || a.ordinal - b.ordinal;
      });
    }
    sections.find((s) => s.id === sectionOf(p))!.places.push(p);
  }

  const kindRank: Record<LocationKind, number> = { mop: 0, repair: 1, rollaround: 2 };
  for (const s of sections) {
    s.places.sort((a, b) =>
      (s.id === 'nosplice' ? kindRank[a.kind] - kindRank[b.kind] : 0)
      || compareNumbers(a.number, b.number)
      || (firstSeen.get(a.key)! - firstSeen.get(b.key)!));
  }
  return sections.filter((s) => s.places.length);
}
