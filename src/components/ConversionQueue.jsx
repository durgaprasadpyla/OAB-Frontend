import { fmtDate } from '../lib/format.js';

// 30.09 §SL5 / §SL6 — the leads waiting for the Super Admin to convert them.
//
// "In My Leads, leads marked Converted should be sent to the Super Admin for
// conversion; once the Super Admin converts, they move to the customers list."
// A rep's Converted is a request; this is where the Super Admin sees it. The same
// banner sits on both Leads screens (S Dashboard → Leads, Dashboard → Leads), fed by
// repFlow.conversionQueue, so the two can never list different leads.
//
// Props: queue (leads), busy, markedBy(lead) → who marked it, owners(lead) → rep
// names, onConvert(lead), onConvertAll().

export default function ConversionQueue({ queue, busy, markedBy, owners, onConvert, onConvertAll }) {
  const n = queue.length;
  if (!n) return null;
  const when = (l) => String(l.conversion_requested_at || l.stage_updated_at || '').slice(0, 10);
  return (
    <div className="al al-y" style={{ display: 'block' }} role="region" aria-label="Leads waiting for conversion">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <span style={{ flex: 1, minWidth: 260, fontWeight: 800 }}>
          🔔 {n} lead{n === 1 ? '' : 's'} marked Converted {n === 1 ? 'is' : 'are'} waiting for you to convert {n === 1 ? 'it' : 'them'}
        </span>
        <button className="btn btn-g" disabled={busy} aria-label="Convert all leads marked Converted" onClick={onConvertAll}>Convert all {n}</button>
      </div>
      <div style={{ fontSize: 11, marginBottom: 6 }}>
        Until a lead is converted here, the sales rep still sees it as a lead. Converting adds it to the Customer Master
        when it is not there yet and moves it to the customer side of the rep&rsquo;s login.
      </div>
      <div className="tw" style={{ background: 'var(--wh)' }}>
        <table style={{ fontSize: 11 }}>
          <thead><tr><th>Lead</th><th>Rep</th><th>Marked Converted by</th><th>On</th><th style={{ width: 100 }}></th></tr></thead>
          <tbody>
            {queue.map((l) => (
              <tr key={l.id}>
                <td style={{ fontWeight: 700 }}>{l.client_name}</td>
                <td>{owners(l).join(', ') || '—'}</td>
                <td>{markedBy(l)}</td>
                <td>{when(l) ? fmtDate(when(l)) : '—'}</td>
                <td style={{ textAlign: 'right' }}>
                  <button className="btn btn-s" style={{ height: 22, fontSize: 10, padding: '0 7px' }} disabled={busy}
                    aria-label={`Convert ${l.client_name} from the queue`} onClick={() => onConvert(l)}>→ Customer</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
