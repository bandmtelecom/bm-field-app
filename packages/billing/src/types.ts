// Engine input/output types. The API builds a JobInput from the database rows,
// runs computeInvoice(), and writes the returned draft. Techs never see any of
// the dollar fields here — this module runs server-side only.

export type StructureType = 'mh' | 'hh' | 'aerial' | 'building';
export type CaseAction = 'reenter' | 'new_case' | 'midsheath';
export type SpliceType = 'single' | 'ribbon';
export type BillingMode = 'capital' | 'emergency';
export type TestType = 'otdr' | 'bare';

export interface ExtraUnit {
  code: string;        // a rate_card.code the tech tapped (civil, case work, material)
  qty?: number;        // default 1
  note?: string;
}

export interface LocationInput {
  id: string;
  closureCode?: string;             // e.g. 'Lumen-0042' — for the audit source
  structureType: StructureType;
  holeKey?: string;                 // closures sharing a hole share ONE setup; falls back to GPS/id
  gpsLat?: number;
  gpsLng?: number;
  caseAction?: CaseAction | null;
  enclosureNew?: boolean;
  spliceType?: SpliceType | null;
  spliceCount?: number;             // single = # splices; ribbon = # ribbons
  testFiberCount?: number;          // # fibers shot/tested (only bills on test-only jobs)
  testType?: TestType;              // default 'otdr'
  downtimeHours?: number;           // total downtime logged at this location
  /** The men who worked THIS hole. Downtime bills per tech against this list.
   *  Empty on rows filed before 8/28/26 — the engine falls back to the visit
   *  crew for those. See the note on downtime in engine.ts. */
  techs?: string[];
  newCaseMaterialCode?: string;     // rate_card.code for the physical case, when new_case
  traysAdded?: number;
  trayMaterialCode?: string;        // inferred from enclosure + single/ribbon
  extraUnits?: ExtraUnit[];         // tap-to-add checklist items
}

export interface VisitInput {
  id: string;
  date: string;
  /** Lead-tech clocker hours. Recorded for the job history; does NOT bill —
   *  the units cover on-site working time on capital AND emergency jobs. */
  leadHours?: number;
  /** Everybody who worked this report. Kept as history and as the fallback
   *  crew for locations filed before the crew moved onto the location (8/28/26).
   *  Travel is counted from the distinct techs across the whole job, not from
   *  this list per visit — a crew that files two reports in one night made one
   *  trip, not two. */
  techs?: string[];
  locations: LocationInput[];
}

export interface JobInput {
  bmNumber: string;
  billingMode: BillingMode;
  /** Scheduled maintenance window (night work) — adds the per-splice maint adder
   *  to every splice line. Capital jobs only; emergency/LOR bills hourly and
   *  never reaches the adder, so a night LOR can't pick it up. */
  maintWindow?: boolean;
  /** Emergency/LOR that was scheduled ahead rather than rolled out on.
   *  Kills the unit 223 travel hours; downtime still bills under 223. */
  scheduledAhead?: boolean;
  visits: VisitInput[];
}

export interface InvoiceLine {
  unitCode: string;
  description: string;
  quantity: number;
  rate: number;
  extended: number;
  source: string;                   // WHY this line exists (closure / visit) — for audit
}

export interface InvoiceDraft {
  bmNumber: string;
  billingMode: BillingMode;
  lines: InvoiceLine[];
  subtotal: number;
  total: number;                    // tax is already baked into the rate-card rates
}
