import { describe, it, expect } from 'vitest';
import { screen, fireEvent, waitFor, within } from '@testing-library/react';
import { renderApp, oabModule } from './harness.jsx';
import OabBoard from '../pages/OabBoard.jsx';

// Client, 2026-09-02: "once I select a particular customer or a group, then the spec
// number should be filtered based on the group and customer selection" and "There
// should be a filter by group also here".
//
// The board had no Group filter at all, and its Customer and Spec lists were built
// from every open order — so after choosing a customer the Spec box still offered
// every spec in the business, most of which that customer has never ordered.

const customers = [
  { customer: 'Acme Foods', group: 'ACME GROUP' },
  { customer: 'Acme Beverages', group: 'ACME GROUP' },
  { customer: 'Nandi Dairy', group: 'NANDI' },
];
const jss = [
  { spec: 'A1', dispatchForm: 'Pouch', width: 300, customer: 'Acme Foods' },
  { spec: 'A2', dispatchForm: 'Pouch', width: 300, customer: 'Acme Beverages' },
  { spec: 'N1', dispatchForm: 'Pouch', width: 200, customer: 'Nandi Dairy' },
];
const rows = [
  { so: '26/1', spec: 'A1', customer: 'Acme Foods', jobName: 'Pouch A', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' },
  { so: '26/2', spec: 'A2', customer: 'Acme Beverages', jobName: 'Pouch B', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' },
  { so: '26/3', spec: 'N1', customer: 'Nandi Dairy', jobName: 'Pouch C', dispatchForm: 'Pouch', poQty: 1000, invDisp: 0, manDisp: 0, fg: 0, poDate: '2026-08-01' },
];

const mount = () => renderApp(<OabBoard />, {
  modules: { oab: oabModule({ SF: rows }), jss, customers }, route: '/oab?sheet=SF',
});
const values = (sel) => [...sel.options].slice(1).map((o) => o.value);   // skip the "All …" option

describe('OAB board — filter by group, and narrow what follows', () => {
  it('offers a Group filter built from the Customer Master', async () => {
    mount();
    await screen.findByText('Pouch A');
    const group = screen.getByLabelText('Filter by group');
    expect(values(group)).toEqual(['ACME GROUP', 'NANDI']);
  });

  it('narrows the customers and the specs to the chosen group', async () => {
    mount();
    await screen.findByText('Pouch A');
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: 'ACME GROUP' } });

    await waitFor(() => expect(values(screen.getByLabelText('Filter by customer'))).toEqual(['Acme Beverages', 'Acme Foods']));
    expect(values(screen.getByLabelText('Filter by spec'))).toEqual(['A1', 'A2']);
    expect(screen.queryByText('Pouch C')).toBeNull();      // Nandi's order is filtered out
  });

  it('narrows the specs again once a customer is chosen', async () => {
    mount();
    await screen.findByText('Pouch A');
    fireEvent.change(screen.getByLabelText('Filter by customer'), { target: { value: 'Acme Foods' } });

    await waitFor(() => expect(values(screen.getByLabelText('Filter by spec'))).toEqual(['A1']));
    expect(screen.getByText('Pouch A')).toBeInTheDocument();
    expect(screen.queryByText('Pouch B')).toBeNull();
  });

  it('drops a customer and spec that the newly chosen group cannot have', async () => {
    mount();
    await screen.findByText('Pouch A');
    fireEvent.change(screen.getByLabelText('Filter by customer'), { target: { value: 'Nandi Dairy' } });
    await waitFor(() => expect(screen.queryByText('Pouch A')).toBeNull());

    // Switching group must not leave "Nandi Dairy" selected under ACME GROUP,
    // which would show an empty board with two filters that contradict each other.
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: 'ACME GROUP' } });
    await waitFor(() => expect(screen.getByLabelText('Filter by customer')).toHaveValue(''));
    expect(screen.getByLabelText('Filter by spec')).toHaveValue('');
    expect(screen.getByText('Pouch A')).toBeInTheDocument();
  });

  it('groups a customer under its own name when the master gives it no group', async () => {
    renderApp(<OabBoard />, {
      modules: { oab: oabModule({ SF: rows }), jss, customers: [] }, route: '/oab?sheet=SF',
    });
    await screen.findByText('Pouch A');
    // No Customer Master: each customer stands as its own group rather than the
    // filter coming up empty.
    expect(values(screen.getByLabelText('Filter by group'))).toEqual(['Acme Beverages', 'Acme Foods', 'Nandi Dairy']);
  });

  it('still filters the rows themselves by group, not just the dropdowns', async () => {
    mount();
    await screen.findByText('Pouch A');
    fireEvent.change(screen.getByLabelText('Filter by group'), { target: { value: 'NANDI' } });
    await waitFor(() => expect(screen.getByText('Pouch C')).toBeInTheDocument());
    expect(screen.queryByText('Pouch A')).toBeNull();
    expect(screen.queryByText('Pouch B')).toBeNull();
  });
});
