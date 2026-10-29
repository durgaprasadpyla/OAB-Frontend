import { useMemo } from 'react';
import { useApi } from '../lib/useApi.js';
import {
  LAYER_NAMES, GUSSET_TYPES, SEAL_TYPES, gsmBreakdown, layerCount, printingMachines, laminationMachines,
  machineKey, machineLabel, toolingFor, printFigures, sleeveChoices, laminatedWidth, rollerChoices,
  sheetKind, gussetSplit, pouchFigures, sleeveFigures, labelFigures, sheetOf, sheetIsBlank, missingRollers,
} from '../lib/specSheet.js';

// Issues 26.10 — the SPECIFICATIONS sheet, one component on both the QC's CSA report
// and the JSS spec entry ("The CSA report format and the JSS spec sheet format should
// be similar"). The arithmetic lives in lib/specSheet.js; this only draws it.
//
//   <SpecSheet sales layers sheet onChange dispatchForm />
//     layers   [{ material, specialty, microns } × 3] — the structure picked above
//     sheet    the saved sheet (sheetOf fills the gaps)
//     onChange (nextSheet) => void

const fmt = (v) => (v > 0 ? String(v) : '');

function Num({ label, value, onChange, unit, aria, disabled, width }) {
  return (
    <div className="fg" style={width ? { maxWidth: width } : undefined}>
      <label>{label}{unit ? ` (${unit})` : ''}</label>
      <input type="number" step="any" min="0" className="nospin" value={value ?? ''} disabled={disabled}
        aria-label={aria || (unit ? `${label} (${unit})` : label)} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
function Out({ label, value, aria, how, bad }) {
  return (
    <div className="fg">
      <label style={{ fontWeight: 700 }}>{label}</label>
      <input type="text" readOnly tabIndex={-1} value={value === 0 || value === '' || value == null ? '' : String(value)} placeholder="—"
        aria-label={aria || label} style={{ background: 'var(--bg)', fontWeight: 700, color: bad ? 'var(--red)' : undefined, borderColor: bad ? 'var(--red)' : undefined }} />
      {how ? <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 2 }}>{how}</div> : null}
    </div>
  );
}
function Toggle({ label, value, onChange }) {
  const on = value === 'Yes';
  return (
    <div className="fg">
      <label>{label}</label>
      <label className="cb" style={{ minHeight: 34, display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="checkbox" role="switch" checked={on} aria-label={label} onChange={(e) => onChange(e.target.checked ? 'Yes' : 'No')} />
        <span style={{ fontWeight: 700, color: on ? '#1e7e34' : 'var(--i3)' }}>{on ? 'Yes' : 'No'}</span>
      </label>
    </div>
  );
}
function Radios({ label, name, value, options, onChange }) {
  return (
    <div className="fg">
      <label>{label}</label>
      <div role="radiogroup" aria-label={label} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', minHeight: 34, alignItems: 'center', fontSize: 12 }}>
        {options.map((o) => (
          <label key={o} className="cb"><input type="radio" name={name} checked={value === o} aria-label={o} onChange={() => onChange(o)} /><span>{o}</span></label>
        ))}
      </div>
    </div>
  );
}
const box = { marginTop: 6, padding: '8px 10px', border: '1px solid var(--bd)', borderRadius: 8 };

export default function SpecSheet({
  sales, layers, sheet: saved, onChange, dispatchForm = '', machines: machinesProp = null,
  idPrefix = 'spec', lockTracks = false,
}) {
  const fetched = useApi(machinesProp ? '' : '/api/master/machines');
  const machines = useMemo(() => machinesProp || (Array.isArray(fetched.data) ? fetched.data : []), [machinesProp, fetched.data]);
  const printers = useMemo(() => printingMachines(machines), [machines]);
  const laminators = useMemo(() => laminationMachines(machines), [machines]);

  const sh = sheetOf(saved);
  const set = (patch) => onChange({ ...sh, ...patch });
  const gsm = gsmBreakdown(sales, layers, sh);
  const nLayers = layerCount(layers);
  const kind = sheetKind(dispatchForm);

  const setRun = (key, patch) => set({ print: { ...sh.print, [key]: { ...(sh.print[key] || {}), ...patch } } });
  function togglePrinter(key, on) {
    const print = { ...sh.print };
    if (on) print[key] = print[key] || { ups: '', sleeve: '', tracks: '', tracker: '' };
    else delete print[key];
    // a printing machine dropped takes its laminations with it
    const strip = (lam) => { const o = { ...lam }; if (!on) delete o[key]; return o; };
    set({ print, lam1: strip(sh.lam1), lam2: strip(sh.lam2) });
  }
  const setLam = (stage, pKey, lKey, patch) => {
    const lam = sh[stage] || {};
    const forP = { ...(lam[pKey] || {}) };
    if (patch === null) delete forP[lKey];
    else forP[lKey] = { ...(forP[lKey] || {}), ...patch };
    set({ [stage]: { ...lam, [pKey]: forP } });
  };

  const chosen = printers.filter((m) => sh.print[machineKey(m)]);
  // a machine taken off the master stays on a saved sheet
  const orphanRuns = Object.keys(sh.print).filter((k) => !printers.some((m) => machineKey(m) === k));
  const pName = (key) => machineLabel(machines.find((m) => machineKey(m) === key)) || `Machine ${key}`;

  function lamination(stage, n) {
    const runs = Object.keys(sh.print);
    return (
      <div style={box} aria-label={`Lamination ${n}`}>
        <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>
          {n === 1 ? 'First lamination — secondary substrate' : 'Second lamination — third substrate'}
        </div>
        <div style={{ fontSize: 10, color: 'var(--i3)', marginBottom: 4 }}>
          A roller for every printing machine above. Film width here = stage-1 film width + {10 * n} mm. The roller has to be
          more than the print width (single print width × tracks, no tracker line) + 5 mm and less than the stage-1 film width.
        </div>
        {runs.length > 0 && missingRollers(sh, stage).length > 0 && (
          <div style={{ fontSize: 10, color: '#a07800' }} aria-label={`Lamination ${n} rollers still to pick`}>
            Still to pick a roller for: {missingRollers(sh, stage).map(pName).join(', ')}.
          </div>
        )}
        {runs.length === 0 ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>Pick a printing machine above first.</div>
          : runs.map((pKey) => {
            const f = printFigures(sh, sh.print[pKey], toolingFor(sales, pKey));
            const lam = (sh[stage] || {})[pKey] || {};
            return (
              <div key={pKey} style={{ borderTop: '1px dashed var(--bd)', paddingTop: 6, marginTop: 6 }} aria-label={`Lamination ${n} for ${pName(pKey)}`}>
                <div style={{ fontSize: 12, fontWeight: 700 }}>
                  For {pName(pKey)}: print width {fmt(f.printWidth) || '—'} mm · film width {fmt(laminatedWidth(f.filmWidth, n)) || '—'} mm
                </div>
                {laminators.length === 0 && <div className="al al-y" style={{ fontSize: 11 }}>No lamination machines yet — the Super Admin adds them under Drop-down selections → Machines (Lamination department).</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, margin: '4px 0' }}>
                  {laminators.map((lm) => {
                    const lKey = machineKey(lm);
                    return (
                      <label key={lKey} className="cb" style={{ fontSize: 12 }}>
                        <input type="checkbox" checked={!!lam[lKey]} aria-label={`Lamination ${n} ${pName(pKey)} on ${machineLabel(lm)}`}
                          onChange={(e) => setLam(stage, pKey, lKey, e.target.checked ? { roller: '', comment: '' } : null)} />
                        <span>{machineLabel(lm)}</span>
                      </label>
                    );
                  })}
                </div>
                {Object.entries(lam).map(([lKey, pick]) => {
                  const lm = machines.find((m) => machineKey(m) === lKey);
                  const rc = rollerChoices(toolingFor(sales, lKey).rollers, f.printWidth, f.filmWidth);
                  const cur = String((pick && pick.roller) || '');
                  const lbl = `${pName(pKey)} · ${machineLabel(lm) || lKey}`;
                  return (
                    <div className="g3" key={lKey}>
                      <div className="fg">
                        <label>Roller on {machineLabel(lm) || lKey} (mm)</label>
                        <select value={cur} aria-label={`Lamination ${n} roller ${lbl}`} onChange={(e) => setLam(stage, pKey, lKey, { roller: e.target.value })}>
                          <option value="">{rc.options.length ? '— select —' : '— no roller fits —'}</option>
                          {cur && !rc.options.map(String).includes(cur) && <option value={cur}>{cur} (current)</option>}
                          {rc.options.map((w) => <option key={w} value={String(w)}>{w}</option>)}
                        </select>
                        <div style={{ fontSize: 10, color: rc.fallback ? '#a07800' : 'var(--i3)', marginTop: 2 }} aria-label={`Lamination ${n} roller rule ${lbl}`}>
                          {f.printWidth > 0
                            ? (rc.fallback
                              ? `No roller between ${rc.lo} and ${rc.hi} mm — showing every roller over ${rc.lo} mm; say why in the comment.`
                              : `Rollers over ${rc.lo} mm and under ${rc.hi} mm.`)
                            : 'Enter the tracks above to narrow the rollers.'}
                        </div>
                      </div>
                      <div className="fg" style={{ gridColumn: 'span 2' }}>
                        <label>QC comment</label>
                        <input value={(pick && pick.comment) || ''} aria-label={`Lamination ${n} comment ${lbl}`}
                          onChange={(e) => setLam(stage, pKey, lKey, { comment: e.target.value })} />
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>
    );
  }

  const pouch = kind === 'pouch' ? pouchFigures(sh, gsm.total) : null;
  const sleeve = kind === 'sleeve' ? sleeveFigures(sh, gsm.total) : null;
  const label = kind === 'label' ? labelFigures(sh, gsm.total) : null;
  const g = gussetSplit(sh.gusset_type, sh.gusset_total);

  return (
    <div aria-label="Specifications sheet">
      {/* ── GSM of each substrate ─────────────────────────────────────── */}
      <div style={box} aria-label="GSM build-up">
        <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>GSM</div>
        <div style={{ fontSize: 10, color: 'var(--i3)', marginBottom: 4 }}>
          GSM = density × micron, density from the Super Admin’s Drop-down selections → Material Densities. Ink GSM is on the
          primary substrate; the secondary and third each carry their adhesive GSM.
        </div>
        {nLayers === 0 ? <div style={{ fontSize: 11, color: 'var(--i3)' }}>Pick the substrates above — their GSM is worked out here.</div>
          : (
            <table style={{ width: '100%' }}>
              <thead><tr><th>Substrate</th><th style={{ textAlign: 'right' }}>Micron</th><th style={{ textAlign: 'right' }}>Density</th><th style={{ width: 120 }}>GSM</th><th style={{ width: 120 }}>Ink GSM</th><th style={{ width: 120 }}>Adhesive GSM</th></tr></thead>
              <tbody>
                {gsm.rows.map((r, i) => (r.used ? (
                  <tr key={i}>
                    <td style={{ fontSize: 12 }}><b>{LAYER_NAMES[i]}</b> · {r.material}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{r.micron || '—'}</td>
                    <td style={{ textAlign: 'right', fontSize: 12 }}>{r.density != null ? r.density : <span style={{ color: '#a07800' }} title="No density for this material — type the GSM">none</span>}</td>
                    <td>
                      {r.auto
                        ? <input readOnly tabIndex={-1} value={r.gsm} aria-label={`${LAYER_NAMES[i]} GSM`} style={{ background: 'var(--bg)', fontWeight: 700 }} />
                        : <input type="number" step="any" min="0" className="nospin" value={sh.layer_gsm[i] ?? ''} aria-label={`${LAYER_NAMES[i]} GSM`}
                          placeholder={r.density == null ? 'type GSM' : 'pick the micron'}
                          onChange={(e) => set({ layer_gsm: sh.layer_gsm.map((v, j) => (j === i ? e.target.value : v)) })} />}
                    </td>
                    <td>{i === 0 ? <input type="number" step="any" min="0" className="nospin" value={sh.ink_gsm ?? ''} aria-label="Ink GSM" onChange={(e) => set({ ink_gsm: e.target.value })} /> : null}</td>
                    <td>{i > 0 ? <input type="number" step="any" min="0" className="nospin" value={sh[`adhesive_gsm${i + 1}`] ?? ''} aria-label={`${LAYER_NAMES[i]} Adhesive GSM`} onChange={(e) => set({ [`adhesive_gsm${i + 1}`]: e.target.value })} /> : null}</td>
                  </tr>
                ) : null))}
              </tbody>
            </table>
          )}
        <div style={{ marginTop: 6, fontSize: 13 }} aria-label="Total GSM">
          Total GSM: <b>{gsm.total || 0}</b>
          <span style={{ fontSize: 10, color: 'var(--i3)', marginLeft: 8 }}>
            substrates {gsm.rows.filter((r) => r.used).map((r) => r.gsm || 0).join(' + ') || 0} + ink {gsm.ink} + adhesive {gsm.adhesive}
          </span>
        </div>
      </div>

      {/* ── printing ─────────────────────────────────────────────────── */}
      <div style={box} aria-label="Printing">
        <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>Printing</div>
        <div className="g4">
          <div className="fg"><label>Coating</label><input value={sh.coating ?? ''} aria-label="Coating" onChange={(e) => set({ coating: e.target.value })} /></div>
          <Num label="Single print repeat" unit="mm" value={sh.single_repeat} onChange={(v) => set({ single_repeat: v })} />
          <Num label="Single print width" unit="mm" value={sh.single_width} onChange={(v) => set({ single_width: v })} />
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, marginTop: 4 }}>Printing machines</div>
        {printers.length === 0 && <div className="al al-y" style={{ fontSize: 11 }}>No printing machines yet — the Super Admin adds them under Drop-down selections → Machines (Printing department).</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, margin: '4px 0' }}>
          {printers.map((m) => (
            <label key={machineKey(m)} className="cb" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={!!sh.print[machineKey(m)]} aria-label={`Print on ${machineLabel(m)}`}
                onChange={(e) => togglePrinter(machineKey(m), e.target.checked)} />
              <span>{machineLabel(m)}</span>
            </label>
          ))}
        </div>
        {[...chosen.map(machineKey), ...orphanRuns].map((key) => {
          const run = sh.print[key] || {};
          const tool = toolingFor(sales, key);
          const f = printFigures(sh, run, tool);
          const sc = sleeveChoices(tool.sleeves, f.repeat);
          const nm = pName(key);
          return (
            <div key={key} style={{ borderTop: '1px dashed var(--bd)', paddingTop: 6, marginTop: 6 }} aria-label={`Printing on ${nm}`}>
              <div style={{ fontSize: 12, fontWeight: 700 }}>{nm}{tool.maxWidth > 0 ? <span style={{ fontWeight: 400, color: 'var(--i3)' }}> · max film width {tool.maxWidth} mm</span> : null}</div>
              <div className="g4">
                <Num label="Ups" value={run.ups} aria={`${nm} ups`} onChange={(v) => setRun(key, { ups: v })} />
                <Out label="Print repeat (mm)" aria={`${nm} print repeat`} value={f.repeat}
                  how={`${run.ups || 0} ups × ${sh.single_repeat || 0} mm`} />
                <div className="fg">
                  <label>Sleeve repeat (mm)</label>
                  <select value={String(run.sleeve || '')} aria-label={`${nm} sleeve`} onChange={(e) => setRun(key, { sleeve: e.target.value })}>
                    <option value="">{sc.options.length ? '— select —' : '— no sleeves for this machine —'}</option>
                    {run.sleeve && !sc.options.map(String).includes(String(run.sleeve)) && <option value={String(run.sleeve)}>{run.sleeve} (current)</option>}
                    {sc.options.map((x) => <option key={x} value={String(x)}>{x}</option>)}
                  </select>
                  <div style={{ fontSize: 10, color: sc.fallback ? '#a07800' : 'var(--i3)', marginTop: 2 }}>
                    {sc.fallback ? `No sleeve of ${f.repeat} mm or more — every sleeve of the machine shown.` : f.repeat > 0 ? `Sleeves of ${f.repeat} mm or more.` : 'From the Super Admin’s sleeve list for this machine.'}
                  </div>
                </div>
                <div />
                <Num label="Number of tracks" value={run.tracks} aria={`${nm} tracks`} disabled={lockTracks} onChange={(v) => setRun(key, { tracks: v })} />
                <Num label="Tracker line" unit="mm" value={run.tracker} aria={`${nm} tracker line`} disabled={lockTracks} onChange={(v) => setRun(key, { tracker: v })} />
                <Out label="Film width (mm)" aria={`${nm} film width`} value={f.filmWidth} bad={f.tooWide}
                  how={`${run.tracks || 0} tracks × ${sh.single_width || 0} mm + ${run.tracker || 0} mm tracker line`} />
              </div>
              {f.tooWide && (
                <div className="al al-r" role="alert" aria-label={`${nm} film width too wide`} style={{ fontSize: 12 }}>
                  ⚠ Film width {f.filmWidth} mm is more than {nm} takes ({f.max} mm)
                  {f.maxTracks != null ? ` — reduce to ${f.maxTracks} track(s) or fewer` : ''}. The report cannot be saved like this.
                </div>
              )}
            </div>
          );
        })}
        {lockTracks && <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Tracks are fixed — this report has been sent for quotation.</div>}
      </div>

      {nLayers >= 2 && lamination('lam1', 1)}
      {nLayers >= 3 && lamination('lam2', 2)}

      {/* ── the dispatch form ────────────────────────────────────────── */}
      {kind === 'pouch' && (
        <div style={box} aria-label="Pouch specifications">
          <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>{dispatchForm || 'Pouch'} — specifications</div>
          <div className="g4">
            <Radios label="Gusset" name={`${idPrefix}-gusset`} value={sh.gusset_type} options={GUSSET_TYPES} onChange={(v) => set({ gusset_type: v })} />
            <Num label="Total gusset" unit="mm" value={sh.gusset_total} onChange={(v) => set({ gusset_total: v })} />
            <Out label="Each gusset fold (mm)" value={g.each}
              how={g.folds ? `${g.total} ÷ ${g.folds} (${/bottom/i.test(sh.gusset_type) ? 'bottom' : 'side'} gusset)` : 'Pick side or bottom gusset'} />
            <div />
            <Radios label="Seal" name={`${idPrefix}-seal`} value={sh.seal_type} options={SEAL_TYPES} onChange={(v) => set({ seal_type: v })} />
            <Toggle label="With glue" value={sh.with_glue} onChange={(v) => set({ with_glue: v })} />
            <Toggle label="With zipper" value={sh.zipper} onChange={(v) => set({ zipper: v })} />
            <div />
            <Num label="Individual pouch height" unit="mm" value={sh.pouch_height} onChange={(v) => set({ pouch_height: v })} />
            <Num label="Flap" unit="mm" value={sh.flap} onChange={(v) => set({ flap: v })} />
            <Num label="Individual pouch width" unit="mm" value={sh.pouch_width} onChange={(v) => set({ pouch_width: v })} />
            <div />
            <div className="fg">
              <label>{pouch.three ? 'Side seal width' : 'Side / centre seal width'} (mm)</label>
              <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input type="number" step="any" min="0" className="nospin" value={sh.seal_a ?? ''} aria-label="Seal width A" style={{ flex: 1, minWidth: 0 }}
                  onChange={(e) => {
                    const v = e.target.value;
                    // "as soon as I enter, say, 5 mm in one of the numeric fields, then
                    // automatically in the other numeric field also 5 should be entered"
                    const mirror = sh.seal_b === '' || sh.seal_b == null || String(sh.seal_b) === String(sh.seal_a);
                    set(mirror ? { seal_a: v, seal_b: v } : { seal_a: v });
                  }} />
                <span style={{ fontWeight: 700 }}>+</span>
                <input type="number" step="any" min="0" className="nospin" value={sh.seal_b ?? ''} aria-label="Seal width B" style={{ flex: 1, minWidth: 0 }}
                  onChange={(e) => set({ seal_b: e.target.value })} />
              </div>
            </div>
            <Out label="Total seal width (mm)" value={pouch.seal} how={`${sh.seal_a || 0} + ${sh.seal_b || 0}`} />
            {pouch.three ? <Num label="Bottom seal width" unit="mm" value={sh.bottom_seal} onChange={(v) => set({ bottom_seal: v })} /> : <div />}
            <Num label="GSM for the weight" value={sh.gsm_override} aria="GSM for the weight" onChange={(v) => set({ gsm_override: v })} />
          </div>
          <div className="g4" aria-label="Pouch weight">
            <Out label="Height (mm)" value={pouch.height}
              how={`${sh.pouch_height || 0}${pouch.three ? ` + ${pouch.bottomSeal} × 2 bottom seal` : ''} + ${g.bottom} bottom gusset + ${sh.flap || 0} flap`} />
            <Out label="Width (mm)" value={pouch.width} how={`${sh.pouch_width || 0} + ${pouch.seal} seal + ${g.side} side gusset`} />
            <Out label="Pouch weight (g)" value={pouch.weight} how={`height × width × ${pouch.gsm || 0} GSM × 1.02 ÷ 1,000,000`} />
            <Out label="Pouches per kg" value={pouch.perKg} how="1000 ÷ pouch weight" />
          </div>
          {!(Number(sh.gsm_override) > 0) && <div style={{ fontSize: 10, color: 'var(--i3)' }}>The weight uses the total GSM of the substrates ({gsm.total || 0}) — type a GSM above to use another.</div>}
        </div>
      )}

      {kind === 'sleeve' && (
        <div style={box} aria-label="Sleeve specifications">
          <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>{dispatchForm || 'Sleeve'} — specifications</div>
          <div className="g4">
            <Num label="Sleeve height" unit="mm" value={sh.sleeve_height} onChange={(v) => set({ sleeve_height: v })} />
            <Num label="Sleeve width" unit="mm" value={sh.sleeve_width} onChange={(v) => set({ sleeve_width: v })} />
            <Num label="Overlap width" unit="mm" value={sh.overlap} onChange={(v) => set({ overlap: v })} />
            <Num label="Open width" unit="mm" value={sh.open_width} onChange={(v) => set({ open_width: v })} />
            <Toggle label="Reverse glue" value={sh.reverse_glue} onChange={(v) => set({ reverse_glue: v })} />
            <Num label="GSM for the weight" value={sh.gsm_override} aria="GSM for the weight" onChange={(v) => set({ gsm_override: v })} />
            <Out label="Sleeve weight (g)" value={sleeve.weight} how={`${sh.sleeve_height || 0} × ${sh.open_width || 0} × ${sleeve.gsm || 0} GSM × 1.02 ÷ 1,000,000`} />
            <Out label="Sleeves per kg" value={sleeve.perKg} how="1000 ÷ sleeve weight" />
          </div>
        </div>
      )}

      {kind === 'label' && (
        <div style={box} aria-label="Label specifications">
          <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>{dispatchForm || 'Label'} — specifications</div>
          <div className="g4">
            <Num label="Label height" unit="mm" value={sh.label_height} onChange={(v) => set({ label_height: v })} />
            <Num label="Bleed (height)" unit="mm" value={sh.bleed_h} onChange={(v) => set({ bleed_h: v })} />
            <Out label="Effective height (mm)" value={label.effH} how={`${sh.label_height || 0} + ${sh.bleed_h || 0} bleed`} />
            <Num label="GSM for the weight" value={sh.gsm_override} aria="GSM for the weight" onChange={(v) => set({ gsm_override: v })} />
            <Num label="Label width" unit="mm" value={sh.label_width} onChange={(v) => set({ label_width: v })} />
            <Num label="Bleed (width)" unit="mm" value={sh.bleed_w} onChange={(v) => set({ bleed_w: v })} />
            <Out label="Effective width (mm)" value={label.effW} how={`${sh.label_width || 0} + ${sh.bleed_w || 0} bleed`} />
            <Out label="Label weight (g)" value={label.weight} how={`effective height × effective width × ${label.gsm || 0} GSM × 1.02 ÷ 1,000,000`} />
          </div>
        </div>
      )}

      {kind === 'roll' && (
        <div style={box} aria-label="Roll specifications">
          <div className="ctitle" style={{ fontSize: 12, margin: 0 }}>{dispatchForm || 'Roll'} — specifications</div>
          <div className="g4">
            <Num label="Core" unit="inches" value={sh.core_in} aria="Core (inches)" onChange={(v) => set({ core_in: v })} />
            <Num label="Per reel" unit="Kgs" value={sh.per_reel_kg} aria="Per reel (Kgs)" onChange={(v) => set({ per_reel_kg: v })} />
          </div>
        </div>
      )}

      {/* ── packing ─────────────────────────────────────────────────── */}
      <div style={box} aria-label="Packing">
        <div className="fg" style={{ margin: 0 }}>
          <label>Packing material / packing specifications</label>
          <textarea rows={2} value={sh.packing ?? ''} aria-label="Packing specifications" onChange={(e) => set({ packing: e.target.value })}
            placeholder="from the sales rep’s Add SKU — edit as needed" />
        </div>
      </div>
    </div>
  );
}

/**
 * The sheet read-only — the CSA report view and anywhere a saved sheet is shown.
 * Only what was entered is listed.
 */
export function SpecSummary({ sales, layers, sheet, dispatchForm = '', machines = [] }) {
  if (sheetIsBlank(sheet)) return null;
  const sh = sheetOf(sheet);
  const gsm = gsmBreakdown(sales, layers, sh);
  const kind = sheetKind(dispatchForm);
  const name = (key) => machineLabel(machines.find((m) => machineKey(m) === key)) || `Machine ${key}`;
  const rows = [];
  const add = (k, v) => { if (v !== '' && v != null && v !== 0 && String(v) !== '0') rows.push([k, String(v)]); };
  gsm.rows.forEach((r, i) => { if (r.used) add(`${LAYER_NAMES[i]} GSM`, r.gsm); });
  add('Ink GSM', gsm.ink); add('Adhesive GSM', gsm.adhesive); add('Total GSM', gsm.total);
  add('Coating', sh.coating); add('Single print repeat', sh.single_repeat ? sh.single_repeat + ' mm' : '');
  add('Single print width', sh.single_width ? sh.single_width + ' mm' : '');
  Object.entries(sh.print).forEach(([key, run]) => {
    const f = printFigures(sh, run, toolingFor(sales, key));
    add(`${name(key)}`, [run.ups ? `${run.ups} ups` : '', f.repeat ? `repeat ${f.repeat} mm` : '', run.sleeve ? `sleeve ${run.sleeve} mm` : '',
      run.tracks ? `${run.tracks} tracks` : '', run.tracker ? `tracker ${run.tracker} mm` : '', f.filmWidth ? `film ${f.filmWidth} mm` : ''].filter(Boolean).join(' · '));
    ['lam1', 'lam2'].forEach((stage, si) => {
      Object.entries((sh[stage] || {})[key] || {}).forEach(([lKey, pick]) => {
        add(`Lamination ${si + 1} · ${name(key)} → ${name(lKey)}`, [pick.roller ? `roller ${pick.roller} mm` : 'no roller', `film ${laminatedWidth(f.filmWidth, si + 1) || '—'} mm`, pick.comment].filter(Boolean).join(' · '));
      });
    });
  });
  if (kind === 'pouch') {
    const p = pouchFigures(sh, gsm.total);
    add('Gusset', sh.gusset_type ? `${sh.gusset_type} ${sh.gusset_total || 0} mm` : '');
    add('Seal', [sh.seal_type, p.seal ? `${p.seal} mm` : '', p.three && sh.bottom_seal ? `bottom ${sh.bottom_seal} mm` : ''].filter(Boolean).join(' · '));
    add('With glue', sh.with_glue === 'Yes' ? 'Yes' : ''); add('Zipper', sh.zipper === 'Yes' ? 'Yes' : '');
    add('Pouch (H × W)', p.height && p.width ? `${p.height} × ${p.width} mm` : '');
    add('Flap', sh.flap ? sh.flap + ' mm' : '');
    add('Pouch weight', p.weight ? p.weight + ' g' : ''); add('Pouches per kg', p.perKg);
  } else if (kind === 'sleeve') {
    const sf = sleeveFigures(sh, gsm.total);
    add('Sleeve (H × W)', sh.sleeve_height ? `${sh.sleeve_height} × ${sh.sleeve_width || 0} mm` : '');
    add('Overlap', sh.overlap ? sh.overlap + ' mm' : ''); add('Open width', sh.open_width ? sh.open_width + ' mm' : '');
    add('Reverse glue', sh.reverse_glue === 'Yes' ? 'Yes' : ''); add('Sleeve weight', sf.weight ? sf.weight + ' g' : '');
  } else if (kind === 'label') {
    const lf = labelFigures(sh, gsm.total);
    add('Effective size (H × W)', lf.effH ? `${lf.effH} × ${lf.effW} mm` : ''); add('Label weight', lf.weight ? lf.weight + ' g' : '');
  } else if (kind === 'roll') {
    add('Core', sh.core_in ? sh.core_in + ' in' : ''); add('Per reel', sh.per_reel_kg ? sh.per_reel_kg + ' kg' : '');
  }
  add('Packing', sh.packing);
  if (!rows.length) return null;
  return (
    <div style={{ marginTop: 8 }} aria-label="Specifications summary">
      <div className="ctitle" style={{ fontSize: 12 }}>Specifications</div>
      <div className="g2">
        {rows.map(([k, v], i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, borderBottom: '1px dashed var(--bd)', padding: '4px 0' }}>
            <span style={{ color: 'var(--i3)', fontSize: 12 }}>{k}</span>
            <span style={{ fontWeight: 700, fontSize: 12, textAlign: 'right' }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
