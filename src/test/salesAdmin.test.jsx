import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import SalesAdmin from '../pages/SalesAdmin.jsx';
import {
  leadLineItems, allCategories, assignLine, bulkAssignLines, filterLineItems, UNASSIGNED,
  addRep, updateRep, salesOverview, monthKey,
  REP_ACCOUNT_STATUSES,
} from '../lib/sales.js';
import {
  upsertTarget, deleteTarget, repTargets, targetAchieved, periodMatch, currentPeriod,
} from '../lib/salesTargets.js';

const LEADS = [
  {
    id: 'L1', client_name: 'Acme Dairy', group: 'Acme Group', stage: 'Hot',
    categories: ['Dairy', 'Ice Creams'], category_assignments: { Dairy: 'R1' }, assigned_to: '',
  },
  { id: 'L2', client_name: 'Beta Snacks', stage: 'Warm', categories: ['Namkeen'], category_assignments: {} },
];
const USERS = [
  { id: 'R1', username: 'rep1', display_name: 'Rep One', password: 'p', status: 'Active' },
  { id: 'R2', username: 'rep2', display_name: 'Rep Two', password: 'p', status: 'Active' },
  { id: 'R3', username: 'rep3', display_name: 'Rep Three', password: 'p', status: 'Inactive' },
];

describe('leadLineItems', () => {
  it('produces one row per customer × category', () => {
    const items = leadLineItems(LEADS);
    expect(items.map((i) => `${i.client_name}/${i.category}`)).toEqual([
      'Acme Dairy/Dairy', 'Acme Dairy/Ice Creams', 'Beta Snacks/Namkeen',
    ]);
  });

  it('carries the per-category owner, blank where unassigned', () => {
    const items = leadLineItems(LEADS);
    expect(items[0].repId).toBe('R1');
    expect(items[1].repId).toBe('');      // Ice Creams has no owner
    expect(items[2].repId).toBe('');
  });

  it('counts contacts relevant to the line', () => {
    const items = leadLineItems(LEADS, {
      contacts: [{ lead_id: 'L1', category: 'Dairy' }, { lead_id: 'L1' }, { lead_id: 'L2', category: 'Namkeen' }],
    });
    expect(items[0].contacts).toBe(2);    // the Dairy one plus the category-less one
    expect(items[1].contacts).toBe(1);    // only the category-less one
  });

  it('lists the categories actually in use', () => {
    expect(allCategories(LEADS)).toEqual(['Dairy', 'Ice Creams', 'Namkeen']);
  });
});

describe('assignLine', () => {
  it('sets the owner for ONE category, leaving the others alone', () => {
    const out = assignLine(LEADS, 'L1', 'Ice Creams', 'R2');
    expect(out[0].category_assignments).toEqual({ Dairy: 'R1', 'Ice Creams': 'R2' });
  });

  it('unassigns by removing the key rather than storing a blank', () => {
    const out = assignLine(LEADS, 'L1', 'Dairy', '');
    expect(out[0].category_assignments).toEqual({});
    expect('Dairy' in out[0].category_assignments).toBe(false);
  });

  it('does not touch other leads or mutate the input', () => {
    const before = JSON.parse(JSON.stringify(LEADS));
    const out = assignLine(LEADS, 'L1', 'Dairy', 'R2');
    expect(out[1]).toBe(LEADS[1]);
    expect(LEADS).toEqual(before);
  });
});

describe('bulkAssignLines', () => {
  it('assigns every ticked line in one pass', () => {
    const out = bulkAssignLines(LEADS, ['L1|~|Ice Creams', 'L2|~|Namkeen'], 'R2');
    expect(out[0].category_assignments).toEqual({ Dairy: 'R1', 'Ice Creams': 'R2' });
    expect(out[1].category_assignments).toEqual({ Namkeen: 'R2' });
  });

  it('bulk-unassigns with a blank rep', () => {
    const out = bulkAssignLines(LEADS, ['L1|~|Dairy'], '');
    expect(out[0].category_assignments).toEqual({});
  });

  it('handles a category containing spaces, and ignores a malformed key', () => {
    expect(bulkAssignLines(LEADS, ['L1|~|Ice Creams'], 'R2')[0].category_assignments['Ice Creams']).toBe('R2');
    expect(bulkAssignLines(LEADS, ['rubbish'], 'R2')).toEqual(LEADS);
  });
});

describe('filterLineItems', () => {
  const items = leadLineItems(LEADS);
  it('matches on customer name', () => {
    expect(filterLineItems(items, { q: 'acme' })).toHaveLength(2);
  });
  it('filters by category and by rep', () => {
    expect(filterLineItems(items, { category: 'Dairy' })).toHaveLength(1);
    expect(filterLineItems(items, { repId: 'R1' })).toHaveLength(1);
  });
  it('shows only the unallocated queue when asked', () => {
    const un = filterLineItems(items, { repId: UNASSIGNED });
    expect(un.map((i) => i.category)).toEqual(['Ice Creams', 'Namkeen']);
  });
  it('returns everything with no filters', () => {
    expect(filterLineItems(items, {})).toHaveLength(3);
  });
});

describe('addRep', () => {
  it('adds an active rep with the given details', () => {
    const out = addRep(USERS, { name: 'Rep Four', username: 'rep4', password: 'pw' }, { uid: () => 'R4' });
    expect(out).toHaveLength(4);
    expect(out[3]).toMatchObject({ id: 'R4', display_name: 'Rep Four', username: 'rep4', status: 'Active' });
  });

  it('refuses a duplicate username, case-insensitively', () => {
    // The rep-login endpoint matches on username; a duplicate makes one account unreachable.
    expect(() => addRep(USERS, { name: 'X', username: 'REP1', password: 'p' })).toThrow(/already taken/);
  });

  it('requires name, username and password', () => {
    expect(() => addRep(USERS, { username: 'u', password: 'p' })).toThrow(/Full name/);
    expect(() => addRep(USERS, { name: 'n', password: 'p' })).toThrow(/Username/);
    expect(() => addRep(USERS, { name: 'n', username: 'u' })).toThrow(/Password/);
  });

  it('falls back to Active for an unknown status', () => {
    expect(addRep(USERS, { name: 'n', username: 'u9', password: 'p', status: 'Nonsense' }, { uid: () => 'X' })[3].status).toBe('Active');
    expect(REP_ACCOUNT_STATUSES).toContain('Left');
  });

  it('does not mutate the input list', () => {
    addRep(USERS, { name: 'n', username: 'u8', password: 'p' }, { uid: () => 'X' });
    expect(USERS).toHaveLength(3);
  });
});

describe('updateRep', () => {
  it('patches one rep only', () => {
    const out = updateRep(USERS, 'R2', { status: 'Left' });
    expect(out[1].status).toBe('Left');
    expect(out[0].status).toBe('Active');
  });
});

describe('salesOverview', () => {
  const sales = {
    leads: LEADS,
    pos: [{ lead_id: 'L1', created_by: 'R1', date: '2026-08-05', value: 5000 }],
    interactions: [{ date: '2026-08-20', created_by: 'R1' }, { date: '2026-01-01' }],
  };

  it('counts customers by stage', () => {
    const k = salesOverview(sales, '2026-08-20');
    expect(k).toMatchObject({ total: 2, hot: 1, warm: 1, cold: 0 });
  });

  it('defines Converted as customers with at least one PO, not the stage label', () => {
    // L1's stage is Hot, but it has a PO -> converted. A lead merely *labelled*
    // Converted with no PO would not count.
    const k = salesOverview(sales, '2026-08-20');
    expect(k.converted).toBe(1);
    const labelled = salesOverview({ leads: [{ id: 'X', stage: 'Converted' }], pos: [], interactions: [] });
    expect(labelled.converted).toBe(0);
  });

  it('counts today\'s activity only', () => {
    expect(salesOverview(sales, '2026-08-20').todaysActivities).toBe(1);
  });

  it('counts unallocated line items', () => {
    expect(salesOverview(sales, '2026-08-20').unallocated).toBe(2);
  });

  it('survives an empty blob', () => {
    expect(salesOverview({})).toMatchObject({ total: 0, converted: 0, unallocated: 0 });
  });
});

describe('targets — dimensioned by category and dispatch form', () => {
  const base = { repId: 'R1', ptype: 'month', pkey: '2026-08' };
  const uid = (p) => p + '_fixed';

  it('sets a target per dimension key rather than one flat monthly figure', () => {
    let t = upsertTarget([], { ...base, dim: 'category', key: 'Dairy', amount: 50000 }, { uid });
    t = upsertTarget(t, { ...base, dim: 'despatch', key: 'Pouch', amount: 30000 }, { uid });
    expect(repTargets(t, 'R1', 'month', '2026-08')).toHaveLength(2);
    expect(repTargets(t, 'R1', 'month', '2026-09')).toHaveLength(0);
    expect(repTargets(t, 'R2', 'month', '2026-08')).toHaveLength(0);
  });

  it('overwrites the amount for the same rep/period/dimension/key', () => {
    let t = upsertTarget([], { ...base, dim: 'category', key: 'Dairy', amount: 100 }, { uid });
    t = upsertTarget(t, { ...base, dim: 'category', key: 'Dairy', amount: 200 }, { uid });
    expect(t).toHaveLength(1);
    expect(t[0].amount).toBe(200);
    // …but the same key under the OTHER dimension is a separate target.
    t = upsertTarget(t, { ...base, dim: 'despatch', key: 'Dairy', amount: 5 }, { uid });
    expect(t).toHaveLength(2);
  });

  it('removes a target by id', () => {
    const t = upsertTarget([], { ...base, dim: 'category', key: 'Dairy', amount: 100 }, { uid });
    expect(deleteTarget(t, t[0].id)).toEqual([]);
  });

  it('counts one PO toward BOTH its category and its dispatch-form target', () => {
    const skus = [{ id: 'S1', category: 'Dairy', dispatch_form: 'Pouch' }];
    const pos = [{ created_by: 'R1', sku_id: 'S1', date: '2026-08-05', qty: 100, price: 12 }];
    expect(targetAchieved(pos, skus, 'R1', 'month', '2026-08', 'category', 'Dairy')).toBe(1200);
    expect(targetAchieved(pos, skus, 'R1', 'month', '2026-08', 'despatch', 'Pouch')).toBe(1200);
    // A different key, rep, period or an unknown SKU contributes nothing.
    expect(targetAchieved(pos, skus, 'R1', 'month', '2026-08', 'category', 'Spices')).toBe(0);
    expect(targetAchieved(pos, skus, 'R2', 'month', '2026-08', 'category', 'Dairy')).toBe(0);
    expect(targetAchieved(pos, skus, 'R1', 'month', '2026-07', 'category', 'Dairy')).toBe(0);
    expect(targetAchieved(pos, [], 'R1', 'month', '2026-08', 'category', 'Dairy')).toBe(0);
  });

  it('matches a date against every period type', () => {
    expect(periodMatch('2026-08-05', 'month', '2026-08')).toBe(true);
    expect(periodMatch('2026-08-05', 'quarter', '2026-Q3')).toBe(true);
    expect(periodMatch('2026-08-05', 'half', '2026-H2')).toBe(true);
    expect(periodMatch('2026-05-05', 'half', '2026-H1')).toBe(true);
    expect(periodMatch('2026-08-05', 'annual', '2026')).toBe(true);
    expect(periodMatch('2026-08-05', 'quarter', '2026-Q2')).toBe(false);
    expect(periodMatch('', 'month', '2026-08')).toBe(false);
  });

  it('names the period covering a date', () => {
    const d = new Date('2026-08-20T00:00:00');
    expect(currentPeriod('month', d)).toBe('2026-08');
    expect(currentPeriod('quarter', d)).toBe('2026-Q3');
    expect(currentPeriod('half', d)).toBe('2026-H2');
    expect(currentPeriod('annual', d)).toBe('2026');
  });

  it('formats the current month key', () => {
    expect(monthKey(new Date('2026-08-20T00:00:00'))).toBe('2026-08');
  });
});

/* ─────────────────────────── screen ─────────────────────────── */

const salesModule = () => ({
  leads: JSON.parse(JSON.stringify(LEADS)),
  sales_users: JSON.parse(JSON.stringify(USERS)),
  contacts: [{ id: 'c1', lead_id: 'L1', name: 'Mr Acme' }],
  interactions: [], quotations: [], skus: [], qc_reports: [],
  pos: [{ lead_id: 'L1', created_by: 'R1', date: '2026-08-05', value: 5000 }],
  targets: [], substrate_options: [], nego_msgs: [], dropdowns: {},
});

const open = async () => {
  const r = renderApp(<SalesAdmin />, { modules: { sales: salesModule() }, role: 'sadmin' });
  await waitFor(() => expect(screen.getByText(/S Dashboard/)).toBeInTheDocument());
  return r;
};
const goTab = async (label) => {
  const hit = [...document.querySelectorAll('.step-tab')].find((el) => new RegExp(label).test(el.textContent));
  await userEvent.click(hit);
};

describe('Sales Admin — overview', () => {
  it('shows the pipeline and flags unallocated lines', async () => {
    await open();
    await waitFor(() => expect(screen.getByText('Unallocated lines')).toBeInTheDocument());
    expect(screen.getByText('POs received')).toBeInTheDocument();
    const card = screen.getByText('Unallocated lines').closest('.kpi');
    expect(within(card).getByText('2')).toBeInTheDocument();
  });

  it('summarises each active rep and omits inactive ones', async () => {
    await open();
    await goTab('Overview');
    const card = screen.getByText('Rep summary').closest('.card');
    expect(within(card).getByText('Rep One')).toBeInTheDocument();
    expect(within(card).queryByText('Rep Three')).not.toBeInTheDocument();
  });
});

describe('Sales Admin — category allocation', () => {
  it('lists one row per customer × category', async () => {
    await open();
    await goTab('Category Allocation');
    await waitFor(() => expect(screen.getByLabelText('Assign Acme Dairy Dairy')).toBeInTheDocument());
    expect(screen.getByLabelText('Assign Acme Dairy Ice Creams')).toBeInTheDocument();
    expect(screen.getByLabelText('Assign Beta Snacks Namkeen')).toBeInTheDocument();
  });

  it('assigns one line without disturbing the customer\'s other category', async () => {
    const { saved } = await open();
    await goTab('Category Allocation');
    await userEvent.selectOptions(screen.getByLabelText('Assign Acme Dairy Ice Creams'), 'R2');

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.leads[0].category_assignments).toEqual({ Dairy: 'R1', 'Ice Creams': 'R2' });
  });

  it('filters down to the unallocated queue', async () => {
    await open();
    await goTab('Category Allocation');
    await userEvent.selectOptions(screen.getByLabelText('Filter by rep'), UNASSIGNED);
    expect(screen.queryByLabelText('Assign Acme Dairy Dairy')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Assign Acme Dairy Ice Creams')).toBeInTheDocument();
  });

  it('bulk-assigns the ticked lines', async () => {
    const { saved } = await open();
    await goTab('Category Allocation');
    await userEvent.click(screen.getByLabelText('Tick Acme Dairy Ice Creams'));
    await userEvent.click(screen.getByLabelText('Tick Beta Snacks Namkeen'));
    await userEvent.selectOptions(screen.getByLabelText('Bulk assign to'), 'R2');
    await userEvent.click(screen.getByText('Assign selected'));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.leads[0].category_assignments).toEqual({ Dairy: 'R1', 'Ice Creams': 'R2' });
    expect(blob.leads[1].category_assignments).toEqual({ Namkeen: 'R2' });
  });

  it('refuses a bulk assign with nothing ticked', async () => {
    const { saved } = await open();
    await goTab('Category Allocation');
    await userEvent.click(screen.getByText('Assign selected'));
    expect(screen.getByText(/Tick at least one/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('offers only active reps in the assign dropdown', async () => {
    await open();
    await goTab('Category Allocation');
    const opts = [...screen.getByLabelText('Assign Beta Snacks Namkeen').options].map((o) => o.textContent);
    expect(opts).toContain('Rep One');
    expect(opts).not.toContain('Rep Three');
  });
});

describe('Sales Admin — rep accounts', () => {
  it('lists reps with how many line items each owns', async () => {
    await open();
    await goTab('Users & Access');
    await waitFor(() => expect(screen.getByText('rep1')).toBeInTheDocument());
    const row = screen.getByText('Rep One').closest('tr');
    expect(within(row).getByText('1')).toBeInTheDocument();   // owns Acme/Dairy
  });

  it('adds a rep', async () => {
    const { saved } = await open();
    await goTab('Users & Access');
    await userEvent.type(screen.getByLabelText('Rep full name'), 'Rep Four');
    await userEvent.type(screen.getByLabelText('Rep username'), 'rep4');
    await userEvent.type(screen.getByLabelText('Rep password'), 'secret');
    await userEvent.click(screen.getByText('Add sales user'));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.sales_users).toHaveLength(4);
    expect(blob.sales_users[3]).toMatchObject({ display_name: 'Rep Four', username: 'rep4' });
  });

  it('blocks a duplicate username and does not write', async () => {
    const { saved } = await open();
    await goTab('Users & Access');
    await userEvent.type(screen.getByLabelText('Rep full name'), 'Clash');
    await userEvent.type(screen.getByLabelText('Rep username'), 'rep1');
    await userEvent.type(screen.getByLabelText('Rep password'), 'x');
    await userEvent.click(screen.getByText('Add sales user'));

    expect(screen.getByText(/already taken/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('changes a rep status', async () => {
    const { saved } = await open();
    await goTab('Users & Access');
    await userEvent.selectOptions(screen.getByLabelText('Status for Rep Two'), 'Left');
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(saved.filter((s) => s.key === 'sales').pop().data.sales_users[1].status).toBe('Left');
  });
});

describe('Sales Admin — Targets tab', () => {
  it('sets a category target for a rep and shows progress from their POs', async () => {
    const { saved } = await open();
    await goTab('Targets');

    // Pick the rep whose targets are being edited — production opens an editor per rep.
    await userEvent.click(await screen.findByRole('button', { name: /Rep One/ }));

    await userEvent.selectOptions(screen.getByLabelText('New Category Targets'), 'Dairy');
    await userEvent.type(screen.getByLabelText('Category Targets amount'), '10000');
    await userEvent.click(screen.getAllByRole('button', { name: '+ Add' })[0]);

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const targets = saved.filter((s) => s.key === 'sales').pop().data.targets;
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ rep_id: 'R1', dim: 'category', key: 'Dairy', amount: 10000, period_type: 'month' });
  });

  it('offers targets by dispatch form as well as by category', async () => {
    await open();
    await goTab('Targets');
    await userEvent.click(await screen.findByRole('button', { name: /Rep One/ }));
    expect(screen.getByLabelText('New Category Targets')).toBeInTheDocument();
    expect(screen.getByLabelText('New Dispatch-Form Targets')).toBeInTheDocument();
  });
});
