import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { DROPDOWN_DEFS, DD_DEFAULTS, ddList, ddPatch, ddIsOverridden } from '../lib/dropdowns.js';

// Super-admin editor for the nine shared dropdown lists (module 12).
// Ported from the monolith's Dropdowns tab (ddRender / ddRenderEditor / ddSave).
//
// Three shapes: a plain list, value/label pairs (payment types), and
// name/unit rows (CSA substrates).

const blankFor = (type) => (type === 'pairs' ? ['', ''] : type === 'substrate' ? { name: '', unit: 'Micron' } : '');
const UNITS = ['Micron', 'GSM'];

export default function DropdownAdmin() {
  const { mods, save } = useData();
  const sales = mods.sales || {};

  const [sel, setSel] = useState(DROPDOWN_DEFS[0].key);
  const [work, setWork] = useState(null);      // null = showing the saved list
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const def = DROPDOWN_DEFS.find((d) => d.key === sel);
  const saved = useMemo(() => ddList(sales, sel), [sales, sel]);
  const rows = work ?? saved;
  const dirty = work !== null;

  function pick(key) { setSel(key); setWork(null); setMsg(null); }
  const edit = (next) => setWork(next);

  const setRow = (i, v) => edit(rows.map((r, j) => (j === i ? v : r)));
  const addRow = () => edit([...rows, blankFor(def.type)]);
  const dropRow = (i) => edit(rows.filter((_, j) => j !== i));

  async function persist(values) {
    setBusy(true);
    try {
      const patch = ddPatch(sales, sel, values);
      await save('sales', (prev) => ({ ...(prev || {}), ...patch }));
      setWork(null);
      setMsg({ t: 'g', text: `✅ ${def.label} saved.` });
    } catch (e) {
      setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) });
    } finally { setBusy(false); }
  }

  function saveList() {
    // Drop blanks so an empty row left behind does not become a blank option.
    const cleaned = rows.filter((r) => (
      def.type === 'pairs' ? String(r[0] || '').trim()
        : def.type === 'substrate' ? String(r.name || '').trim()
          : String(r || '').trim()
    ));
    persist(cleaned);
  }

  function resetToDefault() {
    if (!window.confirm(`Reset ${def.label} to the built-in list?`)) return;
    persist([]);            // an empty override means "fall back to defaults"
  }

  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="ctitle">Lists</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>Edited here, used everywhere. Blank lists fall back to the built-in defaults.</div>
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <tbody>
              {DROPDOWN_DEFS.map((d) => (
                <tr
                  key={d.key} style={{ cursor: 'pointer', background: d.key === sel ? 'var(--gl)' : undefined }}
                  onClick={() => pick(d.key)}
                >
                  <td>
                    <div style={{ fontWeight: 700, fontSize: 12.5, color: d.key === sel ? 'var(--g)' : 'var(--ink)' }}>
                      {d.label} <span style={{ fontWeight: 500, color: 'var(--i3)' }}>({ddList(sales, d.key).length})</span>
                      {ddIsOverridden(sales, d.key) && <span className="tag tb" style={{ fontSize: 9, marginLeft: 6 }}>custom</span>}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 1 }}>{d.where}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>{def.label} <span className="tag tgr">{rows.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={resetToDefault} disabled={busy || !ddIsOverridden(sales, sel)}>Reset to default</button>
          <button className="btn btn-g" onClick={saveList} disabled={busy || !dirty}>{busy ? 'Saving…' : '💾 Save'}</button>
        </div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        {dirty && <div className="al al-y">Unsaved changes.</div>}

        <div className="tw sy" style={{ maxHeight: 380 }}>
          <table>
            <thead>
              <tr>
                {def.type === 'pairs' ? <><th style={{ width: 110 }}>Value</th><th>Label</th></>
                  : def.type === 'substrate' ? <><th>Substrate</th><th style={{ width: 130 }}>Unit</th></>
                    : <th>Value</th>}
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>
                  Empty — the built-in list of {(DD_DEFAULTS[sel] || []).length} is in use.
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  {def.type === 'pairs' ? (
                    <>
                      <td><input value={r[0] ?? ''} aria-label={`Value ${i + 1}`} onChange={(e) => setRow(i, [e.target.value, r[1]])} /></td>
                      <td><input value={r[1] ?? ''} aria-label={`Label ${i + 1}`} onChange={(e) => setRow(i, [r[0], e.target.value])} /></td>
                    </>
                  ) : def.type === 'substrate' ? (
                    <>
                      <td><input value={r.name ?? ''} aria-label={`Substrate ${i + 1}`} onChange={(e) => setRow(i, { ...r, name: e.target.value })} /></td>
                      <td>
                        <select value={r.unit || 'Micron'} aria-label={`Unit ${i + 1}`} onChange={(e) => setRow(i, { ...r, unit: e.target.value })}>
                          {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                    </>
                  ) : (
                    <td><input value={r ?? ''} aria-label={`Value ${i + 1}`} onChange={(e) => setRow(i, e.target.value)} /></td>
                  )}
                  <td style={{ textAlign: 'center' }}>
                    <button className="btn btn-s" style={{ color: 'var(--red)' }} aria-label={`Remove ${i + 1}`} onClick={() => dropRow(i)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn btn-s" style={{ marginTop: 8 }} onClick={addRow}>＋ Add</button>
      </div>
    </div>
  );
}
