import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';

// Issues 4.1 — the client's four Stores / Padmin items.
//
//   1. "In Stores Login when I select an item code while making a GRN, I want the
//      material type, subgroup, and specialty to be prefilled automatically."
//   2. "When one parent roll is split into two child rolls … the total width should
//      not be more than the initial film width. There should be one more field for
//      the child rolls' weight, and the cumulative weight … should not be more than
//      the parent roll's weight."
//   3. "In Padmin login … the item description has the width. This width should be
//      one more field where it should be a numeric field and the unit of measurement
//      should be mm. Based on this width only, the allocation to the jobs and the
//      parent-child rule association are happening. Say I have a 1200 mm: I should be
//      able to cut it into 700 and 500 only. I should not be able to cut it into
//      700 and 600."

vi.mock('../lib/xlsx.js', () => ({ exportAOA: vi.fn(), exportObjects: vi.fn(), readSheet: vi.fn(async () => []) }));
vi.mock('../lib/pdf.js', () => ({ elementToPDF: vi.fn(async () => {}), printElement: vi.fn() }));

const res = (body) => ({ status: 200, ok: true, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });

const ITEMS = [
  { id: 43, code: 'BLM043', name: '435 MM', materialType: 'FILM', subGroup: 'PEARLISED BOPP',
    specialtyName: 'Surface', microns: '35', uom: 'Kg', widthMm: 435 },
  { id: 64, code: 'BLM064', name: '635 MM', materialType: 'FILM', subGroup: 'AF BOPP',
    specialtyName: 'Reverse', microns: '20', uom: 'Kg', widthMm: 635 },
  { id: 99, code: 'INK099', name: 'Cyan', materialType: 'INK', subGroup: 'Flexo',
    specialtyName: '', microns: '', uom: 'Kg' },
  // Codes are allocated BY width, so these are the widths a returned roll may be cut
  // to — the picker on the return screen offers exactly these.
  { id: 44, code: 'BLM044', name: '445 MM', materialType: 'FILM', subGroup: 'AF BOPP', uom: 'Kg', widthMm: 445 },
  { id: 20, code: 'BLM020', name: '200 MM', materialType: 'FILM', subGroup: 'AF BOPP', uom: 'Kg', widthMm: 200 },
];
const PURCHASE = {
  pos: [],
  asl: [
    { company: 'Cosmo Films Engineered', itemCode: 'BLM043', materialType: 'FILM', subGroup: 'PEARLISED BOPP', speciality: 'Surface' },
    { company: 'Cosmo Films Engineered', itemCode: 'BLM064', materialType: 'FILM', subGroup: 'AF BOPP', speciality: 'Reverse' },
    { company: 'Ink House', itemCode: 'INK099', materialType: 'INK', subGroup: 'Flexo' },
  ],
  itemsExtra: [],
};

// One 635 mm / 146 Kg roll on the floor — the roll from the client's screenshot.
const UNITS = [
  { id: 20, itemId: 64, internalCode: 'BLMU-20', uom: 'Kg', qtyReceived: 146, qtyRemaining: 146,
    widthMm: 635, location: 'A2', status: 'MOVING', receivedAt: '2026-09-01T00:00:00Z' },
];
const ON_HAND = [
  { id: 64, code: 'BLM064', name: '635 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: 'Reverse',
    microns: '20', uom: 'Kg', closingStock: 146, unitCount: 1, stockValue: 0, byStatus: {} },
];

let posted;
beforeEach(() => {
  posted = [];
  vi.doMock('../data.jsx', () => ({ useData: () => ({ mods: { purchase: PURCHASE }, save: vi.fn() }) }));
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if ((opts.method || 'GET') !== 'GET') { posted.push({ u, method: opts.method, body: JSON.parse(opts.body || '{}') }); return res({}); }
    if (u.includes('/api/master/items')) return res(ITEMS);
    if (u.includes('/api/master/departments')) return res([{ id: 1, name: 'Printing', active: true }]);
    if (u.includes('/api/master/uoms')) return res([{ id: 1, name: 'Kg' }]);
    if (u.includes('/api/stores/locations')) return res([{ id: 1, name: 'A2', active: true }]);
    if (u.includes('/units')) return res(UNITS);
    if (u.includes('/api/stores/on-hand')) return res(ON_HAND);
    if (u.includes('/api/stores/grns')) return res([]);
    if (u.includes('/api/stores/txns')) return res([]);
    return res([]);
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.resetModules(); });

/* ───────── 1 · picking an item code fills in what arrived ───────── */

describe('GRN — the item code fills in the material, sub-group and speciality', () => {
  async function openGrn() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('📥 GRN'));
    return screen.findByLabelText('Supplier');
  }

  it('leaves the three boxes on "any" until an item is chosen', async () => {
    await openGrn();
    expect(screen.getByLabelText('Material type filter').value).toBe('');
    expect(screen.getByLabelText('Sub group filter').value).toBe('');
    expect(screen.getByLabelText('Speciality filter').value).toBe('');
  });

  it('fills all three from the Item Master when the code is typed', async () => {
    const sup = await openGrn();
    await waitFor(() => expect([...sup.options].map((o) => o.value)).toContain('Cosmo Films Engineered'));
    fireEvent.change(sup, { target: { value: 'Cosmo Films Engineered' } });

    fireEvent.change(await screen.findByLabelText('Item for line 1'), { target: { value: 'BLM043' } });

    await waitFor(() => expect(screen.getByLabelText('Material type filter').value).toBe('FILM'));
    expect(screen.getByLabelText('Sub group filter').value).toBe('PEARLISED BOPP');
    expect(screen.getByLabelText('Speciality filter').value).toBe('Surface');
  });

  it('follows the item when a different code is chosen, rather than keeping the last one', async () => {
    const sup = await openGrn();
    await waitFor(() => expect([...sup.options].map((o) => o.value)).toContain('Cosmo Films Engineered'));
    fireEvent.change(sup, { target: { value: 'Cosmo Films Engineered' } });

    const line = await screen.findByLabelText('Item for line 1');
    fireEvent.change(line, { target: { value: 'BLM043' } });
    await waitFor(() => expect(screen.getByLabelText('Sub group filter').value).toBe('PEARLISED BOPP'));

    fireEvent.change(line, { target: { value: 'BLM064' } });
    await waitFor(() => expect(screen.getByLabelText('Sub group filter').value).toBe('AF BOPP'));
    expect(screen.getByLabelText('Speciality filter').value).toBe('Reverse');
  });
});

/* ───────── 2 · a slit roll cannot come back bigger than it went out ───────── */

describe('Issues & Returns — the split roll cannot exceed its parent', () => {
  async function openSplit() {
    const { default: Stores } = await import('../pages/Stores.jsx');
    render(<Stores />);
    fireEvent.click(await screen.findByText('🔄 Issues & Returns'));
    fireEvent.change(await screen.findByLabelText('Item'), { target: { value: '64' } });
    const roll = await screen.findByLabelText('Roll');
    await waitFor(() => expect([...roll.options].length).toBeGreaterThan(1));
    fireEvent.change(roll, { target: { value: '20' } });
    fireEvent.click(screen.getByLabelText('Returned as narrower rolls'));
    return screen.findByLabelText('Returned rolls 1');
  }
  const setRow = (i, { rolls, width, weight }) => {
    if (rolls !== undefined) fireEvent.change(screen.getByLabelText(`Returned rolls ${i}`), { target: { value: String(rolls) } });
    if (width !== undefined) fireEvent.change(screen.getByLabelText(`Returned width ${i}`), { target: { value: String(width) } });
    if (weight !== undefined) fireEvent.change(screen.getByLabelText(`Returned weight ${i}`), { target: { value: String(weight) } });
  };

  it('gives each returned roll its own weight box', async () => {
    await openSplit();
    expect(screen.getByLabelText('Returned weight 1')).toBeInTheDocument();
    expect(screen.getByText('Weight each *')).toBeInTheDocument();
  });

  it('shows the roll it was cut from with its width and its weight', async () => {
    await openSplit();
    expect(screen.getByText(/Cut from/)).toHaveTextContent('635 mm');
    expect(screen.getByText(/Cut from/)).toHaveTextContent('146');
  });

  it('refuses two 445 mm rolls off a 635 mm one', async () => {
    await openSplit();
    setRow(1, { rolls: 2, width: 445, weight: 70 });

    await waitFor(() => expect(screen.getByText(/wider than the roll they were cut from/)).toBeInTheDocument());
    fireEvent.click(screen.getByText('↙ Receive return'));
    await waitFor(() => expect(screen.getByText(/only 635 mm wide/)).toBeInTheDocument());
    expect(posted.filter((p) => p.u.includes('/returns')).length).toBe(0);
  });

  it('refuses child rolls that together weigh more than the parent', async () => {
    await openSplit();
    setRow(1, { rolls: 1, width: 435, weight: 100 });
    fireEvent.click(screen.getByText('＋ Another roll back'));
    setRow(2, { rolls: 1, width: 200, weight: 100 });

    fireEvent.click(screen.getByText('↙ Receive return'));
    await waitFor(() => expect(screen.getByText(/only weighed 146/)).toBeInTheDocument());
    expect(posted.filter((p) => p.u.includes('/returns')).length).toBe(0);
  });

  it('books a split that fits, one roll per sticker', async () => {
    await openSplit();
    setRow(1, { rolls: 2, width: 200, weight: 40 });     // 400 mm and 80 Kg — inside both caps
    fireEvent.click(screen.getByText('↙ Receive return'));

    await waitFor(() => expect(posted.filter((p) => p.u.includes('/returns')).length).toBe(1));
    const body = posted.find((p) => p.u.includes('/returns')).body;
    expect(body.children).toHaveLength(2);              // "2 rolls" books two units
    expect(body.children.every((c) => c.qty === 40 && c.widthMm === 200)).toBe(true);
  });

  it('says so rather than half-booking a row that is missing its weight', async () => {
    await openSplit();
    setRow(1, { rolls: 1, width: 435 });
    fireEvent.click(screen.getByText('↙ Receive return'));
    await waitFor(() => expect(screen.getByText(/half filled in/)).toBeInTheDocument());
    expect(posted.filter((p) => p.u.includes('/returns')).length).toBe(0);
  });
});

/* ───────── the description-derived width, and where it must NOT guess ───────── */

describe('widthFromName — a grade code is not a width', () => {
  // Checked against the live item master: without the boundary rule these 11 codes
  // were backfilled as widths. Kept in step with MasterDataService.widthFromName
  // and the SQL backfill in migrate-issues-4-1.sql.
  it('reads a width the description actually states', async () => {
    const { widthFromName } = await import('../lib/itemWidth.js');
    expect(widthFromName('435 MM')).toBe(435);
    expect(widthFromName('680 MM (AJ)')).toBe(680);
    expect(widthFromName('700')).toBe(700);
    expect(widthFromName('435MM')).toBe(435);
    expect(widthFromName('325 MM Paper Core')).toBe(325);
  });

  it('refuses a number that runs straight into something else', async () => {
    const { widthFromName } = await import('../lib/itemWidth.js');
    // real codes off the live master — grades, not widths
    ['1018MA', '1018MK', '8656MK', '1015RA', '1018RA', '1615M23M32', '806-SILVER']
      .forEach((n) => expect(widthFromName(n)).toBeNull());
    // compound dimensions: the leading number is not the slitting width
    expect(widthFromName('950x185x MM')).toBeNull();
    expect(widthFromName('800(150+150) MM')).toBeNull();
  });

  it('refuses a count, and anything with no number at all', async () => {
    const { widthFromName } = await import('../lib/itemWidth.js');
    expect(widthFromName('3 PLY LAMINATE')).toBeNull();   // below the 50 mm floor
    expect(widthFromName('TURBO MELT 8866')).toBeNull();
    expect(widthFromName('')).toBeNull();
    expect(widthFromName(null)).toBeNull();
  });
});

/* ───────── 3 · the Padmin Item Master's numeric width ───────── */

describe('Padmin Item Master — Width is a number, in mm', () => {
  async function openItemMaster() {
    const { default: PDashboard } = await import('../pages/PDashboard.jsx');
    render(<PDashboard />);
    fireEvent.click(await screen.findByText('🗂 Item Master'));
    return screen.findByLabelText('Item form Width (mm)');
  }

  it('offers a numeric width box with mm fixed beside it', async () => {
    const box = await openItemMaster();
    expect(box).toHaveAttribute('type', 'number');
    expect(box.parentElement).toHaveTextContent('mm');
  });

  it('reads the width out of the description as it is typed', async () => {
    const box = await openItemMaster();
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '1200 MM' } });
    await waitFor(() => expect(box.value).toBe('1200'));
  });

  it('never overwrites a width the Purchase Admin typed', async () => {
    const box = await openItemMaster();
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '1200 MM' } });
    await waitFor(() => expect(box.value).toBe('1200'));
    fireEvent.change(box, { target: { value: '1180' } });
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: '1200 MM (AJ)' } });
    expect(box.value).toBe('1180');
  });

  it('will not save a film item without one', async () => {
    await openItemMaster();
    fireEvent.change(screen.getByLabelText('Item form Description'), { target: { value: 'Pearlised roll' } });
    fireEvent.change(screen.getByLabelText('Item form Material Type'), { target: { value: 'FILM' } });
    fireEvent.click(screen.getByText('＋ Add Item'));
    await waitFor(() => expect(screen.getByText(/film rolls are allocated and slit by width/)).toBeInTheDocument());
  });
});
