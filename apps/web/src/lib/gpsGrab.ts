// The GPS Grab button — listen, keep the best reading, then stop.
//
// Why this exists (10/27, job 26-448 Location 2): Grab saved a point 300-400 ft
// from the hole. The old code called getCurrentPosition() once and took the
// FIRST answer the phone gave. A phone's first answer usually comes from cell
// towers and Wi-Fi while the satellites are still locking in, and it can be
// hundreds of feet off. The app never looked at how good the reading was.
//
// Now: watch the position for up to MAX_WAIT_MS, keep the reading with the
// smallest accuracy radius, stop early once it is GOOD_FT or better, and hand
// back the accuracy so the screen can show "±12 ft" and warn when it is rough.
//
// Pure helpers sit at the top so tests can import them without a browser.

export const M_TO_FT = 3.28084;
/** Stop listening as soon as a reading is this good. */
export const GOOD_FT = 16;
/** Above this, tell the tech the point is rough and to grab again. */
export const ROUGH_FT = 50;
/** Never listen longer than this. */
export const MAX_WAIT_MS = 20000;

export interface Fix { lat: number; lng: number; accuracyFt: number; }

export function toFix(c: { latitude: number; longitude: number; accuracy: number }): Fix {
  return { lat: c.latitude, lng: c.longitude, accuracyFt: c.accuracy * M_TO_FT };
}

/** Keep whichever reading has the smaller accuracy radius. */
export function better(a: Fix | null, b: Fix): Fix {
  if (!a) return b;
  return b.accuracyFt < a.accuracyFt ? b : a;
}

export function isGoodEnough(f: Fix | null): boolean {
  return !!f && f.accuracyFt <= GOOD_FT;
}

export function isRough(f: Fix | null): boolean {
  return !!f && f.accuracyFt > ROUGH_FT;
}

/** "±12 ft" — rounded, never "±0". */
export function accuracyLabel(ft: number): string {
  return `±${Math.max(1, Math.round(ft))} ft`;
}

/** What the screen says under the GPS boxes after a grab. */
export function fixMessage(f: Fix): string {
  const acc = accuracyLabel(f.accuracyFt);
  if (isRough(f)) {
    return `GPS is rough (${acc}). Step out from under steel or trees, give it a few seconds, and tap Grab again.`;
  }
  return `GPS good to ${acc}.`;
}

export const fmt = (n: number) => n.toFixed(6);

/**
 * Listen to the phone's GPS, report each improving reading through onProgress,
 * and resolve with the best one. Rejects only if the phone gives nothing at all.
 * Call the returned cancel() to stop early (e.g. the tech leaves the screen).
 */
export function grabBestFix(
  onProgress?: (best: Fix) => void,
  maxWaitMs = MAX_WAIT_MS,
): { done: Promise<Fix>; cancel: () => void } {
  let cancel = () => {};
  const done = new Promise<Fix>((resolve, reject) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) { reject(new Error('no-geolocation')); return; }

    let best: Fix | null = null;
    let finished = false;
    let lastErr: GeolocationPositionError | null = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      geo.clearWatch(id);
      clearTimeout(timer);
      if (best) resolve(best);
      else reject(lastErr ?? new Error('no-fix'));
    };

    const id = geo.watchPosition(
      (p) => {
        const f = toFix(p.coords);
        const next = better(best, f);
        if (next !== best) { best = next; onProgress?.(best); }
        if (isGoodEnough(best)) finish();
      },
      (e) => {
        lastErr = e;
        // Permission denied will never get better — stop now.
        if (e.code === 1) finish();
      },
      // maximumAge 0: never reuse a stale fix from the last hole.
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
    );
    const timer = setTimeout(finish, maxWaitMs);
    cancel = finish;
  });
  return { done, cancel };
}
