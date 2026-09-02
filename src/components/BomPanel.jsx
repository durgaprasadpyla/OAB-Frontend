import { useCallback, useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import { masterApi, bomApi } from '../api.js';
import { inr, fmtDate } from '../lib/format.js';
import { num } from '../lib/calc.js';
import { bomUOM, hasBOM, bomSaveSpec, bomMaterialForSO } from '../lib/bom.js';
import { specGroup } from '../lib/master.js';
import { exportAOA } from '../lib/xlsx.js';
import { elementToPDF } from '../lib/pdf.js';

// Bill of Materials editor (module 13) — superadmin Dashboard AND the QC
// workspace's "BOM (legacy)" tab. Defines, per spec, the raw material needed to
// make a BASE quantity. The Raw Material Requirement view then scales that
// recipe by each open order's balance. Ported from the legacy renderBomList /
// bomEditorHTML / bomSaveSpec / bomFillFromCode / bomExportExcel / bomExportPDF.

const blankItem = () => ({ itemCode: '', itemDescription: '', materialType: '', subGroup: '', microns: '', uom: '', qtyPerBase: '' });
const DATALIST_ID = 'bom-item-code-list';

const uniqSorted = (arr) => [...new Set(arr)].sort((a, b) => String(a).localeCompare(String(b)));
// Show the stored value even when the current Item Master no longer lists it, so
// an older BOM never loses its selection just because the catalog changed.
const withCurrent = (opts, cur) => (cur && !opts.includes(cur) ? [cur, ...opts] : opts);
const safeName = (s) => String(s == null ? '' : s).replace(/[\\/:*?"<>|]+/g, '-');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * The BOM Item Master: one row per unique item code, sourced from the purchase
 * module's Approved Supplier List (first non-linked row defines a code) plus the
 * catalog-only itemsExtra entries. Each entry is { code, ref } where `ref`
 * carries materialType / subGroup / specificMaterial / microns / uom.
 * Mirrors the legacy imMasterList (index.html 12110).
 */
function buildItemMaster(purchase) {
  const asl = Array.isArray(purchase && purchase.asl) ? purchase.asl : [];
  const extra = Array.isArray(purchase && purchase.itemsExtra) ? purchase.itemsExtra : [];
  const seen = new Set();
  const list = [];
  asl.forEach((r) => { const code = r.itemCode; if (!code || seen.has(code) || r.linked === true) return; seen.add(code); list.push({ code, ref: r }); });
  asl.forEach((r) => { const code = r.itemCode; if (!code || seen.has(code)) return; seen.add(code); list.push({ code, ref: r }); });
  extra.forEach((r) => { const code = r.itemCode; if (!code || seen.has(code)) return; seen.add(code); list.push({ code, ref: r }); });
  list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return list;
}

export default function BomPanel() {
  const { mods, save } = useData();
  const { user } = useAuth();

  // The recipes QC saves under Route and BOM live in the planning tables, not in
  // this screen's own module. Reading only the module meant a BOM entered in QC
  // never showed here at all — the business hit exactly that. Both are shown: the
  // planning store is the live one, the module keeps whatever was captured here
  // before, and a spec present in both prefers the planning store.
  const [planned, setPlanned] = useState({});
  const [plannedErr, setPlannedErr] = useState('');
  const loadPlanned = useCallback(async () => {
    try {
      const list = await bomApi.list();
      const m = {};
      (Array.isArray(list) ? list : []).forEach((b) => {
        if (!b || !b.specCode) return;
        m[String(b.specCode).trim()] = {
          baseQty: b.baseQty, baseUOM: b.baseUom, savedBy: b.savedBy, savedAt: b.savedAt,
          items: (b.items || []).map((it) => ({
            itemCode: it.itemCode, itemDescription: it.itemName, materialType: it.materialType || '',
            subGroup: it.subGroup || '', microns: it.microns || '', uom: it.uom || '',
            qtyPerBase: it.qtyPerBase, departmentName: it.departmentName || '',
          })),
        };
      });
      setPlanned(m);
    } catch (e) { setPlannedErr(e.message || 'Could not read the planning BOMs'); }
  }, []);
  useEffect(() => { loadPlanned(); }, [loadPlanned]);

  // The module this screen has always edited, with the planning store layered over it.
  const bom = useMemo(() => ({ ...(mods.bom || {}), ...planned }), [mods.bom, planned]);

  // QC cannot read the purchase blob (module 6 stays purchase/padmin/superadmin —
  // it carries supplier pricing), so in the QC login the catalogue above is empty
  // and every dropdown showed only "Any". Fall back to the NORMALIZED item master
  // (/api/master/items — readable by every signed-in role, no pricing), which the
  // JSS-planning sync keeps aligned with the P Dashboard catalogue.
  const [masterItems, setMasterItems] = useState([]);
  const purchaseEmpty = buildItemMaster(mods.purchase).length === 0;
  useEffect(() => {
    if (!purchaseEmpty) return undefined;
    let live = true;
    masterApi.listItems()
      .then((r) => { if (live && Array.isArray(r)) setMasterItems(r); })
      .catch(() => { /* master unreachable — dropdowns stay free-text */ });
    return () => { live = false; };
  }, [purchaseEmpty]);

  const itemMaster = useMemo(() => {
    const fromPurchase = buildItemMaster(mods.purchase);
    if (fromPurchase.length) return fromPurchase;
    return masterItems
      .map((it) => ({ code: it.code, ref: {
        materialType: it.materialType || '', subGroup: it.subGroup || '',
        specificMaterial: it.name || '', microns: it.microns || '', uom: it.uom || '',
      } }))
      .sort((a, b) => String(a.code).localeCompare(String(b.code)));
  }, [mods.purchase, masterItems]);
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
      .filter(([sp, j]) => !s || [sp, j.customer, j.jobName, specGroup(j, mods.customers)].some((v) => String(v || '').toLowerCase().includes(s)))
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
  const fillItem = (i, patch) => setDraft((d) => ({ ...d, items: d.items.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
  const removeItem = (i) => setDraft((d) => ({ ...d, items: d.items.length > 1 ? d.items.filter((_, j) => j !== i) : [blankItem()] }));

  // Choosing an Item Code fills materialType / subGroup / description / microns /
  // uom from the Item Master; a free code just sets the code. (bomFillFromCode 6491)
  function fillFromCode(i, code) {
    const found = itemMaster.find((m) => m.code === code);
    if (found) {
      fillItem(i, {
        itemCode: code,
        materialType: found.ref.materialType || '', subGroup: found.ref.subGroup || '',
        itemDescription: found.ref.specificMaterial || '', microns: found.ref.microns || '', uom: found.ref.uom || '',
      });
    } else {
      setItem(i, 'itemCode', code);
    }
  }
  // Choosing a description (within the row's material/sub-group filters) fills the
  // rest of the row from the matching master item. (bomFillFromDescription 6483)
  function fillFromDescription(i, row, desc) {
    if (!desc) { setItem(i, 'itemDescription', ''); return; }
    const found = itemMaster.find((m) =>
      (!row.materialType || (m.ref.materialType || '') === row.materialType)
      && (!row.subGroup || (m.ref.subGroup || '') === row.subGroup)
      && (m.ref.specificMaterial || '') === desc);
    if (found) {
      fillItem(i, {
        itemDescription: desc, itemCode: found.code,
        materialType: found.ref.materialType || row.materialType || '', subGroup: found.ref.subGroup || row.subGroup || '',
        microns: found.ref.microns || '', uom: found.ref.uom || '',
      });
    } else {
      fillItem(i, { itemDescription: desc });
    }
  }

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

  // Download a defined BOM as an .xlsx sheet (meta header + item rows). (bomExportExcel 6586)
  function exportExcel(spec, jssRow) {
    const rec = bom[spec];
    if (!rec || !(rec.items || []).length) { flash('r', `No BOM defined for ${spec} yet.`); return; }
    const baseLine = `${rec.baseQty ?? ''} ${rec.baseUOM || ''}`.trim() + (rec.meters ? ` / ${rec.meters} m` : '');
    const meta = [
      ['Spec', spec],
      ['Group', specGroup(jssRow, mods.customers) || ''],
      ['Customer', jssRow.customer || ''],
      ['Job Name', jssRow.jobName || ''],
      ['Dispatch Form', jssRow.dispatchForm || ''],
      ['Base Qty', baseLine],
      [],
    ];
    const header = ['Item Code', 'Material Type', 'Sub-Group', 'Item Description', 'Microns', 'UOM', 'Qty per Base'];
    const body = rec.items.map((r) => [r.itemCode, r.materialType || '', r.subGroup || '', r.itemDescription || '', r.microns || '', r.uom || '', r.qtyPerBase]);
    exportAOA([...meta, header, ...body], 'BOM_' + safeName(spec), 'BOM');
  }

  // Download a defined BOM as a one-page PDF, rasterised from an offscreen node
  // via the shared lib/pdf pipeline. (bomExportPDF 6594)
  async function exportPDF(spec, jssRow) {
    const rec = bom[spec];
    if (!rec || !(rec.items || []).length) { flash('r', `No BOM defined for ${spec} yet.`); return; }
    const baseLine = `${esc(rec.baseQty)} ${esc(rec.baseUOM)}`.trim() + (rec.meters ? ` / ${esc(rec.meters)} m` : '');
    const header = ['Item Code', 'Material Type', 'Sub-Group', 'Item Description', 'Microns', 'UOM', 'Qty per Base'];
    const rowsHtml = rec.items.map((r) => '<tr style="border-bottom:1px solid #eee">'
      + [r.itemCode, r.materialType, r.subGroup, r.itemDescription, r.microns, r.uom, r.qtyPerBase]
        .map((c, k) => `<td style="padding:4px 6px;text-align:${k === 6 ? 'right' : 'left'}">${esc(c)}</td>`).join('')
      + '</tr>').join('');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;left:-9999px;top:0;background:#fff;padding:16px;font-family:Arial,sans-serif;width:760px;color:#111';
    wrap.innerHTML = `<div style="font-size:16px;font-weight:800;color:#0e6fb8;margin-bottom:6px">Bill of Materials — ${esc(spec)}</div>`
      + `<div style="font-size:11px;color:#444;margin-bottom:2px">Group: ${esc(specGroup(jssRow, mods.customers) || '-')} &nbsp; Customer: ${esc(jssRow.customer)}</div>`
      + `<div style="font-size:11px;color:#444;margin-bottom:2px">Job Name: ${esc(jssRow.jobName)}</div>`
      + `<div style="font-size:11px;color:#444;margin-bottom:10px">Dispatch Form: ${esc(jssRow.dispatchForm)} &nbsp; Base Qty: ${baseLine}</div>`
      + '<table style="width:100%;border-collapse:collapse;font-size:11px"><thead><tr style="background:#0e6fb8;color:#fff">'
      + header.map((h) => `<th style="padding:5px 6px;text-align:left">${esc(h)}</th>`).join('')
      + `</tr></thead><tbody>${rowsHtml}</tbody></table>`;
    document.body.appendChild(wrap);
    try {
      await elementToPDF(wrap, 'BOM_' + safeName(spec));
    } catch (e) {
      flash('r', 'PDF error: ' + (e && e.message ? e.message : String(e)));
    } finally {
      document.body.removeChild(wrap);
    }
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
          <thead><tr><th>Spec</th><th>Group</th><th>Customer</th><th style={{ minWidth: 200 }}>Job Name</th><th>Dispatch</th><th style={{ textAlign: 'center' }}>BOM</th><th style={{ textAlign: 'center', width: 180 }}></th></tr></thead>
          <tbody>
            {specs.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No specs match</td></tr>
            ) : specs.map(([spec, j]) => (
              <BomRow
                key={spec} spec={spec} jssRow={j} group={specGroup(j, mods.customers)} defined={hasBOM(bom, spec)}
                open={openSpec === spec} onToggle={() => openEditor(spec, j)}
                onExportExcel={() => exportExcel(spec, j)} onExportPDF={() => exportPDF(spec, j)}
              >
                {openSpec === spec && draft && (
                  <td colSpan={7} style={{ background: 'var(--bg)', padding: '12px 18px' }}>
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

                    <datalist id={DATALIST_ID}>
                      {itemMaster.map((m) => <option key={m.code} value={m.code}>{m.code + ' — ' + (m.ref.specificMaterial || '')}</option>)}
                    </datalist>
                    <div className="tw" style={{ maxHeight: 260 }}>
                      <table>
                        <thead><tr>
                          <th style={{ minWidth: 130 }}>Material Type</th>
                          <th style={{ minWidth: 120 }}>Sub-Group</th>
                          <th style={{ minWidth: 200 }}>Item Description</th>
                          <th style={{ minWidth: 130 }}>Item Code</th>
                          <th style={{ width: 80 }}>Microns</th>
                          <th style={{ width: 80 }}>UOM</th>
                          <th style={{ textAlign: 'right', width: 110 }}>Qty / base *</th>
                          <th style={{ width: 40 }}></th>
                        </tr></thead>
                        <tbody>
                          {draft.items.map((r, i) => {
                            // Material Type → Sub-Group → Item Description each narrows the next.
                            const matOpts = uniqSorted(itemMaster.map((m) => m.ref.materialType || '').filter(Boolean));
                            const byMat = itemMaster.filter((m) => !r.materialType || (m.ref.materialType || '') === r.materialType);
                            const subOpts = uniqSorted(byMat.map((m) => m.ref.subGroup || '').filter(Boolean));
                            const bySub = byMat.filter((m) => !r.subGroup || (m.ref.subGroup || '') === r.subGroup);
                            const descOpts = uniqSorted(bySub.map((m) => m.ref.specificMaterial || '').filter(Boolean));
                            return (
                              <tr key={i}>
                                <td>
                                  <select aria-label={`Material Type row ${i + 1}`} value={r.materialType || ''} style={{ width: '100%' }}
                                    onChange={(e) => fillItem(i, { materialType: e.target.value, subGroup: '' })}>
                                    <option value="">Any</option>
                                    {withCurrent(matOpts, r.materialType).map((m) => <option key={m} value={m}>{m}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <select aria-label={`Sub Group row ${i + 1}`} value={r.subGroup || ''} style={{ width: '100%' }}
                                    onChange={(e) => setItem(i, 'subGroup', e.target.value)}>
                                    <option value="">Any</option>
                                    {withCurrent(subOpts, r.subGroup).map((s) => <option key={s} value={s}>{s}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <select aria-label={`Description row ${i + 1}`} value={r.itemDescription || ''} style={{ width: '100%' }}
                                    onChange={(e) => fillFromDescription(i, r, e.target.value)}>
                                    <option value="">Select…</option>
                                    {withCurrent(descOpts, r.itemDescription).map((d) => <option key={d} value={d}>{d}</option>)}
                                  </select>
                                </td>
                                <td>
                                  <input list={DATALIST_ID} aria-label={`Item Code row ${i + 1}`} value={r.itemCode ?? ''} placeholder="code"
                                    onChange={(e) => fillFromCode(i, e.target.value)} style={{ width: '100%' }} />
                                </td>
                                <td><input aria-label={`Microns row ${i + 1}`} value={r.microns ?? ''} onChange={(e) => setItem(i, 'microns', e.target.value)} style={{ width: '100%' }} /></td>
                                <td><input aria-label={`UOM row ${i + 1}`} value={r.uom ?? ''} onChange={(e) => setItem(i, 'uom', e.target.value)} style={{ width: '100%' }} /></td>
                                <td><input type="number" min="0" step="any" aria-label={`Qty per base row ${i + 1}`} value={r.qtyPerBase ?? ''} onChange={(e) => setItem(i, 'qtyPerBase', e.target.value)} style={{ width: '100%', textAlign: 'right' }} /></td>
                                <td style={{ textAlign: 'center' }}>
                                  <button className="btn btn-s" style={{ height: 24, fontSize: 11, padding: '0 8px', color: 'var(--red)' }} onClick={() => removeItem(i)} title="Remove item">✕</button>
                                </td>
                              </tr>
                            );
                          })}
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
function BomRow({ spec, jssRow, group, defined, open, onToggle, onExportExcel, onExportPDF, children }) {
  const items = defined ? 'defined' : '—';
  return (
    <>
      <tr>
        <td><span className="tag tb" style={{ fontSize: 10 }}>{spec}</span></td>
        {/* Buying group from the master data (spec's own group, else its customer's). */}
        <td style={{ fontSize: 11 }}>{group || '-'}</td>
        <td style={{ fontSize: 11 }}>{jssRow.customer || '-'}</td>
        <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{jssRow.jobName || '-'}</td>
        <td style={{ fontSize: 11 }}>{jssRow.dispatchForm || '-'}</td>
        <td style={{ textAlign: 'center' }}>
          {defined ? <span className="tag tgr" style={{ fontSize: 10 }}>{items}</span> : <span style={{ fontSize: 10, color: 'var(--i3)', fontStyle: 'italic' }}>no BOM</span>}
        </td>
        <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
          <button className="btn btn-s" style={{ height: 26, fontSize: 11, padding: '0 10px' }} onClick={onToggle} aria-label={`${open ? 'Close' : 'Edit'} BOM for ${spec}`}>{open ? 'Close' : 'BOM'}</button>
          {defined && (
            <>
              {' '}
              <button className="btn btn-s" style={{ height: 26, fontSize: 11, padding: '0 8px' }} title="Download Excel" aria-label={`Download Excel for ${spec}`} onClick={onExportExcel}>⬇ XLS</button>
              {' '}
              <button className="btn btn-s" style={{ height: 26, fontSize: 11, padding: '0 8px' }} title="Download PDF" aria-label={`Download PDF for ${spec}`} onClick={onExportPDF}>⬇ PDF</button>
            </>
          )}
        </td>
      </tr>
      {open && <tr>{children}</tr>}
    </>
  );
}

export { bomMaterialForSO };
