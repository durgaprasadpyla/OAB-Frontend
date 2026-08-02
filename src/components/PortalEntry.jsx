import { useState } from 'react';
import { invoicePortalFields, unitNoun } from '../lib/portalData.js';
import { inr } from '../lib/format.js';

// Raw, portal-friendly copy values: money as plain 2dp (no ₹, no thousands
// separators — those get rejected by numeric form fields), qty as an integer.
const money2 = (v) => Number(v || 0).toFixed(2);
const int = (v) => String(Math.round(Number(v || 0)));

/** Copy text to the clipboard, with an execCommand fallback for older browsers. */
async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/**
 * Customer-portal quick-entry panel. Shows the exact fields the payment portal
 * needs (Invoice No., Date, Qty, Total incl GST, Price per unit) with one-click
 * copy so they can be pasted straight in — no re-typing from the PDF. Rendered
 * outside the printable invoice, so it never appears on the PDF or printout.
 */
export default function PortalEntry({ header, lines }) {
  const f = invoicePortalFields(header, lines);
  const [copied, setCopied] = useState('');   // key of the last-copied field
  const flash = (key) => { setCopied(key); setTimeout(() => setCopied((k) => (k === key ? '' : k)), 1500); };
  const doCopy = async (key, value) => { if (await copyText(value)) flash(key); };

  const unit = unitNoun(f.uom);
  const fields = [
    { key: 'no', label: 'Invoice Number', display: f.invoiceNumber || '-', value: f.invoiceNumber },
    { key: 'date', label: 'Invoice Date', display: f.invoiceDate || '-', value: f.invoiceDate, hint: f.invoiceDateIso && f.invoiceDateIso !== f.invoiceDate ? `ISO: ${f.invoiceDateIso}` : '' },
    { key: 'qty', label: 'Quantity', display: `${inr(f.totalQty)} ${f.uom}`, value: int(f.totalQty) },
    { key: 'total', label: 'Total Amount (incl. GST)', display: `₹${inr(f.totalAmount, 2)}`, value: money2(f.totalAmount) },
  ];
  if (f.ratePerUnit != null) {
    fields.push({ key: 'rate', label: `Price per ${unit}`, display: `₹${inr(f.ratePerUnit, 2)}`, value: money2(f.ratePerUnit) });
  }

  // "Copy all" — a labeled block (for notes) and a TSV row (paste into a sheet).
  const allBlock = [
    `Invoice Number\t${f.invoiceNumber}`,
    `Invoice Date\t${f.invoiceDate}`,
    `Quantity\t${int(f.totalQty)} ${f.uom}`,
    `Total Amount\t${money2(f.totalAmount)}`,
    f.ratePerUnit != null ? `Price per ${unit}\t${money2(f.ratePerUnit)}` : null,
  ].filter(Boolean).join('\n');
  const allTsv = [f.invoiceNumber, f.invoiceDate, int(f.totalQty), money2(f.totalAmount), f.ratePerUnit != null ? money2(f.ratePerUnit) : '']
    .join('\t');

  const rowS = { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--bd)' };
  const lblS = { flex: '0 0 42%', fontSize: 12, color: 'var(--i3)' };
  const valS = { flex: 1, fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' };
  const btnS = { height: 24, fontSize: 10, padding: '0 10px' };

  return (
    <div className="card" style={{ maxWidth: 560, margin: '0 auto 16px', border: '1px solid var(--g)', background: 'var(--gl)' }}>
      <div className="ctitle" style={{ marginBottom: 2 }}>📋 Customer Portal — Quick Entry</div>
      <div style={{ fontSize: 11, color: 'var(--i3)', marginBottom: 8 }}>
        Copy each field straight into the payment portal — no re-typing from the PDF. Values match the invoice exactly.
      </div>

      <div>
        {fields.map((fld) => (
          <div key={fld.key} style={rowS}>
            <div style={lblS}>
              {fld.label}
              {fld.hint ? <span style={{ display: 'block', fontSize: 9, color: 'var(--i3)', fontWeight: 400 }}>{fld.hint}</span> : null}
            </div>
            <div style={valS}>{fld.display}</div>
            <button type="button" className="btn btn-s" style={btnS} onClick={() => doCopy(fld.key, fld.value)}>
              {copied === fld.key ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        ))}
      </div>

      {f.ratePerUnit == null && f.lines.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: 'var(--i3)', margin: '2px 0 4px' }}>Price per {unit} (lines have different rates):</div>
          {f.lines.map((ln, i) => (
            <div key={i} style={rowS}>
              <div style={lblS}>{ln.description}<span style={{ display: 'block', fontSize: 9, color: 'var(--i3)', fontWeight: 400 }}>{inr(ln.qty)} {ln.uom}</span></div>
              <div style={valS}>₹{inr(ln.rate, 2)}</div>
              <button type="button" className="btn btn-s" style={btnS} onClick={() => doCopy('ln' + i, money2(ln.rate))}>
                {copied === 'ln' + i ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 10 }}>
        <button type="button" className="btn btn-s" onClick={() => doCopy('all', allBlock)}>
          {copied === 'all' ? '✓ Copied all' : 'Copy all (labeled)'}
        </button>
        <button type="button" className="btn btn-s" onClick={() => doCopy('row', allTsv)}>
          {copied === 'row' ? '✓ Copied row' : 'Copy as row (TSV)'}
        </button>
      </div>
    </div>
  );
}
