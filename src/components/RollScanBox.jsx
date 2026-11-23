import { useState } from 'react';

// BloomFlex V2: "Scan / type roll barcode". A USB barcode scanner is a keyboard — it
// types the sticker's code and presses Enter — so this is one text box that submits on
// Enter. `onScan(code)` resolves to an error message (shown in red) or nothing (done).
export default function RollScanBox({ onScan, label = 'Scan / type roll barcode', hint, disabled = false }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState(null);   // { ok, text }
  const [busy, setBusy] = useState(false);

  async function submit() {
    const code = text.trim();
    if (!code || busy) return;
    setBusy(true);
    try {
      const err = await onScan(code);
      if (err) setMsg({ ok: false, text: err });
      else { setMsg({ ok: true, text: `${code.toUpperCase()} picked.` }); setText(''); }
    } catch (e) {
      setMsg({ ok: false, text: (e && e.message) || String(e) });
    } finally { setBusy(false); }
  }

  return (
    <div className="fg" style={{ maxWidth: 420 }}>
      <label>🔎 {label}</label>
      <input value={text} disabled={disabled} placeholder="BLMU-…" autoComplete="off" spellCheck={false}
        aria-label={label} style={{ fontFamily: 'monospace' }}
        onChange={(e) => { setText(e.target.value); if (msg) setMsg(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      {msg ? (
        <div role={msg.ok ? 'status' : 'alert'} style={{ fontSize: 11, marginTop: 2, color: msg.ok ? 'var(--g)' : 'var(--red)' }}>{msg.text}</div>
      ) : hint ? <div className="pg-sub" style={{ margin: '2px 0 0' }}>{hint}</div> : null}
    </div>
  );
}
