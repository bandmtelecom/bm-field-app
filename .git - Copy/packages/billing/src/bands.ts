// Band selection — the count made at a location picks the rate-card band.

/** Single-fusion band by number of splices made. */
export function singleFusionBand(count: number): string {
  if (count <= 4) return 'FUSION_1_4';
  if (count <= 12) return 'FUSION_5_12';
  if (count <= 24) return 'FUSION_13_24';
  if (count <= 48) return 'FUSION_25_48';
  if (count <= 144) return 'FUSION_49_144';
  if (count <= 288) return 'FUSION_145_288';
  if (count <= 432) return 'FUSION_289_432';
  if (count <= 864) return 'FUSION_433_864';
  return 'FUSION_GT_864';
}

/** Ribbon band by number of RIBBONS (1 ribbon = 12 fibers). Billed per ribbon. */
export function ribbonBand(ribbons: number): string {
  if (ribbons <= 2) return 'RIBBON_LE2';
  if (ribbons <= 12) return 'RIBBON_3_12';
  if (ribbons <= 24) return 'RIBBON_13_24';
  if (ribbons <= 36) return 'RIBBON_25_36';
  if (ribbons <= 72) return 'RIBBON_37_72';
  if (ribbons <= 144) return 'RIBBON_73_144';
  return 'RIBBON_145_288'; // highest band on the card
}

/** OTDR / power-meter test band by fiber count. */
export function otdrTestBand(count: number): string {
  if (count <= 4) return 'TEST_OTDR_1_4';
  if (count <= 12) return 'TEST_OTDR_5_12';
  if (count <= 24) return 'TEST_OTDR_13_24';
  if (count <= 48) return 'TEST_OTDR_25_48';
  if (count <= 144) return 'TEST_OTDR_49_144';
  if (count <= 288) return 'TEST_OTDR_145_288';
  if (count <= 432) return 'TEST_OTDR_289_432';
  return 'TEST_OTDR_GT_432';
}

/** Bare-fiber test band by fiber count. */
export function bareTestBand(count: number): string {
  if (count <= 4) return 'TEST_BARE_1_4';
  if (count <= 12) return 'TEST_BARE_5_12';
  if (count <= 24) return 'TEST_BARE_13_24';
  if (count <= 48) return 'TEST_BARE_25_48';
  if (count <= 144) return 'TEST_BARE_49_144';
  if (count <= 288) return 'TEST_BARE_145_288';
  if (count <= 432) return 'TEST_BARE_289_432';
  return 'TEST_BARE_GT_432';
}
