import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { inr, fmtDate } from '../lib/format.js';
import { num } from '../lib/calc.js';
import { bomUOM, hasBOM, bomSaveSpec, bomMaterialForSO } from '../lib/bom.js';

// Bill of Materials editor — superadmin only (module 13).
// Defines, per spec, the raw material needed to make a BASE quantity. The Raw
// Material Requirement view then scales that recipe by each open order's balance.
// Ported from the legacy renderBomList / bomEditorHTML / bomSaveSpec.

const ITEM_COLS = [
  { k: 'itemCode', label: 'Item Code', w: 130 },
  { k: 'itemDescription', label: 'Description', w: 220 },
  { k: 'materialType', label: 'Material Type', w: 130 },
  { k: 'subGroup', label: 'Sub Group', w: 120 },
  { k: 'microns', label: 'Microns', w: 80 },
  { k: 'uom', label: 'UOM', w: 80 },
];
const blankItem = () => ({ itemCode: '', itemDescription: '', materialType: '', subGroup: '', microns: '', uom: '', qtyPerBase: '' });

export default function BomPanel() {
  const { mods, save } = useData();
  const { user } = useAuth();
  const bom = mods.bom || {};
  const jss = useMemo(() => (mods.jss || []).filter((j) => String(j.spec || '').trim()), [mods.jss]);

  const [q, setQ] = useState('');
  const [openSpec, setOpenSpec] = useState('');
  const [draft, setDraft] = useState(null);      // { baseQty, meters, width, height, items[] }
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);          // { t, text }
  const [showHistory, setShowHistory] = useState(false);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  // One row per unique spec — a spec repeated across JSS entries has ONE BOM.
  const specs = useMemo(() => {
    const seen = new Map();
    jss.forEach((j) => { const sp = String(j.spec).trim(); if (!seen.has(sp)) seen.set(sp, j); });
    const s = q.trim().toLowerCase();
    return [...seen.entries()]
      .filter(([sp, j]) => !s || [sp, j.customer, j.jobName].some((v) => String(v || '').toLowerCase().includes(s)))
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  }, [jss, q]);

  function openEditor(spec, jssRow) {
    if (openSpec === spec) { setOpenSpec(''); setDraft(null); return; }
    const rec = bom[spec];
    setOpenSpec(spec);
    setShowHistory(false);
    setMsg(null);
    setDraft({
      baseQty: rec?.baseQty ?? '',
      meters: rec?.meters ?? '',
      width: rec?.width ?? jssRow?.width ?? '',
      height: rec?.height ?? jssRow?.height ?? '',
      items: rec?.items?.length ? rec.items.map((r) => ({ ...r })) : [blankItem()],
    });
  }

  const setField = (f, v) => setDraft((d) => ({ ...d, [f]: v }));
  const setItem = (i, f, v) => setDraft((d) => ({ ...d, items: d.items.map((r, j) => (j === i ? { ...r, [f]: v } : r)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
  const removeItem = (i) => setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, j) => j !== i) : [blankItem()] }));

  async function saveSpec(spec, jssRow) {
    setBusy(true);
    try {
      const next = bomSaveSpec(bom, spec, draft, { jssRow, user });
      await save('bom', next);
      flash('g', `✅ BOM saved for ${spec}.`);
    } catch (e) {
      flash('r', '⚠ ' + (e && e.message ? e.message : String(e)));
    } finally { setBusy(false); }
  }

  const rec = openSpec ? bom[openSpec] : null;
  // Live preview: what the current draft would need for one base quantity's worth.
  const previewBase = num(draft?.baseQty);

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🧱 Bill of Materials (BOM)</div>
        <input placeholder="Search spec / customer / job…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <span style={{ flex: 1 }} />
        <span className="tag tgr">{Object.keys(bom).length} defined</span>
      </div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Define the raw material needed to make a base quantity of a spec. The Raw Material
        Requirement view scales this recipe by each open sale order's balance.
      </div>

      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr><th>Spec</th><th>Customer</th><th style={{ minWidth: 200 }}>Job Name</th><th>Dispatch</th><th style={{ textAlign: 'center' }}>BOM</th><th style={{ textAlign: 'center', width: 90 }}></th></tr></thead>
          <tbody>
            {specs.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs match</td></tr>
            ) : specs.map(([spec, j]) => (
              <BomRow
                key={spec} spec={spec} jssRow={j} defined={hasBOM(bom, spec)}
                open={openSpec === spec} onToggle={() => openEditor(spec, j)}
              >
                {openSpec === spec && draft && (
                  <td colSpan={6} style={{ background: 'var(--bg)', padding: '12px 18px' }}>
                    {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
                    <div className="g4" style={{ marginBottom: 10 }}>
                      <div className="fg">
                        <label>Base Quantity * <span style={{ color: 'var(--i3)', fontWeight: 400 }}>({bomUOM(j.dispatchForm)})</span></label>
                        <input type="number" min="0" aria-label="Base quantity" value={draft.baseQty} onChange={(e) => setField('baseQty', e.target.value)} placeholder="e.g. 10000" />
                      </div>
                      <div className="fg"><label>Metres</label><input type="number" min="0" value={draft.meters} onChange={(e) => setField('meters', e.target.value)} /></div>
                      <div className="fg"><label>Width</label><input value={draft.width} onChange={(e) => setField('width', e.target.value)} /></div>
                      <div className="fg"><label>Height</label><input value={draft.height} onChange={(e) => setField('height', e.target.value)} /></div>
                    </div>

                    <div className="tw" style={{ maxHeight: 260 }}>
                      <table>
                        <thead><tr>{ITEM_COLS.map((c) => <th key={c.k} style={{ minWidth: c.w }}>{c.label}</th>)}<th style={{ textAlign: 'right', width: 120 }}>Qty / base *</th><th style={{ width: 40 }}></th></tr></thead>
                        <tbody>
                          {draft.items.map((r, i) => (
                            <tr key={i}>
                              {ITEM_COLS.map((c) => (
                                <td key={c.k}><input value={r[c.k] ?? ''} aria-label={`${c.label} row ${i + 1}`} onChange={(e) => setItem(i, c.k, e.target.value)} style={{ width: '100%' }} /></td>
                              ))}
                              <td><input type="number" min="0" step="any" aria-label={`Qty per base row ${i + 1}`} value={r.qtyPerBase ?? ''} onChange={(e) => setItem(i, 'qtyPerBase', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                              <td style={{ textAlign: 'center' }}>
                                <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} onClick={() => removeItem(i)} title="Remove item">✕</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="fbar" style={{ marginTop: 10 }}>
                      <button className="btn btn-s" onClick={addItem}>+ Add material</button>
                      {rec?.history?.length ? (
                        <button className="btn btn-s" onClick={() => setShowHistory((v) => !v)}>{showHistory ? 'Hide' : 'Show'} history ({rec.history.length})</button>
                      ) : null}
                      <span style={{ flex: 1 }} />
                      <button className="btn btn-g" onClick={() => saveSpec(spec, j)} disabled={busy}>{busy ? 'Saving…' : '💾 Save BOM'}</button>
                    </div>

                    {previewBase > 0 && (
                      <div className="pg-sub" style={{ marginTop: 6 }}>
                        Per <strong>{inr(previewBase)}</strong> {bomUOM(j.dispatchForm)}:{' '}
                        {draft.items.filter((r) => r.itemCode && num(r.qtyPerBase) > 0)
                          .map((r) => `${r.itemCode} ${inr(num(r.qtyPerBase), 2)} ${r.uom || ''}`.trim()).join(' · ') || '—'}
                      </div>
                    )}

                    {showHistory && rec?.history?.length ? (
                      <div className="tw sy" style={{ marginTop: 10, maxHeight: 180 }}>
                        <table>
                          <thead><tr><th style={{ width: 120 }}>When</th><th style={{ width: 120 }}>Who</th><th>Change</th></tr></thead>
                          <tbody>
                            {rec.history.slice().reverse().map((h, i) => (
                              <tr key={i}><td>{fmtDate(String(h.ts).slice(0, 10))}</td><td style={{ fontSize: 11 }}>{h.user || '-'}</td><td style={{ fontSize: 11 }}>{h.note}</td></tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </td>
                )}
              </BomRow>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** One spec row plus, when open, its editor as a full-width sibling row. */
function BomRow({ spec, jssRow, defined, open, onToggle, children }) {
  const items = defined ? 'defined' : '—';
  return (
    <>
      <tr>
        <td><span className="tag tb" style={{ fontSize: 10 }}>{spec}</span></td>
        <td style={{ fontSize: 11 }}>{jssRow.customer || '-'}</td>
        <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{jssRow.jobName || '-'}</td>
        <td style={{ fontSize: 11 }}>{jssRow.dispatchForm || '-'}</td>
        <td style={{ textAlign: 'center' }}>
          {defined ? <span className="tag tgr" style={{ fontSize: 10 }}>{items}</span> : <span style={{ fontSize: 10, color: 'var(--i3)', fontStyle: 'italic' }}>no BOM</span>}
        </td>
        <td style={{ textAlign: 'center' }}>
          <button className="btn btn-s" onClick={onToggle} aria-label={`${open ? 'Close' : 'Edit'} BOM for ${spec}`}>{open ? 'Close' : 'BOM'}</button>
        </td>
      </tr>
      {open && <tr>{children}</tr>}
    </>
  );
}

export { bomMaterialForSO };
