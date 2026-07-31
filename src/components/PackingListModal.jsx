import { useRef } from 'react';
import { COMPANY } from '../lib/company.js';
import { dash } from '../lib/format.js';
import { elementToPDF, printElement } from '../lib/pdf.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Packing list builder — bags per SKU (native port of the pl-modal flow, legacy 5646+). */
export default function PackingListModal({ items, setItems, invNo, onClose }) {
  const docRef = useRef(null);

  const setBag = (ii, bi, patch) => setItems((xs) => xs.map((it, i) => i === ii
    ? { ...it, bags: it.bags.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : it));
  const addBag = (ii) => setItems((xs) => xs.map((it, i) => i === ii ? { ...it, bags: [...it.bags, { from: '', to: '', qty: '' }] } : it));
  const delBag = (ii, bi) => setItems((xs) => xs.map((it, i) => i === ii ? { ...it, bags: it.bags.filter((_, j) => j !== bi) } : it));

  async function pdf() { try { await elementToPDF(docRef.current, `PackingList_${(invNo || '').replace(/[\\/]/g, '-')}.pdf`); } catch (e) { alert('PDF failed: ' + e.message); } }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="ctitle" style={{ margin: 0 }}>Packing List — {invNo}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g" onClick={pdf}>⬇ Save PDF</button>
            <button className="btn btn-s" onClick={() => printElement(docRef.current)}>🖨 Print</button>
            <button className="btn btn-b" onClick={onClose}>Done</button>
          </div>
        </div>

        <div ref={docRef} style={{ background: '#fff', padding: 16, border: '1px solid var(--bd)', borderRadius: 8 }}>
          <div style={{ textAlign: 'center', marginBottom: 10 }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1B6B3A' }}>{COMPANY.name}</div>
            <div style={{ fontSize: 13, fontWeight: 700, textDecoration: 'underline', marginTop: 4 }}>PACKING LIST</div>
            <div style={{ fontSize: 11, color: '#555' }}>Invoice: {invNo}</div>
          </div>
          {(items || []).map((it, ii) => {
            const bagged = it.bags.reduce((s, b) => s + num(b.qty), 0);
            return (
              <div key={ii} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{it.jobName || it.spec} <span style={{ color: '#888', fontWeight: 400 }}>· {it.spec} · Total {dash(it.totalQty)}</span></div>
                <div className="tw">
                  <table>
                    <thead><tr><th>#</th><th>Bag From</th><th>Bag To</th><th>Qty</th><th></th></tr></thead>
                    <tbody>
                      {it.bags.map((b, bi) => (
                        <tr key={bi}>
                          <td>{bi + 1}</td>
                          <td><input value={b.from} onChange={(e) => setBag(ii, bi, { from: e.target.value })} style={{ width: '100%' }} /></td>
                          <td><input value={b.to} onChange={(e) => setBag(ii, bi, { to: e.target.value })} style={{ width: '100%' }} /></td>
                          <td><input type="number" value={b.qty} onChange={(e) => setBag(ii, bi, { qty: e.target.value })} style={{ width: '100%' }} /></td>
                          <td><button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px' }} onClick={() => delBag(ii, bi)}>✕</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                  <button className="btn btn-s" style={{ height: 24, fontSize: 11 }} onClick={() => addBag(ii)}>+ Add bag</button>
                  <span style={{ fontSize: 11, color: bagged === num(it.totalQty) ? 'var(--g)' : 'var(--red)' }}>Bagged: {dash(bagged)} / {dash(it.totalQty)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', overflow: 'auto', padding: 20 };
const sheet = { background: 'var(--wh)', borderRadius: 12, padding: 18, width: 'min(820px, 96vw)', margin: 'auto' };
