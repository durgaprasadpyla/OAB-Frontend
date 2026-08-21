import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import SalesAdmin from '../pages/SalesAdmin.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import QuotationDesk from '../pages/QuotationDesk.jsx';
import { ddList, ddPairs, ddPatch, ddIsOverridden, DD_DEFAULTS, DROPDOWN_DEFS } from '../lib/dropdowns.js';
import { negoThread, negoUnread, negoGroups, negoUnreadTotal, negoPost, negoMarkSeen } from '../lib/nego.js';
import { monthKeyBack, kamLeadFor, kamCustomerStats, kamPrimaryContact, kamStored, kamApplyEdits, kamRows } from '../lib/kam.js';

/* ─────────────────────────── dropdown overrides ─────────────────────────── */

describe('ddList — overrides vs defaults', () => {
  it('falls back to the built-in list when nothing is stored', () => {
    expect(ddList({}, 'statuses')).toEqual(DD_DEFAULTS.statuses);
    expect(ddList({ dropdowns: {} }, 'categories')).toEqual(DD_DEFAULTS.categories);
  });

  it('uses a stored override when it has entries', () => {
    expect(ddList({ dropdowns: { statuses: ['A', 'B'] } }, 'statuses')).toEqual(['A', 'B']);
  });

  it('ignores an EMPTY stored list rather than blanking the dropdown', () => {
    // An accidental empty save must not leave the app with no options at all.
    expect(ddList({ dropdowns: { statuses: [] } }, 'statuses')).toEqual(DD_DEFAULTS.statuses);
  });

  it('reads substrates from their own top-level key', () => {
    expect(ddList({ substrate_options: [{ name: 'X', unit: 'GSM' }] }, 'substrates')).toHaveLength(1);
    expect(ddList({}, 'substrates')).toEqual(DD_DEFAULTS.substrates);
  });

  it('normalises payment types to [value, label] pairs however stored', () => {
    expect(ddPairs({ dropdowns: { paytypes: ['A', 'B'] } })).toEqual([['A', 'A'], ['B', 'B']]);
    expect(ddPairs({ dropdowns: { paytypes: [['A', 'Alpha']] } })).toEqual([['A', 'Alpha']]);
  });

  it('patches the right place for each list type', () => {
    expect(ddPatch({}, 'statuses', ['X'])).toEqual({ dropdowns: { statuses: ['X'] } });
    expect(ddPatch({}, 'substrates', [{ name: 'X' }])).toEqual({ substrate_options: [{ name: 'X' }] });
  });

  it('preserves other lists when patching one', () => {
    const p = ddPatch({ dropdowns: { categories: ['keep'] } }, 'statuses', ['X']);
    expect(p.dropdowns.categories).toEqual(['keep']);
  });

  it('reports whether a list is overridden', () => {
    expect(ddIsOverridden({}, 'statuses')).toBe(false);
    expect(ddIsOverridden({ dropdowns: { statuses: [] } }, 'statuses')).toBe(false);
    expect(ddIsOverridden({ dropdowns: { statuses: ['A'] } }, 'statuses')).toBe(true);
  });

  it('covers all nine lists with a default each', () => {
    DROPDOWN_DEFS.forEach((d) => expect((DD_DEFAULTS[d.key] || []).length).toBeGreaterThan(0));
  });
});

/* ─────────────────────────── negotiations ─────────────────────────── */

const NEGO = {
  skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A' }, { id: 'S2', lead_id: 'L2', sku_name: 'Pouch B' }],
  leads: [{ id: 'L1', client_name: 'Acme' }, { id: 'L2', client_name: 'Beta' }],
  nego_msgs: [
    { id: 'm1', sku_id: 'S1', lead_id: 'L1', from: 'rep', text: 'Can you do 11?', at: '2026-08-01T10:00:00Z', seen_by_rep: true, seen_by_quote: false },
    { id: 'm2', sku_id: 'S1', lead_id: 'L1', from: 'quote', text: 'Best is 11.5', at: '2026-08-02T10:00:00Z', seen_by_rep: false, seen_by_quote: true },
    { id: 'm3', sku_id: 'S2', lead_id: 'L2', from: 'rep', text: 'Any movement?', at: '2026-08-03T10:00:00Z', seen_by_rep: true, seen_by_quote: false },
  ],
};

describe('negotiation threads', () => {
  it('groups by SKU, oldest message first within a thread', () => {
    expect(negoThread(NEGO, 'S1').map((m) => m.id)).toEqual(['m1', 'm2']);
  });

  it('counts unread per side — you never see your own messages as unread', () => {
    expect(negoUnread(NEGO, 'S1', 'quote')).toBe(1);   // m1 from rep
    expect(negoUnread(NEGO, 'S1', 'rep')).toBe(1);     // m2 from quote
    expect(negoUnread(NEGO, 'S2', 'rep')).toBe(0);     // only the rep's own message
  });

  it('orders threads by most recent activity', () => {
    expect(negoGroups(NEGO, 'quote').map((g) => g.sku_id)).toEqual(['S2', 'S1']);
  });

  it('totals unread for the nav badge', () => {
    expect(negoUnreadTotal(NEGO, 'quote')).toBe(2);    // m1 + m3
    expect(negoUnreadTotal(NEGO, 'rep')).toBe(1);      // m2
  });

  it('marks a sent message seen by its own side immediately', () => {
    const next = negoPost(NEGO, { skuId: 'S1', leadId: 'L1', from: 'quote', text: 'Final 11.4' }, { uid: () => 'm9' });
    const m = next[next.length - 1];
    expect(m).toMatchObject({ from: 'quote', seen_by_quote: true, seen_by_rep: false });
  });

  it('refuses an empty message', () => {
    expect(() => negoPost(NEGO, { skuId: 'S1', from: 'rep', text: '   ' })).toThrow(/Type a message/);
    expect(() => negoPost(NEGO, { skuId: '', from: 'rep', text: 'hi' })).toThrow(/No SKU/);
  });

  it('marks one thread seen without touching the others', () => {
    const next = negoMarkSeen(NEGO, 'quote', 'S1');
    expect(next.find((m) => m.id === 'm1').seen_by_quote).toBe(true);
    expect(next.find((m) => m.id === 'm3').seen_by_quote).toBe(false);
  });

  it('marks everything seen when no thread is named', () => {
    const next = negoMarkSeen(NEGO, 'quote');
    expect(next.filter((m) => m.from === 'rep').every((m) => m.seen_by_quote)).toBe(true);
  });

  it('returns the SAME array when nothing changed, so callers can skip a write', () => {
    const once = negoMarkSeen(NEGO, 'quote');
    expect(negoMarkSeen({ nego_msgs: once }, 'quote')).toBe(once);
  });
});

/* ─────────────────────────── KAM & targets ─────────────────────────── */

const NOW = new Date('2026-08-20T00:00:00');
const OAB = {
  SF: [
    { customer: 'Acme', poDate: '2026-08-05', poQty: 1000 },
    { customer: 'Acme', poDate: '2026-08-12', poQty: 500 },
    { customer: 'Acme', poDate: '2026-07-10', poQty: 900 },
    { customer: 'Acme', poDate: '2026-06-10', poQty: 900 },
    { customer: 'Acme', poDate: '2026-05-10', poQty: 1200 },
    { customer: 'Other', poDate: '2026-08-01', poQty: 5000 },
  ],
  OT: [],
};

describe('kamCustomerStats', () => {
  it('sums this month from the OAB board', () => {
    expect(kamCustomerStats(OAB, 'Acme', NOW).achieved).toBe(1500);
  });

  it('suggests a target from the previous three months average', () => {
    // 900 + 900 + 1200 over three months.
    expect(kamCustomerStats(OAB, 'Acme', NOW).suggestedTarget).toBe(1000);
  });

  it('suggests an order frequency from how often they actually ordered', () => {
    expect(kamCustomerStats(OAB, 'Acme', NOW).suggestedFreqDays).toBe(30);   // 90 / 3 orders
  });

  it('is all zeroes for a customer with no orders', () => {
    expect(kamCustomerStats(OAB, 'Nobody', NOW)).toEqual({ achieved: 0, suggestedTarget: 0, suggestedFreqDays: 0 });
  });

  it('formats month keys going back', () => {
    expect(monthKeyBack(0, NOW)).toBe('2026-08');
    expect(monthKeyBack(3, NOW)).toBe('2026-05');
  });
});

describe('kam lead fields', () => {
  const leads = [{ id: 'L1', client_name: 'Acme', kam: 'R1', order_frequency: 30, monthly_target: 2000 }];

  it('reads the stored KAM, frequency and target', () => {
    expect(kamStored(leads, 'Acme')).toEqual({ kam: 'R1', freq: 30, target: 2000 });
  });

  it('returns nulls for a customer with no lead', () => {
    expect(kamStored(leads, 'Nobody')).toEqual({ kam: '', freq: null, target: null });
    expect(kamLeadFor(leads, 'Nobody')).toBeNull();
  });

  it('treats a blank stored value as unset, not zero', () => {
    expect(kamStored([{ client_name: 'X', monthly_target: '' }], 'X').target).toBeNull();
  });
});

describe('kamApplyEdits', () => {
  const leads = [{ id: 'L1', client_name: 'Acme', categories: ['Dairy'], category_assignments: { Dairy: 'R1' } }];

  it('patches an existing lead without disturbing its allocations', () => {
    const out = kamApplyEdits(leads, { Acme: { kam: 'R2', monthly_target: '5000' } });
    expect(out[0]).toMatchObject({ kam: 'R2', monthly_target: '5000' });
    expect(out[0].category_assignments).toEqual({ Dairy: 'R1' });
  });

  it('creates a lead for a customer that has none yet', () => {
    const out = kamApplyEdits(leads, { NewCo: { kam: 'R1' } }, { uid: () => 'L9' });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'L9', client_name: 'NewCo', kam: 'R1', stage: 'To Approach' });
  });

  it('does not mutate the input', () => {
    const before = JSON.parse(JSON.stringify(leads));
    kamApplyEdits(leads, { Acme: { kam: 'R2' } });
    expect(leads).toEqual(before);
  });
});

describe('kamPrimaryContact / kamRows', () => {
  const sales = {
    leads: [{ id: 'L1', client_name: 'Acme', kam: 'R1', monthly_target: 2000 }],
    contacts: [
      { id: 'c1', lead_id: 'L1', name: 'Junior', phone: '111' },
      { id: 'c2', lead_id: 'L1', name: 'Boss', phone: '222', is_primary: true },
    ],
    sales_users: [{ id: 'R1', display_name: 'Rep One', status: 'Active' }],
  };

  it('prefers the flagged-primary contact', () => {
    expect(kamPrimaryContact(sales, 'Acme').name).toBe('Boss');
  });

  it('falls back to any contact on file', () => {
    const one = { ...sales, contacts: [sales.contacts[0]] };
    expect(kamPrimaryContact(one, 'Acme').name).toBe('Junior');
    expect(kamPrimaryContact(sales, 'Nobody')).toBeNull();
  });

  it('matches a contact that names the customer directly, with no lead link', () => {
    const direct = { ...sales, contacts: [{ id: 'c9', customer: 'Acme', name: 'Direct' }] };
    expect(kamPrimaryContact(direct, 'Acme').name).toBe('Direct');
  });

  it('joins the master, lead fields, contact and live achievement', () => {
    const rows = kamRows({ customers: [{ customer: 'Acme', group: 'G' }], sales, oab: OAB }, NOW);
    expect(rows[0]).toMatchObject({
      customer: 'Acme', group: 'G', kam: 'R1', target: 2000, achieved: 1500, contactName: 'Boss',
    });
    expect(rows[0].gap).toBe(500);
  });

  it('falls back per field to the Customer Master for contact details', () => {
    const rows = kamRows({ customers: [{ customer: 'Zed', contactPerson: 'CM Name', contactPhone: '999' }], sales, oab: OAB }, NOW);
    expect(rows[0]).toMatchObject({ contactName: 'CM Name', contactPhone: '999' });
  });

  it('collapses the customer master to ONE row per customer name', () => {
    // Production holds one master row per customer x dispatch location — RELIANCE
    // has 27. A KAM/target belongs to the customer, and duplicate rows would also
    // collide on the React key, letting an edit land on the wrong row.
    const dupes = [
      { customer: 'RELIANCE', dispatchLoc: 'Hyderabad' },
      { customer: 'RELIANCE', dispatchLoc: 'Chennai', group: 'RIL Group' },
      { customer: 'RELIANCE', dispatchLoc: 'Mumbai' },
      { customer: 'Solo' },
    ];
    const rows = kamRows({ customers: dupes, sales, oab: OAB }, NOW);
    expect(rows.map((r) => r.customer)).toEqual(['RELIANCE', 'Solo']);
    // The fuller record (the one carrying a group) is the one kept.
    expect(rows[0].group).toBe('RIL Group');
  });

  it('skips inactive customers', () => {
    expect(kamRows({ customers: [{ customer: 'Gone', active: false }], sales, oab: OAB }, NOW)).toEqual([]);
  });
});

/* ─────────────────────────── screens ─────────────────────────── */

const mods = () => ({
  sales: {
    leads: [{ id: 'L1', client_name: 'Acme', kam: '', categories: ['Dairy'], category_assignments: {} }],
    sales_users: [{ id: 'R1', display_name: 'Rep One', username: 'rep1', status: 'Active' }],
    skus: [{ id: 'S1', lead_id: 'L1', sku_name: 'Pouch A' }],
    nego_msgs: [{ id: 'm1', sku_id: 'S1', lead_id: 'L1', from: 'rep', text: 'Can you do 11?', at: '2026-08-01T10:00:00Z', seen_by_quote: false }],
    contacts: [], interactions: [], quotations: [], qc_reports: [], pos: [], targets: [],
    substrate_options: [], dropdowns: {},
  },
  customers: [{ customer: 'Acme', group: 'G' }],
  oab: { OAB: { SF: [{ customer: 'Acme', poDate: '2026-08-05', poQty: 1000 }], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 1 }, lastInvNo: 1 },
});

const goTab = async (label) => {
  const hit = [...document.querySelectorAll('.step-tab')].find((el) => new RegExp(label).test(el.textContent));
  await userEvent.click(hit);
};

describe('Dashboard — Customer KAM & Targets tab', () => {
  // KAM lives on the superadmin Dashboard (monolith: dash-tab-kam), not the
  // Sales Dashboard — the S Dashboard has its own rep-level Targets tab.
  it('lists customers with their live achievement and lets a KAM be assigned', async () => {
    const { saved } = renderApp(<Dashboard />, { modules: mods(), role: 'superadmin' });
    await waitFor(() => expect(screen.getByText(/Business Dashboard/)).toBeInTheDocument());
    await goTab('Customer KAM');

    await waitFor(() => expect(screen.getByLabelText('KAM for Acme')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('KAM for Acme'), 'R1');
    await userEvent.type(screen.getByLabelText('Monthly target for Acme'), '5000');
    await userEvent.click(screen.getByText(/Save 1/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const lead = saved.filter((s) => s.key === 'sales').pop().data.leads[0];
    expect(lead).toMatchObject({ kam: 'R1', monthly_target: '5000' });
    expect(lead.categories).toEqual(['Dairy']);   // untouched
  });
});

describe('Sales Admin — dropdown lists tab', () => {
  it('saves an edited list and shows it as custom', async () => {
    const { saved } = renderApp(<SalesAdmin />, { modules: mods(), role: 'sadmin' });
    await waitFor(() => expect(screen.getByText(/S Dashboard/)).toBeInTheDocument());
    await goTab('Dropdown Lists');

    await waitFor(() => expect(screen.getByLabelText('Value 1')).toBeInTheDocument());
    await userEvent.clear(screen.getByLabelText('Value 1'));
    await userEvent.type(screen.getByLabelText('Value 1'), 'Bespoke');
    await userEvent.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    expect(saved.filter((s) => s.key === 'sales').pop().data.dropdowns.categories[0]).toBe('Bespoke');
  });
});

describe('Quotation Desk — negotiations tab', () => {
  it('badges unread and opens the thread', async () => {
    renderApp(<QuotationDesk />, { modules: mods(), role: 'quote' });
    await waitFor(() => expect(screen.getByText('Quotation Desk')).toBeInTheDocument());

    const tab = [...document.querySelectorAll('.step-tab')].find((el) => /Negotiations/.test(el.textContent));
    expect(within(tab).getByText('1')).toBeInTheDocument();      // one unread from the rep

    await userEvent.click(tab);
    await userEvent.click(await screen.findByText('Pouch A'));
    // The list shows a preview of the same text, so scope to the thread itself.
    const panel = screen.getByLabelText('Negotiation thread');
    expect(within(panel).getByText('Can you do 11?')).toBeInTheDocument();
    expect(within(panel).getByText(/Sales rep/)).toBeInTheDocument();
  });

  it('sends a reply into the thread', async () => {
    const { saved } = renderApp(<QuotationDesk />, { modules: mods(), role: 'quote' });
    await waitFor(() => expect(screen.getByText('Quotation Desk')).toBeInTheDocument());
    await goTab('Negotiations');
    await userEvent.click(await screen.findByText('Pouch A'));
    await userEvent.type(screen.getByLabelText('Message'), 'Best is 11.5');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      const w = saved.filter((s) => s.key === 'sales').map((s) => s.data.nego_msgs).flat();
      expect(w.some((m) => m.text === 'Best is 11.5' && m.from === 'quote')).toBe(true);
    });
  });
});
