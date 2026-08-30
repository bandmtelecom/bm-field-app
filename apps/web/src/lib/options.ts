// Static option lists for the field form. NO PRICES here — techs never see
// dollars. The `code` values map to rate_card.code on the back end, where the
// billing engine attaches the price. Labels are what the tech sees.

type StructureCode = 'mh' | 'hh' | 'aerial' | 'building';

export const ENCLOSURE_MODELS = [
  '450D', '450B', '600D', 'Windsor', '12 Stainless', '12 Stainless Stretch',
  '6in Dome', '8.5in Dome', 'Other',
];

export const STRUCTURE_OWNERS = [
  'Level 3', 'CenturyLink', 'Communication', 'Time Warner', 'Fiberlight', 'Unmarked',
];

export const MANUFACTURERS = [
  'Corning', 'Prysmian', 'OFS', 'Draka', 'Sumitomo', 'Pirelli', 'Teldor', 'Other',
];

export const DOWNTIME_REASONS = [
  ['troubleshooting', 'Troubleshooting / DT'],
  ['waiting_construction', 'Waiting on construction'],
  ['waiting_customer', 'Waiting on customer / engineer'],
  ['access', 'Access / gate delay'],
  ['locate', 'Locate / permit'],
  ['traffic', 'Traffic control'],
  ['equipment', 'Equipment'],
  ['weather', 'Weather'],
  ['other', 'Other'],
] as const;

// New-case physical case options (code → label). No prices shown.
export const CASE_MATERIALS: { code: string; label: string }[] = [
  { code: 'CASE_AER_B', label: 'Aerial B — 9.8x24 gel' },
  { code: 'CASE_AER_D_1130', label: 'Aerial D — 11.5x30 (36 tray)' },
  { code: 'CASE_AER_D_1133', label: 'Aerial D — 11x33 (36 tray)' },
  { code: 'CASE_UG_B', label: 'UG B — 9.8x24 gel' },
  { code: 'CASE_UG_D_1130', label: 'UG D — 11.5x30 (36 tray)' },
  { code: 'CASE_UG_D_1133', label: 'UG D — 11x33 (36 tray)' },
];

// Tap-to-add closure/civil work (code → label). No prices.
//   only — show this button only for these structure types (omit = always show)
//   qty  — after tapping it on, ask for a count (bills qty × the unit); omit = bills 1
export const EXTRA_UNITS: {
  code: string; label: string; only?: StructureCode[]; qty?: { label: string; hint?: string };
}[] = [
  { code: 'DEWATERING', label: 'Dewatered / pumped the hole' },
  { code: 'EXPOSE_HHMH_12', label: 'Expose existing HH/MH (≤12in)' },
  { code: 'EXPOSE_HHMH_ADDL', label: 'Expose — each additional 12in' },
  { code: 'RMV_REPLACE_CASE', label: 'Remove / replace case' },
  { code: 'PREP_HOUSING', label: 'Prep cable in housing' },
  { code: 'FIBER_ADD_EXIST', label: 'Add fiber to existing case' },
  { code: 'FIBER_TRANSFER_TUBE', label: 'Fiber transfer tube' },
  { code: 'TERM_PANEL_OSP', label: 'Termination panel OSP — add' },
  { code: 'RMV_TERM_PANEL_OSP', label: 'Termination panel OSP — remove' },
  { code: 'GROUND_BRACKET_KIT', label: 'Ground bracket kit' },
  // Building / FQA only — rate card unit 250, billed per fiber.
  {
    code: 'TEST_CD_PMD', label: 'CD / PMD test adder', only: ['building'],
    qty: { label: 'Fibers CD/PMD tested', hint: 'How many fibers got the CD/PMD test' },
  },
];

// Tray material inferred from enclosure model + single/ribbon.
/**
 * Which priced case row an enclosure model corresponds to.
 *
 * The card carries each case in an aerial and an underground version of the
 * same size, so the model gives the SIZE and the structure the tech already
 * picked gives which side of the pair to bill.
 *
 * All of this is Austin's, confirmed 8/30/26 — none of it is inferred from the
 * model names. Guessing this kind of mapping is how trays ended up on unit 171
 * instead of 173 back in August.
 *
 *   450B → B  9.8x24 gel, no tray   unit 63 UG / 17 aerial
 *   450D → D  11.5x30, 36 tray      unit 65 UG / 19 aerial
 *   600D → D  11x33, 36 tray        unit 68 UG / 22 aerial
 *
 * The rest of ENCLOSURE_MODELS — Windsor, the stainless, the domes — are
 * deliberately absent. Austin, 8/30: "the other closure are not ones that we
 * put on just ones that we want to document for lumen." B&M does not install
 * them, so they must never bill a case. They are there to describe what the
 * crew found in the hole.
 *
 * A null is not a failure. It means the crew picks the case from the dropdown,
 * exactly as they always have.
 */
const CASE_BY_MODEL: Record<string, { ug: string; aer: string }> = {
  '450b': { ug: 'CASE_UG_B', aer: 'CASE_AER_B' },
  '450d': { ug: 'CASE_UG_D_1130', aer: 'CASE_AER_D_1130' },
  '600d': { ug: 'CASE_UG_D_1133', aer: 'CASE_AER_D_1133' },
};

export function inferCaseMaterial(
  enclosure: string, structureType: StructureCode,
): string | null {
  const row = CASE_BY_MODEL[(enclosure || '').trim().toLowerCase()];
  if (!row) return null;
  // Aerial is the only one that takes the AER row. A building bills the
  // underground version — Austin, 8/30/26 — so mh, hh and building all land on
  // the same side of the pair.
  return structureType === 'aerial' ? row.aer : row.ug;
}

export function inferTrayMaterial(enclosure: string, spliceType: string | null): string | null {
  const e = (enclosure || '').toLowerCase();
  if (e.includes('450')) return 'TRAY_450B_24';
  if (e.includes('600')) return spliceType === 'ribbon' ? 'TRAY_600D_24_RBN' : 'TRAY_600D_48';
  return null; // reconciled on the back end
}
