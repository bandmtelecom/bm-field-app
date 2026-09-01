/**
 * The location number — the arithmetic only, no database and no React.
 *
 * There is ONE number per location and it lives in the box the tech types in.
 * Austin, 9/1: *"I only want the location 5 or generate the next number in line.
 * if the tech does not put one the app just needs to assign the next number."*
 *
 * The DATABASE is what actually assigns it (migration 0013). Everything here is
 * the preview of that decision, so a man is never shown one number on the form
 * and handed another on the report. Kept pure so both halves can be tested —
 * `.20 km` parsing as 20 instead of 0.2 survived a careful read of the code and
 * died in the first test run.
 */

/**
 * A hole already recorded on this job, offered to a tech as "we've been here
 * before". Everything a man can check against what he is looking at — and the
 * cables are the part that settles it. GPS never does: on 26-359 two closures
 * 32 feet apart turned out to be two different holes in two different lids.
 */
export interface PriorLocation {
  id: string;
  job_location_no: number | null;
  pm_location_no: string | null;
  closure_id: string | null;
  closure_code: string | null;
  structure_type: string | null;
  structure_owner: string | null;
  building_address: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  visit_date: string | null;
  /** "N 312 Corning", "S 312 Corning" — what was in the hole last time. */
  cables: string[];
}

/**
 * Is this location number a place in a sequence, or a name?
 *
 * The techs type both into the same box. "5" is a position; "1950 Stemmons",
 * "West", "Wayne ILA", "2112 California Ave, OKC" and "1a" are names — and a
 * name must never push the count, or the next hole on 26-354 would be
 * location 1951. Same rule the trigger applies in SQL.
 */
export function isSequenceNumber(v: string | null | undefined): boolean {
  return /^\s*\d+\s*$/.test(v ?? '');
}

/** The highest plain number among a set of location numbers, or 0. */
export function highestNumber(values: (string | null | undefined)[]): number {
  return values.reduce<number>((m, v) => {
    if (!isSequenceNumber(v)) return m;
    return Math.max(m, parseInt((v as string).trim(), 10));
  }, 0);
}

/**
 * The number each block on an unsaved report will end up with.
 *
 * What the tech typed always stands, whatever it is. A return trip with an
 * empty box takes the number of the hole it is going back to — that is what
 * makes a second visit read as the same location instead of a new one — and
 * consumes nothing. Everything else takes the next number in line, counting
 * both what is already on the job and what the other blocks on this screen
 * have claimed.
 */
export function previewPmNumbers(
  prior: PriorLocation[],
  blocks: { pm_location_no: string; revisit_of: string | null }[],
): string[] {
  const claimed: (string | null)[] = prior.map((p) => p.pm_location_no);
  // A number typed into ANY block on this screen is taken, including one
  // further down the page — otherwise the first blank hands out a 6 that the
  // man has already typed into the block below it.
  claimed.push(...blocks.map((b) => b.pm_location_no));

  return blocks.map((b) => {
    const typed = (b.pm_location_no ?? '').trim();
    if (typed) return typed;

    if (b.revisit_of) {
      const target = prior.find((p) => p.id === b.revisit_of);
      const fromHole = (target?.pm_location_no ?? '').trim();
      if (fromHole) return fromHole;
    }

    const next = String(highestNumber(claimed) + 1);
    claimed.push(next);
    return next;
  });
}
