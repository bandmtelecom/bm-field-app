/**
 * B&M's location numbering — the arithmetic only, no database, no React.
 *
 * Kept on its own so it can be unit-tested. `.20 km` parsing as 20 instead of
 * 0.2 survived a careful read of the code and died in the first test run; the
 * same rule applies here, because a number shown on the form and a different
 * number printed on the customer's report is exactly the class of bug this
 * whole change exists to kill.
 *
 * The DATABASE is what actually assigns a number (migration 0012). Everything
 * here is the preview of that decision.
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
  gps_lat: number | null;
  gps_lng: number | null;
  visit_date: string | null;
  /** "N 312 Corning", "S 312 Corning" — what was in the hole last time. */
  cables: string[];
}

/**
 * The next unused B&M location number on a job. Rows filed before the
 * numbering migration have no number and must not push the count.
 */
export function nextJobLocationNo(prior: PriorLocation[]): number {
  return prior.reduce((m, p) => Math.max(m, p.job_location_no ?? 0), 0) + 1;
}

/**
 * The number each block on an unsaved report will end up with.
 *
 * A return trip takes the number of the hole it is going back to and consumes
 * nothing — that is the entire point. Everything else takes the next one along.
 * A target that is not in the list returns null: an obvious blank beats a
 * confident wrong number.
 */
export function previewNumbers(
  prior: PriorLocation[],
  blocks: { revisit_of: string | null }[],
): (number | null)[] {
  let next = nextJobLocationNo(prior);
  return blocks.map((b) => {
    if (b.revisit_of) {
      return prior.find((p) => p.id === b.revisit_of)?.job_location_no ?? null;
    }
    return next++;
  });
}
