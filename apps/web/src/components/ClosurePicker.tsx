import { useEffect, useState } from 'react';
import {
  closuresNear, searchClosures, listClosures, closureWithCables,
  cableLabel, CANDIDATE_RADIUS_FT,
  type ClosureCandidate,
} from '../lib/closures';
import { closureOptionLabel, type ClosureListItem } from '../lib/closureLabel';
import { STRUCTURE_LABELS } from '../lib/types';
import { numOrNull } from '../lib/num';

/**
 * Which closure is this?
 *
 * GPS narrows it down; the TECH decides, by matching the cables on record
 * against what he's looking at in the hole. A hole can hold more than one
 * closure, so proximity alone is never an answer — that's why every candidate
 * shows its cables rather than just a distance.
 *
 * Picking an existing closure attaches this work to that closure's permanent
 * code, which is what builds the history. Picking "New closure" mints a code.
 */
export default function ClosurePicker({
  customerId, lat, lng, selectedId, selectedCode, onSelect,
}: {
  customerId: string | null;
  lat: string;
  lng: string;
  selectedId: string | null;
  selectedCode: string | null;
  onSelect: (id: string | null, code: string | null) => void;
}) {
  const [candidates, setCandidates] = useState<ClosureCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<ClosureCandidate[] | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  /** Every closure on this customer, for the pick-from-the-list dropdown. */
  const [all, setAll] = useState<ClosureListItem[] | null>(null);
  /** The one picked from the list, fetched with its cables so he can check it. */
  const [picked, setPicked] = useState<ClosureCandidate | null>(null);

  // A tech types "35.4 N" into these boxes. Raw Number() turns that into NaN,
  // which quietly switched proximity search off with nothing on screen saying
  // so — the same class of bug as the km values that vanished in August.
  const latN = numOrNull(lat);
  const lngN = numOrNull(lng);
  const hasGps = latN != null && lngN != null;

  // whenever GPS lands (or changes), re-look for candidates
  useEffect(() => {
    let alive = true;
    if (!customerId || latN == null || lngN == null) { setCandidates(null); return; }
    setBusy(true);
    closuresNear(customerId, latN, lngN)
      .then((r) => { if (alive) { setCandidates(r); setBusy(false); } })
      .catch(() => { if (alive) { setCandidates([]); setBusy(false); } });
    return () => { alive = false; };
  }, [customerId, latN, lngN]);

  // The whole list, loaded once. It does not depend on where he is standing —
  // that is the entire point of it.
  useEffect(() => {
    let alive = true;
    if (!customerId) { setAll(null); return; }
    listClosures(customerId)
      .then((r) => { if (alive) setAll(r); })
      .catch((e) => {
        if (alive) setAll([]);
        console.error('could not load the closure list', e);
      });
    return () => { alive = false; };
  }, [customerId]);

  // Whatever is selected, show its cables. That is how a man confirms he picked
  // the right one — GPS never settles it, cables do.
  useEffect(() => {
    let alive = true;
    if (!selectedId) { setPicked(null); return; }
    closureWithCables(selectedId)
      .then((c) => { if (alive) setPicked(c); })
      .catch(() => { if (alive) setPicked(null); });
    return () => { alive = false; };
  }, [selectedId]);

  async function runSearch(q: string) {
    setTerm(q);
    if (q.trim().length < 2) { setResults(null); return; }
    setResults(await searchClosures(q, customerId ?? undefined));
  }

  function Card({ c }: { c: ClosureCandidate }) {
    const on = selectedId === c.id;
    return (
      <button
        type="button"
        onClick={() => onSelect(on ? null : c.id, on ? null : c.closure_code)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', marginTop: 8,
          padding: '10px 12px', cursor: 'pointer', font: 'inherit', color: 'inherit',
          borderRadius: 10,
          border: on ? '2px solid var(--ok)' : '1px solid var(--line)',
          background: on ? 'rgba(46,160,67,.12)' : 'transparent',
        }}
      >
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <strong>{c.closure_code}</strong>
          <span className="small muted">
            {c.distanceFt != null ? `${c.distanceFt} ft away` : ''}
          </span>
        </div>
        <div className="muted small">
          {STRUCTURE_LABELS[c.structure_type as keyof typeof STRUCTURE_LABELS] ?? c.structure_type}
          {c.structure_owner ? ` · ${c.structure_owner}` : ''}
          {c.enclosure_model ? ` · ${c.enclosure_model}` : ''}
        </div>

        {c.cables.length > 0 ? (
          <div style={{ marginTop: 6 }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Cables on record
            </div>
            {c.cables.map((cb, i) => (
              <div key={i} className="small">• {cableLabel(cb)}</div>
            ))}
          </div>
        ) : (
          <div className="muted small" style={{ marginTop: 6 }}>No cables recorded yet</div>
        )}

        <div className="muted small" style={{ marginTop: 6 }}>
          {c.visitCount > 0
            ? `Worked ${c.visitCount} time(s)${c.lastWorked ? `, last ${c.lastWorked}` : ''}`
            : 'Never worked'}
        </div>
      </button>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label>Which closure is this?</label>

      {selectedCode && (
        <div className="small" style={{ color: 'var(--ok)', marginBottom: 4 }}>
          Attaching this work to <strong>{selectedCode}</strong>.
        </div>
      )}

      {!hasGps && (
        <p className="muted small">
          Grab the GPS above and any closures we've already worked nearby will show up here,
          with the cables we recorded, so you can tell which one you're in — or pick one
          from the list below.
        </p>
      )}

      {busy && <div className="muted small">Looking for closures nearby…</div>}

      {hasGps && candidates && candidates.length === 0 && !busy && (
        <p className="muted small">
          Nothing on record within {CANDIDATE_RADIUS_FT} ft. This will be logged as a new closure
          and get its own number.
        </p>
      )}

      {candidates && candidates.length > 0 && (
        <>
          <p className="muted small">
            {candidates.length} closure(s) we've worked within {CANDIDATE_RADIUS_FT} ft.
            Match the cables to what's in the hole — a hole can hold more than one.
          </p>
          {candidates.map((c) => <Card key={c.id} c={c} />)}
        </>
      )}

      {/* ---- pick one from the list ------------------------------------------
          Austin, 8/25: "there should be a way we can search closures when we are
          not close to them... make a drop down where we can just click on
          lumen-003."

          Everything above this starts from where the man is standing. This does
          not, which is the whole point: the office back-entering a paper report,
          a crew sent to a closure they have not reached yet, or anyone whose GPS
          will not lock in a downtown manhole. Always visible, never behind a
          button, and it needs no typing. */}
      {all && all.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <label>Or pick one from the list ({all.length} on record)</label>
          <select
            value={selectedId ?? ''}
            onChange={(e) => {
              const id = e.target.value || null;
              const hit = id ? all.find((c) => c.id === id) ?? null : null;
              onSelect(id, hit?.closure_code ?? null);
            }}
          >
            <option value="">— pick a closure —</option>
            {all.map((c) => (
              <option key={c.id} value={c.id}>{closureOptionLabel(c)}</option>
            ))}
          </select>

          {/* Picked from a list, so he has NOT seen the cables yet. Show them.
              A code chosen off a list is a guess until it matches what is in
              front of him. */}
          {picked && (
            <div className="card" style={{ borderColor: 'var(--ok)', marginTop: 8 }}>
              <strong className="small">{picked.closure_code}</strong>
              <div className="muted small">
                {STRUCTURE_LABELS[picked.structure_type as keyof typeof STRUCTURE_LABELS]
                  ?? picked.structure_type}
                {picked.structure_owner ? ` · ${picked.structure_owner}` : ''}
                {picked.building_address ? ` · ${picked.building_address}` : ''}
              </div>
              {picked.cables.length > 0 ? (
                <>
                  <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', marginTop: 6 }}>
                    Cables on record
                  </div>
                  {picked.cables.map((cb, i) => (
                    <div key={i} className="small">• {cableLabel(cb)}</div>
                  ))}
                  <p className="muted small" style={{ marginTop: 6 }}>
                    If that isn't what you're looking at, it's a different closure.
                  </p>
                </>
              ) : (
                <div className="muted small" style={{ marginTop: 6 }}>
                  No cables recorded here yet — check the GPS and the structure.
                </div>
              )}
              <div className="muted small" style={{ marginTop: 6 }}>
                {picked.visitCount > 0
                  ? `Worked ${picked.visitCount} time(s)${picked.lastWorked ? `, last ${picked.lastWorked}` : ''}`
                  : 'Never worked'}
              </div>
            </div>
          )}
        </div>
      )}

      {/* explicit "this is a new one" so nothing is attached by accident */}
      <button
        type="button"
        onClick={() => onSelect(null, null)}
        style={{
          display: 'block', width: '100%', textAlign: 'left', marginTop: 8,
          padding: '10px 12px', cursor: 'pointer', font: 'inherit', color: 'inherit',
          borderRadius: 10,
          border: !selectedId ? '2px solid var(--ok)' : '1px solid var(--line)',
          background: !selectedId ? 'rgba(46,160,67,.12)' : 'transparent',
        }}
      >
        <strong>＋ New closure</strong>
        <div className="muted small">
          Not one we've been in before — give it a new number.
        </div>
      </button>

      {/* Typing still beats scrolling once the registry is long — kept for the
          office, and for the day the list runs to hundreds. */}
      {showSearch ? (
        <div style={{ marginTop: 10 }}>
          <label>Find a closure by code</label>
          <input value={term} placeholder="Lumen-0042"
            onChange={(e) => runSearch(e.target.value)} />
          {results && results.length === 0 && (
            <div className="muted small">No match.</div>
          )}
          {results?.map((c) => <Card key={c.id} c={c} />)}
        </div>
      ) : (
        <button type="button" className="addline" style={{ marginTop: 8 }}
          onClick={() => setShowSearch(true)}>Type a closure code instead</button>
      )}
    </div>
  );
}
