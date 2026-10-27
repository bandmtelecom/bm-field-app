import type { LocationInput } from '@bm/billing';

/**
 * A second enclosure in the same hole (migration 0016) shares that hole's ONE
 * setup/teardown and still bills its own re-enter and splices — the 26-356
 * rule (Lumen-0056 + Lumen-0057: two closures, one manhole, one setup).
 *
 * The engine groups holes by hole_ref, else structure@GPS (holeKeyOf in
 * packages/billing). This gives each second enclosure exactly the key the
 * first enclosure in its hole gets, so a missing or mistyped GPS on either one
 * can never bill the hole twice. Call it per visit: a different night is a
 * different setup, as it always was. Mutates `locs` in place.
 *
 * Same key formula as the engine's holeKeyOf — keep the two in step.
 */
export function shareEnclosureHoles(locs: LocationInput[], enclosureOf: Map<string, string>): void {
  const naturalKey = (li: LocationInput) =>
    li.holeKey ?? (li.gpsLat != null && li.gpsLng != null
      ? `${li.structureType}@${li.gpsLat.toFixed(5)},${li.gpsLng.toFixed(5)}`
      : `loc:${li.id}`);
  const byId = new Map(locs.map((l) => [l.id, l]));
  const keys = new Map<string, string>();
  for (const li of locs) {
    // walk up to the first enclosure in the hole (on this visit)
    let top: LocationInput | undefined;
    let target = enclosureOf.get(li.id);
    const seen = new Set<string>([li.id]);
    while (target && !seen.has(target)) {
      seen.add(target);
      const t = byId.get(target);
      if (!t) break;
      top = t;
      target = enclosureOf.get(t.id);
    }
    if (top) keys.set(li.id, naturalKey(top));
  }
  for (const li of locs) {
    const k = keys.get(li.id);
    if (k) li.holeKey = k;
  }
}
