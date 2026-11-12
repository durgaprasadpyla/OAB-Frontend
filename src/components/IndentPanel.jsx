import { useCallback, useEffect, useMemo, useState } from 'react';
import { indentApi, masterApi } from '../api.js';
import { fmtDate, today } from '../lib/format.js';

// Issues 11.11 — purchase indents (PI). "I want a provision to make a PI from the stores
// login … On the PI creation page of the stores login, I want the item code to be
// selected, the quantity to be entered, and the tentative expected date to be mentioned.
// The department for which it is being procured should be a dropdown and that dropdown
// should come from the item-to-department mapping."
//
//   <StoresIndents />                 the stores desk: raise a PI, see what became of it
//   <IndentList indents onPick picked /> the list both logins read

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const PI_STATUS = { OPEN: 'Open', PO_RAISED: 'PO raised', CANCELLED: 'Cancelled' };
const tagOf = (s) => (s === 'OPEN' ? 'ty' : s === 'PO_RAISED' ? 'tg' : 'tgr');

/** The PIs, newest first — with a radio when `onPick` is given. */
export function IndentList({ indents, onPick, picked, empty = 'No purchase indents yet.' }) {
  const cols = onPick ? 10 : 9;
  return (
    <div className="tw sy" style={{ maxHeight: 420 }}>
      <table aria-label="Purchase indents">
        <thead><tr>
          {onPick && <th style={{ width: 34 }} />}
          <th>PI</th><th>Raised</th><th>Item</th><th style={{ textAlign: 'right' }}>Qty</th><th>Expected by</th>
          <th>Department</th><th>Raised by</th><th>Status</th><th>PO</th>
        </tr></thead>
        <tbody>
          {indents.length === 0 ? (
            <tr><td colSpan={cols} style={{ textAlign: 'center', padding: 16, color: 'var(--i3)' }}>{empty}</td></tr>
          ) : indents.map((p) => (
            <tr key={p.id} className={picked === p.id ? 'hi' : ''}>
              {onPick && (
                <td style={{ textAlign: 'center' }}>
                  <input type="radio" name="pi-pick" checked={picked === p.id} disabled={p.status !== 'OPEN'}
                    aria-label={`Select ${p.piNo}`} onChange={() => onPick(p.id)} />
                </td>
              )}
              <td style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 11 }}>{p.piNo}</td>
              <td style={{ fontSize: 11 }}>{p.createdAt ? fmtDate(String(p.createdAt).slice(0, 10)) : '—'}</td>
              <td style={{ fontSize: 11, whiteSpace: 'normal' }}><b style={{ fontFamily: 'monospace' }}>{p.itemCode}</b> {p.itemName || ''}</td>
              <td style={{ textAlign: 'right', fontWeight: 700 }}>{num(p.qty).toLocaleString('en-IN')} {p.uom || ''}</td>
              <td style={{ fontSize: 11 }}>{p.expectedDate ? fmtDate(p.expectedDate) : '—'}</td>
              <td style={{ fontSize: 11 }}>{p.departmentName || '—'}</td>
              <td style={{ fontSize: 11 }}>{p.createdBy || '—'}</td>
              <td><span className={'tag ' + tagOf(p.status)} title={p.remarks || ''}>{PI_STATUS[p.status] || p.status}</span></td>
              <td style={{ fontSize: 11 }}>{p.poNum ? <>{p.poNum}<div style={{ color: 'var(--i3)' }}>{p.supplier || ''}</div></> : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The stores desk's PI page. */
export function StoresIndents() {
  const [items, setItems] = useState([]);
  const [indents, setIndents] = useState([]);
  const [form, setForm] = useState({ itemCode: '', qty: '', expectedDate: '', departmentId: '', remarks: '' });
  const [depts, setDepts] = useState(null);   // null = no item picked yet
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 5000); };

  const load = useCallback(async () => {
    try { const l = await indentApi.list(); setIndents(Array.isArray(l) ? l : []); }
    catch (e) { flash('r', 'Could not load the purchase indents: ' + (e.message || e)); }
  }, []);
  useEffect(() => {
    load();
    masterApi.listItems().then((r) => setItems((Array.isArray(r) ? r : []).filter((x) => x.active !== false))).catch(() => {});
  }, [load]);

  const byCode = useMemo(() => new Map(items.map((it) => [String(it.code || '').trim().toUpperCase(), it])), [items]);
  const item = byCode.get(String(form.itemCode || '').trim().toUpperCase()) || null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // the item decides the departments on offer
  useEffect(() => {
    if (!item) { setDepts(null); return; }
    let live = true;
    indentApi.departments(item.id).then((d) => {
      if (!live) return;
      const list = Array.isArray(d) ? d : [];
      setDepts(list);
      setForm((f) => ({ ...f, departmentId: list.length === 1 ? String(list[0].id) : (list.some((x) => String(x.id) === String(f.departmentId)) ? f.departmentId : '') }));
    }).catch(() => { if (live) setDepts([]); });
    return () => { live = false; };
  }, [item && item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function raise() {
    if (!item) { flash('r', 'Pick the item code.'); return; }
    if (!(num(form.qty) > 0)) { flash('r', 'Enter the quantity.'); return; }
    if (!form.expectedDate) { flash('r', 'Enter the tentative expected date.'); return; }
    if (depts && depts.length && !form.departmentId) { flash('r', 'Pick the department it is being procured for.'); return; }
    setBusy(true);
    try {
      const pi = await indentApi.create({
        itemId: item.id, qty: num(form.qty), expectedDate: form.expectedDate,
        departmentId: form.departmentId ? Number(form.departmentId) : undefined, remarks: form.remarks.trim() || undefined,
      });
      flash('g', `✅ ${pi.piNo} raised — it is now with the purchase desk.`);
      setForm({ itemCode: '', qty: '', expectedDate: '', departmentId: '', remarks: '' });
      await load();
    } catch (e) { flash('r', e.message || 'Could not raise the PI'); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <div className="ctitle">📝 Raise a purchase indent</div>
        {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <datalist id="pi-items">{items.map((it) => <option key={it.id} value={it.code}>{it.name}</option>)}</datalist>
        <div className="g4">
          <div className="fg"><label>Item code *</label>
            <input list="pi-items" value={form.itemCode} aria-label="PI item code" placeholder="type or pick the code"
              onChange={(e) => set({ itemCode: e.target.value })} />
            {item && <div style={{ fontSize: 11, color: 'var(--i3)', marginTop: 2 }}>{item.name}{item.uom ? ` · ${item.uom}` : ''}</div>}
          </div>
          <div className="fg"><label>Quantity *{item && item.uom ? ` (${item.uom})` : ''}</label>
            <input type="number" min="0" step="any" className="nospin" value={form.qty} aria-label="PI quantity" onChange={(e) => set({ qty: e.target.value })} />
          </div>
          <div className="fg"><label>Tentative expected date *</label>
            <input type="date" min={today()} value={form.expectedDate} aria-label="PI expected date" onChange={(e) => set({ expectedDate: e.target.value })} />
          </div>
          <div className="fg"><label>For department{depts && depts.length ? ' *' : ''}</label>
            <select value={form.departmentId} aria-label="PI department" disabled={!item || !depts || depts.length === 0}
              onChange={(e) => set({ departmentId: e.target.value })}>
              <option value="">{!item ? '— pick the item first —' : depts && depts.length === 0 ? '— no department mapped —' : '— select —'}</option>
              {(depts || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>
        <div className="fg"><label>Remarks</label>
          <input value={form.remarks} aria-label="PI remarks" placeholder="optional — e.g. for which order" onChange={(e) => set({ remarks: e.target.value })} />
        </div>
        <div className="act"><button className="btn btn-g" onClick={raise} disabled={busy}>{busy ? 'Raising…' : '＋ Raise PI'}</button></div>
      </div>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Purchase indents <span className="tag tgr">{indents.length}</span></div>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={load}>↻ Refresh</button>
        </div>
        <IndentList indents={indents} />
      </div>
    </>
  );
}
