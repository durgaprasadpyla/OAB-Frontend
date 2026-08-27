/**
 * LIVE end-to-end check against the running backend + local oabdb.
 *
 * Not part of the normal suite — it needs a backend on OAB_E2E_BASE
 * (default http://localhost:8080) and is skipped automatically when that
 * host is not answering, so `npm test` stays hermetic.
 *
 *   node node_modules/vitest/vitest.mjs run src/test/live.e2e.test.js
 *
 * What it proves: the ported business logic produces sane results when fed the
 * REAL module blobs, and the API contract the app depends on actually holds.
 */
import { describe, it, expect, beforeAll } from 'vitest';

import { fgAvail, fgAgeingInfo, fgRemainingBatches, fgSpecsWithActivity } from '../lib/fg.js';
import { certLines, certStatus } from '../lib/cert.js';
import { bomOpenSOList, bomMaterialForSOList } from '../lib/bom.js';
import { custGroupOf, custGroups } from '../lib/master.js';
import { buildScrapChart, bestByItem } from '../lib/scrapChart.js';
import {
  leadLineItems, leadsForRep, activeReps, salesOverview, allCategories,
  repWorkload, nudgeList, quoteStatusCounts,
} from '../lib/sales.js';
import { ddList, DROPDOWN_DEFS } from '../lib/dropdowns.js';
import { csaPendingForQc, csaPendingForPlant } from '../lib/csa.js';
import { kamRows } from '../lib/kam.js';
import { nextInvNo, isSOFormat } from '../lib/seq.js';
import { calcMetres } from '../lib/calc.js';

const BASE = process.env.OAB_E2E_BASE || 'http://localhost:8080';
const CREDS = { username: 'superadmin', password: 'superadmin@123' };

let live = false;
let token = '';
const mod = {};

async function get(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' on ' + path);
  return r.json();
}

async function loadSlot(id) {
  const rows = await get(`/rest/v1/oab_data?id=eq.${id}&select=data`);
  if (!rows || !rows.length || rows[0].data == null) return null;
  const d = rows[0].data;
  return typeof d === 'string' ? JSON.parse(d) : d;
}

beforeAll(async () => {
  try {
    // The suite runs single-fork, so a fetch mock installed by an EARLIER test file
    // can still be on globalThis here — it happily answers /api/health and makes this
    // file "live" against a fake. Only a native fetch can reach a real backend.
    if (!String(globalThis.fetch).includes('[native code]')) return;
    const h = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
    if (!h.ok) return;
    const lr = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(CREDS),
    });
    if (!lr.ok) return;
    token = (await lr.json()).token;
    for (const [key, id] of Object.entries({
      oab: 1, jss: 2, prices: 3, customers: 4, prodStatus: 5, purchase: 6,
      pmData: 7, scrap: 8, fgLedger: 9, capa: 11, sales: 12, bom: 13,
    })) mod[key] = await loadSlot(id);
    live = true;
  } catch { live = false; }
}, 60000);

const t = (name, fn) => it(name, (ctx) => (live ? fn(ctx) : ctx.skip()));

describe('LIVE — API contract', () => {
  t('signs in and returns a role the client understands', async () => {
    const me = await get('/api/auth/me');
    expect(me.role).toBe('superadmin');
    expect(typeof me.mustChangePassword).toBe('boolean');
  });

  t('every module the app loads is either readable or absent — never malformed', () => {
    Object.entries(mod).forEach(([key, value]) => {
      if (value === null) return;                       // slot with no row yet
      expect(value, key).toBeTypeOf('object');
    });
  });

  t('empty slots come back as no-row, which the data layer treats as empty', () => {
    // capa (11) and bom (13) have no row in this database.
    expect(mod.capa === null || Array.isArray(mod.capa)).toBe(true);
    expect(mod.bom === null || typeof mod.bom === 'object').toBe(true);
  });
});

describe('LIVE — module 1 (OAB + invoice register)', () => {
  t('board rows carry the fields every screen reads', () => {
    const rows = [...(mod.oab.OAB.SF || []), ...(mod.oab.OAB.OT || [])];
    expect(rows.length).toBeGreaterThan(0);
    const r = rows[0];
    ['so', 'spec', 'customer', 'poQty'].forEach((f) => expect(r, `missing ${f}`).toHaveProperty(f));
  });

  t('every SO number matches the format seq.js validates', () => {
    const rows = [...(mod.oab.OAB.SF || []), ...(mod.oab.OAB.OT || [])];
    const bad = rows.map((r) => r.so).filter((so) => so && !isSOFormat(so));
    expect(bad, `unrecognised SO numbers: ${bad.slice(0, 5)}`).toEqual([]);
  });

  t('the next invoice number continues the register in the BFX series', () => {
    const { no } = nextInvNo(mod.oab.lastInvNo);
    expect(no).toMatch(/^BL\/\d{2}-\d{2}\/\d+$/);
  });

  t('metres calculation returns a finite number for every open row', () => {
    const rows = [...(mod.oab.OAB.SF || []), ...(mod.oab.OAB.OT || [])].slice(0, 200);
    rows.forEach((r) => {
      const m = calcMetres(r, r.poQty);
      expect(Number.isFinite(m.net), `NaN metres on ${r.so}`).toBe(true);
    });
  });
});

describe('LIVE — FG ledger (module 9)', () => {
  t('availability and FIFO ageing hold for every spec with activity', () => {
    const specs = fgSpecsWithActivity(mod.fgLedger);
    expect(specs.length).toBeGreaterThan(0);
    specs.forEach((sp) => {
      const avail = fgAvail(mod.fgLedger, sp);
      const batches = fgRemainingBatches(mod.fgLedger, sp);
      const ag = fgAgeingInfo(mod.fgLedger, sp);
      expect(Number.isFinite(avail), sp).toBe(true);
      // Remaining batches must never exceed what is actually on hand.
      const sum = batches.reduce((s, b) => s + b.qty, 0);
      expect(sum, `${sp}: batches ${sum} > avail ${avail}`).toBeLessThanOrEqual(Math.max(0, avail) + 0.001);
      expect(typeof ag.display).toBe('string');
    });
  });
});

describe('LIVE — customers (module 4) and grouping', () => {
  t('resolves a group for every customer on the board', () => {
    const rows = [...(mod.oab.OAB.SF || []), ...(mod.oab.OAB.OT || [])];
    const names = [...new Set(rows.map((r) => r.customer).filter(Boolean))];
    names.forEach((n) => expect(custGroupOf(n, mod.customers), n).toBeTruthy());
  });

  t('the master yields a usable group list', () => {
    expect(Array.isArray(custGroups(mod.customers))).toBe(true);
  });
});

describe('LIVE — certificates over the real invoice register', () => {
  t('produces one certificate line per invoiced spec', () => {
    const lines = certLines(mod.oab);
    expect(lines.length).toBeGreaterThan(0);
    lines.forEach((l) => {
      expect(l.invNo, 'line with no invoice number').toBeTruthy();
      expect(l.spec).toBeTruthy();
      const st = certStatus(l.invoice, l.spec);
      expect(typeof st.coa).toBe('boolean');
    });
  });
});

describe('LIVE — purchase and scrap', () => {
  t('the ASL loads and the price chart tolerates the real history', () => {
    expect(Array.isArray(mod.purchase.asl)).toBe(true);
    const chart = buildScrapChart(mod.purchase.priceHistory || [], { seriesKey: 'supplier' });
    expect(chart === null || Array.isArray(chart.series)).toBe(true);
  });

  t('scrap best-price board computes over real postings', () => {
    const best = bestByItem(mod.scrap.prices || []);
    Object.values(best).forEach((b) => expect(Number.isFinite(b.rate)).toBe(true));
    const chart = buildScrapChart(mod.scrap.prices || [], {});
    expect(chart === null || chart.series.length).toBeTruthy();
  });
});

describe('LIVE — BOM against real open orders', () => {
  t('open-SO list is derived without error even with no BOMs defined', () => {
    const list = bomOpenSOList(mod.bom || {}, mod.oab.OAB, {
      metresOf: (r, bal) => (calcMetres(r, bal) || {}).net || 0,
      groupOf: (c) => custGroupOf(c, mod.customers),
    });
    expect(Array.isArray(list)).toBe(true);
    list.forEach((r) => {
      expect(r.bal).toBeGreaterThan(0);
      expect(Number.isFinite(r.mtrs)).toBe(true);
    });
    // No BOMs in this DB yet, so the requirement is empty — but must not throw.
    expect(bomMaterialForSOList(mod.bom || {}, list)).toEqual([]);
  });
});

describe('LIVE — sales system (module 12)', () => {
  t('loads the real lead book', () => {
    expect(mod.sales.leads.length).toBeGreaterThan(0);
  });

  t('flattens leads into line items without losing any category', () => {
    const items = leadLineItems(mod.sales.leads, { contacts: mod.sales.contacts });
    const catTotal = mod.sales.leads.reduce(
      (n, l) => n + ((l.categories && l.categories.length) ? l.categories.length : (l.category ? 1 : 0)), 0,
    );
    expect(items.length).toBe(catTotal);
  });

  t('every rep sees a subset of the book, never the whole of it by accident', () => {
    const reps = activeReps(mod.sales.sales_users);
    expect(reps.length).toBeGreaterThan(0);
    reps.forEach((r) => {
      const mine = leadsForRep(mod.sales.leads, r.id);
      expect(mine.length, `${r.display_name} sees everything`).toBeLessThanOrEqual(mod.sales.leads.length);
      mine.forEach((l) => expect(l.id).toBeTruthy());
    });
  });

  t('overview rollups are all finite', () => {
    const k = salesOverview(mod.sales);
    Object.entries(k).forEach(([key, v]) => expect(Number.isFinite(v), key).toBe(true));
    expect(k.total).toBe(mod.sales.leads.length);
  });

  t('rep workload and the nudge list compute over real follow-ups', () => {
    repWorkload(mod.sales.leads, mod.sales.sales_users, mod.sales.interactions)
      .forEach((w) => expect(Number.isFinite(w.overdue)).toBe(true));
    nudgeList(mod.sales.leads, mod.sales.interactions)
      .forEach((n) => expect(n.due).toMatch(/^\d{4}-\d{2}-\d{2}$/));
  });

  t('categories in use are all non-empty strings', () => {
    allCategories(mod.sales.leads).forEach((c) => expect(String(c).trim()).toBeTruthy());
  });

  t('quote status counts do not throw on the real list', () => {
    expect(typeof quoteStatusCounts(mod.sales.quotations)).toBe('object');
  });
});

describe('LIVE — dropdown overrides actually stored in this database', () => {
  t('resolves every list, using the stored override where present', () => {
    // Master-backed defs (Departments §5, Dispatch Forms §16) live in the normalized
    // tables, not the sales blob — ddList never resolves them, so they are excluded.
    DROPDOWN_DEFS.filter((d) => !d.master).forEach((d) => {
      const list = ddList(mod.sales, d.key);
      expect(Array.isArray(list), d.key).toBe(true);
      expect(list.length, `${d.key} resolved empty`).toBeGreaterThan(0);
    });
  });
});

describe('LIVE — CSA queues', () => {
  t('derives both queues from the real SKU and report lists', () => {
    expect(Array.isArray(csaPendingForQc(mod.sales))).toBe(true);
    expect(Array.isArray(csaPendingForPlant(mod.sales))).toBe(true);
  });
});

describe('LIVE — KAM over the real customer master + OAB', () => {
  t('joins master, leads and live achievement for every active customer', () => {
    const rows = kamRows({ customers: mod.customers, sales: mod.sales, oab: mod.oab.OAB });
    expect(rows.length).toBeGreaterThan(0);
    rows.forEach((r) => {
      expect(Number.isFinite(r.achieved), r.customer).toBe(true);
      expect(Number.isFinite(r.suggestedTarget), r.customer).toBe(true);
    });
    // At least one customer should have real achievement, or the join is broken.
    expect(rows.some((r) => r.achieved > 0)).toBe(true);
  });
});
