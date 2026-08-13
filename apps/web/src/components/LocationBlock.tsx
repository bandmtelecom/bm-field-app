import type { ReactNode } from 'react';
import {
  ENCLOSURE_MODELS, STRUCTURE_OWNERS, MANUFACTURERS, DOWNTIME_REASONS,
  CASE_MATERIALS, EXTRA_UNITS, inferTrayMaterial,
} from '../lib/options';
import { STRUCTURE_LABELS } from '../lib/types';

export interface LocationForm {
  pm_location_no: string;
  structure_type: 'mh' | 'hh' | 'aerial' | 'building';
  structure_owner: string;
  building_address: string;
  gps_lat: string; gps_lng: string;
  hole_ref: string;
  enclosure_new: boolean;
  enclosure_model: string;
  case_action: '' | 'reenter' | 'new_case' | 'midsheath';
  new_case_material_code: string;
  splice_type: '' | 'single' | 'ribbon';
  splice_count: string;
  trays_added: string;
  test_fiber_count: string;
  test_type: 'otdr' | 'bare';
  narrative: string; as_found: string; as_built: string;
  downtimes: { hours: string; reason: string }[];
  cables: { direction: string; count: string; manufacturer: string; date_code: string; footage: string; role: string }[];
  panel_ports: { panel: string; port: string; position: string; pass_fail: '' | 'pass' | 'fail' }[];
  shots: { fiber_group: string; direction: string; distance_km: string; event: string }[];
  extras: string[];
}

export function emptyLocation(): LocationForm {
  return {
    pm_location_no: '', structure_type: 'mh', structure_owner: '', building_address: '',
    gps_lat: '', gps_lng: '', hole_ref: '', enclosure_new: false, enclosure_model: '',
    case_action: '', new_case_material_code: '', splice_type: '', splice_count: '',
    trays_added: '', test_fiber_count: '', test_type: 'otdr',
    narrative: '', as_found: '', as_built: '',
    downtimes: [], cables: [], panel_ports: [], shots: [], extras: [],
  };
}

export default function LocationBlock({
  value, index, onChange, onRemove,
}: { value: LocationForm; index: number; onChange: (v: LocationForm) => void; onRemove: () => void }) {
  const set = (patch: Partial<LocationForm>) => onChange({ ...value, ...patch });
  const isBuilding = value.structure_type === 'building';

  function grabGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => set({ gps_lat: p.coords.latitude.toFixed(6), gps_lng: p.coords.longitude.toFixed(6) }),
      () => alert('Could not get GPS — enter it manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  const toggleExtra = (code: string) =>
    set({ extras: value.extras.includes(code) ? value.extras.filter((c) => c !== code) : [...value.extras, code] });

  return (
    <div className="block">
      <div className="head">
        <strong>Location {index + 1}{value.pm_location_no ? ` · #${value.pm_location_no}` : ''}</strong>
        <button className="rm" onClick={onRemove}>Remove</button>
      </div>

      <div className="row">
        <div>
          <label>PM location #</label>
          <input value={value.pm_location_no} onChange={(e) => set({ pm_location_no: e.target.value })} />
        </div>
        <div>
          <label>Structure</label>
          <select value={value.structure_type} onChange={(e) => set({ structure_type: e.target.value as any })}>
            {(['mh', 'hh', 'aerial', 'building'] as const).map((s) => (
              <option key={s} value={s}>{STRUCTURE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>

      {isBuilding && (
        <>
          <label>Building address</label>
          <input value={value.building_address} onChange={(e) => set({ building_address: e.target.value })} />
        </>
      )}

      <label>Structure owner / tag</label>
      <select value={value.structure_owner} onChange={(e) => set({ structure_owner: e.target.value })}>
        <option value="">—</option>
        {STRUCTURE_OWNERS.map((o) => <option key={o}>{o}</option>)}
      </select>

      <label>GPS</label>
      <div className="row">
        <input placeholder="lat" value={value.gps_lat} onChange={(e) => set({ gps_lat: e.target.value })} />
        <input placeholder="lng" value={value.gps_lng} onChange={(e) => set({ gps_lng: e.target.value })} />
        <button type="button" className="iconbtn" style={{ background: 'var(--navy)' }} onClick={grabGps}>Grab</button>
      </div>

      <label>Enclosure</label>
      <div className="seg">
        <button type="button" className={!value.enclosure_new ? 'on' : ''} onClick={() => set({ enclosure_new: false })}>Existing</button>
        <button type="button" className={value.enclosure_new ? 'on' : ''} onClick={() => set({ enclosure_new: true })}>New</button>
      </div>
      <label>Enclosure model</label>
      <select value={value.enclosure_model} onChange={(e) => set({ enclosure_model: e.target.value })}>
        <option value="">—</option>
        {ENCLOSURE_MODELS.map((m) => <option key={m}>{m}</option>)}
      </select>

      <label>Case action</label>
      <div className="seg">
        {([['reenter', 'Re-enter'], ['new_case', 'New case'], ['midsheath', 'Midsheath prep']] as const).map(([v, l]) => (
          <button type="button" key={v} className={value.case_action === v ? 'on' : ''} onClick={() => set({ case_action: v })}>{l}</button>
        ))}
      </div>
      {value.case_action === 'new_case' && (
        <>
          <label>New case — pick the case</label>
          <select value={value.new_case_material_code} onChange={(e) => set({ new_case_material_code: e.target.value })}>
            <option value="">—</option>
            {CASE_MATERIALS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </>
      )}

      <label>Splice type</label>
      <div className="seg">
        <button type="button" className={value.splice_type === 'single' ? 'on' : ''} onClick={() => set({ splice_type: 'single' })}>Single fusion</button>
        <button type="button" className={value.splice_type === 'ribbon' ? 'on' : ''} onClick={() => set({ splice_type: 'ribbon' })}>Ribbon</button>
      </div>
      <div className="row">
        <div>
          <label>{value.splice_type === 'ribbon' ? 'Ribbons made' : 'Splices made'}</label>
          <input inputMode="numeric" value={value.splice_count} onChange={(e) => set({ splice_count: e.target.value })} />
        </div>
        <div>
          <label>Trays added</label>
          <input inputMode="numeric" value={value.trays_added} onChange={(e) => set({ trays_added: e.target.value })} />
        </div>
      </div>

      <label>As-found / as-built</label>
      <input placeholder="Was spliced…" value={value.as_found} onChange={(e) => set({ as_found: e.target.value })} />
      <div style={{ height: 6 }} />
      <input placeholder="Spliced N 144F 39/40 to 1/2 of the 24F…" value={value.as_built} onChange={(e) => set({ as_built: e.target.value })} />

      <label>What happened here</label>
      <textarea value={value.narrative} onChange={(e) => set({ narrative: e.target.value })} />

      {/* shots */}
      <RepeatList label="Shot fibers (OTDR)" rows={value.shots}
        onAdd={() => set({ shots: [...value.shots, { fiber_group: '', direction: '', distance_km: '', event: '' }] })}
        onRemove={(i) => set({ shots: value.shots.filter((_, x) => x !== i) })}
        render={(r, i) => (
          <div className="row" key={i}>
            <input placeholder="144F 36" value={r.fiber_group} onChange={(e) => upd(value.shots, i, { fiber_group: e.target.value }, (v) => set({ shots: v }))} />
            <input placeholder="km" value={r.distance_km} onChange={(e) => upd(value.shots, i, { distance_km: e.target.value }, (v) => set({ shots: v }))} />
          </div>
        )} />

      {/* cables OR panel ports */}
      {isBuilding ? (
        <RepeatList label="Panel ports & positions" rows={value.panel_ports}
          onAdd={() => set({ panel_ports: [...value.panel_ports, { panel: '', port: '', position: '', pass_fail: '' }] })}
          onRemove={(i) => set({ panel_ports: value.panel_ports.filter((_, x) => x !== i) })}
          render={(r, i) => (
            <div className="row" key={i}>
              <input placeholder="Panel G12.014.13" value={r.panel} onChange={(e) => upd(value.panel_ports, i, { panel: e.target.value }, (v) => set({ panel_ports: v }))} />
              <input placeholder="Port 638" value={r.port} onChange={(e) => upd(value.panel_ports, i, { port: e.target.value }, (v) => set({ panel_ports: v }))} />
              <input placeholder="Pos C" value={r.position} onChange={(e) => upd(value.panel_ports, i, { position: e.target.value }, (v) => set({ panel_ports: v }))} />
            </div>
          )} />
      ) : (
        <RepeatList label="Cables in this closure" rows={value.cables}
          onAdd={() => set({ cables: [...value.cables, { direction: '', count: '', manufacturer: '', date_code: '', footage: '', role: '' }] })}
          onRemove={(i) => set({ cables: value.cables.filter((_, x) => x !== i) })}
          render={(r, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div className="row">
                <input placeholder="Dir (S/W…)" value={r.direction} onChange={(e) => upd(value.cables, i, { direction: e.target.value }, (v) => set({ cables: v }))} />
                <input placeholder="144F" value={r.count} onChange={(e) => upd(value.cables, i, { count: e.target.value }, (v) => set({ cables: v }))} />
                <input placeholder="Footage" value={r.footage} onChange={(e) => upd(value.cables, i, { footage: e.target.value }, (v) => set({ cables: v }))} />
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <select value={r.manufacturer} onChange={(e) => upd(value.cables, i, { manufacturer: e.target.value }, (v) => set({ cables: v }))}>
                  <option value="">Mfr…</option>{MANUFACTURERS.map((m) => <option key={m}>{m}</option>)}
                </select>
                <input placeholder="Role (tail…)" value={r.role} onChange={(e) => upd(value.cables, i, { role: e.target.value }, (v) => set({ cables: v }))} />
              </div>
            </div>
          )} />
      )}

      {/* downtime */}
      <RepeatList label="Downtime on site" rows={value.downtimes}
        onAdd={() => set({ downtimes: [...value.downtimes, { hours: '', reason: 'waiting_construction' }] })}
        onRemove={(i) => set({ downtimes: value.downtimes.filter((_, x) => x !== i) })}
        render={(r, i) => (
          <div className="row" key={i}>
            <input placeholder="hrs" inputMode="decimal" value={r.hours} onChange={(e) => upd(value.downtimes, i, { hours: e.target.value }, (v) => set({ downtimes: v }))} />
            <select value={r.reason} onChange={(e) => upd(value.downtimes, i, { reason: e.target.value }, (v) => set({ downtimes: v }))}>
              {DOWNTIME_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )} />

      {/* tap-to-add extras */}
      <label>Other work at this closure</label>
      <div className="seg">
        {EXTRA_UNITS.map((u) => (
          <button type="button" key={u.code} className={value.extras.includes(u.code) ? 'on' : ''}
            style={{ minWidth: '46%' }} onClick={() => toggleExtra(u.code)}>{u.label}</button>
        ))}
      </div>
    </div>
  );
}

// helpers -------------------------------------------------------------------
function upd<T>(rows: T[], i: number, patch: Partial<T>, commit: (rows: T[]) => void) {
  commit(rows.map((r, x) => (x === i ? { ...r, ...patch } : r)));
}

function RepeatList<T>({ label, rows, onAdd, onRemove, render }: {
  label: string; rows: T[]; onAdd: () => void; onRemove: (i: number) => void;
  render: (row: T, i: number) => ReactNode;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <label>{label}</label>
      {rows.map((r, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ flex: 1 }}>{render(r, i)}</div>
          <button type="button" className="rm" onClick={() => onRemove(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="addline" onClick={onAdd}>＋ Add</button>
    </div>
  );
}

export { inferTrayMaterial };
