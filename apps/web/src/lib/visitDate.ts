/**
 * The visit date — the one date on the report. Every location on a visit is
 * printed under it; a location has no date of its own.
 *
 * Austin, 9/30: jobs that started before the app, and crews with no signal who
 * write it down and enter it the next day, both need the real date, not the
 * day it was typed in. So the date is picked when the visit starts (today by
 * default), and the lead or the office can change it afterwards.
 *
 * Pure — no Supabase import — so the tests can load it.
 */

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day in yyyy-mm-dd, or null. `2026-02-30` is not a day. */
function parse(value: string): Date | null {
  const m = ISO.exec((value ?? '').trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? dt : null;
}

/**
 * What is wrong with this visit date, in words for the screen — or null if it
 * is fine. Both arguments are local yyyy-mm-dd (see todayLocal()).
 *
 * Blank and future dates are refused. Past dates are the whole point.
 */
export function visitDateProblem(value: string, today: string): string | null {
  if (!parse(value)) return 'Pick the date the work was done.';
  if (value.trim() > today) return 'That date is in the future. Pick today or an earlier day.';
  return null;
}

/** True when the date is before today — the screen says so out loud. */
export function isBackdated(value: string, today: string): boolean {
  return !!parse(value) && value.trim() < today;
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `2026-09-29` → `Tue 9/29`. Anything unreadable comes back as it went in. */
export function shortDay(value: string | null | undefined): string {
  const dt = parse(value ?? '');
  if (!dt) return value ?? '';
  return `${DAYS[dt.getDay()]} ${dt.getMonth() + 1}/${dt.getDate()}`;
}
