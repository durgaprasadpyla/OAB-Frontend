import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { ordersApi } from '../api.js';
import { useApi } from '../lib/useApi.js';
import { pouchWeightJSS } from '../lib/calc.js';
import { specGroup } from '../lib/master.js';
import { exportAOA, readSheetAOA } from '../lib/xlsx.js';
import SpecFields from './SpecFields.jsx';
import { layerFields, layersOfSpec, layerCountFor, materialOptions } from '../lib/jssSpec.js';
import { ddList } from '../lib/dropdowns.js';
import { specIndex, duplicateSpecs, specKey } from '../lib/specs.js';
import { effectiveDespatchList } from '../lib/despatchSync.js';

/* ─────────────────────────── JSS Editor ───────────────────────────
 * Every JSS spec, edited with the same fields QC creates one with. Lived inside the
 * Super Admin Dashboard until 30.09 §QC asked for a login that does this and
 * nothing else ("ONLY the JSS editor functionality that exists in super admin …
 * one-time job for ~500 JSSs"), so it is one component now — the Dashboard's
 * '📋 JSS Editor' tab and the JSS login's page render the same thing.
 */

const clone = (o) => JSON.parse(JSON.stringify(o));

// Dispatch-form + status option lists, matching the legacy JSS editor.
// The built-in list the editor always offers; the Super Admin's "Dispatch Forms"
// drop-down list (Shrink Sleeve …) is merged in at render, so the JSS editor and
// QC's Add JSS Spec offer the same forms.
const JSS_DISP_FORMS = ['Pouch', 'Roll', 'Bulk Bags', 'Label', 'Sleeve', 'Punch', 'Lids', 'Roll Form'];
const JSS_STATUSES = ['Active', 'Sample', 'Inactive', 'Redundant'];
const JSS_STATUS_FILTERS = [
  ['all', 'All Status'], ['active', 'Active Only'], ['sample', 'Sample Only'], ['inactive', 'Inactive Only'], ['redundant', 'Redundant Only'],
  // 30.09 §QC: the one-time job is working through the specs whose structure has not
  // been built from the Item Master yet — this is that worklist.
  ['unstructured', 'Not yet built from the Item Master'],
];
// Legacy JSS-editor look (renderJSSEdit): compact bordered cells + a green sticky header.
const jssTh = { padding: '7px 8px', textAlign: 'left', fontSize: 11, whiteSpace: 'nowrap', color: '#fff', background: 'var(--g)' };
const jssTd = { padding: '3px 5px' };
// [field, header label, min-width] — exact legacy column order (no Gusset; Spec editable).
const JSS_COLS = [
  ['spec', 'Spec No.*', 80], ['jobType', 'Job Type', 100], ['group', 'Group', 120], ['customer', 'Customer', 140],
  ['subBrand', 'Sub Brand', 100], ['jobName', 'Job Name*', 200], ['mic', 'MIC', 60],
  // 24.09: the structure as it is now built — the composed Material, then the layers
  // behind it, so a laminate reads as what it is made of rather than one string.
  ['gsm', 'GSM', 60], ['material', 'Material*', 130], ['structure', 'Structure', 200], ['filmWidth', 'Film W', 70], ['width', 'W', 50],
  ['height', 'H', 50], ['pouchWeight', 'Pouch Wt (g)', 100], ['qtyPerBag', 'Qty/Bag', 70], ['dispatchForm', 'Disp Form*', 80],
  ['status', 'Status', 80],
];
// What a spec carries onto the OAB rows on it: an SO copies these at PO time, and a
// spec re-tagged afterwards (A1404: Label → Shrink Sleeve) must reach its orders too.
const IDENTITY = ['customer', 'subBrand', 'jobName', 'dispatchForm', 'jobType'];

/**
 * Has this spec's structure been built from the Item Master? Its primary layer has
 * to name a film / paper sub-group the Item Master holds — a legacy material text
 * copied into the layer ("BOPP", not on the master) does not count. With the master
 * unreadable, a recorded primary layer is the best that can be said.
 */
function isStructured(row, materials) {
  const m = specKey(row && row.material1);
  if (!m) return false;
  return materials.size === 0 || materials.has(m);
}

const okMsg = (m) => m.startsWith('✅') || m.startsWith('🗑') || m.startsWith('Imported');

export default function JssEditor() {
  const { mods, save, reloadModule } = useData();
  const { role } = useAuth() || {};
  const customers = mods.customers || [];
  const [rows, setRows] = useState(() => clone(mods.jss || []));
  // JSS+QC 24.09 §24: "I should be able to edit all the existing JSS from the super
  // admin login based on the above criteria" — so this edits with the SAME form QC
  // creates a spec with (SpecFields), over the same Item Master dropdowns.
  const jobTypes = useMemo(() => ddList(mods.sales, 'jobTypes'), [mods.sales]);
  const dispForms = useMemo(() => {
    const out = [...JSS_DISP_FORMS];
    effectiveDespatchList(mods.sales).forEach((f) => { if (!out.some((o) => o.toLowerCase() === String(f).toLowerCase())) out.push(f); });
    return out;
  }, [mods.sales]);
  // The Item Master, read once here and handed to the form — the progress count
  // below needs it too, and one read serves both.
  const master = useApi('/api/master/items');
  const items = useMemo(() => (Array.isArray(master.data) ? master.data : []), [master.data]);
  const materials = useMemo(() => new Set(materialOptions(items).map(specKey)), [items]);

  const [q, setQ] = useState('');
  const [statusFil, setStatusFil] = useState('all');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  // Issues 22.09: the table is READ-ONLY and a RADIO picks the row to work on —
  // "I want a radio button selection against each of these rows. Just like a
  // customer item, I should be able to edit whatever data the QC has added in the
  // same format on the top". Typing straight into the grid is what let a spec be
  // half-edited (a dispatch form typed over, a spec code re-used), so the fields
  // are now the same guided ones QC creates a spec with.
  const [sel, setSel] = useState(-1);          // index into `rows`, -1 = nothing picked
  const [form, setForm] = useState(null);      // the picked row, being edited
  const selRef = useRef(sel);
  selRef.current = sel;
  const pickedRef = useRef('');                // the picked row's code, as the master holds it

  // The master changed under the editor — this editor's own save (applied
  // optimistically, mid-save), its rollback, or another writer's copy after a 409.
  // The table re-reads it. The picked row stays picked while the master still holds
  // that spec at that place: wiping it here is what made every save reopen with no
  // radio checked, and the NEXT save then wrote `rows[-1]` — lost, while the screen
  // said saved. A row that is gone or moved is let go.
  useEffect(() => {
    const next = clone(mods.jss || []);
    setRows(next);
    const i = selRef.current;
    if (i < 0) return;
    if (!next[i] || specKey(next[i].spec) !== pickedRef.current) { setSel(-1); setForm(null); }
  }, [mods.jss]);

  // A code on more than one row is a data fault: every screen now reads the same
  // row (specs.js), but the other copy is still there to be deleted.
  const dupes = useMemo(() => duplicateSpecs(rows), [rows]);
  const structured = useMemo(() => rows.filter((r) => isStructured(r, materials)).length, [rows, materials]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  function openRow(i, list = rows) {
    setSel(i);
    pickedRef.current = specKey(list[i] && list[i].spec);
    // A spec saved before the layers existed opens on what it actually says — its
    // composed material becomes the primary layer (layersOfSpec).
    setForm({ ...list[i], layers: layersOfSpec(list[i]) });
  }
  function pick(i) { openRow(i); setMsg(''); }
  function recalcPW() {
    const pw = pouchWeightJSS(form);
    if (pw) set({ pouchWeight: Number(pw.toFixed(6)) });
    else setMsg('Pouch weight needs Height, Width and GSM on this spec.');
  }

  const filtered = rows.map((r, i) => ({ r, i })).filter(({ r }) => {
    if (statusFil === 'unstructured') { if (isStructured(r, materials)) return false; }
    else if (statusFil !== 'all' && String(r.status || '').toLowerCase() !== statusFil) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.spec, r.customer, r.jobName, specGroup(r, customers), r.material, r.subBrand]
      .some((v) => String(v || '').toLowerCase().includes(s));
  });

  /**
   * Carry each touched code's identity onto the OAB rows on that spec. The server
   * does it (POST /api/oab-rows/sync-spec) for every role alike — the JSS login may
   * neither read nor write module 1, and copying the whole order book through the
   * browser just to change a dispatch form on a few rows was never necessary.
   * Returns how many order rows changed.
   */
  async function syncOrders(next, codes) {
    const idx = specIndex(next);
    const specs = [...new Set(codes.map(specKey).filter(Boolean))]
      .map((k) => idx[k]).filter(Boolean)
      .map((j) => ({ spec: j.spec, ...Object.fromEntries(IDENTITY.map((f) => [f, String(j[f] ?? '')])) }));
    if (!specs.length) return 0;
    try {
      const r = await ordersApi.syncSpecIdentity(specs);
      if (r && typeof r === 'object' && !Array.isArray(r) && Number.isFinite(Number(r.updated))) {
        const updated = Number(r.updated);
        // the JSS login cannot read module 1 — there is nothing of it here to refresh
        if (updated > 0 && role !== 'jss') await reloadModule('oab');
        return updated;
      }
    } catch (e) {
      if (![403, 404, 405].includes(e && e.status)) throw e;
    }
    // A backend from before the sync endpoint: carry it in the module-1 blob, as the
    // editor always did (only a role that may write module 1 can).
    if (role === 'jss') return 0;
    const nextOab = clone(mods.oab); let changed = 0;
    ['SF', 'OT'].forEach((key) => ((nextOab.OAB && nextOab.OAB[key]) || []).forEach((r) => {
      const j = idx[specKey(r.spec)]; if (!j) return;
      let dirty = false;
      IDENTITY.forEach((f) => { if (j[f] && r[f] !== j[f]) { r[f] = j[f]; dirty = true; } });
      if (dirty) changed += 1;
    }));
    if (changed) await save('oab', nextOab);
    return changed;
  }

  /** Write `next` to module 2 and carry the identity fields of `codes` onto the OAB rows. */
  async function persist(next, note, codes) {
    await save('jss', next);
    let tail = '';
    try {
      const n = await syncOrders(next, codes);
      if (n > 0) tail = ` · ${n} order row${n === 1 ? '' : 's'} synced`;
    } catch (e) {
      // the spec IS saved — say so, and say what did not follow it
      setMsg(`⚠ ${note} — but the open orders were not updated: ${e.message}`);
      return;
    }
    setMsg(`✅ ${note}${tail}`);
    setTimeout(() => setMsg((m) => (m.startsWith('✅') ? '' : m)), 4000);
  }

  /** Save the picked row back into the master; `andNext` then opens the next row in the list. */
  async function saveRow(andNext = false) {
    if (sel < 0 || !rows[sel] || !form) { setMsg('Pick a spec with its radio first.'); return; }
    const next = [...rows];
    const spec = String(form.spec || '').trim();
    if (!spec) { setMsg('A Spec No. is required.'); return; }
    if (!String(form.jobName || '').trim()) { setMsg('A Job Name is required.'); return; }
    // The layers the form is holding, composed into the Material string every other
    // screen reads. With no layer picked at all, the row keeps the material it came
    // with — writing the empty composition over it would silently lose the spec's film.
    const layers = (form.layers || []).slice(0, layerCountFor(form.jobType));
    const composed = layers.some((l) => String((l && l.material) || '').trim())
      ? layerFields(layers)
      : {};
    const material = composed.material || String(form.material || '').trim();
    // Material is required the way QC requires it — but an OLD row that never had one
    // must not be held hostage over it: fixing this spec's status or dispatch form
    // should not mean inventing a material nobody recorded. Clearing one that IS
    // there is refused, because that is a loss.
    const hadMaterial = String(rows[sel].material || '').trim();
    if (!material && hadMaterial) { setMsg('Material cannot be cleared — pick the film this spec runs on.'); return; }
    if (!String(form.dispatchForm || '').trim()) { setMsg('A Dispatch Form is required.'); return; }
    // Re-using a code that another row already holds is how the master ended up with
    // two A1404s reading differently on different screens. Warn before allowing it.
    const clash = next.some((r, i) => i !== sel && specKey(r.spec) === specKey(spec));
    if (clash && !window.confirm(`Spec ${spec} is already on another row.\n\nTwo rows with one code disagree the moment either is edited — the tool will read the Active, most recent one and flag the pair. Keep this code anyway?`)) return;
    // `layers` is the form's own working copy — the spec row keeps the composed
    // fields, not the draft.
    const { layers: _draftLayers, ...rest } = form;   // eslint-disable-line no-unused-vars
    next[sel] = { ...rest, spec, ...composed, material };
    // The row to open after this one: the next in the list as it is shown now.
    const order = filtered.map(({ i }) => i);
    const at = order.indexOf(sel);
    const following = andNext ? (at >= 0 ? order[at + 1] : order.find((i) => i > sel)) : undefined;
    const before = pickedRef.current;
    // the saved row is the picked one under its (possibly re-typed) code
    pickedRef.current = specKey(spec);
    setBusy(true);
    try {
      setRows(next);
      await persist(next, `Spec ${spec} saved${!material ? ' (no material on this spec yet)' : ''}`, [spec]);
      if (andNext && following !== undefined) openRow(following, next);
      else {
        // the form re-reads what was written, layers and all, with its radio still on
        openRow(sel, next);
        if (andNext) setMsg((m) => `${m} · That was the last spec in this list.`);
      }
    } catch (e) {
      pickedRef.current = before;
      setMsg('Save failed: ' + e.message);
    } finally { setBusy(false); }
  }

  async function saveAll() {
    setBusy(true);
    try { await persist(rows, 'JSS saved', rows.map((r) => r.spec)); }
    catch (e) { setMsg('Save failed: ' + e.message); } finally { setBusy(false); }
  }

  // Permanently delete a spec (legacy jssDeleteRow) — persists immediately.
  async function delRow(i) {
    const r = rows[i];
    if (!window.confirm(`Permanently delete spec "${r.spec || '(no spec no.)'}" — ${r.jobName || 'no job name'}?\n\nSale orders / FG history referencing it remain, but the spec is gone. This cannot be undone.`)) return;
    const next = rows.filter((_, j) => j !== i);
    setRows(next);
    if (sel === i) { setSel(-1); setForm(null); }
    else if (sel > i) { setSel(sel - 1); }
    setBusy(true);
    try { await save('jss', next); setMsg('🗑 Spec deleted'); setTimeout(() => setMsg(''), 4000); }
    catch (e) { setMsg('Delete failed: ' + e.message); } finally { setBusy(false); }
  }

  // Export the JSS master to Excel (legacy exportJSSExcel) and import it back
  // (legacy importJSSExcel) — rows are matched by Spec No., updated or appended.
  function exportJSS() {
    const header = JSS_COLS.map(([, label]) => label.replace('*', ''));
    exportAOA([header, ...rows.map((r) => JSS_COLS.map(([k]) => r[k] ?? ''))], 'JSS_Master', 'JSS');
  }
  async function importJSS(file) {
    if (!file) return;
    try {
      const aoa = await readSheetAOA(file);
      if (!aoa || aoa.length < 2) { setMsg('Import: no data rows found'); return; }
      const hdr = aoa[0].map((h) => String(h || '').trim().toLowerCase());
      const idxOf = {};
      JSS_COLS.forEach(([k, label]) => {
        let idx = hdr.indexOf(label.replace('*', '').trim().toLowerCase());
        if (idx < 0) idx = hdr.indexOf(k.toLowerCase());
        if (idx >= 0) idxOf[k] = idx;
      });
      if (idxOf.spec == null) { setMsg('Import: a "Spec No." column is required.'); return; }
      const next = [...rows]; let updated = 0, added = 0;
      for (let r = 1; r < aoa.length; r++) {
        const spec = String(aoa[r][idxOf.spec] ?? '').trim();
        if (!spec) continue;
        const patch = {}; Object.entries(idxOf).forEach(([k, idx]) => { patch[k] = String(aoa[r][idx] ?? '').trim(); });
        // match on the CODE's identity, so an import updates the row that is in force
        // instead of appending a second copy of it
        const at = next.findIndex((x) => specKey(x.spec) === specKey(spec));
        if (at >= 0) { next[at] = { ...next[at], ...patch }; updated++; } else { next.push(patch); added++; }
      }
      setRows(next); setSel(-1); setForm(null);
      setMsg(`Imported ${updated} updated, ${added} added — review, then Save All Changes.`);
    } catch (e) { setMsg('Import failed: ' + e.message); }
  }

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>📋 JSS Editor — edit JSS entries (changes reflect in QC JSS report)</div>
        <span style={{ flex: 1 }} />
        <input placeholder="Search spec / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} aria-label="Search specs" />
        <select value={statusFil} onChange={(e) => setStatusFil(e.target.value)} aria-label="Status filter">
          {JSS_STATUS_FILTERS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <button className="btn btn-g" onClick={saveAll} disabled={busy}>{busy ? 'Saving…' : '💾 Save All Changes'}</button>
        <button className="btn btn-b" onClick={exportJSS}>⬇ Export Excel</button>
        <label className="btn btn-s" title="Import JSS specs (same columns as the export). Existing specs update by Spec No.; new ones are added.">
          ⬆ Import Excel
          <input type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={(e) => { importJSS(e.target.files[0]); e.target.value = ''; }} />
        </label>
      </div>
      <div style={{ fontSize: 11, color: 'var(--i3)', margin: '2px 0 8px' }}>
        Pick a row with its radio button to edit it in the form above the table — the same fields QC creates a spec with. Fields marked * are required.
      </div>

      {/* 30.09 §QC: ~500 specs to structure once — how far that job has got. */}
      <div className="fbar" style={{ gap: 10, margin: '0 0 8px' }} aria-label="Structure progress">
        <span style={{ fontSize: 12 }}>
          <strong>{structured}</strong> of <strong>{rows.length}</strong> specs have their structure from the Item Master
        </span>
        <div style={{ flex: '0 0 160px', height: 6, background: 'var(--bd)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${rows.length ? Math.round((structured / rows.length) * 100) : 0}%`, height: '100%', background: '#1e7e34' }} />
        </div>
        {structured < rows.length && statusFil !== 'unstructured' && (
          <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={() => setStatusFil('unstructured')}>
            Show the {rows.length - structured} still to do
          </button>
        )}
      </div>

      {msg && <div className={'al ' + (okMsg(msg) ? 'al-g' : msg.startsWith('⚠') ? 'al-y' : 'al-r')}>{msg}</div>}

      {/* A code held by two rows: every screen reads the same one now, but the other
          copy is still there and will keep disagreeing until it is deleted. */}
      {dupes.length > 0 && (
        <div className="al al-y" aria-label="Duplicate spec numbers">
          <strong>{dupes.length} spec number{dupes.length > 1 ? 's are' : ' is'} on more than one row.</strong>{' '}
          The tool reads the Active, most recent row of each; delete the stale one to stop them disagreeing.
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {dupes.slice(0, 8).map((d) => (
              <li key={d.code} style={{ fontSize: 11 }}>
                <strong>{d.code}</strong> — {d.count} rows
                {d.differing.length > 0 && <> · they disagree on {d.differing.map((f) => `${f.label} (${f.values.join(' / ')})`).join(', ')}</>}
                {' · in force: '}
                <span className="tag tg" style={{ fontSize: 9 }}>{d.winner.dispatchForm || '—'}{d.winner.status ? ` · ${d.winner.status}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── the picked row, edited the way QC creates one ─────────────────── */}
      {form ? (
        <div className="card" style={{ background: 'var(--bg)', marginBottom: 10 }} aria-label="Edit spec">
          <div className="ctitle">✏ Editing {form.spec || '(no spec no.)'} — {form.jobName || 'no job name'}</div>
          <div className="g4">
            <div className="fg">
              <label>Spec No. *</label>
              <input value={form.spec ?? ''} aria-label="Spec No." style={{ width: '100%' }} onChange={(e) => set({ spec: e.target.value })} />
            </div>
            <div className="fg" />
            <div className="fg" />
            <div className="fg" />
          </div>

          {/* the same fields QC creates a spec with — the Super Admin may additionally
              set a group, customer or sub-brand that is not on file yet */}
          <SpecFields
            form={form}
            onChange={(patch) => set(patch)}
            customers={customers}
            jss={rows}
            jobTypes={jobTypes}
            dispatchOptions={dispForms}
            statuses={JSS_STATUSES}
            items={items}
            canAddNew
            showStatus
          />

          <div className="g4">
            <div className="fg">
              <label>Pouch Weight (g)</label>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <input value={form.pouchWeight ?? ''} aria-label="Pouch Weight" placeholder="auto or enter manually"
                  style={{ flex: 1 }} onChange={(e) => set({ pouchWeight: e.target.value })} />
                <button type="button" className="btn btn-g" onClick={recalcPW} aria-label="Auto-calculate pouch weight"
                  title="Calculate from Height, Width, Gusset & GSM" style={{ height: 32, width: 32, flexShrink: 0, padding: 0 }}>↺</button>
              </div>
            </div>
            <div className="fg" />
            <div className="fg" />
            <div className="fg" />
          </div>

          <div className="act">
            <button className="btn btn-g" onClick={() => saveRow(false)} disabled={busy}>{busy ? 'Saving…' : '💾 Save spec'}</button>
            {/* 30.09 §QC: one spec after another without reaching for the table */}
            <button className="btn btn-b" onClick={() => saveRow(true)} disabled={busy}
              title="Save this spec and open the next one in the list below">💾 Save &amp; next</button>
            <button className="btn btn-s" disabled={busy} onClick={() => { setSel(-1); setForm(null); }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="al al-b">Pick a row below with its radio button to edit that spec here.</div>
      )}

      <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: 'calc(100vh - 300px)' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
          <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
            <tr style={{ background: 'var(--g)' }}>
              <th style={{ ...jssTh, minWidth: 34, textAlign: 'center' }}>Edit</th>
              {JSS_COLS.map(([k, label, w]) => <th key={k} style={{ ...jssTh, minWidth: w }}>{label}</th>)}
              <th style={{ ...jssTh, minWidth: 60, textAlign: 'center' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={JSS_COLS.length + 2} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs match</td></tr>
            ) : filtered.map(({ r, i }, idx) => {
              const dup = dupes.some((d) => d.code === specKey(r.spec));
              return (
                <tr key={i} style={{ background: sel === i ? 'var(--gl)' : (idx % 2 ? '#f8f8f8' : '') }}>
                  <td style={{ ...jssTd, textAlign: 'center' }}>
                    <input type="radio" name="jss-row" checked={sel === i} onChange={() => pick(i)}
                      aria-label={`Edit ${r.spec || 'row ' + (i + 1)}`} style={{ cursor: 'pointer' }} />
                  </td>
                  {JSS_COLS.map(([k]) => (
                    <td key={k} style={{ ...jssTd, fontSize: 11, padding: '5px 5px' }}>
                      {k === 'spec' && dup
                        ? <span title="This spec number is on more than one row">{r[k]} <span className="tag ty" style={{ fontSize: 8 }}>dup</span></span>
                        : (r[k] === 0 ? '0' : (r[k] || ''))}
                    </td>
                  ))}
                  <td style={{ ...jssTd, textAlign: 'center' }}>
                    <button title="Permanently delete this spec" disabled={busy} onClick={() => delRow(i)}
                      style={{ height: 26, padding: '0 10px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 4, fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>Del</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
