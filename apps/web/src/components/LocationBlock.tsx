import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import {
  ENCLOSURE_MODELS, STRUCTURE_OWNERS, MANUFACTURERS, DOWNTIME_REASONS,
  CASE_MATERIALS, EXTRA_UNITS, inferTrayMaterial, inferCaseMaterial,
} from '../lib/options';
import { STRUCTURE_LABELS } from '../lib/types';
import { parseNum, splitNames } from '../lib/num';
import ClosurePicker from './ClosurePicker';

export interface LocationForm {
  pm_location_no: string;
  /** The men who worked THIS hole, as typed. Downtime bills per tech against
   *  this list, so when a crew splits up each hole carries its own names. */
  techs: string;
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
  /** counts for extras that bill per-each (e.g. TEST_CD_PMD). code → qty as typed. */
  extra_qty: Record<string, string>;
  /** Photos / traces picked in the field, not yet uploaded. They upload after
   *  the visit saves, so a dropped signal costs a photo and never the report. */
  photos: { file: File; preview: string }[];
  /** an EXISTING closure this work attaches to. null = mint a new one. */
  closure_id: string | null;
  closure_code: string | null;
}

export function emptyLocation(): LocationForm {
  return {
    pm_location_no: '', techs: '', structure_type: 'mh', structure_owner: '', building_address: '',
    gps_lat: '', gps_lng: '', hole_ref: '', enclosure_new: false, enclosure_model: '',
    case_action: '', new_case_material_code: '', splice_type: '', splice_count: '',
    trays_added: '', test_fiber_count: '', test_type: 'otdr',
    narrative: '', as_found: '', as_built: '',
    downtimes: [], cables: [], panel_ports: [], shots: [], extras: [], extra_qty: {},
    photos: [],
    closure_id: null, closure_code: null,
  };
}

export default function LocationBlock({
  value, index, customerId, onChange, onRemove,
}: {
  value: LocationForm; index: number; customerId?: string | null;
  onChange: (v: LocationForm) => void; onRemove: () => void;
}) {
  const set = (patch: Partial<LocationForm>) => onChange({ ...value, ...patch });
  const isBuilding = value.structure_type === 'building';
  /** What the app read out of the techs box — shown so nothing gets swallowed. */
  const crew = splitNames(value.techs);

  /** A case went in whenever the enclosure is New. "New case" as a case action
   *  still counts on its own, so nothing that used to show this box stops. */
  const showCasePicker = value.enclosure_new || value.case_action === 'new_case';
  /** The priced row this enclosure model corresponds to, when we know it. */
  const caseSuggestion = (() => {
    const code = inferCaseMaterial(value.enclosure_model, value.structure_type);
    return code ? CASE_MATERIALS.find((c) => c.code === code) ?? null : null;
  })();

  /** Standard makes + every manufacturer already recorded on a real job. */
  const [seenMfrs, setSeenMfrs] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    supabase.from('cables').select('manufacturer').not('manufacturer', 'is', null)
      .then(({ data }) => {
        if (!alive) return;
        const names = (data ?? [])
          .map((r: any) => (r.manufacturer ?? '').trim())
          .filter(Boolean);
        setSeenMfrs(Array.from(new Set(names)));
      });
    return () => { alive = false; };
  }, []);
  const mfrOptions = Array.from(new Set([...MANUFACTURERS, ...seenMfrs]))
    .filter((m) => m && m !== 'Other')      // "Other" is what you pick when you can't type; now you can
    .sort((a, b) => a.localeCompare(b));

  /** Positive longitude = a dropped minus sign. See the note by the GPS row. */
  const needsWestFix = (() => {
    const raw = (value.gps_lng ?? '').trim();
    if (!raw) return false;
    const n = parseNum(raw);   // "96.97 W" is a dropped minus sign too — Number() made it NaN and it slipped through
    return n != null && n > 0;
  })();

  /** Pick files. Previews are object URLs, revoked when the row is removed. */
  function addPhotos(list: FileList | null) {
    if (!list?.length) return;
    const added = Array.from(list).map((file) => ({
      file,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : '',
    }));
    set({ photos: [...value.photos, ...added] });
  }

  function removePhoto(i: number) {
    const p = value.photos[i];
    if (p?.preview) URL.revokeObjectURL(p.preview);
    set({ photos: value.photos.filter((_, x) => x !== i) });
  }

  function grabGps() {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => set({ gps_lat: p.coords.latitude.toFixed(6), gps_lng: p.coords.longitude.toFixed(6) }),
      () => alert('Could not get GPS — enter it manually.'),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }
  function toggleExtra(code: string) {
    if (value.extras.includes(code)) {
      // turning it off also clears any count that was typed for it
      const { [code]: _drop, ...rest } = value.extra_qty;
      set({ extras: value.extras.filter((c) => c !== code), extra_qty: rest });
    } else {
      set({ extras: [...value.extras, code] });
    }
  }

  // buttons limited to certain structure types (CD/PMD is Building-only) drop
  // off the list entirely when the structure doesn't match.
  const visibleExtras = EXTRA_UNITS.filter(
    (u) => !u.only || u.only.includes(value.structure_type),
  );

  return (
    <div className="block">
      <div className="head">
        <strong>Location {index + 1}{value.pm_location_no ? ` · #${value.pm_location_no}` : ''}</strong>
        <button className="rm" onClick={onRemove}>Remove</button>
      </div>

      <div className="row">
        <div>
          <label>Location #</label>
          <input value={value.pm_location_no} placeholder="Location number"
            onChange={(e) => set({ pm_location_no: e.target.value })} />
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

      {/* ---- who was in THIS hole ------------------------------------------
          The crew used to be one box at the top of the report. On 26-352 four
          men split between two holes on the same night and the invoice billed
          every downtime hour against all four. Downtime bills per tech, so the
          names have to sit with the hole.

          Write them however you write them — "Armando & Josh L", "Armando and
          Spencer", commas, whatever. The count underneath is the app telling
          you what it read, so a name that got swallowed is visible before you
          submit instead of six days later on an invoice. */}
      <label>Who worked this location</label>
      <input placeholder="Armando, Josh L" value={value.techs}
        onChange={(e) => set({ techs: e.target.value })} />
      {crew.length > 0 ? (
        <p className="small" style={{ marginTop: 4, color: 'var(--ok)' }}>
          {crew.length} tech{crew.length === 1 ? '' : 's'}: {crew.join(' · ')}
        </p>
      ) : (
        <p className="muted small" style={{ marginTop: 4 }}>
          Every man in this hole. Standby time bills for each of them.
        </p>
      )}

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

      {/* A dropped minus sign puts the hole in China. It has happened five times
          already, to two different techs, always on hand-typed coordinates -
          Grab writes the sign correctly. Everywhere B&M works is west of
          Greenwich, so a positive longitude is always a typo. Offer the fix
          rather than just complaining, and never silently rewrite what he
          typed. */}
      {needsWestFix && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 6 }}>
          <strong className="small">That longitude is in the eastern hemisphere.</strong>
          <p className="muted small" style={{ marginTop: 4 }}>
            We work west of Greenwich, so it should start with a minus. As typed,
            this hole is about 7,000 miles away and nobody will find it again.
          </p>
          <div style={{ height: 8 }} />
          <button type="button" className="btn"
            onClick={() => set({ gps_lng: `-${value.gps_lng.trim()}` })}>
            Change to −{value.gps_lng.trim()}
          </button>
        </div>
      )}

      {/* ---- photos & traces -------------------------------------------------
          Two buttons on purpose. "Take photo" opens the camera directly, which
          is what a man in a hole wants; "Choose files" opens the picker for
          shots already taken or an OTDR trace pulled off the set. Nothing
          uploads here — files ride in memory and go up after the visit saves,
          so a dropped signal costs a photo, never the whole report. */}
      <label>Photos / traces</label>
      <div className="row">
        <label className="iconbtn" style={{ background: 'var(--navy)', textAlign: 'center' }}>
          📷 Take photo
          <input type="file" accept="image/*" capture="environment" multiple
            style={{ display: 'none' }}
            onChange={(e) => addPhotos(e.target.files)} />
        </label>
        <label className="iconbtn" style={{ textAlign: 'center' }}>
          📎 Choose files
          <input type="file" accept="image/*,.sor,application/pdf" multiple
            style={{ display: 'none' }}
            onChange={(e) => addPhotos(e.target.files)} />
        </label>
      </div>

      {value.photos.length > 0 && (
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {value.photos.map((p, i) => (
            <div key={i} style={{ position: 'relative', width: 72 }}>
              {p.preview ? (
                <img src={p.preview} alt=""
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
              ) : (
                <div style={{
                  width: 72, height: 72, borderRadius: 6, display: 'flex',
                  alignItems: 'center', justifyContent: 'center', fontSize: 11,
                  background: 'var(--line, #e6e6e6)', textAlign: 'center', padding: 4,
                }}>{p.file.name.slice(-12)}</div>
              )}
              <button type="button" className="rm"
                style={{ position: 'absolute', top: -6, right: -6, padding: '0 6px', width: 'auto' }}
                onClick={() => removePhoto(i)}>×</button>
            </div>
          ))}
        </div>
      )}
      {value.photos.length > 0 && (
        <p className="muted small" style={{ marginTop: 4 }}>
          {value.photos.length} file{value.photos.length === 1 ? '' : 's'} — these upload
          once you submit the report.
        </p>
      )}

      <ClosurePicker
        customerId={customerId ?? null}
        lat={value.gps_lat}
        lng={value.gps_lng}
        selectedId={value.closure_id}
        selectedCode={value.closure_code}
        onSelect={(id, code) => set({ closure_id: id, closure_code: code })}
      />

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
      {/* ---- which case went in the hole ------------------------------------
          This used to hang off the "New case" button, so a tech who set
          Enclosure = New, model 450D and Case action = Midsheath prep — a new
          450D dropped in and opened midsheath, which is exactly what happened at
          Lumen-0018 on 26-352 — was never shown this box at all. The case billed
          nothing. $478.81 out the door with nothing on screen looking wrong.

          The New/Existing toggle is what says a case went in; the case action is
          only which labor it took. So the picker follows the toggle. */}
      {showCasePicker && (
        <>
          <label>Which case went in</label>
          <select value={value.new_case_material_code}
            onChange={(e) => set({ new_case_material_code: e.target.value })}>
            <option value="">—</option>
            {CASE_MATERIALS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>

          {/* Offer the match rather than writing it in behind him — same as the
              longitude fix. He can always pick something else. */}
          {!value.new_case_material_code && caseSuggestion && (
            <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 6 }}>
              <strong className="small">
                A {value.enclosure_model} is {caseSuggestion.label}.
              </strong>
              <p className="muted small" style={{ marginTop: 4 }}>
                This is the case B&M bills for. Nothing bills until you pick one.
              </p>
              <div style={{ height: 8 }} />
              <button type="button" className="btn"
                onClick={() => set({ new_case_material_code: caseSuggestion.code })}>
                Use {caseSuggestion.label}
              </button>
            </div>
          )}
          {!value.new_case_material_code && !caseSuggestion && (
            <p className="muted small" style={{ marginTop: 4 }}>
              Pick the case that went in — it doesn't bill until you do.
            </p>
          )}
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

      {/* Type-ahead for manufacturer: a real <input> with a <datalist>, not a
          <select>. The old dropdown could not accept a make that was not on the
          list, so anything unusual got filed as "Other" - which is exactly why
          manufacturer turned out to be the least trustworthy field in the data.
          The list is seeded from the standard makes plus every manufacturer
          already typed on a real job, so it learns as the crew works. */}
      <datalist id="bm-mfr-list">
        {mfrOptions.map((m) => <option key={m} value={m} />)}
      </datalist>

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
            /* Three boxes, one line. Austin, 8/25: fewer boxes, everything about
               the cable itself typed straight into one field. The techs were
               already doing this - the live data has "48F 03-23" and
               "96F JUN2008" crammed into the old count box - so this matches
               how they actually write it down rather than fighting it.
               `date_code` is no longer written; old rows keep theirs and still
               display. `role` is gone from the form.

               Footage got its own box back on 8/28 - Austin: "leave the area
               where the guys put that in as just blank and let them put anything
               there. that area is just information it has nothing to do with
               billing." Two crews had skipped footage entirely on 26-363 because
               nothing on the screen asked for it. It takes any text and is never
               parsed. */
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input list="bm-mfr-list" placeholder="Manufacturer"
                value={r.manufacturer}
                onChange={(e) => upd(value.cables, i, { manufacturer: e.target.value }, (v) => set({ cables: v }))} />
              <input placeholder="Dir" style={{ maxWidth: 70 }}
                value={r.direction}
                onChange={(e) => upd(value.cables, i, { direction: e.target.value }, (v) => set({ cables: v }))} />
              <input placeholder="144F 03-23"
                value={r.count}
                onChange={(e) => upd(value.cables, i, { count: e.target.value }, (v) => set({ cables: v }))} />
              <input placeholder="Footage" style={{ maxWidth: 110 }}
                value={r.footage}
                onChange={(e) => upd(value.cables, i, { footage: e.target.value }, (v) => set({ cables: v }))} />
            </div>
          )} />
      )}

      {/* downtime */}
      <RepeatList label="Downtime on site" rows={value.downtimes}
        onAdd={() => set({ downtimes: [...value.downtimes, { hours: '', reason: '' }] })}
        onRemove={(i) => set({ downtimes: value.downtimes.filter((_, x) => x !== i) })}
        render={(r, i) => (
          <div className="row" key={i}>
            <input placeholder="hrs" inputMode="decimal" value={r.hours} onChange={(e) => upd(value.downtimes, i, { hours: e.target.value }, (v) => set({ downtimes: v }))} />
            <select value={r.reason} onChange={(e) => upd(value.downtimes, i, { reason: e.target.value }, (v) => set({ downtimes: v }))}>
              <option value="">— pick a reason —</option>
              {DOWNTIME_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        )} />

      {/* tap-to-add extras */}
      <label>Other work at this closure</label>
      <div className="seg">
        {visibleExtras.map((u) => (
          <button type="button" key={u.code} className={value.extras.includes(u.code) ? 'on' : ''}
            style={{ minWidth: '46%' }} onClick={() => toggleExtra(u.code)}>{u.label}</button>
        ))}
      </div>

      {/* per-each extras ask for a count once they're switched on */}
      {visibleExtras.filter((u) => u.qty && value.extras.includes(u.code)).map((u) => (
        <div key={`${u.code}-qty`} style={{ marginTop: 10 }}>
          <label>{u.qty!.label}</label>
          <input inputMode="numeric" placeholder="0"
            value={value.extra_qty[u.code] ?? ''}
            onChange={(e) => set({ extra_qty: { ...value.extra_qty, [u.code]: e.target.value } })} />
          {u.qty!.hint && <div className="muted small">{u.qty!.hint}</div>}
        </div>
      ))}
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
