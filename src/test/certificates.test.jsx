import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import { CertificateDoc } from '../components/CertificatePanel.jsx';
import {
  certKey, getCert, certStatus, certStruct, certJobName, certSO,
  certDefaultAttrs, certInitialData, certQty, attachCert, certLines,
} from '../lib/cert.js';

const JSS = [{ spec: 'SP-1', jobName: 'Pouch A', mic: 51, width: 120, height: 200 }];
const OAB_ROWS = {
  SF: [{ so: '26/500', spec: 'SP-1', poNum: 'PO-1' }, { so: '26/499', spec: 'SP-1', poNum: 'PO-OLD' }],
  OT: [],
};
const INV = {
  no: 'BFX/2026-27/001', date: '2026-08-10', customer: 'Acme Foods', po: 'PO-1',
  items: [{ spec: 'SP-1', qty: 5000, jobName: 'Pouch A' }],
};

describe('certKey / getCert / certStatus', () => {
  it('keys a certificate by type and spec', () => {
    expect(certKey('coa', 'SP-1')).toBe('coa|SP-1');
  });

  it('reads a saved certificate and reports per-line status', () => {
    const inv = { ...INV, certs: { 'coa|SP-1': { done: true, data: { batch: 'B1' } } } };
    expect(getCert(inv, 'coa', 'SP-1').data.batch).toBe('B1');
    expect(getCert(inv, 'fg', 'SP-1')).toBeNull();
    expect(certStatus(inv, 'SP-1')).toEqual({ coa: true, fg: false });
    expect(certStatus(INV, 'SP-1')).toEqual({ coa: false, fg: false });
  });
});

describe('spec-derived fields', () => {
  it('builds the structure line from the spec micron', () => {
    expect(certStruct(JSS, 'SP-1')).toBe('51 MIC');
    expect(certStruct(JSS, 'NOPE')).toBe('');
    expect(certStruct([{ spec: 'X', mic: '' }], 'X')).toBe('');
  });

  it('takes the job name from the spec master', () => {
    expect(certJobName(JSS, 'SP-1')).toBe('Pouch A');
    expect(certJobName(JSS, 'NOPE')).toBe('');
  });

  it('prefers the SO matching the invoice PO, then falls back to any', () => {
    expect(certSO(OAB_ROWS, 'SP-1', 'PO-1')).toBe('26/500');
    expect(certSO(OAB_ROWS, 'SP-1', 'PO-OLD')).toBe('26/499');
    // Unknown PO -> still return a sensible SO rather than a blank certificate.
    expect(certSO(OAB_ROWS, 'SP-1', 'PO-GONE')).toBe('26/500');
    expect(certSO(OAB_ROWS, 'NOPE', 'PO-1')).toBe('');
    expect(certSO(undefined, 'SP-1')).toBe('');
  });
});

describe('certDefaultAttrs', () => {
  it('seeds dimensions with their tolerances and observed values', () => {
    const a = certDefaultAttrs(JSS, 'SP-1');
    expect(a[0]).toEqual({ name: 'Pouch Width (mm)', std: '120 ± 2', obs: '120' });
    expect(a[1]).toEqual({ name: 'Pouch Height (mm)', std: '200 ± 2', obs: '200' });
  });

  it('always includes the fixed lab attributes', () => {
    expect(certDefaultAttrs(JSS, 'SP-1').map((x) => x.name)).toEqual([
      'Pouch Width (mm)', 'Pouch Height (mm)', 'Sealing width (mm)',
      'Seal Strength (gm/25 mm)', 'COF', 'Perforation Size',
    ]);
  });

  it('leaves dimension rows blank for an unknown spec', () => {
    const a = certDefaultAttrs([], 'NOPE');
    expect(a[0]).toEqual({ name: 'Pouch Width (mm)', std: '', obs: '' });
  });
});

describe('certInitialData', () => {
  const args = { invoice: INV, item: INV.items[0], spec: 'SP-1', jss: JSS, oab: OAB_ROWS };

  it('derives a fresh COA from the invoice, spec master and OAB', () => {
    const d = certInitialData({ ...args, type: 'coa' });
    expect(d).toMatchObject({ date: '2026-08-10', job: 'Pouch A', so: '26/500', struct: '51 MIC' });
    expect(d.attrs).toHaveLength(6);
  });

  it('a Food Grade certificate carries no attributes', () => {
    expect(certInitialData({ ...args, type: 'fg' }).attrs).toBeUndefined();
  });

  it('a saved certificate wins over the derived defaults', () => {
    const inv = { ...INV, certs: { 'coa|SP-1': { data: { batch: 'B9', so: 'MANUAL', attrs: [{ name: 'Only', std: '', obs: '' }] } } } };
    const d = certInitialData({ ...args, invoice: inv, type: 'coa' });
    expect(d.so).toBe('MANUAL');
    expect(d.batch).toBe('B9');
    expect(d.attrs).toEqual([{ name: 'Only', std: '', obs: '' }]);
  });

  it('a blank saved field falls back to the derived value', () => {
    const inv = { ...INV, certs: { 'coa|SP-1': { data: { so: '' } } } };
    expect(certInitialData({ ...args, invoice: inv, type: 'coa' }).so).toBe('26/500');
  });
});

describe('certQty', () => {
  it('prefers the line quantity, falling back to the invoice', () => {
    expect(certQty(INV, INV.items[0])).toBe(5000);
    expect(certQty({ qty: 90 }, {})).toBe(90);
    expect(certQty({}, {})).toBe(0);
  });
});

describe('attachCert', () => {
  const mod = { INV_REG: [INV, { no: 'OTHER', items: [] }] };

  it('attaches to the invoice identified by NUMBER, not position', () => {
    const out = attachCert(mod, 'BFX/2026-27/001', 'coa', 'SP-1', { batch: 'B1' });
    expect(out.INV_REG[0].certs['coa|SP-1']).toMatchObject({ done: true, data: { batch: 'B1' } });
    expect(out.INV_REG[0].certs['coa|SP-1'].savedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.INV_REG[1].certs).toBeUndefined();
  });

  it('keeps certificates already attached to the same invoice', () => {
    const first = attachCert(mod, 'BFX/2026-27/001', 'coa', 'SP-1', { batch: 'B1' });
    const second = attachCert(first, 'BFX/2026-27/001', 'fg', 'SP-1', { count: '3' });
    expect(Object.keys(second.INV_REG[0].certs).sort()).toEqual(['coa|SP-1', 'fg|SP-1']);
  });

  it('does not mutate the module it was given', () => {
    const before = JSON.parse(JSON.stringify(mod));
    attachCert(mod, 'BFX/2026-27/001', 'coa', 'SP-1', {});
    expect(mod).toEqual(before);
  });

  it('refuses when the invoice is no longer in the register', () => {
    // Better to fail loudly than to silently drop a certificate the QC team filled in.
    expect(() => attachCert(mod, 'GONE', 'coa', 'SP-1', {})).toThrow(/no longer in the register/);
  });
});

describe('certLines', () => {
  it('produces one row per invoice line, newest invoice first', () => {
    const lines = certLines({ INV_REG: [{ no: 'A', date: '2026-08-01', items: [{ spec: 'S1' }, { spec: 'S2' }] }, { no: 'B', date: '2026-08-09', items: [{ spec: 'S3' }] }] });
    expect(lines.map((l) => `${l.invNo}/${l.spec}`)).toEqual(['B/S3', 'A/S1', 'A/S2']);
  });

  it('handles a single-spec invoice with no items array', () => {
    const lines = certLines({ INV_REG: [{ no: 'A', spec: 'S1', qty: 10 }] });
    expect(lines).toHaveLength(1);
    expect(lines[0].spec).toBe('S1');
  });

  it('skips lines with no spec, and tolerates an empty register', () => {
    expect(certLines({ INV_REG: [{ no: 'A', items: [{ spec: '' }] }] })).toEqual([]);
    expect(certLines({})).toEqual([]);
  });
});

/* ─────────────────────────── screen ─────────────────────────── */

const modules = () => ({
  jss: JSON.parse(JSON.stringify(JSS)),
  oab: { OAB: JSON.parse(JSON.stringify(OAB_ROWS)), INV_REG: [JSON.parse(JSON.stringify(INV))], lastSO: { y: '26', n: 500 }, lastInvNo: 1 },
  capa: [],
});

const openCerts = async () => {
  const r = renderApp(<QC />, { modules: modules(), role: 'qc' });
  await userEvent.click(await screen.findByText(/Certificates/));
  return r;
};

describe('QC Certificates screen', () => {
  it('lists invoiced lines with their certificate status', async () => {
    await openCerts();
    await waitFor(() => expect(screen.getByText('BFX/2026-27/001')).toBeInTheDocument());
    expect(screen.getAllByText('Acme Foods').length).toBeGreaterThan(0);
    expect(screen.getByText('5,000')).toBeInTheDocument();
  });

  it('opens a COA prefilled from the invoice and spec', async () => {
    await openCerts();
    await userEvent.click(await screen.findByLabelText('COA for BFX/2026-27/001 SP-1'));
    expect(screen.getByLabelText('Job Name')).toHaveValue('Pouch A');
    expect(screen.getByLabelText('SO Number')).toHaveValue('26/500');
    expect(screen.getByLabelText('Structure')).toHaveValue('51 MIC');
    expect(screen.getByLabelText('Attribute 1 standard')).toHaveValue('120 ± 2');
  });

  it('saves a COA onto the invoice in module 1', async () => {
    const { saved } = await openCerts();
    await userEvent.click(await screen.findByLabelText('COA for BFX/2026-27/001 SP-1'));
    await userEvent.type(screen.getByLabelText('Batch No'), '2907A');
    await userEvent.click(screen.getByText(/Submit & attach/));

    await waitFor(() => expect(saved.some((s) => s.id === 1)).toBe(true));
    const reg = saved.filter((s) => s.id === 1).pop().data.INV_REG;
    const cert = reg[0].certs['coa|SP-1'];
    expect(cert.done).toBe(true);
    expect(cert.data.batch).toBe('2907A');
    expect(cert.data.attrs).toHaveLength(6);
  });

  it('shows the Food Grade declaration instead of attributes', async () => {
    await openCerts();
    await userEvent.click(await screen.findByLabelText('Food Grade for BFX/2026-27/001 SP-1'));
    expect(screen.getByText(/US FDA CFR TITLE 21.177.1520/)).toBeInTheDocument();
    expect(screen.getByText(/Number of Boxes/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Attribute 1 name')).not.toBeInTheDocument();
  });

  it('lets an attribute be added and removed', async () => {
    await openCerts();
    await userEvent.click(await screen.findByLabelText('COA for BFX/2026-27/001 SP-1'));
    await userEvent.click(screen.getByText('+ Add attribute'));
    expect(screen.getByLabelText('Attribute 7 name')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Remove attribute 7'));
    expect(screen.queryByLabelText('Attribute 7 name')).not.toBeInTheDocument();
  });
});

describe('CertificateDoc', () => {
  const line = { invNo: 'BFX/2026-27/001', invoice: INV, item: INV.items[0], spec: 'SP-1', customer: 'Acme Foods' };
  const data = { date: '2026-08-10', job: 'Pouch A', so: '26/500', dom: '01.08.2026', count: '5', struct: '51 MIC', batch: '2907A', attrs: [{ name: 'COF', std: '0.25 (Max)', obs: '0.20' }] };

  it('renders a COA with its attribute table', () => {
    render(<CertificateDoc line={line} type="coa" data={data} />);
    expect(screen.getByText('CERTIFICATE OF ANALYSIS')).toBeInTheDocument();
    expect(screen.getByText('2907A')).toBeInTheDocument();
    expect(screen.getByText('0.25 (Max)')).toBeInTheDocument();
    expect(screen.getByText('5,000 PCS')).toBeInTheDocument();
  });

  it('renders a Food Grade certificate with the compliance clauses', () => {
    render(<CertificateDoc line={line} type="fg" data={data} />);
    expect(screen.getByText('FOOD GRADE CERTIFICATE')).toBeInTheDocument();
    expect(screen.getByText(/21.175.170/)).toBeInTheDocument();
    expect(screen.queryByText('0.25 (Max)')).not.toBeInTheDocument();
  });

  it('omits attribute rows that have no name', () => {
    render(<CertificateDoc line={line} type="coa" data={{ ...data, attrs: [{ name: '', std: 'x', obs: 'y' }] }} />);
    expect(screen.queryByText('x')).not.toBeInTheDocument();
  });
});
