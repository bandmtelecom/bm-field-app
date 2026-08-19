/**
 * Surgical .xlsx cell patching — no dependencies, no workbook rebuild.
 *
 * An .xlsx is a zip of XML parts. To fill in quantities on the customer's rate
 * card we rewrite ONLY the worksheet part and leave every other part of their
 * file byte-for-byte identical: styles, theme, images, print settings, external
 * links. Formulas are never removed; we only refresh the cached answer Excel
 * shows before it recalculates.
 *
 * The alternative — a spreadsheet library that re-serialises the whole workbook
 * — produced a file Excel called damaged, repaired on open, and stripped the
 * formatting from. Do not go back to that.
 *
 * Kept free of imports so it can be exercised directly against a real sheet.
 */

export const COL_UNIT_NO = 'A';
export const COL_UNIT_RATE = 'J';   // "Total Per Unit" — a formula whose cached value is the rate
export const COL_QTY = 'K';
export const COL_EXTENDED = 'L';    // =J*K

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Map the customer's unit number (column A) to its worksheet row number. */
export function mapUnitRows(sheetXml: string): Map<number, number> {
  const out = new Map<number, number>();
  const rowRe = /<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sheetXml))) {
    const rowNo = Number(m[1]);
    const cell = new RegExp(`<c r="${COL_UNIT_NO}${rowNo}"[^>]*>\\s*<v>([\\d.]+)</v>`).exec(m[2]);
    if (cell) out.set(Math.round(Number(cell[1])), rowNo);
  }
  return out;
}

/** Read a formula cell's cached value — used for the per-unit rate in column J. */
export function cachedValue(sheetXml: string, col: string, row: number): number | null {
  const m = new RegExp(`<c r="${col}${row}"[^>]*>[\\s\\S]*?<v>([\\d.eE+-]+)</v>\\s*</c>`).exec(sheetXml);
  return m ? Number(m[1]) : null;
}

/** Write a number into a cell, keeping whatever style the cell already carries. */
export function setNumber(sheetXml: string, col: string, row: number, value: number): string {
  const selfClosing = new RegExp(`<c r="${col}${row}"([^>]*?)/>`);
  if (selfClosing.test(sheetXml)) {
    return sheetXml.replace(selfClosing, (_s, attrs) => `<c r="${col}${row}"${attrs}><v>${value}</v></c>`);
  }
  const open = new RegExp(`(<c r="${col}${row}"[^>]*>)([\\s\\S]*?)(</c>)`);
  if (open.test(sheetXml)) {
    return sheetXml.replace(open, (_s, a, _body, z) => `${a}<v>${value}</v>${z}`);
  }
  return sheetXml;   // no such cell — leave the sheet alone rather than corrupt it
}

/** Refresh a formula cell's cached answer, keeping its <f> formula intact. */
export function setCachedResult(sheetXml: string, col: string, row: number, value: number): string {
  const open = new RegExp(`(<c r="${col}${row}"[^>]*>)([\\s\\S]*?)(</c>)`);
  return sheetXml.replace(open, (_s, a, body, z) => {
    const f = /<f[^>]*>[\s\S]*?<\/f>|<f[^>]*\/>/.exec(body);
    return `${a}${f ? f[0] : ''}<v>${value}</v>${z}`;
  });
}

export interface PatchResult {
  xml: string;
  total: number;
  filled: number;
  missingUnitNos: number[];
}

/**
 * Fill the Quantity column for the given unit numbers and refresh the Extended
 * cells and the bottom TOTAL. `fallbackRate` supplies a per-unit rate when the
 * sheet's own cached value can't be read.
 */
export function patchQuantities(
  sheetXml: string,
  qtyByUnitNo: Map<number, number>,
  fallbackRate: (unitNo: number) => number,
): PatchResult {
  const original = sheetXml;
  const rowByUnit = mapUnitRows(sheetXml);
  const missingUnitNos: number[] = [];
  let total = 0;
  let filled = 0;

  for (const [unitNo, qty] of qtyByUnitNo) {
    const row = rowByUnit.get(unitNo);
    if (row == null) { missingUnitNos.push(unitNo); continue; }
    if (!qty) continue;

    // the card's own per-unit total, so Extended always agrees with the sheet
    const unitRate = cachedValue(original, COL_UNIT_RATE, row) ?? fallbackRate(unitNo);
    const extended = round2(unitRate * qty);

    sheetXml = setNumber(sheetXml, COL_QTY, row, qty);
    sheetXml = setCachedResult(sheetXml, COL_EXTENDED, row, extended);
    total += extended;
    filled++;
  }

  // the TOTAL row sits immediately below the last unit row
  let lastDataRow = 0;
  for (const r of rowByUnit.values()) lastDataRow = Math.max(lastDataRow, r);
  sheetXml = setCachedResult(sheetXml, COL_EXTENDED, lastDataRow + 1, round2(total));

  return { xml: sheetXml, total: round2(total), filled, missingUnitNos };
}

// DELIBERATELY NOT PROVIDED: a helper that sets calcPr fullCalcOnLoad="1".
// Forcing Excel to recalculate on open made it draw a line through every cell
// in the three formula columns (I, J, L) of the customer's rate card. Verified
// 8/19 by A/B test — their untouched file is clean, this patch without the flag
// is clean, the flag alone caused it. The cached values written by
// patchQuantities() are what Excel renders, so the flag was never needed.
// Leave workbook.xml alone.
