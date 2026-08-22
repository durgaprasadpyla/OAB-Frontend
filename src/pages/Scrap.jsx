import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { dash, today, rupees, fmtDate } from '../lib/format.js';

// Native port of the legacy scrap login (index.html: showScrapView / scrapAddBuyer /
// scrapSetPrice / scrapAddTxn). Add-only: buyers, daily prices and scrap sales, all
// persisted to module 8 (scrap) via useData().save. No shared lib is modified.

const clone = (o) => JSON.parse(JSON.stringify(o));
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Local default master list; merged (unique, case-insensitive) with scrap.items.
const SCRAP_ITEMS_MASTER = ['Trim Waste', 'Printed Waste', 'Lamination Waste', 'Core', 'Mixed Scrap'];

const EMPTY_BUYER = { name: '', contact: '', phone: '', address: '', gstn: '', notes: '' };

export default function Scrap() {
  const { mods, save } = useData();

  // Everything defaults — some arrays may be missing on first load.
  const scrap = mods.scrap || {};
  const buyers = Array.isArray(scrap.buyers) ? scrap.buyers : [];
  const items = Array.isArray(scrap.items) ? scrap.items : [];
  const prices = Array.isArray(scrap.prices) ? scrap.prices : [];
  const txns = Array.isArray(scrap.txns) ? scrap.txns : [];

  const [bf, setBf] = useState(EMPTY_BUYER);
  const [pf, setPf] = useState({ buyer: '', item: '', rate: '' });
  const [sf, setSf] = useState({ date: today(), buyer: '', item: '', qty: '', rate: '', mode: 'Cash' });
  const [msg, setMsg] = useState(null); // { where, text, t }
  const [busy, setBusy] = useState(false);

  // Master list + any items already used, unique by lower-case.
  const mergedItems = useMemo(() => {
    const seen = new Set();
    const out = [];
    [...SCRAP_ITEMS_MASTER, ...items].forEach((it) => {
      const s = String(it || '').trim();
      if (!s) return;
      const k = s.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push(s);
    });
    return out;
  }, [items]);

  const buyerName = (id) => { const b = buyers.find((x) => x.id === id); return b ? b.name : id; };

  const recentPrices = useMemo(
    () => prices.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50),
    [prices],
  );
  const recentTxns = useMemo(
    () => txns.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50),
    [txns],
  );

  // Today's Buying Prices board — every rate posted today, by buyer. (legacy scrapRenderTodayPrices 7692)
  const todaysPrices = useMemo(() => {
    const d = today();
    return prices.filter((p) => p.date === d).sort((a, b) => buyerName(a.buyer).localeCompare(buyerName(b.buyer)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices, buyers]);

  // Buyer directory sorted by name, with each buyer's latest rate per item. (legacy scrapRenderBuyerDirectory 7707)
  const buyerDir = useMemo(
    () => buyers.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))),
    [buyers],
  );
  const latestRatesFor = (buyerId) => {
    const latest = {};
    prices.filter((p) => p.buyer === buyerId).forEach((p) => {
      const cur = latest[p.item];
      if (!cur || String(p.date || '') >= String(cur.date || '')) latest[p.item] = { rate: p.rate, date: p.date };
    });
    return Object.keys(latest).sort((a, b) => a.localeCompare(b)).map((item) => ({ item, rate: latest[item].rate, date: latest[item].date }));
  };

  const saleAmount = num(sf.qty) * num(sf.rate);

  const flash = (where, text, t = 'g') => {
    setMsg({ where, text, t });
    setTimeout(() => setMsg((m) => (m && m.where === where && m.text === text ? null : m)), t === 'g' ? 3000 : 4000);
  };

  // Deep-clone the scrap module and guarantee the four arrays exist on the clone.
  function scrapClone() {
    const next = clone(scrap);
    if (!Array.isArray(next.buyers)) next.buyers = [];
    if (!Array.isArray(next.items)) next.items = [];
    if (!Array.isArray(next.prices)) next.prices = [];
    if (!Array.isArray(next.txns)) next.txns = [];
    return next;
  }

  const isNewItem = (item) => !mergedItems.some((i) => i.toLowerCase() === item.toLowerCase());

  async function addBuyer() {
    const name = bf.name.trim();
    if (!name) { flash('buyer', 'Enter the scrap buyer name.', 'r'); return; }
    // Block duplicate buyer names (case-insensitive), matching legacy 7628.
    if (buyers.some((b) => String(b.name || '').trim().toLowerCase() === name.toLowerCase())) {
      flash('buyer', '"' + name + '" already exists.', 'r'); return;
    }
    const next = scrapClone();
    next.buyers.push({
      id: 'SB' + String(next.buyers.length + 1).padStart(3, '0'),
      name,
      contact: bf.contact.trim(),
      phone: bf.phone.trim(),
      address: bf.address.trim(),
      gstn: bf.gstn.trim(),
      notes: bf.notes.trim(),
    });
    setBusy(true);
    try {
      await save('scrap', next);
      setBf(EMPTY_BUYER);
      flash('buyer', '✓ Buyer added.', 'g');
    } catch (e) { flash('buyer', 'Save failed: ' + e.message, 'r'); }
    finally { setBusy(false); }
  }

  async function setPrice() {
    const buyer = pf.buyer;
    const itemRaw = pf.item.trim();
    const rate = parseFloat(pf.rate);
    if (!buyer) { flash('price', 'Select a buyer.', 'r'); return; }
    if (!itemRaw) { flash('price', 'Select or enter a scrap item.', 'r'); return; }
    if (isNaN(rate) || rate < 0) { flash('price', 'Enter a valid rate.', 'r'); return; }
    const next = scrapClone();
    if (!next.items.some((i) => String(i).toLowerCase() === itemRaw.toLowerCase())) next.items.push(itemRaw);
    // Canonicalise to the stored item's casing so the UPSERT matches reliably.
    const item = next.items.find((i) => String(i).toLowerCase() === itemRaw.toLowerCase()) || itemRaw;
    // UPSERT the rate for the same date + buyer + item instead of pushing a
    // duplicate row (legacy 7653-7655).
    const d = today();
    const existing = next.prices.find((p) => p.date === d && p.buyer === buyer && p.item === item);
    if (existing) existing.rate = num(rate);
    else next.prices.push({ date: d, buyer, item, rate: num(rate) });
    setBusy(true);
    try {
      await save('scrap', next);
      setPf({ buyer, item: '', rate: '' });
      flash('price', '✓ Price updated for ' + buyerName(buyer) + '.', 'g');
    } catch (e) { flash('price', 'Save failed: ' + e.message, 'r'); }
    finally { setBusy(false); }
  }

  async function addSale() {
    const date = sf.date || today();
    const buyer = sf.buyer;
    const item = sf.item.trim();
    const qty = parseFloat(sf.qty);
    const rate = parseFloat(sf.rate);
    const mode = sf.mode || 'Cash';
    if (!buyer) { flash('sale', 'Select a buyer.', 'r'); return; }
    if (!item) { flash('sale', 'Select or enter a scrap item.', 'r'); return; }
    if (isNaN(qty) || qty <= 0) { flash('sale', 'Enter a valid quantity.', 'r'); return; }
    if (isNaN(rate) || rate < 0) { flash('sale', 'Enter a valid rate.', 'r'); return; }
    const amount = num(qty) * num(rate);
    const next = scrapClone();
    if (isNewItem(item) && !next.items.some((i) => String(i).toLowerCase() === item.toLowerCase())) next.items.push(item);
    next.txns.push({ date, buyer, item, qty: num(qty), rate: num(rate), amount, mode });
    // A sale also logs a price point so trends populate.
    next.prices.push({ date, buyer, item, rate: num(rate) });
    setBusy(true);
    try {
      await save('scrap', next);
      setSf({ date: today(), buyer, item: '', qty: '', rate: '', mode });
      flash('sale', '✓ Scrap sale recorded — ' + rupees(amount, 0) + ' (' + mode + ').', 'g');
    } catch (e) { flash('sale', 'Save failed: ' + e.message, 'r'); }
    finally { setBusy(false); }
  }

  const setB = (patch) => setBf((f) => ({ ...f, ...patch }));
  const setP = (patch) => setPf((f) => ({ ...f, ...patch }));
  const setS = (patch) => setSf((f) => ({ ...f, ...patch }));

  const buyerOptions = (
    <>
      <option value="">— select buyer —</option>
      {buyers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </>
  );

  return (
    <div id="app">
      <div className="pg-ttl">Scrap</div>
      <div className="pg-sub">Scrap buyers, daily rates and cash / account sales (module id=8).</div>

      {/* shared item picker source for the two item inputs */}
      <datalist id="scrap-item-list">
        {mergedItems.map((i) => <option key={i} value={i} />)}
      </datalist>

      {/* ── Add Buyer ── */}
      <div className="card">
        <div className="ctitle">Add Scrap Buyer</div>
        {msg && msg.where === 'buyer' && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g3">
          <div className="fg">
            <label>Buyer Name *</label>
            <input value={bf.name} onChange={(e) => setB({ name: e.target.value })} placeholder="e.g. Sri Balaji Traders" />
          </div>
          <div className="fg">
            <label>Contact Person</label>
            <input value={bf.contact} onChange={(e) => setB({ contact: e.target.value })} placeholder="Name" />
          </div>
          <div className="fg">
            <label>Phone</label>
            <input value={bf.phone} onChange={(e) => setB({ phone: e.target.value })} placeholder="Phone" />
          </div>
        </div>
        <div className="g3">
          <div className="fg">
            <label>Address</label>
            <input value={bf.address} onChange={(e) => setB({ address: e.target.value })} placeholder="Address" />
          </div>
          <div className="fg">
            <label>GSTN</label>
            <input value={bf.gstn} onChange={(e) => setB({ gstn: e.target.value })} placeholder="GST number" />
          </div>
          <div className="fg">
            <label>Notes</label>
            <input value={bf.notes} onChange={(e) => setB({ notes: e.target.value })} placeholder="Notes" />
          </div>
        </div>
        <div className="act">
          <button className="btn btn-g" onClick={addBuyer} disabled={busy}>{busy ? 'Saving…' : '+ Add Buyer'}</button>
        </div>
      </div>

      {/* ── Set Today's Price ── */}
      <div className="card">
        <div className="ctitle">Set Today's Price</div>
        {msg && msg.where === 'price' && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g3">
          <div className="fg">
            <label>Buyer</label>
            <select value={pf.buyer} onChange={(e) => setP({ buyer: e.target.value })}>{buyerOptions}</select>
          </div>
          <div className="fg">
            <label>Scrap Item</label>
            <input list="scrap-item-list" value={pf.item} onChange={(e) => setP({ item: e.target.value })} placeholder="Select or type an item" />
          </div>
          <div className="fg">
            <label>Rate ₹ / unit</label>
            <input type="number" min="0" step="any" value={pf.rate} onChange={(e) => setP({ rate: e.target.value })} placeholder="0.00" />
          </div>
        </div>
        <div className="act">
          <button className="btn btn-g" onClick={setPrice} disabled={busy}>{busy ? 'Saving…' : 'Set Price'}</button>
        </div>
      </div>

      {/* ── Record Sale ── */}
      <div className="card">
        <div className="ctitle">Record Scrap Sale</div>
        {msg && msg.where === 'sale' && <div className={'al al-' + msg.t}>{msg.text}</div>}
        <div className="g3">
          <div className="fg">
            <label>Date</label>
            <input type="date" value={sf.date} onChange={(e) => setS({ date: e.target.value })} />
          </div>
          <div className="fg">
            <label>Buyer</label>
            <select value={sf.buyer} onChange={(e) => setS({ buyer: e.target.value })}>{buyerOptions}</select>
          </div>
          <div className="fg">
            <label>Scrap Item</label>
            <input list="scrap-item-list" value={sf.item} onChange={(e) => setS({ item: e.target.value })} placeholder="Select or type an item" />
          </div>
        </div>
        <div className="g3">
          <div className="fg">
            <label>Quantity</label>
            <input type="number" min="0" step="any" value={sf.qty} onChange={(e) => setS({ qty: e.target.value })} placeholder="0" />
          </div>
          <div className="fg">
            <label>Rate ₹ / unit</label>
            <input type="number" min="0" step="any" value={sf.rate} onChange={(e) => setS({ rate: e.target.value })} placeholder="0.00" />
          </div>
          <div className="fg">
            <label>Mode</label>
            <select value={sf.mode} onChange={(e) => setS({ mode: e.target.value })}>
              <option value="Cash">Cash</option>
              <option value="Account">Account</option>
            </select>
          </div>
        </div>
        <div className="act">
          <span style={{ marginRight: 'auto', fontSize: 12, color: 'var(--i2)' }}>
            Amount: <strong>{rupees(saleAmount)}</strong>
          </span>
          <button className="btn btn-g" onClick={addSale} disabled={busy}>{busy ? 'Saving…' : 'Record Sale'}</button>
        </div>
      </div>

      {/* ── Today's Buying Prices ── */}
      <div className="card">
        <div className="ctitle">Today's Buying Prices <span className="tag tgr">{todaysPrices.length}</span></div>
        {todaysPrices.length === 0 ? (
          <div style={{ color: 'var(--i3)', fontSize: 12, padding: 6 }}>No prices entered today yet.</div>
        ) : (
          <div className="tw sy">
            <table>
              <thead>
                <tr><th>Buyer</th><th>Item</th><th style={{ textAlign: 'right' }}>Rate ₹</th></tr>
              </thead>
              <tbody>
                {todaysPrices.map((p, i) => (
                  <tr key={i}>
                    <td>{buyerName(p.buyer)}</td>
                    <td>{p.item}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(p.rate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Buyer Directory ── */}
      <div className="card">
        <div className="ctitle">Buyer Directory <span className="tag tgr">{buyers.length}</span></div>
        {buyerDir.length === 0 ? (
          <div style={{ color: 'var(--i3)', fontSize: 12, padding: 6 }}>No scrap buyers yet. Add one above.</div>
        ) : buyerDir.map((b) => {
          const rates = latestRatesFor(b.id);
          const detail = (label, val) => (val
            ? <span style={{ marginRight: 14 }}><span style={{ color: 'var(--i3)' }}>{label}:</span> {val}</span>
            : null);
          return (
            <div key={b.id} style={{ border: '1px solid var(--bd)', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
              <div style={{ background: 'var(--bg)', padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 800 }}>{b.name} <span className="tag tgr" style={{ fontWeight: 600 }}>{b.id}</span></div>
                <div style={{ fontSize: 12, color: 'var(--i2)' }}>
                  {detail('Contact', b.contact)}{detail('Phone', b.phone)}{detail('GSTN', b.gstn)}
                </div>
              </div>
              {b.address ? <div style={{ padding: '6px 14px 0', fontSize: 12, color: 'var(--i2)' }}><span style={{ color: 'var(--i3)' }}>Address:</span> {b.address}</div> : null}
              {b.notes ? <div style={{ padding: '4px 14px 0', fontSize: 12, color: 'var(--i2)' }}><span style={{ color: 'var(--i3)' }}>Notes:</span> {b.notes}</div> : null}
              <div style={{ padding: '10px 14px 14px' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--i2)', marginBottom: 4 }}>Buying Rates</div>
                <div className="tw">
                  <table>
                    <thead>
                      <tr><th>Item</th><th style={{ textAlign: 'right' }}>Rate ₹</th><th style={{ textAlign: 'right' }}>As of</th></tr>
                    </thead>
                    <tbody>
                      {rates.length === 0 ? (
                        <tr><td colSpan={3} style={{ color: 'var(--i3)', fontSize: 11, padding: '6px 8px' }}>No rates posted yet</td></tr>
                      ) : rates.map((r, i) => (
                        <tr key={i}>
                          <td>{r.item}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{rupees(r.rate)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--i3)', fontSize: 10 }}>{fmtDate(r.date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Recent Prices ── */}
      <div className="card">
        <div className="ctitle">Recent Prices <span className="tag tgr">{prices.length}</span></div>
        <div className="tw sy">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Buyer</th><th>Item</th><th style={{ textAlign: 'right' }}>Rate</th>
              </tr>
            </thead>
            <tbody>
              {recentPrices.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No prices entered yet</td></tr>
              ) : recentPrices.map((p, i) => (
                <tr key={i}>
                  <td>{p.date || '-'}</td>
                  <td>{buyerName(p.buyer)}</td>
                  <td>{p.item}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(p.rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Recent Sales ── */}
      <div className="card">
        <div className="ctitle">Recent Sales <span className="tag tgr">{txns.length}</span></div>
        <div className="tw sy">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Buyer</th><th>Item</th>
                <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Rate</th>
                <th style={{ textAlign: 'right' }}>Amount</th><th style={{ textAlign: 'center' }}>Mode</th>
              </tr>
            </thead>
            <tbody>
              {recentTxns.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No scrap sales recorded yet</td></tr>
              ) : recentTxns.map((t, i) => (
                <tr key={i}>
                  <td>{t.date || '-'}</td>
                  <td>{buyerName(t.buyer)}</td>
                  <td>{t.item}</td>
                  <td style={{ textAlign: 'right' }}>{dash(t.qty)}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(t.rate)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{rupees(t.amount)}</td>
                  <td style={{ textAlign: 'center' }}>
                    <span className={'tag ' + (t.mode === 'Account' ? 'tb' : 'ty')}>{t.mode || '-'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
