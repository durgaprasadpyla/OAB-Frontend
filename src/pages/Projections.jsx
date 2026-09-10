import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { useAuth } from '../auth.jsx';
import {
  blankProjection, validateProjection, saveProjection, removeProjection,
  reconcileMonth, byCustomer, materialForMonth, projectedVsActual, projectedMonths,
  monthLabel, monthsFrom, currentMonth, projectionList,
} from '../lib/projections.js';
import { bomMaterialForSO, plannedBomMap } from '../lib/bom.js';
import { useApi } from '../lib/useApi.js';
import { getCustLocations } from '../lib/master.js';
import { num } from '../lib/calc.js';

// Future Projections.
//
// What sales EXPECT a month to bring, entered before the orders exist, and then read
// back against what actually arrived. Three things follow from that one idea:
//
//   · a projection has to name the job precisely enough to price its material, which
//     is why one made against the customer list is anchored to a JSS number and takes
//     the customer and SKU from it rather than from what somebody typed;
//   · a lead has no JSS number yet, so its projection carries a tentative quantity and
//     is honestly excluded from the material total until the job is specified;
//   · the actuals are never entered. They are the POs whose PO date falls in the
//     month, read off the OAB each time — one number, not two that can disagree.

const rt = { textAlign: 'right' };
const qty = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: 3 }));

export default function Projections() {
  const { mods, save } = useData();
  const { user, role } = useAuth() || {};
  const projections = mods.projections || { entries: [] };
  const jss = useMemo(() => (mods.jss || []).filter((j) => j && j.spec), [mods.jss]);
  const sales = mods.sales || {};
  const customers = mods.customers || [];

  // The BOM behind a spec: the planning store is the live one, the module-13 blob is
  // the fallback — the same layering the Raw Material and BOM panels use.
  const planned = useApi('/api/bom');
  const bom = useMemo(
    () => ({ ...(mods.bom || {}), ...plannedBomMap(planned.data) }),
    [mods.bom, planned.data],
  );
  const materialFor = useMemo(() => (spec, q) => bomMaterialForSO(bom, spec, q), [bom]);

  const canWrite = role === 'sadmin' || role === 'superadmin';

  const [form, setForm] = useState(() => blankProjection(currentMonth()));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [openMonth, setOpenMonth] = useState('');
  const [basis, setBasis] = useState('remaining');

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  /* ── what the form offers ─────────────────────────────────────────────── */

  const leads = useMemo(() => (Array.isArray(sales.leads) ? sales.leads : []), [sales.leads]);
  // "the marketing person's name also should be selected from the dropdown" — the sales
  // people the Sales Admin already maintains, not a free-text name that drifts.
  const marketers = useMemo(() => {
    const names = new Set();
    (Array.isArray(sales.sales_users) ? sales.sales_users : []).forEach((u) => {
      const nm = String(u.display_name || u.username || '').trim();
      if (nm && u.disabled !== true) names.add(nm);
    });
    projectionList(projections).forEach((r) => { if (r.marketer) names.add(r.marketer); });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [sales.sales_users, projections]);

  const chosenSpec = useMemo(
    () => jss.find((j) => String(j.spec).trim() === String(form.spec).trim()) || null,
    [jss, form.spec],
  );
  // The customer a projection is for: the spec's when it came from the customer list,
  // the typed one when it came from a lead. Its locations follow.
  const forCustomer = form.source === 'customer' ? (chosenSpec ? chosenSpec.customer : '') : form.customer;
  const locations = useMemo(
    () => [...new Set(getCustLocations(customers, forCustomer).map((r) => r.dispatchLoc).filter(Boolean))],
    [customers, forCustomer],
  );
  const months = useMemo(() => monthsFrom(currentMonth(), 12), []);

  async function submit() {
    let entry;
    try { entry = validateProjection(form, { jss }); }
    catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('projections', saveProjection(projections, entry, { user: user || '' }));
      flash('g', `✓ ${qty(entry.qty)} of ${entry.jobName || entry.customer} projected for ${monthLabel(entry.month)}.`);
      setForm({ ...blankProjection(entry.month), source: entry.source, marketer: entry.marketer });
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  async function edit(row) {
    setForm({ ...blankProjection(), ...row, qty: String(row.qty ?? '') });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(row) {
    if (!window.confirm(`Remove the projection of ${qty(row.qty)} for ${row.jobName || row.customer} in ${monthLabel(row.month)}?`)) return;
    setBusy(true);
    try {
      await save('projections', removeProjection(projections, row.id));
      flash('g', 'Projection removed.');
    } catch (e) { flash('r', 'Could not remove it: ' + e.message); } finally { setBusy(false); }
  }

  /* ── the months, and the one that is open ─────────────────────────────── */

  const monthsWithWork = useMemo(() => {
    const known = new Set([...projectedMonths(projections), ...months.slice(0, 3)]);
    return [...known].sort((a, b) => a.localeCompare(b));
  }, [projections, months]);

  const summaries = useMemo(
    () => monthsWithWork.map((m) => reconcileMonth(projections, mods.oab, m)),
    [monthsWithWork, projections, mods.oab],
  );

  const open = useMemo(
    () => (openMonth ? reconcileMonth(projections, mods.oab, openMonth) : null),
    [openMonth, projections, mods.oab],
  );
  const groups = useMemo(() => (open ? byCustomer(open.rows) : []), [open]);
  const material = useMemo(
    () => (open ? materialForMonth(open.rows, materialFor, { basis }) : null),
    [open, materialFor, basis],
  );
  const chart = useMemo(
    () => projectedVsActual(projections, mods.oab, monthsWithWork),
    [projections, mods.oab, monthsWithWork],
  );

  return (
    <div id="app">
      <div className="pg-ttl">📈 Future Projections</div>
      <div className="pg-sub">
        What each month is expected to bring, set against the orders that actually arrive —
        so the material can be bought and the floor planned before the PO lands.
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      {/* ── enter one ─────────────────────────────────────────────────────── */}
      {canWrite && (
        <div className="card">
          <div className="ctitle">{form.id ? '✏ Edit projection' : '＋ Project a month'}</div>
          <div className="al al-b">
            A projection against the <strong>customer list</strong> is anchored to a JSS number, so its
            customer, SKU and material requirement all follow the specification. One against a{' '}
            <strong>lead</strong> has no JSS number yet — its quantity is tentative and it is left out of
            the material total until the job is specified.
          </div>

          <div className="g4">
            <div className="fg">
              <label>This projection is from</label>
              <select value={form.source} aria-label="Projection source"
                onChange={(e) => set({ source: e.target.value, spec: '', leadId: '', customer: '', jobName: '', dispLoc: '' })}>
                <option value="customer">The customer list (JSS)</option>
                <option value="lead">A lead</option>
              </select>
            </div>

            {form.source === 'customer' ? (
              <>
                <div className="fg">
                  <label>JSS Number *</label>
                  <input list="proj-specs" value={form.spec} aria-label="JSS number"
                    placeholder="type or pick a spec…"
                    onChange={(e) => set({ spec: e.target.value, dispLoc: '' })} />
                  <datalist id="proj-specs">
                    {jss.map((j) => <option key={j.spec} value={j.spec}>{`${j.customer || ''} — ${j.jobName || ''}`}</option>)}
                  </datalist>
                  {form.spec && !chosenSpec && (
                    <div style={{ fontSize: 10, color: 'var(--red)', marginTop: 2 }}>
                      Not in the JSS master — add it in the JSS Editor first.
                    </div>
                  )}
                </div>
                <div className="fg">
                  <label>Customer <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(from the JSS)</span></label>
                  <input value={chosenSpec ? chosenSpec.customer || '' : ''} readOnly tabIndex={-1}
                    aria-label="Customer" placeholder="pick a JSS number first"
                    style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} />
                </div>
                <div className="fg">
                  <label>SKU <span style={{ fontWeight: 400, color: 'var(--i3)' }}>(from the JSS)</span></label>
                  <input value={chosenSpec ? chosenSpec.jobName || '' : ''} readOnly tabIndex={-1}
                    aria-label="SKU" placeholder="pick a JSS number first"
                    style={{ background: 'var(--bg)', color: 'var(--i3)', cursor: 'not-allowed' }} />
                </div>
              </>
            ) : (
              <>
                <div className="fg">
                  <label>Lead</label>
                  <select value={form.leadId} aria-label="Lead"
                    onChange={(e) => {
                      const l = leads.find((x) => String(x.id) === e.target.value);
                      set({ leadId: e.target.value, customer: l ? (l.client_name || l.company_name || '') : form.customer });
                    }}>
                    <option value="">— not from a recorded lead —</option>
                    {leads.map((l) => <option key={l.id} value={l.id}>{l.client_name || l.company_name || l.id}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Customer *</label>
                  <input value={form.customer} aria-label="Customer"
                    onChange={(e) => set({ customer: e.target.value })} placeholder="who the lead is with" />
                </div>
                <div className="fg">
                  <label>SKU *</label>
                  <input value={form.jobName} aria-label="SKU"
                    onChange={(e) => set({ jobName: e.target.value })} placeholder="what they would buy" />
                </div>
              </>
            )}

            <div className="fg">
              <label>Dispatch location</label>
              {locations.length ? (
                <select value={form.dispLoc} onChange={(e) => set({ dispLoc: e.target.value })} aria-label="Dispatch location">
                  <option value="">— every location for this customer —</option>
                  {locations.map((l) => <option key={l} value={l}>{l}</option>)}
                  {form.dispLoc && !locations.includes(form.dispLoc) && <option value={form.dispLoc}>{form.dispLoc}</option>}
                </select>
              ) : (
                <input value={form.dispLoc} onChange={(e) => set({ dispLoc: e.target.value })}
                  aria-label="Dispatch location" placeholder="blank = every location" />
              )}
              <div className="pg-sub" style={{ margin: '3px 0 0' }}>
                Left blank, this covers every dispatch location that customer has.
              </div>
            </div>

            <div className="fg">
              <label>Month *</label>
              <select value={form.month} onChange={(e) => set({ month: e.target.value })} aria-label="Month">
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
                {form.month && !months.includes(form.month) && <option value={form.month}>{monthLabel(form.month)}</option>}
              </select>
            </div>

            <div className="fg">
              <label>{form.source === 'lead' ? 'Tentative quantity *' : 'Quantity *'}</label>
              <input type="number" step="any" min="0" className="nospin" value={form.qty}
                aria-label="Quantity" onChange={(e) => set({ qty: e.target.value })} />
            </div>

            <div className="fg">
              <label>Marketing person *</label>
              {marketers.length ? (
                <select value={form.marketer} onChange={(e) => set({ marketer: e.target.value })} aria-label="Marketing person">
                  <option value="">— select —</option>
                  {marketers.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              ) : (
                <input value={form.marketer} onChange={(e) => set({ marketer: e.target.value })}
                  aria-label="Marketing person" placeholder="no sales users on file yet" />
              )}
            </div>

            <div className="fg">
              <label>Note</label>
              <input value={form.note} onChange={(e) => set({ note: e.target.value })} aria-label="Note" />
            </div>
          </div>

          <div className="act">
            <button className="btn btn-g" onClick={submit} disabled={busy}>
              {busy ? 'Saving…' : (form.id ? '💾 Update projection' : '＋ Add projection')}
            </button>
            {form.id && (
              <button className="btn btn-s" disabled={busy}
                onClick={() => setForm(blankProjection(form.month))}>Cancel</button>
            )}
          </div>
        </div>
      )}

      {/* ── the months ────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="ctitle">Monthly projections</div>
        <div className="pg-sub" style={{ marginTop: 0 }}>
          Open a month to see which clients it is made up of, and the film it will take.
        </div>
        <div className="tw"><table>
          <thead><tr>
            <th>Month</th><th style={rt}>Projected</th><th style={rt}>Received so far</th>
            <th style={rt}>Still to come</th><th style={rt}>Not projected</th><th style={{ width: 90 }}></th>
          </tr></thead>
          <tbody>
            {summaries.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>Nothing projected yet.</td></tr>
            ) : summaries.map((m) => {
              const still = m.rows.reduce((t, r) => t + num(r.remaining), 0);
              return (
                <tr key={m.month} style={m.month === openMonth ? { background: 'var(--gl)' } : undefined}>
                  <td><strong>{monthLabel(m.month)}</strong></td>
                  <td style={rt}>{qty(m.projected)}</td>
                  <td style={{ ...rt, color: 'var(--g)' }}>{qty(m.matchedActual)}</td>
                  <td style={rt}>{qty(still)}</td>
                  <td style={{ ...rt, color: m.unplannedQty ? '#B7770D' : undefined }}>{m.unplannedQty ? qty(m.unplannedQty) : '—'}</td>
                  <td>
                    <button className="btn btn-s" aria-label={`Open ${monthLabel(m.month)}`}
                      onClick={() => setOpenMonth(m.month === openMonth ? '' : m.month)}>
                      {m.month === openMonth ? 'Close' : 'Open'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>

      {/* ── projected vs actual ───────────────────────────────────────────── */}
      {chart && chart.points.length > 1 && <ProjectionChart chart={chart} />}

      {/* ── one month, opened ─────────────────────────────────────────────── */}
      {open && (
        <>
          <div className="card">
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>
                Projections for {monthLabel(open.month)} <span className="tag tgr">{open.rows.length}</span>
              </div>
              <span style={{ flex: 1 }} />
              <button className="btn btn-s" onClick={() => setOpenMonth('')}>✕ Close</button>
            </div>
            {open.rows.length === 0 ? (
              <div className="al al-b">Nothing was projected for {monthLabel(open.month)}.</div>
            ) : groups.map((g) => (
              <div key={g.customer} style={{ marginBottom: 12 }}>
                <div className="ctitle" style={{ fontSize: 12, margin: '8px 0 2px' }}>
                  {g.customer}
                  <span className="tag tb" style={{ marginLeft: 8, fontSize: 9 }}>
                    {qty(g.projected)} projected · {qty(g.actual)} in · {qty(g.remaining)} to come
                  </span>
                </div>
                <div className="tw"><table>
                  <thead><tr>
                    <th>SKU</th><th>JSS</th><th>Location</th><th>Marketing</th>
                    <th style={rt}>Projected</th><th style={rt}>Received</th><th style={rt}>Still to come</th>
                    <th>Orders</th>{canWrite && <th style={{ width: 80 }}></th>}
                  </tr></thead>
                  <tbody>
                    {g.rows.map((r) => (
                      <tr key={r.id}>
                        <td style={{ fontSize: 11 }}>
                          {r.jobName || '—'}
                          {r.source === 'lead' && <span className="tag ty" style={{ marginLeft: 6, fontSize: 9 }}>lead</span>}
                        </td>
                        <td style={{ fontSize: 11 }}>{r.spec ? <span className="tag tb" style={{ fontSize: 9 }}>{r.spec}</span> : '—'}</td>
                        <td style={{ fontSize: 11 }}>{r.dispLoc || <span style={{ color: 'var(--i3)' }}>all locations</span>}</td>
                        <td style={{ fontSize: 11 }}>{r.marketer || '—'}</td>
                        <td style={rt}>{qty(r.qty)}</td>
                        <td style={{ ...rt, color: 'var(--g)' }}>
                          {qty(r.actual)}
                          {r.over > 0 && <div style={{ fontSize: 9, color: '#B7770D' }}>+{qty(r.over)} over</div>}
                        </td>
                        <td style={rt}><strong>{qty(r.remaining)}</strong></td>
                        <td style={{ fontSize: 10, color: 'var(--i3)' }}>
                          {r.orders.length ? r.orders.map((o) => o.so).join(', ') : '—'}
                        </td>
                        {canWrite && (
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', marginRight: 4 }}
                              aria-label={`Edit projection ${r.id}`} onClick={() => edit(r)}>✎</button>
                            <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 6px', color: 'var(--red)' }}
                              aria-label={`Remove projection ${r.id}`} onClick={() => remove(r)}>✕</button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              </div>
            ))}

            {open.unplanned.length > 0 && (
              <div className="al al-y">
                <strong>{open.unplanned.length} order(s) arrived that nobody projected</strong> —{' '}
                {qty(open.unplannedQty)} against {[...new Set(open.unplanned.map((p) => p.customer))].join(', ')}.
                That is business the forecast did not see coming, not an error.
              </div>
            )}
          </div>

          {/* ── the film it takes ───────────────────────────────────────── */}
          <div className="card">
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>Material this month needs</div>
              <span style={{ flex: 1 }} />
              <select value={basis} onChange={(e) => setBasis(e.target.value)} aria-label="Requirement basis">
                <option value="remaining">For what is still to come</option>
                <option value="projected">For the whole month as projected</option>
              </select>
            </div>
            <div className="pg-sub" style={{ marginTop: 0 }}>
              Scaled from each spec&rsquo;s BOM. &ldquo;Still to come&rdquo; nets off the orders that have already
              arrived — material for those belongs to the sale order, not to the projection.
            </div>
            {material && material.items.length === 0 ? (
              <div className="al al-b">Nothing to buy against this month yet.</div>
            ) : (
              <div className="tw"><table>
                <thead><tr>
                  <th>Item</th><th>Description</th><th>Material</th><th style={rt}>Required</th><th>UOM</th>
                </tr></thead>
                <tbody>
                  {material.items.map((it) => (
                    <tr key={it.itemCode || it.itemDescription}>
                      <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{it.itemCode || '—'}</td>
                      <td style={{ fontSize: 11 }}>{it.itemDescription || '—'}</td>
                      <td style={{ fontSize: 11 }}>{[it.materialType, it.subGroup].filter(Boolean).join(' · ') || '—'}</td>
                      <td style={{ ...rt, fontWeight: 700 }}>{qty(it.required)}</td>
                      <td style={{ fontSize: 11 }}>{it.uom || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            {material && material.noBom.length > 0 && (
              <div className="al al-y" style={{ marginTop: 8 }}>
                <strong>{material.noBom.length} projection(s) could not be costed:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {material.noBom.map((r) => (
                    <li key={r.id} style={{ fontSize: 11 }}>
                      {r.customer} — {r.jobName || '(no SKU)'} ({qty(r.qty)}): {r.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────── projected vs actual, per month ─────────────────── */

const BOX = { W: 700, H: 240, mL: 56, mR: 14, mT: 16, mB: 42 };

/**
 * Two lines over the same months. Drawn rather than pulled from a library: it is one
 * pair of polylines, and the axis labels have to name values the chart actually
 * reaches — a legend of colours over unlabelled points would say nothing.
 */
function ProjectionChart({ chart }) {
  const { points, max } = chart;
  const iw = BOX.W - BOX.mL - BOX.mR;
  const ih = BOX.H - BOX.mT - BOX.mB;
  const x = (i) => BOX.mL + (points.length === 1 ? iw / 2 : (i * iw) / (points.length - 1));
  const y = (v) => BOX.mT + ih - (Math.max(0, v) / max) * ih;
  const line = (key) => points.map((p, i) => `${x(i)},${y(p[key])}`).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));

  return (
    <div className="card">
      <div className="ctitle">Projected against actual</div>
      <div className="pg-sub" style={{ marginTop: 0 }}>
        <span style={{ color: '#2f6fd0', fontWeight: 700 }}>━ Projected</span>
        <span style={{ marginLeft: 14, color: '#1f9c78', fontWeight: 700 }}>━ Actually received</span>
        {' '}— actual counts every PO dated in the month, including orders nobody projected.
      </div>
      <div className="tw">
        <svg viewBox={`0 0 ${BOX.W} ${BOX.H}`} width="100%" style={{ minWidth: 560, display: 'block' }}
          role="img" aria-label="Projected against actual quantity by month">
          {ticks.map((t, i) => {
            const yy = y(t);
            return (
              <g key={i}>
                <line x1={BOX.mL} y1={yy} x2={BOX.W - BOX.mR} y2={yy} stroke="var(--bd)" strokeWidth="1" />
                <text x={BOX.mL - 8} y={yy + 4} textAnchor="end" fontSize="10" fill="var(--i3)">
                  {t.toLocaleString('en-IN')}
                </text>
              </g>
            );
          })}
          <polyline points={line('projected')} fill="none" stroke="#2f6fd0" strokeWidth="2" />
          <polyline points={line('actual')} fill="none" stroke="#1f9c78" strokeWidth="2" />
          {points.map((p, i) => (
            <g key={p.month}>
              <circle cx={x(i)} cy={y(p.projected)} r="3.5" fill="#2f6fd0" />
              <circle cx={x(i)} cy={y(p.actual)} r="3.5" fill="#1f9c78" />
              <text x={x(i)} y={BOX.H - BOX.mB + 16} textAnchor="middle" fontSize="10" fill="var(--i2)">
                {p.label.replace(' 20', ' ’')}
              </text>
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
