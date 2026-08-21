/**
 * LIVE proof that the 3-way merge prevents a stale-tab revert against the real
 * backend. Skips automatically when no backend is answering.
 *
 *   node node_modules/vitest/vitest.mjs run src/test/mergeLive.e2e.test.js
 *
 * It writes to module 1 and restores the exact original bytes afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { snapshotBase, mergeOabModule } from '../lib/merge.js';

const BASE = process.env.OAB_E2E_BASE || 'http://localhost:8080';
let live = false, token = '', original = null, originalVersion = 0;

const H = () => ({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' });
const load = async () => {
  const r = await fetch(`${BASE}/rest/v1/oab_data?id=eq.1&select=data`, { headers: H() });
  const rows = await r.json();
  return { blob: JSON.parse(rows[0].data), version: rows[0].version, raw: rows[0].data };
};
const post = async (data, version) => {
  const r = await fetch(`${BASE}/rest/v1/oab_data`, {
    method: 'POST', headers: H(), body: JSON.stringify({ id: 1, data, version }),
  });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : null };
};

beforeAll(async () => {
  try {
    const h = await fetch(BASE + '/api/health', { signal: AbortSignal.timeout(3000) });
    if (!h.ok) return;
    const lr = await fetch(BASE + '/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'superadmin', password: 'superadmin@123' }),
    });
    if (!lr.ok) return;
    token = (await lr.json()).token;
    const cur = await load();
    original = cur.raw; originalVersion = cur.version;
    live = true;
  } catch { live = false; }
}, 60000);

afterAll(async () => {
  if (!live || !original) return;
  const cur = await load();                 // restore the exact original bytes
  await post(original, cur.version);
}, 60000);

const t = (name, fn) => it(name, (ctx) => (live ? fn(ctx) : ctx.skip()), 60000);

describe('LIVE — 3-way merge stops a stale-tab revert', () => {
  t('a stale blob saved THROUGH the merge preserves the server state', async () => {
    const start = await load();
    const base = snapshotBase(start.blob);                       // this tab syncs

    // Another user moves the board on: advance a stage, add an invoice, bump counters.
    const theirs = JSON.parse(JSON.stringify(start.blob));
    const victim = theirs.OAB.SF.find((r) => Number(r.invDisp) > 0);
    const so = victim.so;
    victim.stage = 'THEIR-NEW-STAGE';
    victim.manDisp = Number(victim.manDisp || 0) + 500;
    theirs.INV_REG.push({ no: 'E2E-EXTRA-INV' });
    theirs.lastInvNo = Number(start.blob.lastInvNo) + 1;
    const wrote = await post(JSON.stringify(theirs), start.version);
    expect(wrote.ok).toBe(true);

    // Our stale tab still holds the ORIGINAL blob, plus one deliberate local edit.
    const mine = JSON.parse(JSON.stringify(start.blob));
    mine.OAB.SF.find((r) => r.so === so).jobName = 'E2E-MY-EDIT';

    // Save through the merge, exactly as data.jsx now does.
    const fresh = await load();
    const { merged, stats } = mergeOabModule(base, mine, fresh.blob);
    const saved = await post(JSON.stringify(merged), fresh.version);
    expect(saved.ok).toBe(true);

    const after = (await load()).blob;
    const row = after.OAB.SF.find((r) => r.so === so);

    // Their work survived...
    expect(row.stage).toBe('THEIR-NEW-STAGE');
    expect(Number(row.manDisp)).toBe(Number(victim.manDisp));
    expect(after.INV_REG.some((i) => i.no === 'E2E-EXTRA-INV')).toBe(true);
    expect(Number(after.lastInvNo)).toBe(Number(theirs.lastInvNo));
    // ...and so did ours.
    expect(row.jobName).toBe('E2E-MY-EDIT');
    expect(stats.tookTheirs).toBeGreaterThan(0);
  });

  t('the SAME stale blob saved WITHOUT the merge destroys their work', async () => {
    const start = await load();
    const theirs = JSON.parse(JSON.stringify(start.blob));
    const victim = theirs.OAB.SF.find((r) => Number(r.invDisp) > 0);
    const so = victim.so;
    victim.stage = 'WILL-BE-LOST';
    theirs.INV_REG.push({ no: 'E2E-WILL-BE-LOST' });
    const wrote = await post(JSON.stringify(theirs), start.version);
    expect(wrote.ok).toBe(true);

    // Blind whole-blob save from the stale tab — the old behaviour.
    const fresh = await load();
    const stale = JSON.parse(JSON.stringify(start.blob));
    const blind = await post(JSON.stringify(stale), fresh.version);
    expect(blind.ok).toBe(true);

    const after = (await load()).blob;
    expect(after.OAB.SF.find((r) => r.so === so).stage).not.toBe('WILL-BE-LOST');
    expect(after.INV_REG.some((i) => i.no === 'E2E-WILL-BE-LOST')).toBe(false);
  });
});
