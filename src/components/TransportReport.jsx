import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, rupees, today } from '../lib/format.js';
import { exportAOA } from '../lib/xlsx.js';
import { TRANSPORT_PARTIES, transportByCustomer, transportByMonth, transportRows, transportTotals } from '../lib/transport.js';
import { custGroupOf } from '../lib/master.js';

const MEASURES = [{ v: 'freight', l: 'All freight' }, { v: 'bloomflex', l: 'Borne by Bloomflex' }, { v: 'customer', l: 'Borne by the customer' }];
const monthName = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }); };

const rt = { textAlign: 'right' };

/** 1 April of the financial year a date falls in. */
function yearStart(iso) {
  const y = Number(iso.slice(0, 4));
  return `${iso.slice(5, 7) < '04' ? y - 1 : y}-04-01`;
}

const pct = (part, whole) => (whole > 0 ? ((part / whole) * 100).toFixed(2) + '%' : '-');

function Tile({ label, value, note }) {
  return (
    <div className="kpi" aria-label={label} style={{ flex: '1 1 180px', background: 'var(--bg)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 12px' }}>
      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--i3)' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      {note && <div style={{ fontSize: 11, color: 'var(--i3)' }}>{note}</div>}
    </div>
  );
}

/**
 * Transport 06.11 — Dashboard → Transport Reports. The freight entered on each invoice,
 * and how much of it Bloomflex and each customer bore. Read off the invoice register.
 */
export default function TransportReport() {
  const { mods } = useData();
  const [from, setFrom] = useState(() => yearStart(today()));
  const [to, setTo] = useState(() => today());
  const [customer, setCustomer] = useState('');
  const [group, setGroup] = useState('');
  const [borne, setBorne] = useState('');
  // Issues 11.11: the month-wise report — per customer or per buying group
  const [monthBy, setMonthBy] = useState('customer');
  const [measure, setMeasure] = useState('freight');

  const groupOf = (name) => custGroupOf(name, mods.customers) || '';
  const inPeriod = useMemo(() => transportRows(mods.oab, { from, to }), [mods.oab, from, to]);
  const groups = useMemo(() => [...new Set(inPeriod.map((r) => groupOf(r.customer)).filter(Boolean))].sort(), [inPeriod, mods.customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const customers = useMemo(() => [...new Set(inPeriod.filter((r) => !group || groupOf(r.customer) === group).map((r) => r.customer).filter(Boolean))].sort(),
    [inPeriod, group, mods.customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => inPeriod.filter((r) => (!group || groupOf(r.customer) === group) && (!customer || r.customer === customer)),
    [inPeriod, group, customer, mods.customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const monthly = useMemo(() => transportByMonth(rows, {
    measure, keyOf: monthBy === 'group' ? (r) => groupOf(r.customer) || `${r.customer} (no group)` : (r) => r.customer || '—',
  }), [rows, measure, monthBy, mods.customers]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => transportTotals(rows), [rows]);
  const byCustomer = useMemo(() => transportByCustomer(rows), [rows]);
  const lines = useMemo(() => rows.filter((r) => r.freight > 0 && (!borne || r.borneBy === borne)), [rows, borne]);

  function exportExcel() {
    exportAOA([
      ['Invoice', 'Date', 'Customer', 'PO', 'Transporter', 'Invoice Value', 'Freight', 'Borne By'],
      ...lines.map((r) => [r.no, r.date, r.customer, r.po, r.transporter, r.invoiceValue, r.freight, r.borneBy]),
    ], `Transport_Report_${from}_to_${to}`, 'Transport');
  }

  return (
    <div className="card">
      <div className="fbar" style={{ flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>🚚 Transport Reports</div>
        <label style={{ fontSize: 11 }}>From <input type="date" value={from} aria-label="Transport report from" onChange={(e) => setFrom(e.target.value)} /></label>
        <label style={{ fontSize: 11 }}>To <input type="date" value={to} aria-label="Transport report to" onChange={(e) => setTo(e.target.value)} /></label>
        <select value={group} aria-label="Transport report group" onChange={(e) => { setGroup(e.target.value); setCustomer(''); }} style={{ maxWidth: 200 }}>
          <option value="">All groups</option>
          {groups.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <select value={customer} aria-label="Transport report customer" onChange={(e) => setCustomer(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" onClick={exportExcel} disabled={!lines.length}>⬇ Export Excel</button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, margin: '10px 0' }}>
        <Tile label="Total freight" value={rupees(totals.freight)} note={`${totals.invoices} invoice${totals.invoices === 1 ? '' : 's'}`} />
        <Tile label="Borne by Bloomflex" value={rupees(totals.bloomflex)} note={`${pct(totals.bloomflex, totals.invoiceValue)} of invoice value`} />
        <Tile label="Borne by customers" value={rupees(totals.customer)} note={`${pct(totals.customer, totals.invoiceValue)} of invoice value`} />
        <Tile label="Invoice value" value={rupees(totals.invoiceValue)} note="before GST and freight" />
      </div>

      <div className="ctitle">By customer</div>
      <div className="tw"><table aria-label="Transport by customer">
        <thead><tr>
          <th>Customer</th><th style={rt}>Invoices</th><th style={rt}>Invoice value</th>
          <th style={rt}>Borne by Bloomflex</th><th style={rt}>Borne by customer</th><th style={rt}>Total freight</th><th style={rt}>% of invoice value</th>
        </tr></thead>
        <tbody>
          {byCustomer.length === 0 ? (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No freight on any invoice in this period</td></tr>
          ) : byCustomer.map((c) => (
            <tr key={c.customer}>
              <td style={{ fontSize: 11 }}>{c.customer}</td><td style={rt}>{c.invoices}</td><td style={rt}>{rupees(c.invoiceValue)}</td>
              <td style={rt}>{rupees(c.bloomflex)}</td><td style={rt}>{rupees(c.borneByCustomer)}</td>
              <td style={{ ...rt, fontWeight: 700 }}>{rupees(c.freight)}</td><td style={rt}>{pct(c.freight, c.invoiceValue)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="fbar" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <div className="ctitle" style={{ margin: 0 }}>Month by month</div>
        <select value={monthBy} aria-label="Month-wise by" onChange={(e) => setMonthBy(e.target.value)}>
          <option value="customer">Per customer</option>
          <option value="group">Per group</option>
        </select>
        <select value={measure} aria-label="Month-wise measure" onChange={(e) => setMeasure(e.target.value)}>
          {MEASURES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn btn-s" disabled={!monthly.rows.length} onClick={() => exportAOA([
          [monthBy === 'group' ? 'Group' : 'Customer', ...monthly.months.map(monthName), 'Total'],
          ...monthly.rows.map((r) => [r.name, ...monthly.months.map((m) => Math.round(r.byMonth[m] || 0)), Math.round(r.total)]),
        ], `Transport_by_month_${monthBy}_${measure}_${from}_to_${to}`, 'By month')}>⬇ Export month-wise</button>
      </div>
      <div className="tw"><table aria-label="Transport by month">
        <thead><tr>
          <th>{monthBy === 'group' ? 'Group' : 'Customer'}</th>
          {monthly.months.map((m) => <th key={m} style={rt}>{monthName(m)}</th>)}
          <th style={rt}>Total</th>
        </tr></thead>
        <tbody>
          {monthly.rows.length === 0 ? (
            <tr><td colSpan={monthly.months.length + 2} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No freight in this period</td></tr>
          ) : monthly.rows.map((r) => (
            <tr key={r.name}>
              <td style={{ fontSize: 11 }}>{r.name}</td>
              {monthly.months.map((m) => <td key={m} style={rt}>{r.byMonth[m] ? rupees(r.byMonth[m]) : '—'}</td>)}
              <td style={{ ...rt, fontWeight: 700 }}>{rupees(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table></div>

      <div className="fbar" style={{ marginTop: 14 }}>
        <div className="ctitle" style={{ margin: 0 }}>Invoice-wise freight <span className="tag tgr">{lines.length}</span></div>
        <select value={borne} aria-label="Borne by filter" onChange={(e) => setBorne(e.target.value)}>
          <option value="">Borne by anyone</option>
          {TRANSPORT_PARTIES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="tw sy" style={{ maxHeight: 420 }}><table aria-label="Invoice-wise freight">
        <thead><tr>
          <th>Invoice</th><th>Date</th><th>Customer</th><th>PO</th><th>Transporter</th>
          <th style={rt}>Invoice value</th><th style={rt}>Freight</th><th>Borne by</th>
        </tr></thead>
        <tbody>
          {lines.length === 0 ? (
            <tr><td colSpan={8} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No freight to show</td></tr>
          ) : lines.map((r) => (
            <tr key={r.no}>
              <td style={{ fontSize: 11 }}>{r.no}</td><td style={{ fontSize: 11 }}>{fmtDate(r.date)}</td><td style={{ fontSize: 11 }}>{r.customer}</td>
              <td style={{ fontSize: 11 }}>{r.po}</td><td style={{ fontSize: 11 }}>{r.transporter || '-'}</td>
              <td style={rt}>{rupees(r.invoiceValue)}</td><td style={{ ...rt, fontWeight: 700 }}>{rupees(r.freight)}</td>
              <td><span className={'tag ' + (r.borneBy === 'Bloomflex' ? 'tr' : 'tb')}>{r.borneBy}</span></td>
            </tr>
          ))}
        </tbody>
      </table></div>
      <p style={{ fontSize: 11, color: 'var(--i3)', marginBottom: 0 }}>
        Invoices raised before who-bears-it was recorded are counted as borne by the customer, because their freight was added to the customer&rsquo;s bill.
      </p>
    </div>
  );
}
