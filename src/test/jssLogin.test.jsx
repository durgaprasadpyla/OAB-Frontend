import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp, oabModule } from './harness.jsx';
import { DataProvider } from '../data.jsx';
import App from '../App.jsx';
import JssDesk from '../pages/JssDesk.jsx';
import Dashboard from '../pages/Dashboard.jsx';
import UsersAccess from '../components/UsersAccess.jsx';

// 30.09 §QC: "New login: ONLY the JSS editor functionality that exists in super admin.
// List of JSS, radio to enable editing. New user jss / jss123. One-time job for ~500
// JSSs." The editor is one component now (components/JssEditor.jsx); this login is
// that editor on its own page. Its two latent bugs are pinned here too, because the
// jss user would hit them on every one of those ~500 saves:
//   · a successful save reported "Save failed: setMaterialNew is not defined";
//   · the save's own module update wiped the selection, so the NEXT save wrote
//     rows[-1] — silently lost while the screen said saved.

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const MASTER = [
  { code: 'F1', name: '600 MM', materialType: 'FILM', subGroup: 'CC PET', specialtyName: 'ANTIFOG', microns: '12', widthMm: 600 },
  { code: 'F2', name: '600 MM', materialType: 'FILM', subGroup: 'LDPE - NATURAL', specialtyName: '', microns: '40', widthMm: 600 },
];
const JSS = [
  // composed material only — not yet built from the Item Master
  { spec: 'A1', customer: 'Acme', group: 'ACME', subBrand: 'Acme', jobName: 'Pouch one', jobType: 'SF Pouch', dispatchForm: 'Pouch', material: 'CC PET', status: 'Active' },
  // built from the Item Master
  { spec: 'A2', customer: 'Acme', group: 'ACME', jobName: 'Pouch two', jobType: 'SF Pouch', dispatchForm: 'Pouch', material: 'CC PET', material1: 'CC PET', status: 'Active' },
  // a primary layer, but a film the Item Master does not hold — still to do
  { spec: 'A3', customer: 'Acme', group: 'ACME', jobName: 'Pouch three', jobType: 'SF Pouch', dispatchForm: 'Pouch', material: 'BOPP', material1: 'BOPP', status: 'Active' },
];
const customers = [{ customer: 'Acme', group: 'ACME' }];
const oab = () => oabModule({ SF: [{ so: '26/1', spec: 'A1', customer: 'Acme', jobName: 'Pouch one', dispatchForm: 'Pouch', poQty: 100 }] });

// The jss login reads module 2 (write), 4 and 12 — never module 1 (or anything else).
const JSS_CANNOT_READ = { 1: true, 3: true, 5: true, 6: true, 7: true, 8: true, 9: true, 10: true, 11: true, 13: true };
const openDesk = (extra = {}) => renderApp(<JssDesk />, {
  modules: { jss: JSS, customers, sales: { dropdowns: {} }, oab: oab(), masterItems: MASTER, ...extra },
  role: 'jss', user: 'jss', forbidRead: JSS_CANNOT_READ,
});
const jssWrites = (saved) => saved.filter((s) => s.id === 2 && !s.endpoint);
const radio = (spec) => screen.getByRole('radio', { name: `Edit ${spec}` });

describe('the JSS login lands on the JSS editor and nothing else', () => {
  it('signs in to /jss with its own bar and no operations tabs', async () => {
    renderApp(<App />, { modules: { jss: JSS, customers, masterItems: MASTER }, role: 'jss', user: 'jss', route: '/', forbidRead: JSS_CANNOT_READ });
    expect(await screen.findByText(/Every JSS spec — pick one with its radio/)).toBeInTheDocument();
    expect(screen.getAllByText('JSS Editor').length).toBeGreaterThan(0);          // the role bar
    expect(screen.queryByText('New PO')).toBeNull();
    expect(screen.queryByText('Stay Fresh OAB')).toBeNull();
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
  });

  it('a typed URL to another screen bounces back to the editor', async () => {
    renderApp(<App />, { modules: { jss: JSS, customers, masterItems: MASTER }, role: 'jss', user: 'jss', route: '/dashboard', forbidRead: JSS_CANNOT_READ });
    expect(await screen.findByText(/Every JSS spec — pick one with its radio/)).toBeInTheDocument();
    expect(screen.queryByText('📊 Business Dashboard')).toBeNull();
  });

  it('the seeded jss / jss123 account must change its password first', async () => {
    renderApp(<App />, { modules: { jss: JSS }, role: 'jss', user: 'jss', route: '/', mustChangePassword: true });
    await waitFor(() => expect(screen.getByText(/Choose a new password/)).toBeInTheDocument());
    expect(screen.queryByText(/Every JSS spec/)).toBeNull();
  });
});

describe('the JSS editor — radio, edit, save', () => {
  it('lists every spec with a radio and opens the picked one in the QC fields', async () => {
    const user = userEvent.setup();
    openDesk();
    expect(await screen.findAllByRole('radio')).toHaveLength(3);
    expect(screen.getByText(/Pick a row below with its radio button/)).toBeInTheDocument();
    await user.click(radio('A1'));
    expect(screen.getByLabelText('Spec No.')).toHaveValue('A1');
    expect(screen.getByLabelText('Primary Material')).toHaveValue('CC PET');
    expect(screen.getByLabelText('Dispatch Form')).toHaveValue('Pouch');
  });

  it('says SAVED after a save, keeps the row picked, and a second save is written too', async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { saved } = openDesk();
    await user.click(await screen.findByRole('radio', { name: 'Edit A1' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'Sample');
    await user.click(screen.getByRole('button', { name: /^💾 Save spec$/ }));

    await waitFor(() => expect(jssWrites(saved)).toHaveLength(1));
    expect(jssWrites(saved)[0].data[0]).toMatchObject({ spec: 'A1', status: 'Sample', material1: 'CC PET', material: 'CC PET' });
    // the message is the success, not "Save failed: setMaterialNew is not defined"
    expect(await screen.findByText(/^✅ Spec A1 saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Save failed/)).toBeNull();
    // the row is still the one being edited, layers and all
    expect(radio('A1')).toBeChecked();
    expect(screen.getByText(/Editing A1/)).toBeInTheDocument();
    expect(screen.getByLabelText('Primary Material')).toHaveValue('CC PET');

    // a second edit of the same row is written, not lost and not mistaken for a clash
    await user.selectOptions(screen.getByLabelText('Dispatch Form'), 'Roll');
    await user.click(screen.getByRole('button', { name: /^💾 Save spec$/ }));
    await waitFor(() => expect(jssWrites(saved)).toHaveLength(2));
    const second = jssWrites(saved)[1].data;
    expect(second).toHaveLength(3);
    expect(second[0]).toMatchObject({ spec: 'A1', status: 'Sample', dispatchForm: 'Roll' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('syncs the open orders through the server and never writes the order book itself', async () => {
    const user = userEvent.setup();
    const { saved, mods } = openDesk();
    await user.click(await screen.findByRole('radio', { name: 'Edit A1' }));
    await user.selectOptions(screen.getByLabelText('Dispatch Form'), 'Roll');
    await user.click(screen.getByRole('button', { name: /^💾 Save spec$/ }));

    await waitFor(() => expect(saved.some((s) => s.endpoint === '/api/oab-rows/sync-spec')).toBe(true));
    const call = saved.find((s) => s.endpoint === '/api/oab-rows/sync-spec');
    expect(call.body.specs).toEqual([{ spec: 'A1', customer: 'Acme', subBrand: 'Acme', jobName: 'Pouch one', dispatchForm: 'Roll', jobType: 'SF Pouch' }]);
    expect(mods.oab.OAB.SF[0].dispatchForm).toBe('Roll');                    // the order row followed
    expect(saved.some((s) => s.id === 1 && !s.endpoint)).toBe(false);       // no module-1 blob write
    expect(await screen.findByText(/1 order row synced/)).toBeInTheDocument();
  });
});

describe('the ~500-spec job — progress, the to-do filter, Save & next', () => {
  it('counts the specs built from the Item Master, and lists the rest on their own', async () => {
    const user = userEvent.setup();
    openDesk();
    const progress = await screen.findByLabelText('Structure progress');
    await waitFor(() => expect(progress).toHaveTextContent('1 of 3 specs have their structure from the Item Master'));
    await user.selectOptions(screen.getByLabelText('Status filter'), 'unstructured');
    const radios = screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'));
    expect(radios).toEqual(['Edit A1', 'Edit A3']);                       // A3's BOPP is not on the master
  });

  it('Save & next saves the spec and opens the next one in the list', async () => {
    const user = userEvent.setup();
    const { saved } = openDesk();
    await user.click(await screen.findByRole('radio', { name: 'Edit A1' }));
    await user.click(screen.getByRole('button', { name: /Save & next/ }));
    await waitFor(() => expect(jssWrites(saved)).toHaveLength(1));
    await waitFor(() => expect(radio('A2')).toBeChecked());
    expect(screen.getByLabelText('Spec No.')).toHaveValue('A2');
    expect(screen.getByText(/^✅ Spec A1 saved/)).toBeInTheDocument();
  });

  it('works through the to-do list: the saved spec drops out and the next to-do opens', async () => {
    const user = userEvent.setup();
    const { saved } = openDesk();
    const progress = await screen.findByLabelText('Structure progress');
    await waitFor(() => expect(progress).toHaveTextContent('1 of 3'));
    await user.selectOptions(screen.getByLabelText('Status filter'), 'unstructured');
    await user.click(radio('A1'));
    await user.click(screen.getByRole('button', { name: /Save & next/ }));
    await waitFor(() => expect(jssWrites(saved)).toHaveLength(1));
    await waitFor(() => expect(radio('A3')).toBeChecked());
    expect(screen.queryByRole('radio', { name: 'Edit A1' })).toBeNull();   // structured now — off the to-do list
    expect(progress).toHaveTextContent('2 of 3');

    // A3 is re-built from the Item Master and saved: the list is done
    await user.selectOptions(screen.getByLabelText('Primary Material'), 'LDPE - NATURAL');
    await user.click(screen.getByRole('button', { name: /Save & next/ }));
    await waitFor(() => expect(jssWrites(saved)).toHaveLength(2));
    expect(jssWrites(saved)[1].data[2]).toMatchObject({ spec: 'A3', material1: 'LDPE - NATURAL', material: 'LDPE - NATURAL' });
    await waitFor(() => expect(progress).toHaveTextContent('3 of 3'));
    expect(await screen.findByText(/That was the last spec in this list/)).toBeInTheDocument();
  });
});

describe('the Super Admin keeps the same editor', () => {
  it('the Dashboard tab saves without the false failure and keeps the row picked', async () => {
    const user = userEvent.setup();
    const { saved } = renderApp(<Dashboard />, {
      modules: { jss: JSS, customers, oab: oab(), prices: {}, sales: {}, masterItems: MASTER }, role: 'superadmin',
    });
    await user.click(await screen.findByText('📋 JSS Editor'));
    await user.click(await screen.findByRole('radio', { name: 'Edit A2' }));
    await user.selectOptions(screen.getByLabelText('Status'), 'Inactive');
    await user.click(screen.getByRole('button', { name: /^💾 Save spec$/ }));
    await waitFor(() => expect(jssWrites(saved)).toHaveLength(1));
    expect(await screen.findByText(/^✅ Spec A2 saved/)).toBeInTheDocument();
    expect(screen.queryByText(/Save failed/)).toBeNull();
    expect(radio('A2')).toBeChecked();
  });

  it('may open the JSS login page too', async () => {
    renderApp(<App />, { modules: { jss: JSS, customers, masterItems: MASTER }, role: 'superadmin', route: '/jss' });
    expect(await screen.findByText(/Every JSS spec — pick one with its radio/)).toBeInTheDocument();
  });
});

describe('Users & Access offers the JSS login', () => {
  it('creates a user with role jss', async () => {
    const user = userEvent.setup();
    localStorage.setItem('blm_token', 't');
    const posted = [];
    const res = (status, data) => ({ status, ok: status < 300, headers: { get: () => 'application/json' }, json: async () => data, text: async () => JSON.stringify(data) });
    globalThis.fetch = async (url, opts = {}) => {
      const u = String(url); const method = (opts.method || 'GET').toUpperCase();
      if (u.includes('/api/admin/users')) {
        if (method === 'POST') { const b = JSON.parse(opts.body); posted.push(b); return res(201, { id: 9, ...b }); }
        return res(200, []);
      }
      if (u.includes('/rest/v1/oab_data')) return res(200, []);
      return res(200, {});
    };
    render(<DataProvider><UsersAccess /></DataProvider>);
    const addCard = (await screen.findByText('Add User')).closest('.card');
    const roleSel = addCard.querySelector('select');
    expect([...roleSel.options].map((o) => o.value)).toContain('jss');
    expect([...roleSel.options].find((o) => o.value === 'jss').textContent).toBe('JSS Editor — edit JSS specs only');
    const inputs = addCard.querySelectorAll('input');
    await user.type(inputs[0], 'jss2');
    await user.type(inputs[1], 'jss12345');
    await user.selectOptions(roleSel, 'jss');
    await user.click(within(addCard).getByRole('button', { name: /Add User/ }));
    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toMatchObject({ username: 'jss2', role: 'jss' });
  });
});
