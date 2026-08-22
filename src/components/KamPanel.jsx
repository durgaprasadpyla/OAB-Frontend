import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { inr } from '../lib/format.js';
import { activeReps } from '../lib/sales.js';
import { kamRows, kamApplyEdits } from '../lib/kam.js';

// Customer KAM & Targets — assign a key account manager, an expected order
// frequency and a monthly target per customer, with this month's achievement
// read live from the OAB board.
//
// Edits are staged locally and written in one save, matching the monolith:
// typing in twenty rows should be one write, not twenty.

const nm = (v) => String(v == null ? '' : v).trim();

/**
 * Apply staged primary-contact edits (name / phone) to the sales `contacts`
 * array, returning a NEW array. Mirrors the legacy kamFindContactIndex: prefer
 * the customer's flagged-primary contact, else any contact on file (matched
 * directly by `customer` or via a linked lead); when none exists, create one.
 * (legacy 7305-7319, kamFindContactIndex 7262)
 */
function applyContactEdits(contacts, leads, contactEdits) {
  let out = (contacts || []).slice();
  const list = leads || [];
  Object.entries(contactEdits || {}).forEach(([customer, fields]) => {
    const target = nm(customer);
    const matches = (c) => {
      if (nm(c.customer) === target) return true;
      const l = list.find((x) => x.id === c.lead_id);
      return !!(l && nm(l.client_name) === target);
    };
    let idx = out.findIndex((c) => matches(c) && (c.is_primary || String(c.priority) === '1'));
    if (idx < 0) idx = out.findIndex(matches);
    if (idx >= 0) {
      out[idx] = { ...out[idx], ...fields, is_primary: true, priority: '1', customer: out[idx].customer || customer };
    } else {
      out = [...out, {
        id: 'contact_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        customer, name: fields.name || '', phone: fields.phone || '',
        is_primary: true, priority: '1', created_at: new Date().toISOString(),
      }];
    }
  });
  return out;
}

/**
 * Keep the Customer Master ("customer file") in sync with a contact edit: write
 * name/phone onto the FIRST master row for that customer, matching the legacy
 * cmPersist step (7320-7324). Returns a NEW customers array.
 */
function applyCustomerContact(customers, contactEdits) {
  const done = {};
  return (customers || []).map((c) => {
    const name = nm(c.customer);
    const e = contactEdits[name];
    if (!e || done[name]) return c;
    done[name] = true;
    const patch = {};
    if ('name' in e) patch.contactPerson = e.name;
    if ('phone' in e) patch.contactPhone = e.phone;
    return { ...c, ...patch };
  });
}

export default function KamPanel() {
  const { mods, save } = useData();
  const sales = mods.sales || {};

  const [q, setQ] = useState('');
  const [edits, setEdits] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const rows = useMemo(
    () => kamRows({ customers: mods.customers, sales, oab: mods.oab?.OAB }),
    [mods.customers, sales, mods.oab],
  );
  const reps = activeReps(sales.sales_users);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? rows.filter((r) => [r.customer, r.group, r.kam].some((v) => String(v || '').toLowerCase().includes(t))) : rows;
  }, [rows, q]);

  const dirtyCount = Object.keys(edits).length;
  const valueOf = (r, field, fallback) => {
    const e = edits[r.customer];
    return e && field in e ? e[field] : fallback;
  };
  const stage = (customer, field, value) =>
    setEdits((s) => ({ ...s, [customer]: { ...(s[customer] || {}), [field]: value } }));

  async function saveAll() {
    setBusy(true);
    try {
      // Split staged edits: KAM/frequency/target live on the LEAD; the primary
      // contact name/phone live on the sales CONTACTS array and the Customer
      // Master. (legacy 7290-7325)
      const leadEdits = {};
      const contactEdits = {};
      Object.entries(edits).forEach(([customer, f]) => {
        const le = {};
        if ('kam' in f) le.kam = f.kam;
        if ('order_frequency' in f) le.order_frequency = f.order_frequency;
        if ('monthly_target' in f) le.monthly_target = f.monthly_target;
        if (Object.keys(le).length) leadEdits[customer] = le;
        const ce = {};
        if ('contactName' in f) ce.name = f.contactName;
        if ('contactPhone' in f) ce.phone = f.contactPhone;
        if (Object.keys(ce).length) contactEdits[customer] = ce;
      });

      await save('sales', (prev) => {
        const base = prev || {};
        return {
          ...base,
          leads: kamApplyEdits(base.leads || [], leadEdits),
          contacts: applyContactEdits(base.contacts || [], base.leads || [], contactEdits),
        };
      });
      if (Object.keys(contactEdits).length) {
        await save('customers', (prev) => applyCustomerContact(prev || [], contactEdits));
      }
      setEdits({});
      setMsg({ t: 'g', text: `✅ Saved ${dirtyCount} customer${dirtyCount === 1 ? '' : 's'}.` });
    } catch (e) {
      setMsg({ t: 'r', text: 'Save failed: ' + (e.message || e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="card">
      <div className="fbar">
        <div className="ctitle" style={{ margin: 0 }}>🎯 Customer KAM &amp; Targets <span className="tag tgr">{filtered.length}</span></div>
        <input placeholder="Search customer / group / KAM…" value={q} aria-label="Search KAM" onChange={(e) => setQ(e.target.value)} />
        <span style={{ flex: 1 }} />
        <button className="btn btn-g" onClick={saveAll} disabled={busy || !dirtyCount}>
          {busy ? 'Saving…' : dirtyCount ? `💾 Save ${dirtyCount}` : '💾 Save'}
        </button>
      </div>
      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
      <div className="pg-sub" style={{ marginTop: 0 }}>
        Achieved is read live from the OAB board, so a sale order entered by ops closes the
        gap on its own. Suggested figures are this customer's own last-three-month average.
      </div>

      <div className="tw sy" style={{ maxHeight: 'calc(100vh - 320px)' }}>
        <table>
          <thead><tr>
            <th style={{ minWidth: 170 }}>Customer</th><th>Group</th><th style={{ minWidth: 150 }}>Primary contact</th>
            <th style={{ width: 160 }}>KAM</th>
            <th style={{ width: 120, textAlign: 'right' }}>Order freq (days)</th>
            <th style={{ width: 130, textAlign: 'right' }}>Monthly target</th>
            <th style={{ minWidth: 170 }}>Achieved &amp; Gap</th>
          </tr></thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 20, color: 'var(--i3)' }}>No customers match</td></tr>
            ) : filtered.map((r) => {
              const kam = valueOf(r, 'kam', r.kam);
              const freq = valueOf(r, 'order_frequency', r.freq ?? '');
              const target = valueOf(r, 'monthly_target', r.target ?? '');
              const contactName = valueOf(r, 'contactName', r.contactName || '');
              const contactPhone = valueOf(r, 'contactPhone', r.contactPhone || '');
              // Achieved-vs-target bar with a target marker (legacy 7386-7389).
              const achieved = r.achieved;
              const targetNum = target === '' || target == null ? 0 : Number(target) || 0;
              const barMax = Math.max(targetNum, achieved, 1);
              const achPct = Math.min(100, (achieved / barMax) * 100);
              const tgtPct = Math.min(100, (targetNum / barMax) * 100);
              const over = achieved >= targetNum;
              const gapTxt = targetNum <= 0 ? 'No target' : over ? '+' + inr(achieved - targetNum) : '-' + inr(targetNum - achieved);
              return (
                <tr key={r.customer} style={edits[r.customer] ? { background: '#fffaf0' } : undefined}>
                  <td style={{ fontWeight: 600 }}>{r.customer}</td>
                  <td style={{ fontSize: 11 }}>{r.group || '—'}</td>
                  <td>
                    <input
                      type="text" value={contactName} placeholder="Contact name" style={{ width: '100%', fontSize: 11, marginBottom: 2 }}
                      aria-label={`Contact name for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'contactName', e.target.value)}
                    />
                    <input
                      type="text" value={contactPhone} placeholder="Phone" style={{ width: '100%', fontSize: 11 }}
                      aria-label={`Contact phone for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'contactPhone', e.target.value)}
                    />
                  </td>
                  <td>
                    <select value={kam} aria-label={`KAM for ${r.customer}`} onChange={(e) => stage(r.customer, 'kam', e.target.value)}>
                      <option value="">— Unassigned —</option>
                      {reps.map((rep) => <option key={rep.id} value={rep.id}>{rep.display_name}</option>)}
                    </select>
                  </td>
                  <td>
                    <input
                      type="number" min="0" step="1" className="kam-numinput" value={freq} style={{ width: '100%', textAlign: 'center' }}
                      placeholder={r.suggestedFreqDays ? String(r.suggestedFreqDays) : ''}
                      aria-label={`Order frequency for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'order_frequency', e.target.value)}
                    />
                    <div style={{ fontSize: 9, color: 'var(--i3)', marginTop: 2, textAlign: 'center' }}>days · avg {r.suggestedFreqDays || 0}</div>
                  </td>
                  <td>
                    <input
                      type="number" min="0" step="1" className="kam-numinput" value={target} style={{ width: '100%', textAlign: 'right' }}
                      placeholder={r.suggestedTarget ? String(Math.round(r.suggestedTarget)) : ''}
                      aria-label={`Monthly target for ${r.customer}`}
                      onChange={(e) => stage(r.customer, 'monthly_target', e.target.value)}
                    />
                    <div style={{ fontSize: 9, color: 'var(--i3)', marginTop: 2, textAlign: 'right' }}>avg {inr(Math.round(r.suggestedTarget || 0))}</div>
                  </td>
                  <td>
                    <div style={{ position: 'relative', height: 8, background: 'var(--bg)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: achPct + '%', background: over ? 'var(--g)' : '#E67E22' }} />
                      <div style={{ position: 'absolute', top: 0, left: tgtPct + '%', height: '100%', width: 2, background: '#333' }} />
                    </div>
                    <div style={{ fontSize: 9, color: 'var(--i3)', marginTop: 2 }} title="Target / Achieved / Gap">
                      T{inr(targetNum)} A{inr(achieved)}{' '}
                      <span style={{ fontWeight: 700, color: targetNum <= 0 ? 'var(--i3)' : over ? 'var(--g)' : 'var(--red)' }}>{gapTxt}</span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
