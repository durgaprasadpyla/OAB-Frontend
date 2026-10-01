// Sales Login §6 / §11 / §31 — "the first primary selection will be Lead or
// Customer radio button selection. Based on this selection the drop-down options
// will be populated": a lead is one the Super Admin allocated to the rep or the rep
// added; a customer is one of those the Super Admin has converted, or a customer
// the rep is KAM of. The same control sits on Contacts, SKUs, Log Visit, the PO and
// the Quote Accepted manual form.
import { pickerList } from '../lib/repFlow.js';

const OPTIONS = [['lead', 'Lead'], ['customer', 'Customer']];

/**
 * 30.09 §SL3: "the Lead/Customer radio should move ONE LEVEL UP (above the row) so the
 * customer picker, contact person name and designation are all in ONE row."
 *
 * The picker hands its grid TWO children: a kind row that spans the whole width, and
 * the dropdown as an ordinary field. Placed first in a .g2 / .g3 / .g4, the radios sit
 * on their own line above, and the dropdown lines up with the fields beside it.
 *
 * The 29.09 version put both radios inside the field's <label> as <span class="cb">:
 * a span picks up the 14x14 .cb BOX rule (only label.cb is exempt) and the radios got
 * the 34px .fg text-input styling, so they collapsed to nothing — and since one label
 * held both, every caption click selected Lead. Each option is its own <label class="cb">
 * now, outside .fg, so the radio keeps its 14px size and a caption selects its own side.
 */
export default function LeadCustomerPicker({ book, kind, leadId, onKind, onLead, label = 'Lead / Customer', required = true, lockKind = null, ariaPrefix = '' }) {
  const list = pickerList(book, kind);
  const pre = ariaPrefix ? ariaPrefix + ' ' : '';
  const side = kind === 'customer' ? 'Customer' : 'Lead';
  return (
    <>
      <div className="lc-kind" role="radiogroup" aria-label={pre + 'Lead or customer'}
        style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: 12, marginBottom: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--i2)' }}>{label}{required ? ' *' : ''}</span>
        {OPTIONS.map(([v, l]) => (
          <label key={v} className="cb" style={{ opacity: lockKind && lockKind !== v ? 0.5 : 1 }}>
            <input type="radio" name={(ariaPrefix || 'lc') + '-kind'} value={v} checked={kind === v} disabled={!!lockKind && lockKind !== v}
              aria-label={pre + 'pick ' + l}
              /* 28.09 §Sales ¶19: this fires onKind alone — every call site clears the
                 selected id inside onKind, and a second update in the same event, built
                 from a captured form object, used to undo the first. */
              onChange={() => onKind(v)} />
            <span>{l} <span style={{ color: 'var(--i3)' }}>({(v === 'lead' ? book.leads : book.customers).length})</span></span>
          </label>
        ))}
      </div>
      <div className="fg">
        <label>{side}{required ? ' *' : ''}</label>
        <select value={leadId || ''} aria-label={pre + side} onChange={(e) => onLead(e.target.value)}>
          <option value="">{kind === 'customer' ? '— Select your customer —' : '— Select your lead —'}</option>
          {list.map((l) => <option key={l.id} value={l.id}>{l.client_name}{l.group && l.group !== l.client_name ? ` (${l.group})` : ''}</option>)}
        </select>
        {list.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--i3)', marginTop: 3 }}>
            {kind === 'customer'
              ? 'No customers yet — a lead becomes a customer when the Super Admin converts it, or when you are made its KAM.'
              : 'No leads yet — add one under My Leads, or ask the Super Admin to allocate one to you.'}
          </div>
        )}
      </div>
    </>
  );
}
