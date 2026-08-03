import { useRef } from 'react';
import { COMPANY } from '../lib/company.js';
import { dash } from '../lib/format.js';
import { elementToPDF } from '../lib/pdf.js';

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Packing list builder — bags per SKU (native port of the pl-modal flow, legacy 5646+). */
export default function PackingListModal({ items, setItems, invNo, onClose }) {
  const docRef = useRef(null);

  const setBag = (ii, bi, patch) => setItems((xs) => xs.map((it, i) => i === ii
    ? { ...it, bags: it.bags.map((b, j) => (j === bi ? { ...b, ...patch } : b)) } : it));
  const addBag = (ii) => setItems((xs) => xs.map((it, i) => i === ii ? { ...it, bags: [...it.bags, { from: '', to: '', qty: '' }] } : it));
  const delBag = (ii, bi) => setItems((xs) => xs.map((it, i) => i === ii ? { ...it, bags: it.bags.filter((_, j) => j !== bi) } : it));

  async function pdf() { try { await elementToPDF(docRef.current, `PackingList_${(invNo || '').replace(/[\\/]/g, '-')}.pdf`); } catch (e) { alert('PDF failed: ' + e.message); } }

  /**
   * Print EVERY record. The packing list lives inside a position:fixed, scrolling
   * modal overlay. The shared printElement() marks the node position:absolute, whose
   * containing block then resolves to that fixed overlay — so the overlay's
   * overflow:auto clips the output to its first page (~one record). Instead we clone
   * the printable node to <body> and, via `.pl-printing` print CSS, show only the
   * clone while printing, so all records flow and paginate across A4 pages — matching
   * the Save-PDF (html2canvas) output, which is left untouched. cloneNode copies markup
   * but not the live value of controlled inputs, so we copy the bag from/to/qty across.
   */
  function handlePrint() {
    const src = docRef.current;
    if (!src) return;
    const clone = src.cloneNode(true);
    const live = src.querySelectorAll('input');
    const copied = clone.querySelectorAll('input');
    live.forEach((inp, i) => { if (copied[i]) { copied[i].setAttribute('value', inp.value); copied[i].value = inp.value; } });

    const wrap = document.createElement('div');
    wrap.className = 'pl-print-clone';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    document.body.classList.add('pl-printing');

    let done = false;
    const mql = typeof window.matchMedia === 'function' ? window.matchMedia('print') : null;
    const onMql = (e) => { if (!e.matches) cleanup(); };
    function cleanup() {
      if (done) return;
      done = true;
      document.body.classList.remove('pl-printing');
      wrap.remove();
      window.removeEventListener('afterprint', cleanup);
      if (mql && mql.removeEventListener) mql.removeEventListener('change', onMql);
    }
    window.addEventListener('afterprint', cleanup);
    if (mql && mql.addEventListener) mql.addEventListener('change', onMql);

    setTimeout(() => window.print(), 60);   // let the clone paint before the print dialog opens
  }

  return (
    <div style={overlay} onClick={onClose}>
      <div style={sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="ctitle" style={{ margin: 0 }}>Packing List — {invNo}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-g" onClick={pdf}>⬇ Save PDF</button>
            <button className="btn btn-s" onClick={handlePrint}>🖨 Print</button>
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
