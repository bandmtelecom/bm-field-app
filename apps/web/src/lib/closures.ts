import { supabase } from './supabase';

/**
 * The closure registry — B&M's permanent list of the closures it has worked.
 *
 * A closure gets ONE code per customer, forever (`Lumen-0042`), with the GPS of
 * the structure it lives in. Return visits attach to the same code, so the
 * closure accumulates a work history the crew can pull up in the field.
 *
 * IMPORTANT (Austin's rule): GPS alone can NEVER identify a closure, because a
 * single hole can hold more than one. Proximity only narrows the candidates —
 * the tech identifies it by matching the CABLES against what's in front of him.
 * So everything here surfaces candidates plus their cables; nothing auto-picks.
 */

/** How far out we look for candidates. Generous on purpose: the tech confirms
 *  by cable, so a wide net costs nothing and a narrow one misses real matches
 *  whenever phone GPS drifts. */
export const CANDIDATE_RADIUS_FT = 150;

/**
 * How far the BROWSE screen looks. Different job entirely from the picker
 * radius above: that one asks "which closure am I standing on", this one is a
 * hunting tool. Austin, 8/20: Lumen hands the crew the wrong splice closure
 * often enough that being able to widen the net — to find the cable you need
 * when you're building a ring or chasing an LOR — is worth real money.
 */
export const BROWSE_RADII_FT = [
  { ft: 500,   label: '500 ft' },
  { ft: 1000,  label: '1,000 ft' },
  { ft: 2000,  label: '2,000 ft' },
  { ft: 3000,  label: '3,000 ft' },
  { ft: 5280,  label: '1 mile' },
  { ft: 10560, label: '2 miles' },
] as const;

/** Compass bearing from point 1 to point 2, as a 16-point label. */
export function bearingLabel(
  lat1: number, lng1: number, lat2: number, lng2: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  const points = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return points[Math.round(((deg + 360) % 360) / 22.5) % 16];
}

/** "1,340 ft NE" / "0.4 mi SW" — how a splicer would say where to go. */
export function distanceLabel(ft: number, bearing?: string): string {
  const d = ft >= 1000
    ? `${(ft / 5280).toFixed(ft >= 5280 ? 1 : 2)} mi`
    : `${Math.round(ft)} ft`;
  return bearing ? `${d} ${bearing}` : d;
}

export interface ClosureRow {
  id: string;
  closure_code: string;
  structure_type: string | null;
  structure_owner: string | null;
  building_address: string | null;
  enclosure_model: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  created_at?: string;
}

export interface CableRow {
  direction: string | null;
  count: string | null;
  manufacturer: string | null;
  date_code: string | null;
  footage: number | null;
  role: string | null;
}

export interface ClosureCandidate extends ClosureRow {
  distanceFt: number | null;
  /** compass direction from where the tech is standing — for hunting */
  bearing: string | null;
  cables: CableRow[];
  lastWorked: string | null;
  visitCount: number;
}

const FT_PER_M = 3.28084;

/** Great-circle distance in feet. */
export function distanceFt(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000; // metres
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a)) * FT_PER_M;
}

/** Attach cables + how often it's been worked to a set of closures. */
async function decorate(rows: ClosureRow[]): Promise<ClosureCandidate[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);

  // every location ever logged against these closures, newest first
  const { data: locs } = await supabase
    .from('locations')
    .select('id, closure_id, created_at, cables(direction, count, manufacturer, date_code, footage, role), visits(visit_date)')
    .in('closure_id', ids)
    .order('created_at', { ascending: false });

  const byClosure = new Map<string, any[]>();
  for (const l of (locs as any[]) ?? []) {
    const list = byClosure.get(l.closure_id) ?? [];
    list.push(l);
    byClosure.set(l.closure_id, list);
  }

  return rows.map((r) => {
    const list = byClosure.get(r.id) ?? [];
    // cables from the most recent visit that actually recorded any
    const withCables = list.find((l) => (l.cables ?? []).length > 0);
    const dates = list
      .map((l) => l.visits?.visit_date)
      .filter(Boolean)
      .sort()
      .reverse();
    return {
      ...r,
      distanceFt: null,
      bearing: null,
      cables: (withCables?.cables ?? []) as CableRow[],
      lastWorked: dates[0] ?? null,
      visitCount: list.length,
    };
  });
}

/**
 * Closures near a point, for one customer — the candidate list a tech picks
 * from. Sorted nearest first. Never decides; the tech matches by cable.
 */
export async function closuresNear(
  customerId: string,
  lat: number,
  lng: number,
  radiusFt = CANDIDATE_RADIUS_FT,
  limit = 60,
): Promise<ClosureCandidate[]> {
  // cheap bounding box first so the database doesn't hand back the whole state
  const degLat = radiusFt / 364000;                                  // ~ft per degree lat
  const degLng = radiusFt / (364000 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  const { data } = await supabase
    .from('closures')
    .select('id, closure_code, structure_type, structure_owner, building_address, enclosure_model, gps_lat, gps_lng, created_at')
    .eq('customer_id', customerId)
    .not('gps_lat', 'is', null)
    .gte('gps_lat', lat - degLat).lte('gps_lat', lat + degLat)
    .gte('gps_lng', lng - degLng).lte('gps_lng', lng + degLng);

  const near = ((data as any[]) ?? [])
    .map((c) => ({ ...c, d: distanceFt(lat, lng, Number(c.gps_lat), Number(c.gps_lng)) }))
    .filter((c) => c.d <= radiusFt)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);   // a 2-mile sweep downtown could otherwise be endless

  const decorated = await decorate(near);
  return decorated.map((c, i) => ({
    ...c,
    distanceFt: Math.round(near[i].d),
    bearing: bearingLabel(lat, lng, Number(near[i].gps_lat), Number(near[i].gps_lng)),
  }));
}

/** Look a closure up by code — the office path when back-entering paper reports. */
export async function searchClosures(q: string, customerId?: string): Promise<ClosureCandidate[]> {
  const term = q.trim();
  if (!term) return [];
  let query = supabase
    .from('closures')
    .select('id, closure_code, structure_type, structure_owner, building_address, enclosure_model, gps_lat, gps_lng, created_at')
    .ilike('closure_code', `%${term}%`)
    .order('closure_code')
    .limit(25);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data } = await query;
  return decorate(((data as any[]) ?? []) as ClosureRow[]);
}

export interface ClosureVisit {
  locationId: string;
  visitDate: string | null;
  techs: string[];
  bmNumber: string | null;
  billingMode: string | null;
  customerName: string | null;
  caseAction: string | null;
  spliceType: string | null;
  spliceCount: number;
  traysAdded: number;
  testFiberCount: number;
  asFound: string | null;
  asBuilt: string | null;
  narrative: string | null;
  cables: CableRow[];
}

/** Everything B&M has ever done at one closure, newest first. */
export async function closureHistory(closureId: string): Promise<ClosureVisit[]> {
  const { data } = await supabase
    .from('locations')
    .select(`
      id, case_action, splice_type, splice_count, trays_added, test_fiber_count,
      as_found, as_built, narrative,
      cables(direction, count, manufacturer, date_code, footage, role),
      visits(visit_date, techs, jobs(bm_number, billing_mode, customers(name)))
    `)
    .eq('closure_id', closureId);

  const rows = ((data as any[]) ?? []).map((l) => ({
    locationId: l.id,
    visitDate: l.visits?.visit_date ?? null,
    techs: (l.visits?.techs ?? []) as string[],
    bmNumber: l.visits?.jobs?.bm_number ?? null,
    billingMode: l.visits?.jobs?.billing_mode ?? null,
    customerName: l.visits?.jobs?.customers?.name ?? null,
    caseAction: l.case_action,
    spliceType: l.splice_type,
    spliceCount: l.splice_count ?? 0,
    traysAdded: l.trays_added ?? 0,
    testFiberCount: l.test_fiber_count ?? 0,
    asFound: l.as_found,
    asBuilt: l.as_built,
    narrative: l.narrative,
    cables: (l.cables ?? []) as CableRow[],
  }));

  return rows.sort((a, b) => (b.visitDate ?? '').localeCompare(a.visitDate ?? ''));
}

export async function getClosure(id: string): Promise<ClosureRow | null> {
  const { data } = await supabase
    .from('closures')
    .select('id, closure_code, structure_type, structure_owner, building_address, enclosure_model, gps_lat, gps_lng, created_at')
    .eq('id', id).single();
  return (data as any) ?? null;
}

/** One-line summary of a cable, the way a splicer would say it. */
export function cableLabel(c: CableRow): string {
  // Since 8/25 the form types count, date code and footage into `count` as one
  // string. Older rows have them split across columns, so join whatever exists.
  // This is what the tech reads while deciding which closure he is standing on,
  // so it has to look right for a cable logged last week and one logged today.
  const spec = [
    c.count,
    c.date_code,
    c.footage ? `${c.footage} ft` : null,
    c.role,
  ].map((x) => (x ?? '').toString().trim()).filter(Boolean).join(' · ');

  const head = [c.direction, c.manufacturer].map((x) => (x ?? '').trim()).filter(Boolean).join(' · ');
  if (head && spec) return `${head} — ${spec}`;
  return head || spec || 'cable';
}
