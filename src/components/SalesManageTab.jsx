import { useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { ddList, ddPairs } from '../lib/dropdowns.js';
import { salesUid } from '../lib/sales.js';
import { DESPATCH_FORMS } from '../lib/salesTargets.js';
import {
  manageCustomers, manageGroups, customerCategories, customerCategoryForms,
  applyCustomerCategories, cleanupApply, deleteCustomer,
} from '../lib/salesAdmin.js';

// 🧹 Manage — consolidate the variations reps type in.
//
// A rename here is a cross-module write: the same customer name lives on leads and
// contacts (module 12), the Customer Master (4), the JSS specs (2) and the OAB rows
// (1). Renaming onto an existing name MERGES the two, which is the point of the tool.
// Only the modules that actually changed are saved.
//
// Ported from sdashManage / _cleanupApply / sdashSaveCustCats / sdashDeleteCustomer.

export default function SalesManageTab({ sales, save }) {
  const { mods } = useData();
  const [cust, setCust] = useState('');
  const [custNew, setCustNew] = useState('');
  const [grp, setGrp] = useState('');
  const [grpNew, setGrpNew] = useState('');
  const [catCust, setCatCust] = useState('');
  const [cats, setCats] = useState([]);
  const [catForms, setCatForms] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const customers = useMemo(() => manageCustomers(sales), [sales]);
  const groups = useMemo(() => manageGroups(sales, mods.customers), [sales, mods.customers]);
  const allCats = ddList(sales, 'categories');
  const despatch = useMemo(() => ddPairs(sales, 'despatch') || DESPATCH_FORMS, [sales]);

  const flash = (t, text) => { setMsg({ t, text }); if (t === 'g') setTimeout(() => setMsg(null), 6000); };

  function pickCatCustomer(name) {
    setCatCust(name);
    setCats(name ? customerCategories(sales, name) : []);
    setCatForms(name ? customerCategoryForms(sales, name) : {});
  }

  const toggleCat = (c) => setCats((xs) => (xs.includes(c) ? xs.filter((x) => x !== c) : [...xs, c]));
  const toggleForm = (cat, form) => setCatForms((m) => {
    const cur = Array.isArray(m[cat]) ? m[cat] : [];
    return { ...m, [cat]: cur.includes(form) ? cur.filter((f) => f !== form) : [...cur, form] };
  });

  /** Write only the modules a cleanup actually touched. */
  async function applyCleanup(kind, oldVal, newVal, verb) {
    setBusy(true);
    try {
      const r = cleanupApply(kind, oldVal, newVal, {
        sales, customers: mods.customers, jss: mods.jss, oab: mods.oab,
      });
      if (r.counts.leads || r.counts.contacts) {
        await save('sales', (prev) => ({ ...(prev || {}), leads: r.leads, contacts: r.contacts }));
      }
      if (r.counts.cm) await save('customers', r.customers);
      if (r.counts.jss) await save('jss', r.jss);
      if (r.counts.oab) await save('oab', r.oab);
      const c = r.counts;
      flash('g', `✓ ${verb}. ${c.leads} leads, ${c.contacts} contacts, ${c.cm} master rows, ${c.jss} specs, ${c.oab} orders.`);
      return true;
    } catch (e) { flash('r', 'Failed: ' + (e.message || e)); return false; } finally { setBusy(false); }
  }

  async function renameCustomer() {
    if (!cust) return flash('r', 'Pick a customer.');
    if (!custNew.trim()) return flash('r', 'Enter the new name.');
    if (custNew.trim() === cust) return flash('r', 'New name is the same as the old one.');
    if (!window.confirm(`Rename customer "${cust}" → "${custNew.trim()}" everywhere (leads, contacts, Customer Master, JSS, Sales Orders)? Merges if "${custNew.trim()}" already exists.`)) return;
    if (await applyCleanup('renameCustomer', cust, custNew.trim(), `Renamed to "${custNew.trim()}"`)) {
      setCust(''); setCustNew('');
    }
  }

  async function removeCustomer() {
    if (!cust) return flash('r', 'Pick a customer.');
    if (!window.confirm(`Delete customer "${cust}"? This removes their lead and contact records from the sales tracker, AND their entries from the Customer Master — so they disappear from every customer dropdown across every login. JSS specs and Sales Order history under this name are NOT touched.`)) return;
    setBusy(true);
    try {
      const r = deleteCustomer(cust, { sales, customers: mods.customers });
      await save('sales', (prev) => ({ ...(prev || {}), leads: r.leads, contacts: r.contacts }));
      if (r.counts.cm) await save('customers', r.customers);
      flash('g', `✓ Deleted "${cust}" — removed ${r.counts.leads} lead record(s), ${r.counts.contacts} contact(s), and ${r.counts.cm} Customer Master row(s).`);
      setCust('');
    } catch (e) { flash('r', 'Delete failed: ' + (e.message || e)); } finally { setBusy(false); }
  }

  async function renameGroup() {
    if (!grp) return flash('r', 'Pick a group.');
    if (!grpNew.trim()) return flash('r', 'Enter the new group name.');
    if (grpNew.trim() === grp) return flash('r', 'New name is the same as the old one.');
    if (!window.confirm(`Rename group "${grp}" → "${grpNew.trim()}" everywhere (contacts, Customer Master, JSS)?`)) return;
    if (await applyCleanup('renameGroup', grp, grpNew.trim(), `Group renamed to "${grpNew.trim()}"`)) {
      setGrp(''); setGrpNew('');
    }
  }

  async function removeGroup() {
    if (!grp) return flash('r', 'Pick a group to delete.');
    if (!window.confirm(`Delete group "${grp}"? Its customers stay but become ungrouped (contacts, Customer Master, JSS).`)) return;
    if (await applyCleanup('deleteGroup', grp, '', `Group "${grp}" deleted`)) setGrp('');
  }

  async function saveCats() {
    if (!catCust) return flash('r', 'Pick a customer first.');
    if (!cats.length && !window.confirm(`No categories selected — clear all categories for "${catCust}"?`)) return;
    // Only keep dispatch-form restrictions for categories that survived.
    const forms = {};
    cats.forEach((c) => { if (Array.isArray(catForms[c]) && catForms[c].length) forms[c] = catForms[c]; });
    setBusy(true);
    try {
      let result = null;
      await save('sales', (prev) => {
        result = applyCustomerCategories(prev || {}, catCust, cats, forms, { uid: salesUid });
        return { ...(prev || {}), leads: result.leads };
      });
      flash('g', result && result.created
        ? `✓ Created a customer record for "${catCust}" and set its categories.`
        : `✓ Categories updated for ${catCust} (${result ? result.count : 0} lead record(s)).`);
    } catch (e) { flash('r', 'Save failed: ' + (e.message || e)); } finally { setBusy(false); }
  }

  const chip = { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, background: '#f4f7fb', border: '1px solid #e3ebf5', borderRadius: 6, padding: '3px 8px', cursor: 'pointer' };

  return (
    <>
      <div className="card">
        <div className="ctitle" style={{ marginBottom: 4 }}>🧹 Manage Customers, Groups &amp; Categories</div>
        <div className="pg-sub" style={{ margin: 0 }}>
          Consolidate the variations reps enter. Renames and merges apply across leads, contacts, the Customer Master,
          JSS specs and Sales Orders. Category changes update the customer’s lead records.
        </div>
      </div>

      {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}

      <div className="card">
        <div className="ctitle">✏ Change or delete a customer name</div>
        <div className="g4" style={{ alignItems: 'end' }}>
          <div className="fg"><label>Customer</label>
            <select value={cust} aria-label="Customer to manage" onChange={(e) => setCust(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="fg"><label>New name (for rename)</label>
            <input value={custNew} aria-label="New customer name" onChange={(e) => setCustNew(e.target.value)} />
          </div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={renameCustomer} disabled={busy}>Rename / Merge</button></div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-r" onClick={removeCustomer} disabled={busy}>Delete</button></div>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">🏷 Edit or delete a group</div>
        <div className="g4" style={{ alignItems: 'end' }}>
          <div className="fg"><label>Group</label>
            <select value={grp} aria-label="Group to manage" onChange={(e) => setGrp(e.target.value)}>
              <option value="">— Select group —</option>
              {groups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div className="fg"><label>New name (for rename)</label>
            <input value={grpNew} aria-label="New group name" onChange={(e) => setGrpNew(e.target.value)} />
          </div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={renameGroup} disabled={busy}>Rename</button></div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-r" onClick={removeGroup} disabled={busy}>Delete</button></div>
        </div>
      </div>

      <div className="card">
        <div className="ctitle">📂 Change the categories a customer deals in</div>
        <div className="g2" style={{ alignItems: 'end', marginBottom: 10 }}>
          <div className="fg"><label>Customer</label>
            <select value={catCust} aria-label="Customer for categories" onChange={(e) => pickCatCustomer(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="fg"><label>&nbsp;</label><button className="btn btn-g" onClick={saveCats} disabled={busy}>✓ Save categories</button></div>
        </div>

        {!catCust ? (
          <div className="pg-sub" style={{ margin: 0 }}>Pick a customer to edit its categories.</div>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allCats.map((c) => (
                <label key={c} style={chip}>
                  <input type="checkbox" checked={cats.includes(c)} onChange={() => toggleCat(c)} style={{ margin: 0 }} />{c}
                </label>
              ))}
            </div>

            {/* Dispatch forms are configured per category, so this only appears once
                categories are picked. All unticked = every form allowed. */}
            {cats.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--i2)', marginBottom: 6 }}>📮 Dispatch forms allowed per category</div>
                {cats.map((cat) => (
                  <div key={cat} style={{ marginBottom: 8, padding: '8px 10px', background: '#f9fafc', border: '1px solid #eceff3', borderRadius: 7 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--blu)', marginBottom: 5 }}>{cat}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {despatch.map((d) => (
                        <label key={d[0]} style={{ ...chip, background: '#fff', border: '1px solid #dde4ee' }}>
                          <input
                            type="checkbox" style={{ margin: 0 }}
                            checked={Array.isArray(catForms[cat]) && catForms[cat].includes(d[0])}
                            onChange={() => toggleForm(cat, d[0])}
                          />{d[1]}
                        </label>
                      ))}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 4 }}>Leave all unticked to allow every dispatch form for this category.</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
