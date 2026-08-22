import { useEffect, useMemo, useState } from 'react';
import { useData } from '../data.jsx';
import { negoGroups, negoThread, negoPost, negoMarkSeen, negoUnread } from '../lib/nego.js';

// Price negotiation — one thread per SKU, shared by the rep and the Quotation Desk.
//   <NegoPanel side="quote" onRevise={fn} />   the desk's inbox (Revise → new version)
//   <NegoPanel side="rep" />                    the rep's view, scoped to their own SKUs
//
// onRevise (quote side only) hands the latest quotation covering the open thread's SKU
// back to the desk so it can open the New-Quotation builder at the next version.
// (qtNego "Revise → new version" 15500)

export default function NegoPanel({ side = 'quote', skuIds = null, onRevise = null }) {
  const { mods, save } = useData();
  const sales = mods.sales || {};
  const [openSku, setOpenSku] = useState(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const patch = (p) => save('sales', (prev) => ({ ...(prev || {}), ...p }));

  const groups = useMemo(() => {
    const all = negoGroups(sales, side);
    // A rep only ever sees threads for SKUs allocated to them.
    return skuIds ? all.filter((g) => skuIds.includes(g.sku_id)) : all;
  }, [sales, side, skuIds]);

  const skuName = (id) => ((sales.skus || []).find((s) => s.id === id) || {}).sku_name || id;
  const leadName = (id) => ((sales.leads || []).find((l) => l.id === id) || {}).client_name || '—';

  // Opening a thread clears its unread badge for this side.
  useEffect(() => {
    if (!openSku) return;
    if (!negoUnread(sales, openSku, side)) return;
    patch({ nego_msgs: negoMarkSeen(sales, side, openSku) }).catch(() => { /* badge only */ });
  }, [openSku]); // eslint-disable-line react-hooks/exhaustive-deps

  async function send(group) {
    setBusy(true);
    try {
      const next = negoPost(sales, { skuId: group.sku_id, leadId: group.lead_id, from: side, text });
      await patch({ nego_msgs: next });
      setText('');
      setMsg(null);
    } catch (e) {
      setMsg({ t: 'r', text: e.message || String(e) });
    } finally { setBusy(false); }
  }

  const thread = openSku ? negoThread(sales, openSku) : [];

  // The newest quotation covering the open SKU — the one a revision bumps a version from.
  const latestQuote = useMemo(() => {
    if (!openSku || !onRevise) return null;
    return (sales.quotations || [])
      .filter((q) => (q.items || []).some((i) => i.sku_id === openSku))
      .sort((a, b) => (b.version || 1) - (a.version || 1))[0] || null;
  }, [sales.quotations, openSku, onRevise]);

  return (
    <div className="g2" style={{ alignItems: 'start' }}>
      <div className="card">
        <div className="ctitle">💬 Negotiations <span className="tag tgr">{groups.length}</span></div>
        <div className="pg-sub" style={{ marginTop: 0 }}>One thread per SKU. Opening a thread marks it read for your side.</div>
        <div className="tw sy" style={{ maxHeight: 420 }}>
          <table>
            <thead><tr><th style={{ minWidth: 150 }}>Customer</th><th>SKU</th><th style={{ width: 80, textAlign: 'center' }}>New</th></tr></thead>
            <tbody>
              {groups.length === 0 ? (
                <tr><td colSpan={3} style={{ textAlign: 'center', padding: 18, color: 'var(--i3)' }}>No negotiations yet.</td></tr>
              ) : groups.map((g) => (
                <tr
                  key={g.sku_id} style={{ cursor: 'pointer', background: openSku === g.sku_id ? 'var(--gl)' : undefined }}
                  onClick={() => setOpenSku(g.sku_id)}
                >
                  <td style={{ fontWeight: 600 }}>{leadName(g.lead_id)}</td>
                  <td style={{ fontSize: 11 }}>
                    {skuName(g.sku_id)}
                    <div style={{ color: 'var(--i3)', fontSize: 10 }}>{g.last ? g.last.text.slice(0, 48) : ''}</div>
                  </td>
                  <td style={{ textAlign: 'center' }}>
                    {g.unread ? <span className="tag tr" aria-label={`${g.unread} unread`}>{g.unread}</span> : <span style={{ color: 'var(--i3)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        {!openSku ? (
          <div className="pg-sub">Pick a thread to read it.</div>
        ) : (
          <>
            <div className="fbar">
              <div className="ctitle" style={{ margin: 0 }}>{skuName(openSku)}</div>
              <span style={{ flex: 1 }} />
              {onRevise && (latestQuote
                ? <button className="btn btn-s" style={{ color: '#5e35b1' }} aria-label="Revise to a new version" onClick={() => onRevise(latestQuote)}>↻ Revise → new version (v{(latestQuote.version || 1) + 1})</button>
                : <span style={{ fontSize: 11, color: 'var(--i3)' }}>No prior quotation for this SKU.</span>)}
            </div>
            {msg && <div className={'al al-' + msg.t}>{msg.text}</div>}
            <div style={{ maxHeight: 320, overflowY: 'auto', padding: 4 }} aria-label="Negotiation thread">
              {thread.map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: m.from === side ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                  <div style={{
                    maxWidth: '78%', padding: '7px 11px', borderRadius: 10, fontSize: 12,
                    background: m.from === side ? 'var(--g)' : 'var(--bg)',
                    color: m.from === side ? '#fff' : 'var(--ink)',
                  }}>
                    <div>{m.text}</div>
                    <div style={{ fontSize: 9, opacity: 0.75, marginTop: 3 }}>
                      {m.from === 'rep' ? 'Sales rep' : 'Quotation desk'} · {String(m.at || '').slice(0, 16).replace('T', ' ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="fbar" style={{ marginTop: 8 }}>
              <input
                placeholder="Type a message…" value={text} aria-label="Message"
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && text.trim()) send(groups.find((g) => g.sku_id === openSku)); }}
                style={{ flex: 1 }}
              />
              <button
                className="btn btn-g" disabled={busy || !text.trim()}
                onClick={() => send(groups.find((g) => g.sku_id === openSku))}
              >Send</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
