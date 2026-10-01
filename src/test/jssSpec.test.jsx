import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, within, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import QC from '../pages/QC.jsx';
import {
  isStayFreshJobType, sheetForJobType, isLaminateJobType, layerCountFor, JOB_TYPE_DEFAULTS,
  materialOptions, specialtyOptions, micronOptions, filmWidthOptions, materialFromLayers,
  layerFields, layersOfSpec, gussetParts, gussetJoin, specItems,
  micronValue, micronFromName, micronChoices, micronChoiceHint, itemsForLayer, widthsForLayer,
} from '../lib/jssSpec.js';
import { segmentOf } from '../lib/salesHistory.js';

// JSS + QC LOGIN, 24 Sep 2026 — the job type becomes a list, the material becomes
// the Item Master, and QC types nothing but the Job Name.

const ITEMS = [
  { code: 'BLM1', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: 'ANTIFOG', microns: '12', widthMm: 600, uom: 'Kg' },
  { code: 'BLM2', name: '700 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: 'ANTIFOG', microns: '15', widthMm: 700, uom: 'Kg' },
  { code: 'BLM3', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: 'PLAIN', microns: '12', widthMm: 600, uom: 'Kg' },
  { code: 'BLM4', name: '700 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: '', microns: '40', widthMm: 700, uom: 'Kg' },
  { code: 'BLM5', name: '450 MM', materialType: 'PAPER', subGroup: 'KRAFT', specialtyName: '', microns: '60', widthMm: 450, uom: 'Kg' },
  // not a film or a paper — never offered on a JSS
  { code: 'BLM6', name: '1018 RK', materialType: 'GRANULES', subGroup: 'METALLOCENE', specialtyName: '', microns: '', widthMm: 0, uom: 'Kg' },
  { code: 'BLM7', name: 'BLUE', materialType: 'INK', subGroup: 'FLEXO', specialtyName: '', microns: '', widthMm: 0, uom: 'Kg' },
];

describe('job types decide the OAB sheet', () => {
  it('sends the four SF types to Stay Fresh and everything else to Others', () => {
    ['SF Pouch', 'SF Pouch + Tape', 'SF Lidding Film', 'SF Lami Pouch + Zipper'].forEach((t) => {
      expect(isStayFreshJobType(t)).toBe(true);
      expect(sheetForJobType(t)).toBe('SF');
    });
    ['Courier Bags', 'Milk Roll', 'Lami Roll', 'Shrink Sleeves', 'IML Labels', 'Ice Cream Cone'].forEach((t) => {
      expect(isStayFreshJobType(t)).toBe(false);
      expect(sheetForJobType(t)).toBe('OT');
    });
    // the value every spec carried before the list existed still counts
    expect(isStayFreshJobType('StayFresh')).toBe(true);
    expect(isStayFreshJobType('')).toBe(false);
    // a name that merely starts with the letters SF is not an SF type
    expect(isStayFreshJobType('SFX Roll')).toBe(false);
  });

  it('is the same rule the Stay Fresh sale report segments by', () => {
    expect(segmentOf('SF Lidding Film')).toBe('stayfresh');
    expect(segmentOf('Lami Pouch')).toBe('domestic');
    expect(segmentOf('')).toBe('unknown');
  });

  it('unlocks the second and third layer only for a laminate', () => {
    ['SF Lami Pouch + Zipper', 'Lami Roll', 'Lami Pouch', 'Lami Pouch + Zipper', 'Ice Cream Cone'].forEach((t) => {
      expect(isLaminateJobType(t)).toBe(true);
      expect(layerCountFor(t)).toBe(3);
    });
    ['SF Pouch', 'Milk Roll', 'Paper Labels'].forEach((t) => {
      expect(isLaminateJobType(t)).toBe(false);
      expect(layerCountFor(t)).toBe(1);
    });
    expect(JOB_TYPE_DEFAULTS).toHaveLength(17);
  });
});

describe('the material comes from the Item Master, and each pick narrows the next', () => {
  it('offers only film and paper', () => {
    expect(specItems(ITEMS).map((i) => i.code)).toEqual(['BLM1', 'BLM2', 'BLM3', 'BLM4', 'BLM5']);
    expect(materialOptions(ITEMS)).toEqual(['CC PET', 'KRAFT', 'LDPE - NATURAL']);
  });

  it('limits the speciality and the micron to what that material has', () => {
    expect(specialtyOptions(ITEMS, 'CC PET')).toEqual(['ANTIFOG', 'PLAIN']);
    expect(specialtyOptions(ITEMS, 'LDPE - NATURAL')).toEqual([]);
    expect(specialtyOptions(ITEMS, '')).toEqual([]);
    // every micron of CC PET, then only ANTIFOG's
    expect(micronOptions(ITEMS, 'CC PET')).toEqual(['12', '15']);
    expect(micronOptions(ITEMS, 'CC PET', 'PLAIN')).toEqual(['12']);
    expect(micronOptions(ITEMS, 'CC PET', 'ANTIFOG')).toEqual(['12', '15']);
  });

  // §23 — "I have a 600 mm item in CC PET whereas I do not have a 600 mm item for
  // LDPE natural, then the QC will get in touch with the super admin"
  it('offers only the widths EVERY layer is stocked in, and names the ones that are short', () => {
    const one = filmWidthOptions(ITEMS, [{ material: 'CC PET' }]);
    expect(one.widths).toEqual([600, 700]);
    expect(one.partial).toEqual([]);

    const two = filmWidthOptions(ITEMS, [{ material: 'CC PET' }, { material: 'LDPE - NATURAL' }]);
    expect(two.widths).toEqual([700]);                       // both have 700
    expect(two.partial).toEqual([{ width: 600, missing: ['LDPE - NATURAL'] }]);

    expect(filmWidthOptions(ITEMS, []).widths).toEqual([]);
  });

  it('composes the layers into the one Material string the rest of the tool reads', () => {
    const layers = [
      { material: 'CC PET', specialty: 'ANTIFOG', microns: '12' },
      { material: 'LDPE - NATURAL', specialty: '', microns: '40' },
      { material: '', specialty: '', microns: '' },
    ];
    expect(materialFromLayers(layers)).toBe('CC PET + LDPE - NATURAL');
    const f = layerFields(layers);
    expect(f).toMatchObject({
      material: 'CC PET + LDPE - NATURAL', mic: '12',
      material1: 'CC PET', specialty1: 'ANTIFOG', microns1: '12',
      material2: 'LDPE - NATURAL', microns2: '40', material3: '',
    });
    expect(f.structure).toBe('CC PET · ANTIFOG · 12 mic  +  LDPE - NATURAL · 40 mic');
  });

  it('opens an old spec on what it actually says', () => {
    // a spec saved before the layers existed carries only the composed text
    expect(layersOfSpec({ material: 'CC PET + LDPE', mic: '12' })[0]).toEqual({ material: 'CC PET', specialty: '', microns: '12' });
    // one saved since opens on its own layers
    expect(layersOfSpec({ material1: 'KRAFT', specialty1: '', microns1: '60' })[0].material).toBe('KRAFT');
  });

  it('keeps the gusset as two panels with a static +', () => {
    expect(gussetParts('20+20')).toEqual({ a: '20', b: '20' });
    expect(gussetParts('40')).toEqual({ a: '40', b: '' });
    expect(gussetJoin('20', '20')).toBe('20+20');
    expect(gussetJoin('40', '')).toBe('40');
    expect(gussetJoin('', '')).toBe('');
  });
});

// 30.09 §QC (RED): the micron dropdown dead-ended — the client's GUSSET / AF BOPP
// items record no micron (or record "35 MIC"), so the exact list was empty.
describe('microns — normalised, read from the name, and never an empty list', () => {
  const MIC_ITEMS = [
    { code: 'L1', name: '450 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: 'GUSSET', microns: '', widthMm: 450 },
    { code: 'L2', name: '600 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: 'PLAIN', microns: '50', widthMm: 600 },
    { code: 'A1', name: '700 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: '35 MIC', widthMm: 700 },
    { code: 'A2', name: '500 MM', materialType: 'FILM', subGroup: 'AF BOPP', specialtyName: '', microns: ' 51 ', widthMm: 500 },
    { code: 'C1', name: '320 MM X 12 MIC', materialType: 'FILM', subGroup: 'CC PET', specialtyName: '', microns: '', widthMm: 320 },
    { code: 'K1', name: 'KRAFT 450', materialType: 'PAPER', subGroup: 'KRAFT', specialtyName: '', microns: '', widthMm: 450 },
  ];

  it('micronValue keeps the number and drops the unit', () => {
    expect(micronValue('35 MIC')).toBe('35');
    expect(micronValue('35mic')).toBe('35');
    expect(micronValue(' 35 ')).toBe('35');
    expect(micronValue('12.5')).toBe('12.5');
    expect(micronValue(40)).toBe('40');
    expect(micronValue('NA')).toBe('');
    expect(micronValue('')).toBe('');
  });

  it('micronFromName reads "320 MM X 35 MIC" as 35, and nothing from a width alone', () => {
    expect(micronFromName('320 MM X 35 MIC')).toBe('35');
    expect(micronFromName('BOPP 20 micron film')).toBe('20');
    expect(micronFromName('12µ PET')).toBe('12');
    expect(micronFromName('700 MM')).toBe('');
    expect(micronFromName('')).toBe('');
  });

  it('specItems carries the normalised micron, falling back to the name', () => {
    const byCode = Object.fromEntries(specItems(MIC_ITEMS).map((i) => [i.code, i.microns]));
    expect(byCode).toEqual({ L1: '', L2: '50', A1: '35', A2: '51', C1: '12', K1: '' });
  });

  it('micronChoices widens one step at a time and says how far', () => {
    expect(micronChoices(MIC_ITEMS, 'LDPE - NATURAL', 'PLAIN')).toEqual({ options: ['50'], basis: 'item' });
    expect(micronChoices(MIC_ITEMS, 'LDPE - NATURAL', 'GUSSET')).toEqual({ options: ['50'], basis: 'material' });
    expect(micronChoices(MIC_ITEMS, 'AF BOPP', '')).toEqual({ options: ['35', '51'], basis: 'item' });
    expect(micronChoices(MIC_ITEMS, 'KRAFT', '')).toEqual({ options: ['12', '35', '50', '51'], basis: 'all' });
    expect(micronChoices(MIC_ITEMS.map((i) => ({ ...i, microns: '', name: 'X' })), 'KRAFT', '')).toEqual({ options: [], basis: 'none' });
    expect(micronChoices(MIC_ITEMS, '', '')).toEqual({ options: [], basis: 'none' });
    expect(micronChoiceHint('material', 'LDPE - NATURAL', 'GUSSET')).toMatch(/No micron is recorded on LDPE - NATURAL · GUSSET items — showing every LDPE - NATURAL micron/);
    expect(micronChoiceHint('item', 'LDPE - NATURAL', 'PLAIN')).toBe('');
  });

  it('a widened micron never empties the film widths of its layer', () => {
    // 50 is an LDPE - NATURAL micron, but no GUSSET item carries it
    expect(widthsForLayer(MIC_ITEMS, { material: 'LDPE - NATURAL', specialty: 'GUSSET', microns: '50' })).toEqual([450]);
    // an exact micron still narrows
    expect(widthsForLayer(MIC_ITEMS, { material: 'AF BOPP', specialty: '', microns: '35' })).toEqual([700]);
    expect(widthsForLayer(MIC_ITEMS, { material: 'AF BOPP', specialty: '', microns: '35 MIC' })).toEqual([700]);
    expect(itemsForLayer(MIC_ITEMS, { material: 'KRAFT', microns: '12' }).map((i) => i.code)).toEqual(['K1']);
  });

  it('the QC spec form offers the widened list under a note instead of "none recorded"', async () => {
    const user = userEvent.setup();
    renderApp(<QC />, { modules: { jss, customers, masterItems: MIC_ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    await user.selectOptions(await screen.findByLabelText('Primary Material'), 'LDPE - NATURAL');
    await user.selectOptions(screen.getByLabelText('Primary Speciality'), 'GUSSET');
    const mic = screen.getByLabelText('Primary Micron');
    expect(mic).not.toBeDisabled();
    expect([...mic.options].map((o) => o.value)).toEqual(['', '50']);
    expect(screen.getByText(/showing every LDPE - NATURAL micron/)).toBeInTheDocument();
    await user.selectOptions(mic, '50');
    // the width list is not emptied by a micron no GUSSET item carries
    expect([...screen.getByLabelText('Film Width (mm)').options].map((o) => o.value)).toContain('450');
  });
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const customers = [{ customer: 'Just Coco', group: 'COCO GROUP', dispatchLoc: 'Dharapuram' }];
const jss = [{ spec: 'A1', customer: 'Just Coco', group: 'COCO GROUP', subBrand: 'Just Coco', jobName: 'Old job', status: 'Active' }];

describe('QC — the spec form types nothing but the job name', () => {
  it('offers no way to add a customer, a group or a material', async () => {
    renderApp(<QC />, { modules: { jss, customers, masterItems: ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    const cust = await screen.findByLabelText('Customer');
    expect([...cust.options].map((o) => o.value)).toEqual(['', 'Just Coco']);   // no "＋ Add new customer…"
    expect([...screen.getByLabelText('Group').options].map((o) => o.value)).toEqual(['', 'COCO GROUP']);
    const mat = await screen.findByLabelText('Primary Material');
    expect([...mat.options].map((o) => o.value)).toEqual(['', 'CC PET', 'KRAFT', 'LDPE - NATURAL']);
    expect(screen.queryByLabelText('New customer name')).toBeNull();
    expect(screen.queryByLabelText('New material')).toBeNull();
    // 29.09 ¶19: "The options in sub-brand should be populated only after I select the
    // group and customer, and not before that." Empty until the customer is named —
    // otherwise one customer's sub-brand could be put on another customer's job.
    expect([...screen.getByLabelText('Sub Brand').options].map((o) => o.value)).toEqual(['']);
    fireEvent.change(cust, { target: { value: 'Just Coco' } });
    await waitFor(() => expect([...screen.getByLabelText('Sub Brand').options].map((o) => o.value)).toEqual(['', 'Just Coco']));
  });

  it('shows the second and third layer only for a laminate job type', async () => {
    const user = userEvent.setup();
    renderApp(<QC />, { modules: { jss, customers, masterItems: ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    await user.selectOptions(await screen.findByLabelText('Job Type'), 'SF Pouch');
    expect(screen.queryByLabelText('Secondary Material')).toBeNull();
    expect(screen.getByText(/Stay Fresh OAB/)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Job Type'), 'Lami Pouch');
    expect(await screen.findByLabelText('Secondary Material')).toBeInTheDocument();
    expect(screen.getByLabelText('Third Material')).toBeInTheDocument();
    expect(screen.getByText(/Others OAB · laminate/)).toBeInTheDocument();
  });

  it('narrows speciality, micron and film width — and says which width a layer is missing', async () => {
    const user = userEvent.setup();
    renderApp(<QC />, { modules: { jss, customers, masterItems: ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    await user.selectOptions(await screen.findByLabelText('Job Type'), 'Lami Pouch');
    await user.selectOptions(await screen.findByLabelText('Primary Material'), 'CC PET');
    expect([...screen.getByLabelText('Primary Speciality').options].map((o) => o.value)).toEqual(['', 'ANTIFOG', 'PLAIN']);
    await user.selectOptions(screen.getByLabelText('Primary Speciality'), 'PLAIN');
    expect([...screen.getByLabelText('Primary Micron').options].map((o) => o.value)).toEqual(['', '12']);

    // width: CC PET alone has 600
    expect([...screen.getByLabelText('Film Width (mm)').options].map((o) => o.value)).toContain('600');
    // add LDPE - NATURAL, which has no 600 — the width goes away and is explained
    await user.selectOptions(screen.getByLabelText('Secondary Material'), 'LDPE - NATURAL');
    const warn = await screen.findByLabelText('Film width not in every layer');
    expect(warn).toHaveTextContent('600 mm (missing in LDPE - NATURAL)');
    expect([...screen.getByLabelText('Film Width (mm)').options].map((o) => o.value)).not.toContain('600');
  });

  it('saves the layers, the composed material and the gusset panels', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<QC />, { modules: { jss, customers, masterItems: ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    await user.selectOptions(await screen.findByLabelText('Customer'), 'Just Coco');
    await user.type(screen.getByLabelText('Job Name'), 'Coconut water sleeve');
    await user.selectOptions(screen.getByLabelText('Dispatch Form'), 'Pouch');
    await user.selectOptions(screen.getByLabelText('Job Type'), 'Lami Pouch');
    await user.selectOptions(await screen.findByLabelText('Primary Material'), 'CC PET');
    await user.selectOptions(screen.getByLabelText('Primary Micron'), '15');
    await user.selectOptions(screen.getByLabelText('Secondary Material'), 'LDPE - NATURAL');
    await user.selectOptions(screen.getByLabelText('Film Width (mm)'), '700');
    await user.type(screen.getByLabelText('Gusset A'), '20');
    await user.type(screen.getByLabelText('Gusset B'), '20');
    await user.click(screen.getByRole('button', { name: /Add Spec/ }));

    const row = await vi.waitFor(() => {
      const w = saved.find((x) => x.id === 2);
      if (!w) throw new Error('not saved yet');
      return w.data.at(-1);
    });
    expect(row).toMatchObject({
      customer: 'Just Coco', jobName: 'Coconut water sleeve', jobType: 'Lami Pouch',
      material: 'CC PET + LDPE - NATURAL', material1: 'CC PET', microns1: '15', material2: 'LDPE - NATURAL',
      mic: '15', filmWidth: 700, gusset: '20+20',
    });
  });

  it('names the box that is still empty instead of one catch-all sentence', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<QC />, { modules: { jss, customers, masterItems: ITEMS }, role: 'qc' });
    await screen.findByText(/Add New Spec/);
    await user.click(screen.getByRole('button', { name: /Add Spec/ }));
    expect(await screen.findByText(/Still to choose: Customer, Job Name, Dispatch Form, Job Type, Primary Material/)).toBeInTheDocument();
    expect(saved.some((s) => s.id === 2)).toBe(false);
  });
});
