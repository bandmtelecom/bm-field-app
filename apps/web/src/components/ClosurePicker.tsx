import { useEffect, useState } from 'react';
import {
  closuresNear, searchClosures, cableLabel, CANDIDATE_RADIUS_FT,
  type ClosureCandidate,
} from '../lib/closures';
import { STRUCTURE_LABELS } from '../lib/types';

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

  const hasGps = !!lat && !!lng && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng));

  // whenever GPS lands (or changes), re-look for candidates
  useEffect(() => {
    let alive = true;
    if (!customerId || !hasGps) { setCandidates(null); return; }
    setBusy(true);
    closuresNear(customerId, Number(lat), Number(lng))
      .then((r) => { if (alive) { setCandidates(r); setBusy(false); } })
      .catch(() => { if (alive) { setCandidates([]); setBusy(false); } });
    return () => { alive = false; };
  }, [customerId, lat, lng, hasGps]);

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

      {!hasGps && !showSearch && (
        <p className="muted small">
          Grab the GPS above and any closures we've already worked nearby will show up here,
          with the cables we recorded, so you can tell which one you're in.{' '}
          <button type="button" className="addline" style={{ width: 'auto', padding: '2px 8px' }}
            onClick={() => setShowSearch(true)}>Look one up by code instead</button>
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

      {(showSearch || (!hasGps && showSearch)) && (
        <div style={{ marginTop: 10 }}>
          <label>Find a closure by code</label>
          <input value={term} placeholder="Lumen-0042"
            onChange={(e) => runSearch(e.target.value)} />
          {results && results.length === 0 && (
            <div className="muted small">No match.</div>
          )}
          {results?.map((c) => <Card key={c.id} c={c} />)}
        </div>
      )}

      {hasGps && !showSearch && (
        <button type="button" className="addline" style={{ marginTop: 8 }}
          onClick={() => setShowSearch(true)}>Search by closure code</button>
      )}
    </div>
  );
}
