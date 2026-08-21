import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import PM from '../pages/PM.jsx';
import Purchase from '../pages/Purchase.jsx';
import {
  isYes, csaDaysSince, ageColor, csaSampleDate, csaPendingForQc, csaPendingForPlant,
  csaDoneForPlant, csaCompanyItem, csaStructure, substrateUnit, substrateList,
  buildCsaReport, markSkuCsaReceived, answerCsaReport, CSA_BLANK, SUBSTRATE_DEFAULTS,
} from '../lib/csa.js';

const SALES = {
  leads: [{ id: 'L1', client_name: 'Acme Foods' }],
  skus: [
    { id: 'S1', lead_id: 'L1', sku_name: 'Pouch A', sample_received: 'Yes', sample_sent: 'Yes', sample_sent_at: '2026-08-10', dispatch_form: 'Pouch' },
    { id: 'S2', lead_id: 'L1', sku_name: 'Pouch B', sample_received: 'Yes', sample_sent: 'No' },
    { id: 'S3', lead_id: 'L1', sku_name: 'Pouch C', sample_received: 'Yes', sample_sent: 'Yes', sample_sent_at: '2026-08-01' },
  ],
  qc_reports: [{ id: 'R1', source: 'sales_os', sku_id: 'S3', lead_id: 'L1', created_at: '2026-08-02T00:00:00Z', substrate1: 'PET', substrate2: 'AF LDPE', status: 'Pending Plant' }],
  contacts: [], interactions: [], quotations: [], sales_users: [], pos: [], targets: [],
  substrate_options: [], nego_msgs: [], dropdowns: {},
};

describe('isYes', () => {
  it('only Yes counts', () => {
    expect(isYes('Yes')).toBe(true);
    expect(isYes(' yes ')).toBe(true);
    expect(isYes('No')).toBe(false);
    expect(isYes('')).toBe(false);
    expect(isYes(undefined)).toBe(false);
    expect(isYes(true)).toBe(false);   // the blob stores the string, not a boolean
  });
});

describe('csaDaysSince', () => {
  const now = new Date('2026-08-20T09:00:00');
  it('counts calendar days, not rolling 24h windows', () => {
    // Logged at 23:00 yesterday -> reads 1d this morning, not 0d.
    expect(csaDaysSince('2026-08-19T23:00:00Z', now)).toBe(1);
    expect(csaDaysSince('2026-08-20T01:00:00Z', now)).toBe(0);
    expect(csaDaysSince('2026-08-10', now)).toBe(10);
  });
  it('is zero for blank or unparseable dates and never negative', () => {
    expect(csaDaysSince('', now)).toBe(0);
    expect(csaDaysSince('rubbish', now)).toBe(0);
    expect(csaDaysSince('2026-09-01', now)).toBe(0);
  });
});

describe('ageColor', () => {
  it('bands fresh / amber / late', () => {
    // "Fresh" is brand blue, not green: build.js remaps the whole document, so
    // production shows #0e6fb8 here. Matching it keeps the two apps identical.
    expect(ageColor(0)).toBe('#0e6fb8');
    expect(ageColor(2)).toBe('#0e6fb8');
    expect(ageColor(5)).toBe('#E67E22');
    expect(ageColor(6)).toBe('#c0392b');
    expect(ageColor(null)).toBe('#888');
  });
});

describe('csaSampleDate', () => {
  it('prefers sent, then received, then created', () => {
    expect(csaSampleDate({ sample_sent_at: 'a', sample_received_at: 'b', created_at: 'c' })).toBe('a');
    expect(csaSampleDate({ sample_received_at: 'b', created_at: 'c' })).toBe('b');
    expect(csaSampleDate({ created_at: 'c' })).toBe('c');
    expect(csaSampleDate({})).toBe('');
  });
});

describe('csaPendingForQc', () => {
  it('needs BOTH received and sent, and no report yet', () => {
    const pending = csaPendingForQc(SALES);
    expect(pending.map((s) => s.id)).toEqual(['S1']);   // S2 not sent, S3 already reported
  });

  it('orders the longest wait first', () => {
    const sales = { ...SALES, qc_reports: [] };
    expect(csaPendingForQc(sales).map((s) => s.id)).toEqual(['S3', 'S1']);   // S3 sent earlier
  });

  it('is empty for a blank blob', () => {
    expect(csaPendingForQc({})).toEqual([]);
  });
});

describe('plant queues', () => {
  it('pending = no plant comments yet, or flagged for re-review', () => {
    expect(csaPendingForPlant(SALES).map((r) => r.id)).toEqual(['R1']);
    const answered = { ...SALES, qc_reports: [{ ...SALES.qc_reports[0], plant_comments: 'ok' }] };
    expect(csaPendingForPlant(answered)).toEqual([]);
    expect(csaDoneForPlant(answered).map((r) => r.id)).toEqual(['R1']);
  });

  it('a re-review flag pulls an answered report back into the queue', () => {
    const reopened = { ...SALES, qc_reports: [{ ...SALES.qc_reports[0], plant_comments: 'ok', needs_pm_review: true }] };
    expect(csaPendingForPlant(reopened).map((r) => r.id)).toEqual(['R1']);
    expect(csaDoneForPlant(reopened)).toEqual([]);
  });
});

describe('csaCompanyItem / csaStructure', () => {
  it('resolves a pipeline report through its SKU and lead', () => {
    expect(csaCompanyItem(SALES, SALES.qc_reports[0])).toEqual({ company: 'Acme Foods', item: 'Pouch C' });
  });
  it('uses the typed-in text for a direct report', () => {
    expect(csaCompanyItem(SALES, { source: 'direct', company_name: 'Walk-in Ltd', product_desc: 'Sample bag' }))
      .toEqual({ company: 'Walk-in Ltd', item: 'Sample bag' });
  });
  it('summarises the structure, dashing when empty', () => {
    expect(csaStructure(SALES.qc_reports[0])).toBe('PET/AF LDPE');
    expect(csaStructure({})).toBe('—');
  });
});

describe('substrates', () => {
  it('paper is GSM, films are microns', () => {
    expect(substrateUnit({}, 'Paper')).toBe('GSM');
    expect(substrateUnit({}, 'PET')).toBe('Micron');
    expect(substrateUnit({}, 'Unknown')).toBe('Micron');
  });
  it('a super-admin list overrides the defaults', () => {
    expect(substrateList({})).toBe(SUBSTRATE_DEFAULTS);
    expect(substrateList({ substrate_options: [{ name: 'Custom', unit: 'GSM' }] })).toHaveLength(1);
    expect(substrateUnit({ substrate_options: [{ name: 'PET', unit: 'GSM' }] }, 'PET')).toBe('GSM');
  });
});

describe('buildCsaReport', () => {
  const opts = { sales: SALES, user: 'qc1', now: new Date('2026-08-20T00:00:00Z'), uid: (p) => p + '_1' };

  it('builds a pipeline report linked to its SKU and lead', () => {
    const r = buildCsaReport({ ...CSA_BLANK, substrate1: 'PET', substrate1_val: '12', gsm: '80' }, { ...opts, skuId: 'S1' });
    expect(r).toMatchObject({ source: 'sales_os', sku_id: 'S1', lead_id: 'L1', status: 'Pending Plant', created_by: 'qc1' });
    expect(r.substrate1_val).toBe(12);
    expect(r.substrate1_unit).toBe('Micron');
    expect(r.gsm).toBe(80);
  });

  it('coerces every numeric field, with blanks becoming zero not NaN', () => {
    const r = buildCsaReport({ ...CSA_BLANK }, { ...opts, skuId: 'S1' });
    ['ink_gsm', 'adhesive_gsm', 'film_width', 'pouch_height', 'pouch_width', 'seal_width',
      'gsm', 'pouch_weight', 'pouches_per_kg', 'print_repeat', 'sleeve_repeat'].forEach((k) => {
      expect(r[k]).toBe(0);
    });
  });

  it('a direct report must name company, product and responsible person', () => {
    expect(() => buildCsaReport({ ...CSA_BLANK }, opts)).toThrow(/Company is required/);
    expect(() => buildCsaReport({ ...CSA_BLANK, company_name: 'X' }, opts)).toThrow(/Product description/);
    expect(() => buildCsaReport({ ...CSA_BLANK, company_name: 'X', product_desc: 'Y' }, opts)).toThrow(/Responsible person/);
  });

  it('a direct report carries its own text and no SKU link', () => {
    const r = buildCsaReport({ ...CSA_BLANK, company_name: 'Walk-in', product_desc: 'Bag', responsible_person: 'ASM' }, opts);
    expect(r).toMatchObject({ source: 'direct', sku_id: null, lead_id: null, company_name: 'Walk-in' });
  });

  it('a pipeline report does not require the direct-only fields', () => {
    expect(() => buildCsaReport({ ...CSA_BLANK }, { ...opts, skuId: 'S1' })).not.toThrow();
  });
});

describe('markSkuCsaReceived / answerCsaReport', () => {
  it('flags only the reported SKU', () => {
    const out = markSkuCsaReceived(SALES.skus, 'S1');
    expect(out[0].csa_received).toBe('Yes');
    expect(out[1].csa_received).toBeUndefined();
  });
  it('is a no-op for a direct report with no SKU', () => {
    expect(markSkuCsaReceived(SALES.skus, '')).toEqual(SALES.skus);
  });
  it('records the plant answer and clears the re-review flag', () => {
    const out = answerCsaReport([{ id: 'R1', needs_pm_review: true }], 'R1', { comments: 'Runs fine', plates: { ci_per: 100, ci_n: 2 }, user: 'pm1' });
    expect(out[0]).toMatchObject({ plant_comments: 'Runs fine', needs_pm_review: false, status: 'Pending QC', plant_answered_by: 'pm1' });
  });
  it('leaves other reports alone', () => {
    const out = answerCsaReport([{ id: 'R1' }, { id: 'R2' }], 'R1', { comments: 'x' });
    expect(out[1].plant_comments).toBeUndefined();
  });
});

/* ─────────────────────────── screens ─────────────────────────── */

const jss = [{ spec: 'SP-1', jobName: 'Pouch A', mic: 51, width: 120, height: 200 }];
const mods = () => ({ sales: JSON.parse(JSON.stringify(SALES)), jss, capa: [], oab: { OAB: { SF: [], OT: [] }, INV_REG: [], lastSO: { y: '26', n: 1 }, lastInvNo: 1 } });

describe('QC — CSA tab', () => {
  const openCsa = async () => {
    const r = renderApp(<QC />, { modules: mods(), role: 'qc' });
    await userEvent.click(await screen.findByText(/CSA Reports/));
    return r;
  };

  it('lists samples the rep has sent and QC has not yet reported', async () => {
    await openCsa();
    await waitFor(() => expect(screen.getByText('Pouch A')).toBeInTheDocument());
    expect(screen.queryByLabelText('Add CSA report for Pouch B')).not.toBeInTheDocument();
  });

  it('saves a report and marks the SKU as analysed', async () => {
    const { saved } = await openCsa();
    await userEvent.click(await screen.findByLabelText('Add CSA report for Pouch A'));
    await userEvent.selectOptions(screen.getByLabelText('Substrate 1'), 'PET');
    await userEvent.type(screen.getByLabelText('Substrate 1 value'), '12');
    await userEvent.click(screen.getByText(/Save CSA report/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const blob = saved.filter((s) => s.key === 'sales').pop().data;
    expect(blob.qc_reports).toHaveLength(2);
    const r = blob.qc_reports[1];
    expect(r).toMatchObject({ sku_id: 'S1', lead_id: 'L1', substrate1: 'PET', substrate1_val: 12, status: 'Pending Plant' });
    expect(blob.skus.find((s) => s.id === 'S1').csa_received).toBe('Yes');
  });

  it('a direct report refuses to save without its own identity fields', async () => {
    const { saved } = await openCsa();
    await userEvent.click(screen.getByText(/Direct CSA report/));
    await userEvent.click(screen.getByText(/Save CSA report/));
    expect(screen.getByText(/Company is required/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });

  it('shows the substrate unit for the chosen material', async () => {
    await openCsa();
    await userEvent.click(await screen.findByLabelText('Add CSA report for Pouch A'));
    await userEvent.selectOptions(screen.getByLabelText('Substrate 1'), 'Paper');
    expect(screen.getByText('Value (GSM)')).toBeInTheDocument();
  });
});

describe('PM — CSA tab', () => {
  const openCsa = async () => {
    const r = renderApp(<PM />, { modules: mods(), role: 'pm' });
    await userEvent.click(await screen.findByText(/CSA/));
    return r;
  };

  it('lists reports awaiting a plant comment', async () => {
    await openCsa();
    await waitFor(() => expect(screen.getByText('Acme Foods')).toBeInTheDocument());
    expect(screen.getByText('PET/AF LDPE')).toBeInTheDocument();
  });

  it('records comments and plate cost back to the report', async () => {
    const { saved } = await openCsa();
    await userEvent.click(await screen.findByLabelText('Answer CSA for Pouch C'));
    await userEvent.type(screen.getByLabelText('Plant comments'), 'Runs at 180 m/min');
    await userEvent.type(screen.getByLabelText('CI per plate'), '1200');
    await userEvent.type(screen.getByLabelText('CI plates'), '4');
    // Text is split across nodes by JSX interpolation, so match on the element.
    expect(screen.getByText((_t, el) => /Total plate cost:\s*₹4,800/.test(el?.textContent || ''), { selector: 'span' })).toBeTruthy();
    await userEvent.click(screen.getByText(/Submit to QC/));

    await waitFor(() => expect(saved.some((s) => s.key === 'sales')).toBe(true));
    const r = saved.filter((s) => s.key === 'sales').pop().data.qc_reports[0];
    expect(r).toMatchObject({ plant_comments: 'Runs at 180 m/min', status: 'Pending QC', needs_pm_review: false });
    expect(r.plates).toMatchObject({ ci_per: '1200', ci_n: '4' });
  });

  it('refuses to submit an empty comment', async () => {
    const { saved } = await openCsa();
    await userEvent.click(await screen.findByLabelText('Answer CSA for Pouch C'));
    await userEvent.click(screen.getByText(/Submit to QC/));
    expect(screen.getByText(/Enter your comments/)).toBeInTheDocument();
    expect(saved.some((s) => s.key === 'sales')).toBe(false);
  });
});

describe('Purchase — overdue nudges', () => {
  const daysAgo = (n) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const purchase = (pos) => ({ purchase: { asl: [], pos, priceHistory: [] } });

  it('warns about open POs past their expected delivery, most overdue first', async () => {
    renderApp(<Purchase />, {
      modules: purchase([
        { poNum: 'PO-1', supplier: 'Acme', expectedDelivery: daysAgo(3), items: [] },
        { poNum: 'PO-2', supplier: 'Beta', expectedDelivery: daysAgo(10), items: [] },
      ]),
      role: 'purchase',
    });
    const banner = await screen.findByLabelText('Overdue purchase orders');
    expect(within(banner).getByText('2')).toBeInTheDocument();
    expect(banner.textContent.indexOf('PO-2')).toBeLessThan(banner.textContent.indexOf('PO-1'));
    expect(banner.textContent).toMatch(/10d late/);
  });

  it('says nothing when no PO is late, and ignores closed ones', async () => {
    renderApp(<Purchase />, {
      modules: purchase([
        { poNum: 'PO-3', supplier: 'Acme', expectedDelivery: daysAgo(-5), items: [] },
        { poNum: 'PO-4', supplier: 'Beta', expectedDelivery: daysAgo(30), closed: true, items: [] },
      ]),
      role: 'purchase',
    });
    await screen.findByText('Purchase');
    expect(screen.queryByLabelText('Overdue purchase orders')).not.toBeInTheDocument();
  });
});
