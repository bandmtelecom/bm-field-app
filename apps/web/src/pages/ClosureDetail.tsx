import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getClosure, closureHistory, cableLabel,
  type ClosureRow, type ClosureVisit,
} from '../lib/closures';
import { STRUCTURE_LABELS } from '../lib/types';

const CASE_ACTION: Record<string, string> = {
  reenter: 'Re-entered existing case',
  new_case: 'New case installed',
  midsheath: 'Mid-sheath opening',
};

/**
 * "What have we done here?" — the whole point of the registry.
 * Everything B&M has ever done at one closure, newest first, no prices.
 */
export default function ClosureDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [closure, setClosure] = useState<ClosureRow | null>(null);
  const [history, setHistory] = useState<ClosureVisit[] | null>(null);

  useEffect(() => {
    if (!id) return;
    getClosure(id).then(setClosure);
    closureHistory(id).then(setHistory);
  }, [id]);

  if (!closure) return <div className="spinner">Loading…</div>;

  const hasGps = closure.gps_lat != null && closure.gps_lng != null;
  // the cables we know about = the most recent visit that recorded any
  const knownCables = (history ?? []).find((h) => h.cables.length > 0)?.cables ?? [];

  return (
    <div className="app">
      <div className="topbar">
        <button className="back" onClick={() => nav('/closures')}>‹ Closures</button>
        <div className="spacer" />
        {hasGps && (
          <a className="iconbtn" style={{ textDecoration: 'none' }}
            href={`https://www.google.com/maps/search/?api=1&query=${closure.gps_lat},${closure.gps_lng}`}
            target="_blank" rel="noreferrer">📍 Map</a>
        )}
      </div>
      <div className="content">
        <div className="card">
          <h2>{closure.closure_code}</h2>
          <div className="muted small">
            {STRUCTURE_LABELS[closure.structure_type as keyof typeof STRUCTURE_LABELS] ?? closure.structure_type}
            {closure.structure_owner ? ` · ${closure.structure_owner}` : ''}
            {closure.enclosure_model ? ` · ${closure.enclosure_model}` : ''}
          </div>
          {closure.building_address && <div className="small" style={{ marginTop: 4 }}>{closure.building_address}</div>}
          {hasGps && <div className="muted small" style={{ marginTop: 4 }}>{closure.gps_lat}, {closure.gps_lng}</div>}

          {knownCables.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Cables on record
              </div>
              {knownCables.map((c, i) => <div key={i} className="small">• {cableLabel(c)}</div>)}
            </div>
          )}
        </div>

        <h3 className="muted small" style={{ margin: '4px 2px' }}>
          WHAT WE'VE DONE HERE · {history?.length ?? 0} visit(s)
        </h3>

        {history?.map((h) => (
          <div key={h.locationId} className="card">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{h.visitDate ?? 'undated'}</strong>
              <span className="small muted">{h.techs.join(', ')}</span>
            </div>
            <div className="row" style={{ gap: 6, marginTop: 6 }}>
              {h.bmNumber && <span className="pill">job {h.bmNumber}</span>}
              {h.billingMode === 'emergency' && <span className="badge emergency">LOR</span>}
            </div>

            <div className="small" style={{ marginTop: 8 }}>
              {h.caseAction ? CASE_ACTION[h.caseAction] ?? h.caseAction : 'No case action recorded'}
              {h.spliceCount > 0 && ` · ${h.spliceCount} ${h.spliceType === 'ribbon' ? 'ribbon' : 'single'} splice(s)`}
              {h.traysAdded > 0 && ` · ${h.traysAdded} tray(s)`}
              {h.testFiberCount > 0 && ` · ${h.testFiberCount} fiber(s) tested`}
            </div>

            {h.asFound && <div className="small" style={{ marginTop: 6 }}><span className="muted">As found: </span>{h.asFound}</div>}
            {h.asBuilt && <div className="small" style={{ marginTop: 4 }}><span className="muted">As built: </span>{h.asBuilt}</div>}
            {h.narrative && <p className="small" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{h.narrative}</p>}

            {h.cables.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div className="muted" style={{ fontSize: 11 }}>Cables recorded this visit</div>
                {h.cables.map((c, i) => <div key={i} className="small">• {cableLabel(c)}</div>)}
              </div>
            )}
          </div>
        ))}

        {history && history.length === 0 && (
          <div className="card muted small">
            Nothing logged at this closure yet.
          </div>
        )}
      </div>
    </div>
  );
}
