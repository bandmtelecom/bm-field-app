/**
 * OPGW report maps — the pure geometry, kept free of pdfkit and fetch so it can
 * be tested (see apps/api/test/opgwMap.test.ts).
 *
 * Austin, 10/7: "Just do the main overall map and a little smaller zoomed in
 * shot of the locations that are close togeather." And on why: "great for when
 * a tech has to come back and finish up the work and when buddy puts a test
 * package togeather."
 *
 * The maps are Web Mercator, the projection every street map uses, so a pin
 * drawn from this math sits on the same spot as the map image under it.
 */

export interface MapPin {
  /** What prints in the circle: "1", "2", … for splices; "T1", "T2" for test points. */
  label: string;
  /** What the close-up caption calls it: "36/3B", "Shankle sub". */
  name: string;
  lat: number;
  lng: number;
  kind: 'splice' | 'test';
}

export interface MapView {
  centerLat: number;
  centerLng: number;
  zoom: number;
  /** Logical pixel size of the map image (before any @2x scale). */
  width: number;
  height: number;
}

const TILE = 256;

function worldX(lng: number, zoom: number) {
  return ((lng + 180) / 360) * TILE * 2 ** zoom;
}
function worldY(lat: number, zoom: number) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** zoom;
}

/** Where a lat/lng lands on the image, in the image's logical pixels. */
export function project(view: MapView, lat: number, lng: number): { x: number; y: number } {
  return {
    x: worldX(lng, view.zoom) - worldX(view.centerLng, view.zoom) + view.width / 2,
    y: worldY(lat, view.zoom) - worldY(view.centerLat, view.zoom) + view.height / 2,
  };
}

/**
 * The tightest whole zoom that fits every pin inside the image with `pad`
 * pixels to spare on each side. Whole zooms only — that is what the map
 * services draw crisply.
 */
export function fitView(
  pins: { lat: number; lng: number }[],
  width: number,
  height: number,
  opts: { pad?: number; maxZoom?: number; minZoom?: number } = {},
): MapView {
  const pad = opts.pad ?? 28;
  const maxZoom = opts.maxZoom ?? 16;
  const minZoom = opts.minZoom ?? 3;
  if (!pins.length) return { centerLat: 32.7, centerLng: -97.1, zoom: 7, width, height };

  const lats = pins.map((p) => p.lat), lngs = pins.map((p) => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  let zoom = maxZoom;
  for (; zoom > minZoom; zoom--) {
    const w = worldX(maxLng, zoom) - worldX(minLng, zoom);
    const h = worldY(minLat, zoom) - worldY(maxLat, zoom);
    if (w <= width - 2 * pad && h <= height - 2 * pad) break;
  }
  // Center on the middle of the box in projected space, not in degrees —
  // on a long north-south line the difference is visible.
  const cx = (worldX(minLng, zoom) + worldX(maxLng, zoom)) / 2;
  const cy = (worldY(minLat, zoom) + worldY(maxLat, zoom)) / 2;
  const scale = TILE * 2 ** zoom;
  const centerLng = (cx / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * cy) / scale;
  const centerLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { centerLat, centerLng, zoom, width, height };
}

/**
 * The groups of pins that would sit on top of each other on the main map —
 * each one gets its own close-up.
 *
 * Leader clustering, not "anything within reach of anything": a pin joins a
 * group only if it is close to that group's FIRST pin. Chaining (A near B near
 * C near … all the way down a dense line) would turn the whole line into one
 * "close-up" the size of the main map.
 *
 * Returned in line order (by the first pin in each group), only groups of two
 * or more. Single pins print on the main map as they are.
 */
export function crowdedGroups(view: MapView, pins: MapPin[], radiusPx = 26): MapPin[][] {
  const groups: { leader: { x: number; y: number }; pins: MapPin[] }[] = [];
  for (const p of pins) {
    const xy = project(view, p.lat, p.lng);
    const g = groups.find((gr) => Math.hypot(gr.leader.x - xy.x, gr.leader.y - xy.y) < radiusPx);
    if (g) g.pins.push(p);
    else groups.push({ leader: xy, pins: [p] });
  }
  return groups.filter((g) => g.pins.length > 1).map((g) => g.pins);
}

/**
 * Spread pins that are still on top of each other at close-up zoom (33/2A and
 * Ennis Pump Tap on 25-497 are inches apart — no zoom separates them). Each
 * pin in a stack moves out around the stack's centre; the caller draws a short
 * line from the pin back to its true spot.
 */
export function spreadPins(
  points: { x: number; y: number }[],
  minGap = 24,
): { x: number; y: number }[] {
  const out = points.map((p) => ({ ...p }));
  const used = new Array(points.length).fill(false);
  for (let i = 0; i < points.length; i++) {
    if (used[i]) continue;
    const stack = [i];
    for (let j = i + 1; j < points.length; j++) {
      if (!used[j] && Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y) < minGap) stack.push(j);
    }
    if (stack.length < 2) continue;
    stack.forEach((k) => (used[k] = true));
    const cx = stack.reduce((s, k) => s + points[k].x, 0) / stack.length;
    const cy = stack.reduce((s, k) => s + points[k].y, 0) / stack.length;
    const r = Math.max(minGap * 0.75, (minGap * stack.length) / (2 * Math.PI));
    stack.forEach((k, n) => {
      const a = -Math.PI / 2 + (2 * Math.PI * n) / stack.length;
      out[k] = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    });
  }
  return out;
}

/** "A", "B", … "Z", "AA" — the close-up letters. */
export function groupLetter(i: number): string {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/**
 * The Google Static Maps URL for a view. scale=2 for a sharp print; the image
 * comes back at twice `width`×`height` and is drawn into the same box.
 * Google caps the logical size at 640 per side.
 */
export function staticMapUrl(view: MapView, key: string, maptype: 'roadmap' | 'satellite' | 'hybrid' = 'roadmap'): string {
  const w = Math.min(640, Math.round(view.width));
  const h = Math.min(640, Math.round(view.height));
  const q = new URLSearchParams({
    center: `${view.centerLat.toFixed(6)},${view.centerLng.toFixed(6)}`,
    zoom: String(view.zoom),
    size: `${w}x${h}`,
    scale: '2',
    maptype,
    key,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${q.toString()}`;
}

/** A Google Maps directions link to a spot — the ROW entrance on the report. */
export function directionsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}
