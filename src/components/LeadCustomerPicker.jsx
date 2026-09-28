// Sales Login §6 / §11 / §31 — "the first primary selection will be Lead or
// Customer radio button selection. Based on this selection the drop-down options
// will be populated": a lead is one the Super Admin allocated to the rep or the rep
// added; a customer is one of those the Super Admin has converted, or a customer
// the rep is KAM of. The same control sits on Contacts, SKUs, Log Visit and the PO.
import { pickerList } from '../lib/repFlow.js';

export default function LeadCustomerPicker({ book, kind, leadId, onKind, onLead, label = 'Lead / Customer', required = true, lockKind = null, ariaPrefix = '' }) {
  const list = pickerList(book, kind);
  const pre = ariaPrefix ? ariaPrefix + ' ' : '';
  return (
    <div className="fg">
      <label>{label}{required ? ' *' : ''}</label>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, marginBottom: 4 }} role="radiogroup" aria-label={pre + 'Lead or customer'}>
        {[['lead', 'Lead'], ['customer', 'Customer']].map(([v, l]) => (
          <label key={v} className="cb" style={{ opacity: lockKind && lockKind !== v ? 0.5 : 1 }}>
            <input type="radio" name={(ariaPrefix || 'lc') + '-kind'} value={v} checked={kind === v} disabled={!!lockKind && lockKind !== v}
              aria-label={pre + "pick " + l}
              /* 28.09 §Sales ¶19: "The radio button is there but I am not able to select
                 the customer radio button selection." This fired onKind and then onLead in
                 the SAME event. A call site that builds its next state by spreading a
                 CAPTURED form object applied the second update over the first — which put
                 `kind` back to what it had just been, and the radio appeared dead. Every
                 call site clears the selected id inside onKind already, so this no longer
                 reaches over and does it again. */
              onChange={() => onKind(v)} />
            <span>{l} <span style={{ color: 'var(--i3)' }}>({(v === 'lead' ? book.leads : book.customers).length})</span></span>
          </label>
        ))}
      </div>
      <select value={leadId || ''} aria-label={pre + (kind === 'customer' ? 'Customer' : 'Lead')} onChange={(e) => onLead(e.target.value)}>
        <option value="">{kind === 'customer' ? '— Select your customer —' : '— Select your lead —'}</option>
        {list.map((l) => <option key={l.id} value={l.id}>{l.client_name}{l.group && l.group !== l.client_name ? ` (${l.group})` : ''}</option>)}
      </select>
      {list.length === 0 && (
        <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>
          {kind === 'customer'
            ? 'No customers yet — a lead becomes a customer when the Super Admin converts it, or when you are made its KAM.'
            : 'No leads yet — add one under Add Lead, or ask the Super Admin to allocate one to you.'}
        </div>
      )}
    </div>
  );
}
