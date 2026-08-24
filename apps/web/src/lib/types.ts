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

// Partial leads deliberately: a tech who is not paying attention should leave
// the job OPEN, not closed. Closing is the destructive direction.
export const STATUS_FLAGS = [
  ['partial_return', 'Partial — return needed'],
  ['complete', 'Complete'],
  ['ready_to_test', 'Ready to test'],
  ['could_not_access', 'Could not access'],
  ['troubleshooting', 'Troubleshooting / ongoing'],
] as const;
