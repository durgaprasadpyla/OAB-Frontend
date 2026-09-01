import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import {
  leadCategories, categoryRep, repCategoriesOf, leadsForRep, activeReps, repName,
  contactsForLead, interactionsForLead, nextFollowUp, followUpState, buildLead,
  buildInteraction, pipelineByStage, repWorkload, nudgeList, acceptedMinPrice,
  quotesForLead, quoteStatusCounts, daysBetween, daysSince, datePlus, salesToday,
  REP_STATUSES,
} from '../lib/sales.js';

const daysFromNow = (n) => datePlus(n);

/* ── fixture: two reps sharing one customer across different categories ── */
const LEADS = [
  {
    id: 'L1', client_name: 'Acme Dairy', group: 'Acme Group', stage: 'Hot', payment_type: 'A',
    categories: ['Dairy', 'Ice Creams'],
    category_assignments: { Dairy: 'R1', 'Ice Creams': 'R2' },   // shared customer
    assigned_to: 'R1', next_follow_up_date: daysFromNow(-2),
  },
  { id: 'L2', client_name: 'Beta Snacks', stage: 'Warm', categories: ['Namkeen'], category_assignments: { Namkeen: 'R2' } },
  // Legacy record: no per-category map, only a lead-level owner.
  { id: 'L3', client_name: 'Gamma Foods', stage: 'Cold', category: 'Spices', category_assignments: {}, assigned_to: 'R1' },
];
const USERS = [
  { id: 'R1', username: 'rep1', display_name: 'Rep One', status: 'Active' },
  { id: 'R2', username: 'rep2', display_name: 'Rep Two', status: 'Active' },
  { id: 'R3', username: 'rep3', display_name: 'Rep Three', status: 'Inactive' },
];

describe('lead categories and per-category allocation', () => {
  it('reads the categories list, falling back to the legacy single field', () => {
    expect(leadCategories(LEADS[0])).toEqual(['Dairy', 'Ice Creams']);
    expect(leadCategories(LEADS[2])).toEqual(['Spices']);
    expect(leadCategories({})).toEqual([]);
  });

  it('resolves the owning rep per category, falling back to the lead owner', () => {
    expect(categoryRep(LEADS[0], 'Dairy')).toBe('R1');
    expect(categoryRep(LEADS[0], 'Ice Creams')).toBe('R2');
    expect(categoryRep(LEADS[2], 'Spices')).toBe('R1');      // no map -> assigned_to
  });

  it('gives each rep only their own categories of a shared customer', () => {
    expect(repCategoriesOf(LEADS[0], 'R1')).toEqual(['Dairy']);
    expect(repCategoriesOf(LEADS[0], 'R2')).toEqual(['Ice Creams']);
    expect(repCategoriesOf(LEADS[0], 'R9')).toEqual([]);
  });

  it('shows a shared customer to BOTH reps, each for their own line', () => {
    expect(leadsForRep(LEADS, 'R1').map((l) => l.id)).toEqual(['L1', 'L3']);
    expect(leadsForRep(LEADS, 'R2').map((l) => l.id)).toEqual(['L1', 'L2']);
  });

  it('never leaks leads to an unknown or blank rep', () => {
    expect(leadsForRep(LEADS, 'R9')).toEqual([]);
    expect(leadsForRep(LEADS, '')).toEqual([]);
    expect(leadsForRep(LEADS, undefined)).toEqual([]);
  });

  it('does not hand a legacy lead to a rep who merely appears in its map', () => {
    const legacy = [{ id: 'X', assigned_to: 'R1', category_assignments: {} }];
    expect(leadsForRep(legacy, 'R2')).toEqual([]);
  });
});

describe('reps', () => {
  it('lists active reps only', () => {
    expect(activeReps(USERS).map((r) => r.id)).toEqual(['R1', 'R2']);
    expect(activeReps([{ id: 'X', disabled: true }])).toEqual([]);
  });
  it('resolves a display name, with a dash for the unknown', () => {
    expect(repName(USERS, 'R1')).toBe('Rep One');
    expect(repName(USERS, 'nope')).toBe('—');
  });
});

describe('follow-ups', () => {
  const inters = [
    { id: 'i1', lead_id: 'L1', date: '2026-08-01', follow_up_date: daysFromNow(5) },
    { id: 'i2', lead_id: 'L1', date: '2026-08-02', follow_up_date: daysFromNow(2) },
    { id: 'i3', lead_id: 'L2', date: '2026-08-03', outcome: 'left message' },
  ];

  it('takes the soonest scheduled date across interactions and the lead itself', () => {
    // L1 has interactions at +5 and +2 and a lead field at -2 -> the overdue one wins.
    expect(nextFollowUp(LEADS[0], inters)).toBe(daysFromNow(-2));
    expect(nextFollowUp(LEADS[1], inters)).toBe('');    // no dated follow-up anywhere
  });

  it('classifies a due date relative to today', () => {
    expect(followUpState(daysFromNow(-1)).kind).toBe('overdue');
    expect(followUpState(salesToday()).kind).toBe('today');
    expect(followUpState(daysFromNow(1)).kind).toBe('tomorrow');
    expect(followUpState(daysFromNow(2)).kind).toBe('soon');
    expect(followUpState(daysFromNow(9)).kind).toBe('later');
    expect(followUpState('').kind).toBe('none');
  });

  it('orders a lead history newest first', () => {
    expect(interactionsForLead(inters, 'L1').map((i) => i.id)).toEqual(['i2', 'i1']);
  });

  it('lists only what is due or overdue, soonest first', () => {
    const list = nudgeList(LEADS, inters);
    expect(list.map((x) => x.lead.id)).toEqual(['L1']);
  });
});

describe('date helpers', () => {
  it('measures whole days, clamping negatives to zero', () => {
    expect(daysBetween('2026-08-01', '2026-08-11')).toBe(10);
    expect(daysBetween('2026-08-11', '2026-08-01')).toBe(0);
    expect(daysBetween('', '2026-08-01')).toBeNull();
    expect(daysSince(null)).toBeNull();
  });
});

describe('buildLead', () => {
  const form = { customer: ' Acme ', categories: ['Dairy', 'Oil'], group: 'G', paymentType: 'A', stage: 'Hot' };
  const opts = { now: new Date('2026-08-20T00:00:00Z'), uid: (p) => p + '_fixed' };

  it('allocates every chosen category to the creating rep', () => {
    const lead = buildLead(form, 'R1', opts);
    expect(lead.category_assignments).toEqual({ Dairy: 'R1', Oil: 'R1' });
    expect(lead.assigned_to).toBe('R1');
    expect(lead.created_by).toBe('R1');
  });

  it('trims the name and keeps the first category as the legacy single field', () => {
    const lead = buildLead(form, 'R1', opts);
    expect(lead.client_name).toBe('Acme');
    expect(lead.category).toBe('Dairy');
  });

  it('defaults the stage to To Approach', () => {
    expect(buildLead({ ...form, stage: '' }, 'R1', opts).stage).toBe('To Approach');
  });

  it('refuses a lead with no customer or no category', () => {
    expect(() => buildLead({ ...form, customer: '  ' }, 'R1', opts)).toThrow(/Customer is required/);
    expect(() => buildLead({ ...form, categories: [] }, 'R1', opts)).toThrow(/at least one category/i);
  });

  it('builds a follow-up interaction bound to the lead', () => {
    const i = buildInteraction('L9', 'R1', { followUp: '2026-09-01', outcome: 'call back' }, { uid: (p) => p + '_x' });
    expect(i).toMatchObject({ lead_id: 'L9', created_by: 'R1', follow_up_date: '2026-09-01', outcome: 'call back' });
  });
});

describe('pipeline rollups', () => {
  it('counts by stage in the canonical order', () => {
    expect(pipelineByStage(LEADS)).toEqual([
      { stage: 'Hot', count: 1 }, { stage: 'Warm', count: 1 }, { stage: 'Cold', count: 1 },
    ]);
  });

  it('still shows a stage outside the known list', () => {
    expect(pipelineByStage([{ stage: 'Revived' }])).toEqual([{ stage: 'Revived', count: 1 }]);
  });

  it('summarises each active rep by leads, category lines and overdue count', () => {
    const w = repWorkload(LEADS, USERS, []);
    const r1 = w.find((x) => x.id === 'R1');
    expect(r1).toMatchObject({ name: 'Rep One', leads: 2, lines: 2, overdue: 1 });
    expect(w.some((x) => x.id === 'R3')).toBe(false);   // inactive rep excluded
  });
});

describe('quotations', () => {
  const quotes = [
    { id: 'q1', lead_id: 'L1', sku: 'SKU-1', rate: 100, status: 'Accepted', created_at: '2026-08-01' },
    { id: 'q2', lead_id: 'L1', sku: 'SKU-1', rate: 92, status: 'Accepted', created_at: '2026-08-05' },
    { id: 'q3', lead_id: 'L1', sku: 'SKU-1', rate: 80, status: 'Rejected', created_at: '2026-08-06' },
    { id: 'q4', lead_id: 'L2', sku: 'SKU-1', rate: 50, status: 'Accepted', created_at: '2026-08-07' },
  ];

  it('takes the lowest ACCEPTED rate for that lead and SKU as the floor', () => {
    expect(acceptedMinPrice(quotes, 'L1', 'SKU-1')).toBe(92);   // 80 was rejected; 50 is another lead
    expect(acceptedMinPrice(quotes, 'L1', 'SKU-9')).toBeNull();
    expect(acceptedMinPrice([], 'L1', 'SKU-1')).toBeNull();
  });

  it('lists a lead\'s quotes newest first', () => {
    expect(quotesForLead(quotes, 'L1').map((q) => q.id)).toEqual(['q3', 'q2', 'q1']);
  });

  it('counts by status, defaulting a blank to Draft', () => {
    expect(quoteStatusCounts(quotes)).toEqual({ Accepted: 3, Rejected: 1 });
    expect(quoteStatusCounts([{ status: '' }])).toEqual({ Draft: 1 });
  });
});

/* ─────────────────────────── Rep Portal screen ─────────────────────────── */

const salesModule = () => ({
  leads: JSON.parse(JSON.stringify(LEADS)),
  sales_users: USERS,
  contacts: [{ id: 'c1', lead_id: 'L1', name: 'Mr Acme', designation: 'Buyer', phone: '900' },
    { id: 'c2', lead_id: 'L2', name: 'Ms Beta', phone: '901' }],
  interactions: [], quotations: [], skus: [], qc_reports: [], pos: [], targets: [],
  substrate_options: [], nego_msgs: [], dropdowns: {},
});

const openRep = async (repId = 'R1') => {
  const r = renderApp(<RepPortal />, {
    modules: { sales: salesModule(), customers: [] },
    role: 'sales', repId, user: repId === 'R1' ? 'Rep One' : 'Rep Two',
  });
  await waitFor(() => expect(screen.getByText('Sales Rep Portal')).toBeInTheDocument());
  return r;
};
const repTab = async (label) => {
  const hit = [...document.querySelectorAll('.step-tab')].find((el) => new RegExp(label).test(el.textContent));
  await userEvent.click(hit);
};

describe('Rep Portal — allocation', () => {
  it('shows a rep only their own customers', async () => {
    await openRep('R1');
    await repTab('My Leads');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());
    expect(screen.getByText('Gamma Foods')).toBeInTheDocument();
    expect(screen.queryByText('Beta Snacks')).not.toBeInTheDocument();   // R2's lead
  });

  it('shows a shared customer to the other rep with THEIR category only', async () => {
    await openRep('R2');
    await repTab('My Leads');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());
    const row = screen.getByText('Acme Dairy').closest('tr');
    expect(within(row).getByText('Ice Creams')).toBeInTheDocument();
    expect(within(row).queryByText('Dairy')).not.toBeInTheDocument();
    expect(screen.queryByText('Gamma Foods')).not.toBeInTheDocument();   // R1's lead
  });

  it('counts only the signed-in rep\'s customers in the header', async () => {
    await openRep('R1');
    expect(screen.getByText(/2 customers allocated to you/)).toBeInTheDocument();
  });
});

describe('Rep Portal — follow-ups', () => {
  it('flags an overdue ping and counts it', async () => {
    await openRep('R1');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());
    expect(screen.getByText('⚠ Overdue')).toBeInTheDocument();
  });

  it('logs a touch-point and reschedules the lead', async () => {
    const { saved } = await openRep('R1');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Log touch-point for Acme Dairy'));
    await userEvent.type(screen.getByLabelText('Outcome for Acme Dairy'), 'Spoke to buyer');
    await userEvent.type(screen.getByLabelText('Next follow-up for Acme Dairy'), daysFromNow(7));
    await userEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.interactions).toHaveLength(1);
    expect(blob.interactions[0]).toMatchObject({ lead_id: 'L1', created_by: 'R1', outcome: 'Spoke to buyer' });
    expect(blob.leads.find((l) => l.id === 'L1').next_follow_up_date).toBe(daysFromNow(7));
    // Untouched keys must survive the patch.
    expect(blob.sales_users).toHaveLength(3);
    expect(blob.contacts).toHaveLength(2);
  });
});

describe('Rep Portal — add customer', () => {
  it('saves a lead allocated to the signed-in rep', async () => {
    const { saved } = await openRep('R1');
    await repTab('Add Lead');
    await userEvent.type(screen.getByLabelText('Customer'), 'New Client Ltd');
    await userEvent.click(screen.getByLabelText('Dairy'));
    await userEvent.click(screen.getByLabelText('Oil'));
    await userEvent.click(screen.getByText(/Save Customer/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    const lead = blob.leads.find((l) => l.client_name === 'New Client Ltd');
    expect(lead.category_assignments).toEqual({ Dairy: 'R1', Oil: 'R1' });
    expect(blob.leads).toHaveLength(4);          // the three fixtures survive
  });

  it('refuses to save without a category, and does not write', async () => {
    const { saved } = await openRep('R1');
    await repTab('Add Lead');
    await userEvent.type(screen.getByLabelText('Customer'), 'No Category Ltd');
    await userEvent.click(screen.getByText(/Save Customer/));
    expect(screen.getByText(/at least one category/i)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });
});

describe('Rep Portal — contacts', () => {
  it('shows only contacts of the rep\'s own customers', async () => {
    await openRep('R1');
    await repTab('My Contacts');
    await waitFor(() => expect(screen.getByText('Mr Acme')).toBeInTheDocument());
    expect(screen.queryByText('Ms Beta')).not.toBeInTheDocument();   // belongs to R2's lead
  });

  it('adds a contact against a chosen customer', async () => {
    const { saved } = await openRep('R1');
    await repTab('My Contacts');
    await userEvent.selectOptions(screen.getByLabelText('Contact customer'), 'L1');
    await userEvent.type(screen.getByLabelText('Contact name'), 'New Person');
    await userEvent.click(screen.getByText(/Add contact/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.contacts).toHaveLength(3);
    expect(blob.contacts[2]).toMatchObject({ lead_id: 'L1', name: 'New Person', created_by: 'R1' });
  });
});

describe('Rep Portal — stage changes', () => {
  it('writes a stage change back to the blob', async () => {
    const { saved } = await openRep('R1');
    await repTab('My Leads');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Stage for Acme Dairy'), 'Converted');
    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.leads.find((l) => l.id === 'L1').stage).toBe('Converted');
  });

  it('offers every canonical stage', async () => {
    await openRep('R1');
    await repTab('My Leads');
    await waitFor(() => expect(screen.getByText('Acme Dairy')).toBeInTheDocument());
    const opts = [...screen.getByLabelText('Stage for Acme Dairy').options].map((o) => o.value);
    expect(opts).toEqual(REP_STATUSES);
  });
});
