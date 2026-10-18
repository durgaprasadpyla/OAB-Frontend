import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import RepPortal from '../pages/RepPortal.jsx';
import CsaRequestCard from '../components/CsaRequestCard.jsx';
import {
  DESPATCH_FIELDS, despatchKind, presetDespatchDetails, bulkBagTotals, buildCsaDraft, buildCsaRequest,
  despatchDetailLabel, withCurrentDespatchKeys,
} from '../lib/repFlow.js';
import { DD_DEFAULTS } from '../lib/dropdowns.js';

// "Issues as on 17.10.2026" — Sales rep → Add SKU → Dispatch details:
//   §1 a dispatch form whose measurements never appeared
//   §2 the bulk-bag gusset computation, visible and saved
//   §3 the roll / shrink-roll core in inches, not mm

afterEach(() => { vi.restoreAllMocks(); });

const REP = 'R1';
const LEADS = [{ id: 'L3', client_name: 'ZEPTO', categories: ['Juices'], category_assignments: { Juices: REP }, created_by: REP, assigned_to: REP, stage: 'Hot', delivery_location: 'Hyderabad' }];
const salesModule = (over = {}) => ({
  leads: JSON.parse(JSON.stringify(LEADS)), contacts: [], interactions: [], skus: [], pos: [], quotations: [], qc_reports: [],
  sales_users: [{ id: REP, username: 'manasa', display_name: 'Manasa', status: 'Active' }],
  targets: [], substrate_options: [], nego_msgs: [], dropdowns: {}, ...over,
});
const openRep = (sales = salesModule()) => renderApp(<RepPortal />, { modules: { sales, customers: [] }, role: 'sales', repId: REP, user: 'Manasa' });
const tab = async (label) => userEvent.click(await screen.findByText(label));
const lastSaved = (saved) => (saved.filter((s) => s.key === 'sales').pop() || {}).data;
const details = () => screen.getByLabelText('Dispatch details');
const labelsShown = () => [...within(screen.getByLabelText('Dispatch form details')).getAllByText((_, el) => el.tagName === 'LABEL' && el.parentElement.className === 'fg')].map((l) => l.textContent);
async function startSku(form) {
  await userEvent.click(screen.getByLabelText('SKU pick Lead'));
  await userEvent.selectOptions(screen.getByLabelText('SKU Lead'), 'L3');
  await userEvent.type(screen.getByLabelText('SKU Name'), 'X');
  await userEvent.selectOptions(screen.getByLabelText('Category'), 'Dairy');
  if (form) await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), form);
}

/* ═══════════════ §1 — every dispatch form shows its measurements ═══════════════ */
describe('Issues 17.10 §1 — every dispatch form has measurements', () => {
  const VARIANTS = {
    Roll: 'roll', ROLL: 'roll', Rolls: 'roll', 'Roll Form': 'roll', Reel: 'roll', 'Laminate': 'roll',
    Label: 'labels', Labels: 'labels', LABELS: 'labels',
    Pouch: 'pouch', Pouches: 'pouch', 'Stand up pouch': 'pouch', Sachet: 'pouch',
    'Bulk Bags': 'bulk', 'Bulk Bag': 'bulk', 'BULK BAGS': 'bulk', FIBC: 'bulk',
    'Shrink Sleeve': 'shrink', 'Shrink sleeve': 'shrink', 'Shrink sleeve in roll form': 'shrink', Sleeves: 'shrink',
    Others: 'other', Other: 'other', Wrapper: 'other',
  };

  it('maps case, plural and wording variants onto a kind that has fields', () => {
    Object.entries(VARIANTS).forEach(([name, kind]) => {
      expect(despatchKind(name), name).toBe(kind);
      expect((DESPATCH_FIELDS[despatchKind(name)] || []).length, name).toBeGreaterThan(0);
    });
    // the built-in list and a stored [value, label] pair
    DD_DEFAULTS.despatch.forEach((name) => expect((DESPATCH_FIELDS[despatchKind(name)] || []).length, name).toBeGreaterThan(0));
    expect(despatchKind(['Bulk Bag', 'Bulk Bags'])).toBe('bulk');
    expect(despatchKind('  ')).toBe('');
    expect(despatchKind(null)).toBe('');
  });

  it('a shrink form named for its form answers the Sleeve / Roll radio', () => {
    expect(presetDespatchDetails('Shrink sleeve in roll form')).toEqual({ sleeve_form: 'Roll form' });
    expect(presetDespatchDetails('Shrink Sleeve - sleeve form')).toEqual({ sleeve_form: 'Sleeve form' });
    expect(presetDespatchDetails('Shrink Sleeve')).toEqual({});
    expect(presetDespatchDetails('Roll')).toEqual({});
  });

  it('shows measurements for every form on the default list — "Others" included', async () => {
    openRep();
    await tab('📦 SKUs');
    await startSku();
    for (const form of DD_DEFAULTS.despatch) {
      await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), form);
      expect(within(details()).getByLabelText('Dispatch form details'), form).toBeInTheDocument();
      expect(labelsShown().length, form).toBeGreaterThan(0);
    }
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Others');
    expect(labelsShown()).toEqual(['Describe the dispatch form', 'Width (mm)', 'Length / height (mm)', 'Packing instructions', 'Other specifications']);
  });

  it('a stored list spelt differently still shows the right measurements', async () => {
    openRep(salesModule({ dropdowns: { despatch: ['ROLL', 'Labels', 'Pouches', 'Bulk Bag', 'Shrink sleeve in roll form', 'Others'] } }));
    await tab('📦 SKUs');
    await startSku('ROLL');
    expect(labelsShown()).toContain('Core width (inches)');
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Labels');
    expect(labelsShown()).toContain('Labels per box');
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Pouches');
    expect(labelsShown()).toContain('Pouch width end to end (mm)');
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Bulk Bag');
    expect(labelsShown()).toContain('Gusset (mm)');
    // the roll-form shrink sleeve shows its roll measurements at once — not just the radio
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Shrink sleeve in roll form');
    expect(within(details()).getByLabelText('Roll form')).toBeChecked();
    expect(labelsShown()).toEqual(['Form', 'Core (inches)', 'Per core', 'Metres / Kgs per core']);
  });

  it('a plain Shrink Sleeve says the measurements wait on the form radio', async () => {
    openRep();
    await tab('📦 SKUs');
    await startSku('Shrink Sleeve');
    expect(within(details()).getByText(/Pick Sleeve form or Roll form/)).toBeInTheDocument();
    await userEvent.click(within(details()).getByLabelText('Sleeve form'));
    expect(within(details()).queryByText(/Pick Sleeve form or Roll form/)).toBeNull();
    expect(labelsShown()).toContain('Height of the sleeve (mm)');
  });
});

/* ═══════════════ §2 — bulk-bag gusset computation ═══════════════ */
describe('Issues 17.10 §2 — bulk-bag gusset computation', () => {
  it('works the totals exactly as the client wrote them', () => {
    // side gusset: total gusset × 4, width + gusset × 4, height as entered
    expect(bulkBagTotals({ gusset_type: 'Side gusset', pouch_width_mm: 300, gusset_mm: 50, pouch_height_mm: 400 }))
      .toEqual({ totalGusset: 200, totalHeight: 400, totalWidth: 500 });
    // bottom gusset: total gusset × 2, height + gusset × 2, width as entered
    expect(bulkBagTotals({ gusset_type: 'Bottom gusset', pouch_width_mm: 300, gusset_mm: 50, pouch_height_mm: 400 }))
      .toEqual({ totalGusset: 100, totalHeight: 500, totalWidth: 300 });
    // typed as strings, decimals kept to two places
    expect(bulkBagTotals({ gusset_type: 'Side gusset', pouch_width_mm: '250.5', gusset_mm: '12.1', pouch_height_mm: '400' }))
      .toEqual({ totalGusset: 48.4, totalHeight: 400, totalWidth: 298.9 });
    // no gusset type yet: no gusset, dimensions as typed
    expect(bulkBagTotals({ pouch_width_mm: 300, gusset_mm: 50, pouch_height_mm: 400 })).toEqual({ totalGusset: 0, totalHeight: 400, totalWidth: 300 });
    expect(bulkBagTotals()).toEqual({ totalGusset: 0, totalHeight: 0, totalWidth: 0 });
  });

  it('shows three labelled read-only boxes that follow the inputs live', async () => {
    openRep();
    await tab('📦 SKUs');
    await startSku('Bulk Bags');
    const d = details();
    const totals = () => within(d).getByLabelText('Bulk bag totals');
    const box = (l) => within(totals()).getByLabelText(l);
    // before a gusset type is picked the boxes are empty and say why
    expect(box('Total gusset (mm)')).toHaveValue('');
    expect(within(totals()).getAllByText('Pick side or bottom gusset')).toHaveLength(3);
    await userEvent.click(within(d).getByLabelText('Side gusset'));
    await userEvent.type(within(d).getByLabelText('Pouch width (mm)'), '300');
    await userEvent.type(within(d).getByLabelText('Gusset (mm)'), '50');
    await userEvent.type(within(d).getByLabelText('Height of the pouch without gusset (mm)'), '400');
    ['Total gusset (mm)', 'Final pouch height (mm)', 'Final pouch width (mm)'].forEach((l) => {
      expect(box(l)).toHaveAttribute('readonly');
    });
    expect(box('Total gusset (mm)')).toHaveValue('200');
    expect(box('Final pouch height (mm)')).toHaveValue('400');
    expect(box('Final pouch width (mm)')).toHaveValue('500');
    expect(within(totals()).getByText('50 × 4 (side gusset)')).toBeInTheDocument();
    expect(within(totals()).getByText('300 + 50 × 4 (side gusset)')).toBeInTheDocument();
    await userEvent.click(within(d).getByLabelText('Bottom gusset'));
    expect(box('Total gusset (mm)')).toHaveValue('100');
    expect(box('Final pouch height (mm)')).toHaveValue('500');
    expect(box('Final pouch width (mm)')).toHaveValue('300');
    expect(within(totals()).getByText('400 + 50 × 2 (bottom gusset)')).toBeInTheDocument();
  });

  it('saves the computed figures with the SKU, and QC is shown them', async () => {
    const { saved } = openRep();
    await tab('📦 SKUs');
    await startSku('Bulk Bags');
    const d = details();
    await userEvent.click(within(d).getByLabelText('Bottom gusset'));
    await userEvent.type(within(d).getByLabelText('Pouch width (mm)'), '300');
    await userEvent.type(within(d).getByLabelText('Gusset (mm)'), '50');
    await userEvent.type(within(d).getByLabelText('Height of the pouch without gusset (mm)'), '400');
    await userEvent.click(screen.getByText('✓ Add SKU'));
    await waitFor(() => expect(lastSaved(saved)).toBeTruthy());
    const sku = lastSaved(saved).skus[0];
    expect(sku.csa_draft.details).toMatchObject({ gusset_type: 'Bottom gusset', gusset_mm: 50, totalGusset: 100, totalHeight: 500, totalWidth: 300 });

    // the requisition carries them too, and the QC banner labels them
    const request = buildCsaRequest({ despatch_location: 'Pune', tentative_qty: 10, tentative_date: '2026-11-01', target_price: 2, ...sku.csa_draft.details }, sku);
    expect(request.details).toMatchObject({ totalGusset: 100, totalHeight: 500, totalWidth: 300 });
    render(<CsaRequestCard sku={{ ...sku, csa_request: request }} />);
    const card = screen.getByLabelText('CSA requisition from the sales rep');
    expect(card.textContent).toContain('Total gusset (mm): 100');
    expect(card.textContent).toContain('Final pouch height (mm): 500');
    expect(card.textContent).toContain('Final pouch width (mm): 300');
  });
});

/* ═══════════════ §3 — core in inches ═══════════════ */
describe('Issues 17.10 §3 — the core is in inches', () => {
  it('labels the roll and shrink-roll core in inches, decimals allowed', async () => {
    openRep();
    await tab('📦 SKUs');
    await startSku('Roll');
    const core = within(details()).getByLabelText('Core width (inches)');
    expect(core).toHaveAttribute('type', 'number');
    expect(core).toHaveAttribute('step', '0.01');
    expect(within(details()).queryByLabelText('Core width (mm)')).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText('Dispatch Form'), 'Shrink Sleeve');
    await userEvent.click(within(details()).getByLabelText('Roll form'));
    expect(within(details()).getByLabelText('Core (inches)')).toHaveAttribute('step', '0.01');
    expect(within(details()).queryByLabelText('Core dimension (mm)')).toBeNull();
  });

  it('stores the core under an inch key, value unconverted, reading the old key as a fallback', () => {
    expect(buildCsaDraft({ core_width_in: '3.5' }, 'Roll').details).toEqual({ core_width_in: 3.5 });
    expect(buildCsaDraft({ core_width_mm: '3' }, 'Roll').details).toEqual({ core_width_in: 3 });
    expect(buildCsaDraft({ sleeve_form: 'Roll form', core_mm: '6' }, 'Shrink Sleeve').details).toEqual({ sleeve_form: 'Roll form', core_in: 6 });
    expect(withCurrentDespatchKeys({ core_width_mm: 3, per_reel_kg: 20 })).toEqual({ core_width_in: 3, per_reel_kg: 20 });
    expect(withCurrentDespatchKeys({ core_width_mm: 3, core_width_in: 4 })).toEqual({ core_width_in: 4 });
    expect(despatchDetailLabel('roll', 'core_width_mm')).toBe('Core width (inches)');
    expect(despatchDetailLabel('roll', 'core_width_in')).toBe('Core width (inches)');
    expect(despatchDetailLabel('shrink', 'core_mm')).toBe('Core (inches)');
  });

  it('an old SKU\'s core comes back in the inch field, and saves under the inch key', async () => {
    const old = {
      id: 'S1', lead_id: 'L3', sku_name: 'Old Roll', category: 'Juices', dispatch_form: 'Roll', created_by: REP,
      csa_draft: { despatch_location: 'Hyderabad', tentative_qty: 10, kind: 'roll', details: { per_reel_kg: 20, core_width_mm: 3 }, saved_at: '2026-10-01T00:00:00Z' },
    };
    const { saved } = openRep(salesModule({ skus: [old] }));
    await tab('📦 SKUs');
    await userEvent.click(await screen.findByLabelText('Edit Old Roll'));
    expect(within(details()).getByLabelText('Core width (inches)')).toHaveValue(3);
    await userEvent.click(screen.getByText('✓ Save SKU'));
    await waitFor(() => expect(lastSaved(saved)).toBeTruthy());
    const det = lastSaved(saved).skus[0].csa_draft.details;
    expect(det).toEqual({ per_reel_kg: 20, core_width_in: 3 });
  });

  it('the QC banner reads an old requisition\'s core as inches', () => {
    const sku = { id: 'S1', sku_name: 'Old', csa_request: { despatch_location: 'Pune', kind: 'roll', despatch_form: 'Roll', details: { core_width_mm: 3 } } };
    render(<CsaRequestCard sku={sku} />);
    const card = screen.getByLabelText('CSA requisition from the sales rep');
    expect(card.textContent).toContain('Core width (inches): 3');
    expect(card.textContent).not.toContain('(mm): 3');
  });
});
