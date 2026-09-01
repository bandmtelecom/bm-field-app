export type Role = 'tech' | 'office' | 'admin';
export type StructureType = 'mh' | 'hh' | 'aerial' | 'building';
export type CaseAction = 'reenter' | 'new_case' | 'midsheath';
export type SpliceType = 'single' | 'ribbon';

export interface Profile {
  id: string; full_name: string | null; initials: string | null;
  role: Role; is_active: boolean;
}

export interface Job {
  id: string; bm_number: string; customer_id: string;
  identifier: string | null; identifier_type: string;
  title: string | null; billing_mode: 'capital' | 'emergency';
  status: 'open' | 'complete' | 'reopened' | 'invoiced';
  customer?: { name: string; code: string };
}

export interface Visit {
  id: string; job_id: string; visit_date: string; report_type: string;
  techs: string[]; narrative: string | null; status_flag: string | null;
  lead_hours: number | null; reporter_id: string | null;
}

export const STRUCTURE_LABELS: Record<StructureType, string> = {
  mh: 'Manhole', hh: 'Handhole', aerial: 'Aerial', building: 'Building',
};

/**
 * What a location is called, everywhere — the running record, the detail panel
 * and the customer's PDF all have to agree.
 *
 * There is ONE number and it is the tech's. Austin, 9/1: *"the only location
 * number that goes on the report should be what the tech puts in"* — and when
 * he puts nothing in, the database fills the next one in line (migration 0013),
 * which lands in the same box and the office can change it afterwards.
 *
 * `job_location_no` is internal bookkeeping now and only stands in for rows
 * filed before 0013 that somehow escaped the backfill.
 *
 * The word "Location" goes in front of a plain number and nowhere else. The
 * techs also type names into that box — "1950 Stemmons", "West", "Wayne ILA" —
 * and "Location 1950 Stemmons" reads like a mistake on a customer's report.
 */
export function locationNumberLabel(l: {
  job_location_no?: number | null;
  pm_location_no?: string | null;
}): string {
  const typed = (l.pm_location_no ?? '').trim();
  const no = typed || (l.job_location_no != null ? String(l.job_location_no) : '');
  if (!no) return 'Location';
  return /^\d+$/.test(no) ? `Location ${no}` : no;
}

/**
 * The whole label: the number, then WHERE it was, then whether it was a return
 * trip. `Location 2 · 1950 Stemmons`, or just `Location 2` on a hole.
 *
 * Austin, 9/1: *"i still want to have the address if that where we went."* The
 * address has always been recorded — it just never reached the top line, so
 * crews were typing "1950 Stemmons" into the number box to get it onto the
 * report, which is how one box ended up doing three jobs. The number says which
 * location; the address says where; neither has to pretend to be the other.
 */
export function locationTitle(l: {
  job_location_no?: number | null;
  pm_location_no?: string | null;
  building_address?: string | null;
  revisit_of?: string | null;
}): string {
  return [
    locationNumberLabel(l),
    (l.building_address ?? '').trim() || null,
    l.revisit_of ? 'revisit' : null,
  ].filter(Boolean).join(' · ');
}

// Partial leads deliberately: a tech who is not paying attention should leave
// the job OPEN, not closed. Closing is the destructive direction.
export const STATUS_FLAGS = [
  ['partial_return', 'Partial — return needed'],
  ['complete', 'Complete'],
  ['ready_to_test', 'Ready to test'],
  ['could_not_access', 'Could not access'],
  ['troubleshooting', 'Troubleshooting / ongoing'],
] as const;
