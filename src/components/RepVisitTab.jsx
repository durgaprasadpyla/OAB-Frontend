import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { fmtDate, inr } from '../lib/format.js';
import { ddList } from '../lib/dropdowns.js';
import { buildVisit } from '../lib/repPortal.js';
import { repBook } from '../lib/repFlow.js';
import LeadCustomerPicker from './LeadCustomerPicker.jsx';

// 📋 Log Visit — the rep's activity log. Every call, visit or sample handover is
// recorded against a customer with what happened and when to ping them next.
// Ported from repVisit / repSaveVisit / repVisitTypeToggle.
//
// Two rules are deliberate and enforced in buildVisit(): notes are mandatory (an
// entry with no notes tells the next person nothing), and the next ping defaults to
// two days out rather than being left blank, so nothing drops off the follow-up list.

export default function RepVisitTab({ leads, sales, save, repId }) {
  const { mods } = useData();
  // Sales Login §31-§33: lead or customer first, then the list that goes with it.
  const book = useMemo(() => repBook(sales, mods.customers || [], repId), [sales, mods.customers, repId]);
  const [form, setForm] = useState({ kind: 'lead', leadId: '', type: '', outcome: '', expense: '', followUp: '', followUpType: '' });
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const types = ddList(sales, 'visit_types');
  const pingTypes = ddList(sales, 'ping_types');
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 4000); };

  // The cost incurred: a visit's travel, a meeting's expenses (§34) — a phone call has none.
  const curType = form.type || types[0];
  const isVisit = curType === 'Visit' || curType === 'Meeting';

  const mine = useMemo(() => (sales.interactions || [])
    .filter((i) => i.created_by === repId)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
    .slice(0, 50), [sales.interactions, repId]);

  const leadName = (id) => ((sales.leads || []).find((l) => l.id === id) || leads.find((l) => l.id === id) || {}).client_name || '—';

  async function saveVisit() {
    let inter;
    try {
      inter = buildVisit({ ...form, type: form.type || types[0], followUpType: form.followUpType || pingTypes[0] }, repId);
    } catch (e) { flash('r', e.message); return; }
    setBusy(true);
    try {
      await save('sales', (prev) => ({
        ...(prev || {}),
        interactions: [...((prev && prev.interactions) || []), inter],
        // The lead's own next-ping date moves with the visit, so the Follow-ups tab
        // and the admin's nudge list both see it without re-deriving.
        leads: ((prev && prev.leads) || []).map((l) => (l.id === inter.lead_id ? { ...l, next_follow_up_date: inter.follow_up_date } : l)),
      }));
      setForm({ kind: form.kind, leadId: '', type: '', outcome: '', expense: '', followUp: '', followUpType: '' });
      flash('g', '✓ Saved.');
    } catch (e) { flash('r', 'Save failed: ' + e.message); } finally { setBusy(false); }
  }

  return (
    <>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle">📋 Log a Visit / Update</div>
        <div className="g2">
          <LeadCustomerPicker book={book} kind={form.kind} leadId={form.leadId} onKind={(k) => set({ kind: k, leadId: '' })} onLead={(id) => set({ leadId: id })} ariaPrefix="Visit" />
          <div className="fg"><label>Activity Type</label>
            <select value={form.type || types[0] || ''} aria-label="Activity Type" onChange={(e) => set({ type: e.target.value })}>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="fg" style={{ gridColumn: '1/-1' }}>
            <label>Outcome / Notes * <span style={{ color: 'var(--i3)', fontWeight: 400 }}>— record what happened in this visit</span></label>
            <textarea
              rows={3} value={form.outcome} aria-label="Outcome / Notes"
              placeholder="What was discussed, customer response, next steps…"
              onChange={(e) => set({ outcome: e.target.value })}
            />
          </div>
          {isVisit && (
            <div className="fg"><label>Cost incurred (₹) <span style={{ color: 'var(--i3)', fontWeight: 400 }}>— {curType === 'Meeting' ? 'this meeting, if any' : 'this visit'}</span></label>
              <input type="number" min="0" step="0.01" value={form.expense} aria-label="Cost incurred" placeholder="₹" onChange={(e) => set({ expense: e.target.value })} />
              <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>Adds up on the Sales Admin dashboard as the cost of converting (leads) or retaining (customers) a customer.</div>
            </div>
          )}
          <div className="fg"><label>Next Ping Date</label>
            <input type="date" value={form.followUp} aria-label="Next Ping Date" onChange={(e) => set({ followUp: e.target.value })} />
          </div>
          <div className="fg"><label>Next Ping Type</label>
            <select value={form.followUpType || pingTypes[0] || ''} aria-label="Next Ping Type" onChange={(e) => set({ followUpType: e.target.value })}>
              {pingTypes.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="act"><button className="btn btn-g" onClick={saveVisit} disabled={busy}>✓ Save Update</button></div>
      </div>

      <div className="card">
        <div className="ctitle">Recent Updates</div>
        <div className="tw sy">
          <table>
            <thead><tr>
              <th>Date</th><th>Customer</th><th>Type</th><th>Notes</th>
              <th style={{ textAlign: 'right' }}>Cost incurred</th><th>Next Ping</th>
            </tr></thead>
            <tbody>
              {mine.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No updates logged yet</td></tr>
              ) : mine.map((i) => (
                <tr key={i.id}>
                  <td>{fmtDate(i.date)}</td>
                  <td style={{ fontWeight: 600 }}>{leadName(i.lead_id)}</td>
                  <td>{i.type || '—'}</td>
                  <td style={{ color: 'var(--i2)' }}>{i.outcome || i.reason || '—'}</td>
                  <td style={{ textAlign: 'right', color: '#d2691e', whiteSpace: 'nowrap' }}>{i.expense ? '₹' + inr(i.expense) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {i.follow_up_date
                      ? <>{fmtDate(i.follow_up_date)}{i.follow_up_type ? <span style={{ color: 'var(--i3)' }}> ({i.follow_up_type})</span> : null}</>
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
