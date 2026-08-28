/**
 * Number boxes in the field form are typed by hand, in a hole, at 2am.
 * The crew writes the unit with the number: "0.2 km", "22.46 kilometers",
 * "15,044'", "3 hrs". That is how they write and it is not going to change.
 *
 * `Number("0.2 km")` is NaN. NaN is not valid JSON, so JSON.stringify turns it
 * into null on the way to Supabase and the insert SUCCEEDS — the value is
 * simply gone when you reopen the location. With `Number(x) || 0` it lands as a
 * silent zero instead, which on a billing field is money off the invoice.
 *
 * So: parse what they typed. Never reject it, never silently drop it.
 */

/**
 * Pull the first number out of whatever was typed.
 *   null      -> the box was empty
 *   undefined -> there was text but no number in it ("see notes")
 */
export function parseNum(s: unknown): number | null | undefined {
  const raw = s == null ? '' : String(s).trim();
  if (raw === '') return null;
  const cleaned = raw
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1')   // 15,044' -> 15044 (thousands separator)
    .replace(',', '.');                        // 22,46   -> 22.46 (decimal comma)
  // The `\.\d+` branch is why ".20 km" parses as 0.2 and not 20 — a distance
  // wrong by 100x is worse than a blank one, and the crew does write it that way.
  const m = cleaned.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/** For nullable columns: unreadable or empty both become null. */
export const numOrNull = (s: unknown): number | null => parseNum(s) ?? null;

/** For NOT NULL billing counters: unreadable or empty both become 0. */
export const numOr0 = (s: unknown): number => parseNum(s) ?? 0;

/** True when the box has text in it but no number anywhere — for a warn-before-save. */
export const isUnreadableNum = (s: unknown): boolean => parseNum(s) === undefined;
