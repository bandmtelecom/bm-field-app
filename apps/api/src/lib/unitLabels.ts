/**
 * Plain-English labels for the tap-to-add units, for the customer-facing
 * report. Mirrors EXTRA_UNITS in apps/web/src/lib/options.ts — the customer
 * should never see a code like DEWATERING on a document.
 */
export const EXTRA_UNIT_LABELS: Record<string, string> = {
  DEWATERING: 'Dewatered / pumped the hole',
  EXPOSE_HHMH_12: 'Expose existing HH/MH (≤12in)',
  EXPOSE_HHMH_ADDL: 'Expose — each additional 12in',
  RMV_REPLACE_CASE: 'Remove / replace case',
  PREP_HOUSING: 'Prep cable in housing',
  FIBER_ADD_EXIST: 'Add fiber to existing case',
  FIBER_TRANSFER_TUBE: 'Fiber transfer tube',
  TERM_PANEL_OSP: 'Termination panel OSP — add',
  RMV_TERM_PANEL_OSP: 'Termination panel OSP — remove',
  GROUND_BRACKET_KIT: 'Ground bracket kit',
  TEST_CD_PMD: 'CD / PMD test adder',
};
