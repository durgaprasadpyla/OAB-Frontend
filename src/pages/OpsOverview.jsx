import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { opsOverviewApi } from '../lib/opsOverviewApi.js';
import { today, inr } from '../lib/format.js';
import { canAccess } from '../lib/roles.js';
import { useAuth } from '../auth.jsx';
import { V2Page, V2Metrics, V2Panel, V2Badge } from '../components/V2Ui.jsx';
import '../v2-ops.css';

// BloomFlex V2 — Operations Overview. One page for the Super Admin, the Plant Manager
// and the PPC: the open order book, readiness, material shortages, today's machine
// load, today's output and dispatch, then the order → dispatch journey as links into
// the existing screens and the orders that need attention. Read-only.

const n0 = (v) => (v == null ? 0 : Math.round(Number(v)));
const hm = (mins) => {
  const m = n0(mins);
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};

/** The journey, in the order a sale order travels it. Only steps the role may open are links. */
const JOURNEY = [
  { to: '/oab?sheet=SF', label: 'OAB / POs', icon: '🧾', sub: 'Capture demand' },
  { to: '/qc', label: 'QC Route & BOM', icon: '▤', sub: 'Stage requirements' },
  { to: '/plan', label: 'Ready to Plan', icon: '▣', sub: 'Material readiness' },
  { to: '/ppc', label: 'PPC planner', icon: '⚙', sub: 'Machine shift plan' },
  { to: '/board', label: 'Today’s board', icon: '▥', sub: 'Run the day' },
  { to: '/mis', label: 'MIS status', icon: '🏭', sub: 'Stage progress' },
  { to: '/fg', label: 'FG ledger', icon: '📦', sub: 'Finished goods' },
  { to: '/invoice', label: 'Dispatch / Invoices', icon: '🚚', sub: 'Close the order' },
];

/**
 * The metric tiles. A tile whose value is null is hidden — those come from features
 * another release may not have installed yet (stock counts, BOM approval, draft plans).
 */
export function overviewTiles(o) {
  if (!o) return [];
  const p = o.productionToday || {};
  const capPct = Number(o.capacityMinutes) > 0 ? Math.round((Number(o.plannedMinutes) * 100) / Number(o.capacityMinutes)) : null;
  return [
    { k: 'open', label: 'Open sale orders', value: o.openSos },
    { k: 'ready', label: 'Ready to plan', value: o.readyToPlan, tone: 'grn' },
    { k: 'notReady', label: 'Not ready', value: o.notReady, tone: o.notReady > 0 ? 'red' : undefined },
    { k: 'short', label: 'SOs short of material', value: o.shortageSos, tone: o.shortageSos > 0 ? 'red' : undefined },
    { k: 'bom', label: 'BOM pending', value: o.bomPending, tone: o.bomPending > 0 ? 'red' : undefined },
    { k: 'draft', label: 'Draft plan jobs', value: o.draftPlanJobs },
    { k: 'load', label: 'Machine load today', value: o.capacityMinutes == null ? null : hm(o.plannedMinutes),
      sub: o.capacityMinutes == null ? undefined : `of ${hm(o.capacityMinutes)}` + (capPct == null ? '' : ` · ${capPct}% of capacity`), tone: capPct != null && capPct > 100 ? 'red' : undefined },
    { k: 'jobs', label: 'Jobs today', value: o.jobsToday },
    { k: 'late', label: 'Delayed starts today', value: o.delayedStartsToday, tone: o.delayedStartsToday > 0 ? 'red' : undefined },
    { k: 'good', label: 'Good output today', value: p.good == null ? null : inr(n0(p.good)),
      sub: p.good == null ? undefined : `wastage ${inr(n0(p.wastage))} · rejected ${inr(n0(p.reject))}` },
    { k: 'disp', label: 'Invoices today', value: o.dispatchedToday },
    { k: 'counts', label: 'Stock counts pending', value: o.pendingStockCounts },
  ].filter((t) => t.value !== null && t.value !== undefined);
}

/** Tile tone (OAB's grn/red) → the V2 tile colour. */
const TONE = { grn: 'good', red: 'danger' };

/** Long date for panel titles, e.g. "Thu, 19 Nov". Falls back to the raw string. */
function dayLabel(iso) {
  const d = iso ? new Date(iso + 'T00:00:00') : null;
  if (!d || Number.isNaN(d.getTime())) return iso || 'today';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function OpsOverview() {
  const { role } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr('');
    try { setData(await opsOverviewApi.get(today())); }
    catch (e) { setErr(e.message || 'Could not load the overview'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const tiles = overviewTiles(data);
  const machines = (data && data.machines) || [];
  const attention = (data && data.attention) || [];
  const canPlanner = canAccess(role, '/ppc');
  const canBoard = canAccess(role, '/board');
  // Where an attention row's action button goes: the readiness desk when this login
  // may open it, otherwise the planner.
  const fix = canAccess(role, '/plan') ? { to: '/plan', label: 'Review readiness' }
    : canPlanner ? { to: '/ppc', label: 'Open planner' } : null;

  return (
    <div id="app">
      <V2Page
        crumb="BloomFlex / Operations overview"
        title="Manufacturing Operations Overview"
        subtitle={`A single operating picture from sale order to finished goods and dispatch${data && data.date ? ` — ${data.date}` : ''}.`}
        actions={<>
          <button className="btn btn-s" onClick={load} disabled={loading}>{loading ? 'Refreshing…' : '↻ Refresh'}</button>
          {canPlanner && <Link className="btn btn-g v2o-link" to="/ppc">Open production planner →</Link>}
        </>}
      >
        {err && <div className="al al-r" style={{ marginBottom: 14 }}>{err}</div>}

        <div className="v2-hero">
          <div>
            <h1>Production, materials, and machines — connected.</h1>
            <p>Review material readiness, plan the machines shift by shift, and track actual execution through to dispatch.</p>
          </div>
          {canBoard && <Link className="btn btn-s v2o-link" to="/board">View today’s machine board →</Link>}
        </div>

        {tiles.length > 0 && (
          <V2Metrics data-testid="overview-tiles" items={tiles.map((t) => ({
            key: t.k, testId: 'tile-' + t.k, label: t.label, value: t.value, detail: t.sub, tone: TONE[t.tone],
          }))} />
        )}

        <V2Panel title="Order-to-dispatch manufacturing workflow" right={<V2Badge tone="blue">Connected stages</V2Badge>}>
          <div className="v2o-flow">
            {JOURNEY.map((s, i) => {
              const inner = (<>
                <span className="ic" aria-hidden="true">{s.icon}</span>
                <b>{i + 1}. {s.label}</b>
                <span className="s">{s.sub}</span>
              </>);
              return canAccess(role, s.to)
                ? <Link key={s.to} className="v2o-step" to={s.to}>{inner}</Link>
                : <div key={s.to} className="v2o-step off" title="Not available to this login">{inner}</div>;
            })}
          </div>
        </V2Panel>

        <div className="v2-grid2">
          <V2Panel title="Operations requiring attention"
            sub={data && data.attentionTotal > attention.length ? `Top ${attention.length} of ${data.attentionTotal}` : undefined}>
            {attention.length === 0 ? <div className="al al-g">Every open order is ready to plan with no material shortage.</div> : (
              <div>{attention.map((a) => (
                <div key={a.so} className="v2o-row">
                  <span className="ic" aria-hidden="true">▤</span>
                  <div className="tx">
                    <b>SO <span className="so-pill">{a.so}</span>{a.customer ? ` · ${a.customer}` : ''}</b>
                    <div className="s">
                      {a.jobName || '—'} · PO {a.poDate || '—'} · Due {a.dueDate || '—'}
                    </div>
                    <div className="tags">
                      {!a.readyToPlan && <span className="tag ty">{a.notReadyReason ? `Not ready · ${a.notReadyReason}` : 'Not marked ready'}</span>}
                      {a.shortages > 0 && <span className="tag tr">{a.shortages} shortage{a.shortages > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                  {fix && <Link className="btn btn-s" to={fix.to}>{fix.label}</Link>}
                </div>
              ))}</div>
            )}
          </V2Panel>

          <V2Panel title={`Machine capacity — ${dayLabel(data && data.date)}`}
            right={canBoard ? <Link className="btn btn-s v2o-link" to="/board">View board</Link> : undefined}>
            {machines.length === 0 ? <div className="al al-g">No active machines.</div> : (
              <div className="v2o-cap">
                {machines.map((m) => {
                  const cap = Number(m.capMinutes) || 0, used = Number(m.plannedMinutes) || 0;
                  const pct = cap > 0 ? Math.round((used * 100) / cap) : 0;
                  const over = used > cap;
                  return (
                    <div key={m.machineId} className="v2o-cap-row">
                      <div className="nm" title={m.departmentName || ''}>
                        <b>{m.name}</b>{m.departmentName ? <span> · {m.departmentName}</span> : null}
                      </div>
                      <div className="v2-progress">
                        <span role="progressbar" aria-label={`${m.name} load`} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                          className={over ? 'over' : undefined} style={{ width: `${Math.min(pct, 100)}%` }} />
                      </div>
                      <div className={'v' + (over ? ' over' : '')}>
                        {hm(used)} / {hm(cap)} · {m.jobs} job{m.jobs === 1 ? '' : 's'}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </V2Panel>
        </div>
      </V2Page>
    </div>
  );
}
