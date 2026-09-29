import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { costLines } from '../lib/repFlow.js';

// 💸 Sales Costs — 28.09 §Sales ¶27.
//
// "These costs should appear in the super admin page under the Admin Dashboard for
// the 'Cost Incurred to Convert a Customer' and 'Cost Incurred to Retain a Customer'
// fields. Where are these listed? There should be a particular tab where costs
// incurred for sales."
//
// The two figures were on the Overview with nothing behind them. This is what makes
// them up: every visit and meeting a rep logged an expense against, split by whether
// the party is still a lead (winning a customer) or already one (keeping them).

const KIND = {
  convert: { label: 'To convert', color: '#8a6d00', bg: '#fdf3d7' },
  retain: { label: 'To retain', color: '#1d4e89', bg: '#e6eef8' },
};

export default function SalesCostsTab({ sales }) {
  const { mods } = useData();
  const customers = mods.customers || [];
  const [kind, setKind] = useState('');
  const [rep, setRep] = useState('');
  const [party, setParty] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const all = useMemo(() => costLines(sales, customers), [sales, customers]);
  const uniq = (a) => [...new Set(a.filter(Boolean))].sort();

  const rows = useMemo(() => all.filter((l) => (
    (!kind || l.kind === kind)
    && (!rep || l.rep === rep)
    && (!party || l.party === party)
    && (!from || String(l.date) >= from)
    && (!to || String(l.date) <= to)
  )), [all, kind, rep, party, from, to]);

  const sum = (k) => rows.filter((l) => !k || l.kind === k).reduce((t, l) => t + l.cost, 0);
  const convert = sum('convert');
  const retain = sum('retain');
  const total = convert + retain;

  function download() {
    if (!rows.length) return;
    const header = ['Date', 'Lead / Customer', 'Group', 'Counts as', 'Mode', 'Sales rep', 'Amount', 'Remarks'];
    const body = rows.map((l) => [
      l.date, l.party, l.group, KIND[l.kind].label, l.mode, l.rep, Math.round(l.cost * 100) / 100, l.note,
    ]);
    exportAOA([header, ...body], 'Bloomflex_Sales_Costs_' + new Date().toISOString().slice(0, 10), 'Sales Costs');
  }

  return (
    <>
      <div className="card">
        <div className="fbar">
          <div className="ctitle" style={{ margin: 0 }}>Sales costs <span className="tag tgr">{rows.length}</span></div>
          <select value={kind} aria-label="Filter by cost kind" onChange={(e) => setKind(e.target.value)}>
            <option value="">Convert and retain</option>
            <option value="convert">To convert a customer</option>
            <option value="retain">To retain a customer</option>
          </select>
          <select value={rep} aria-label="Filter costs by rep" onChange={(e) => setRep(e.target.value)}>
            <option value="">All reps</option>
            {uniq(all.map((l) => l.rep)).map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <select value={party} aria-label="Filter costs by lead or customer" onChange={(e) => setParty(e.target.value)}>
            <option value="">All leads and customers</option>
            {uniq(all.map((l) => l.party)).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <span style={{ flex: 1 }} />
          <button className="btn btn-s" onClick={download} disabled={!rows.length}>⬇ Export</button>
        </div>
        <div className="fbar" style={{ marginTop: 0 }}>
          <div className="fg" style={{ margin: 0 }}><label>From</label><input type="date" value={from} aria-label="Costs from" onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="fg" style={{ margin: 0 }}><label>To</label><input type="date" value={to} aria-label="Costs to" onChange={(e) => setTo(e.target.value)} /></div>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="sl">Cost incurred to convert a customer</div>
            <div className="sv" style={{ color: KIND.convert.color }}>₹{inr(Math.round(convert))}</div>
            <div style={{ fontSize: 10, color: 'var(--i3)' }}>spent on parties still on the lead list</div>
          </div>
          <div className="stat">
            <div className="sl">Cost incurred to retain a customer</div>
            <div className="sv" style={{ color: KIND.retain.color }}>₹{inr(Math.round(retain))}</div>
            <div style={{ fontSize: 10, color: 'var(--i3)' }}>spent on parties the Super Admin has converted</div>
          </div>
          <div className="stat">
            <div className="sl">Total</div>
            <div className="sv">₹{inr(Math.round(total))}</div>
            <div style={{ fontSize: 10, color: 'var(--i3)' }}>{rows.length} logged visit(s) and meeting(s)</div>
          </div>
        </div>
        <div className="pg-sub" style={{ marginBottom: 0 }}>
          Every visit or meeting a rep logged an expense against. A phone call carries no cost, so it does not appear here.
        </div>
      </div>

      <div className="card">
        <div className="tw sy" style={{ maxHeight: 460 }}>
          <table>
            <thead><tr>
              <th style={{ width: 100 }}>Date</th><th style={{ minWidth: 160 }}>Lead / Customer</th><th>Group</th>
              <th style={{ width: 110 }}>Counts as</th><th>Mode</th><th>Sales rep</th>
              <th style={{ textAlign: 'right', width: 110 }}>Amount</th><th style={{ minWidth: 160 }}>Remarks</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>
                  No costs logged{all.length ? ' for this selection' : ' yet — reps record them on Log Visit'}.
                </td></tr>
              ) : rows.map((l) => (
                <tr key={l.id}>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{l.date ? fmtDate(l.date) : '—'}</td>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{l.party}</td>
                  <td style={{ fontSize: 11 }}>{l.group || '—'}</td>
                  <td>
                    <span style={{
                      background: KIND[l.kind].bg, color: KIND[l.kind].color, padding: '2px 8px',
                      borderRadius: 10, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap',
                    }}>{KIND[l.kind].label}</span>
                  </td>
                  <td style={{ fontSize: 11 }}>{l.mode}</td>
                  <td style={{ fontSize: 11 }}>{l.rep}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>₹{inr(Math.round(l.cost))}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'normal' }}>{l.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
