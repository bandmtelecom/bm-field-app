import type { ClosureRow } from './closures';

/**
 * How a closure reads in a list you pick from.
 *
 * Its own module, with no database and no React in it, so it can be
 * unit-tested — a test that reaches `lib/supabase.ts` dies on a missing
 * `@supabase/supabase-js` in the container. Same reason `locationNo.ts` and
 * `cableSuggest.ts` sit on their own.
 */

/** A closure as the pick-list holds it. Light on purpose: no cables, no visit
 *  counts. Those cost a second query each and only matter for the ONE he
 *  picks, which is when they load. */
export interface ClosureListItem extends ClosureRow {
  hasGps: boolean;
}

const STRUCTURE_SHORT: Record<string, string> = {
  mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
};

/**
 * One line in the dropdown. Short enough for a phone, specific enough to pick
 * from, and the code comes first because that is what a man is hunting for —
 * Austin, 8/25: *"a drop down where we can just click on lumen-003."*
 *
 * "no GPS" is called out rather than left blank. A closure with no GPS is
 * legitimate — two in the live registry have none — but it is also the one that
 * can never be found by standing next to it, so the list is the only way to it.
 */
export function closureOptionLabel(c: ClosureListItem): string {
  return [
    c.closure_code,
    STRUCTURE_SHORT[c.structure_type ?? ''] ?? c.structure_type,
    c.structure_owner,
    c.building_address,
    c.hasGps ? null : 'no GPS',
  ].filter(Boolean).join(' · ');
}
