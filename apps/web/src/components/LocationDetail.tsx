import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { STRUCTURE_LABELS } from '../lib/types';
import { DOWNTIME_REASONS, EXTRA_UNITS, CASE_MATERIALS } from '../lib/options';

/**
 * Read-only "what did the guys do here" panel.
 * Opens under a location in the running record. No prices — this renders the
 * same for a tech and for the office; dollars live behind RLS on rate_card.
 */

const CASE_ACTION_LABELS: Record<string, string> = {
  reenter: 'Re-entered existing case',
  new_case: 'New case installed',
  midsheath: 'Mid-sheath opening',
};

const DOWNTIME_LABELS: Record<string, string> = Object.fromEntries(
  DOWNTIME_REASONS.map(([code, label]) => [code, label]),
);
const UNIT_LABELS: Record<string, string> = Object.fromEntries(
  EXTRA_UNITS.map((u) => [u.code, u.label]),
);
const CASE_MATERIAL_LABELS: Record<string, string> = Object.fromEntries(
  CASE_MATERIALS.map((c) => [c.code, c.label]),
);

interface Detail {
  shots: any[];
  cables: any[];
  panel_ports: any[];
  downtime: any[];
  units: any[];
}

function Field({ label, value }: { label: string; value: any }) {
  if (value === null || value === undefined || value === '' || value === 0) return null;
  return (
    <div style={{ marginTop: 6 }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{String(value)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,.08)' }}>
      <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>{title}</div>
      {children}
    </div>
  );
}

export default function LocationDetail({ loc }: { loc: any }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [shots, cables, ports, down, units] = await Promise.all([
          supabase.from('shots').select('*').eq('location_id', loc.id).order('ordinal'),
          supabase.from('cables').select('*').eq('location_id', loc.id).order('ordinal'),
          supabase.from('panel_ports').select('*').eq('location_id', loc.id).order('ordinal'),
          supabase.from('downtime').select('*').eq('location_id', loc.id).order('ordinal'),
          supabase.from('location_units').select('*').eq('location_id', loc.id).order('ordinal'),
        ]);
        if (!alive) return;
        setD({
          shots: shots.data ?? [], cables: cables.data ?? [], panel_ports: ports.data ?? [],
          downtime: down.data ?? [], units: units.data ?? [],
        });
      } catch (e: any) {
        if (alive) setErr(e.message ?? 'Could not load this location.');
      }
    })();
    return () => { alive = false; };
  }, [loc.id]);

  const hasGps = loc.gps_lat != null && loc.gps_lng != null;
  const structure = STRUCTURE_LABELS[loc.structure_type as keyof typeof STRUCTURE_LABELS] ?? loc.structure_type;
  const totalFootage = (d?.cables ?? []).reduce((s: number, c: any) => s + (Number(c.footage) || 0), 0);
  const totalDowntime = (d?.downtime ?? []).reduce((s: number, x: any) => s + (Number(x.hours) || 0), 0);

  return (
    <div className="block" style={{ marginTop: 8 }}>
      {/* --- the structure itself --- */}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <strong>{loc.closures?.closure_code ?? `Location ${loc.pm_location_no ?? ''}`}</strong>
          <div className="muted small">
            {structure}
            {loc.structure_owner ? ` · ${loc.structure_owner}` : ''}
            {loc.pm_location_no ? ` · Location #${loc.pm_location_no}` : ''}
          </div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          {hasGps && (
            <a className="iconbtn" style={{ textDecoration: 'none' }}
              href={`https://www.google.com/maps/search/?api=1&query=${loc.gps_lat},${loc.gps_lng}`}
              target="_blank" rel="noreferrer">📍 Map</a>
          )}
          {/* the crew fixes their own reports — forgotten cable, missing GPS */}
          <Link className="iconbtn" style={{ textDecoration: 'none' }}
            to={`/locations/${loc.id}/edit`}>✎ Edit</Link>
        </div>
      </div>

      <Field label="Building address" value={loc.building_address} />
      {hasGps && <Field label="GPS" value={`${loc.gps_lat}, ${loc.gps_lng}`} />}

      {/* --- the splice work --- */}
      <Section title="Work performed">
        <div className="small">
          {loc.case_action ? CASE_ACTION_LABELS[loc.case_action] ?? loc.case_action : 'No case action recorded'}
          {loc.enclosure_model ? ` · ${loc.enclosure_model}` : ''}
          {loc.enclosure_new ? ' (new enclosure)' : ''}
        </div>
        {loc.splice_count > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            🔩 <strong>{loc.splice_count}</strong>{' '}
            {loc.splice_type === 'ribbon' ? 'ribbon splice(s)' : 'single-fiber splice(s)'}
          </div>
        )}
        {loc.trays_added > 0 && <div className="small" style={{ marginTop: 4 }}>🗄 {loc.trays_added} tray(s) added</div>}
        {loc.new_case_material_code && (
          <div className="small muted" style={{ marginTop: 4 }}>
            Case: {CASE_MATERIAL_LABELS[loc.new_case_material_code] ?? loc.new_case_material_code}
          </div>
        )}
        {loc.test_fiber_count > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            🔦 {loc.test_fiber_count} fiber(s) tested{loc.test_type ? ` (${loc.test_type.toUpperCase()})` : ''}
          </div>
        )}
      </Section>

      <Field label="As found" value={loc.as_found} />
      <Field label="As built" value={loc.as_built} />
      <Field label="Notes" value={loc.narrative} />

      {!d && !err && <div className="muted small" style={{ marginTop: 10 }}>Loading detail…</div>}
      {err && <div className="error">{err}</div>}

      {d && (
        <>
          {/* --- cables + footages --- */}
          {d.cables.length > 0 && (
            <Section title={`Cables (${d.cables.length})${totalFootage ? ` · ${totalFootage} ft` : ''}`}>
              <table>
                <thead><tr><th>Direction</th><th>Cable</th><th className="num">Footage</th></tr></thead>
                <tbody>
                  {d.cables.map((c: any) => (
                    <tr key={c.id}>
                      <td>{c.direction || '—'}{c.role ? <div className="muted" style={{ fontSize: 11 }}>{c.role}</div> : null}</td>
                      <td>
                        {c.count || '—'}
                        {(c.manufacturer || c.date_code) && (
                          <div className="muted" style={{ fontSize: 11 }}>
                            {[c.manufacturer, c.date_code].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </td>
                      <td className="num">{c.footage ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* --- panel ports (buildings) --- */}
          {d.panel_ports.length > 0 && (
            <Section title={`Panel ports (${d.panel_ports.length})`}>
              <table>
                <thead><tr><th>Panel</th><th>Port</th><th>Pos</th><th className="num">Result</th></tr></thead>
                <tbody>
                  {d.panel_ports.map((p: any) => (
                    <tr key={p.id}>
                      <td>{p.panel || '—'}</td><td>{p.port || '—'}</td><td>{p.position || '—'}</td>
                      <td className="num">{p.pass_fail ? p.pass_fail.toUpperCase() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* --- OTDR shots --- */}
          {d.shots.length > 0 && (
            <Section title={`OTDR shots (${d.shots.length})`}>
              <table>
                <thead><tr><th>Fiber</th><th>Direction</th><th className="num">Distance</th></tr></thead>
                <tbody>
                  {d.shots.map((s: any) => (
                    <tr key={s.id}>
                      <td>{s.fiber_group || '—'}{s.event ? <div className="muted" style={{ fontSize: 11 }}>{s.event}</div> : null}</td>
                      <td>{s.direction || '—'}</td>
                      <td className="num">{s.distance_km != null ? `${s.distance_km} km` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          )}

          {/* --- downtime --- */}
          {d.downtime.length > 0 && (
            <Section title={`Downtime · ${totalDowntime} hr`}>
              {d.downtime.map((x: any) => (
                <div key={x.id} className="small">
                  ⏱ {x.hours} hr — {DOWNTIME_LABELS[x.reason] ?? x.reason ?? 'unspecified'}
                </div>
              ))}
            </Section>
          )}

          {/* --- extra units (no prices) --- */}
          {d.units.length > 0 && (
            <Section title="Additional work">
              {d.units.map((u: any) => (
                <div key={u.id} className="small">
                  • {UNIT_LABELS[u.unit_code] ?? u.unit_code}
                  {Number(u.qty) !== 1 ? ` × ${u.qty}` : ''}
                  {u.note ? <span className="muted"> — {u.note}</span> : null}
                </div>
              ))}
            </Section>
          )}
        </>
      )}
    </div>
  );
}
