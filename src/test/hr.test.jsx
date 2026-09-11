import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import HR, { takeHomeOf, experienceText, netPayableOf } from '../pages/HR.jsx';
import { landingPath, canAccess, navTabs, ROLE_LABEL } from '../lib/roles.js';

// The HR module, rebuilt to the "HR MODULE" brief (2026-09): six tabs — Overview,
// Employee details, Salary & advances, Increments & Bonus, Leave details, Admin
// details — served live from /api/hr/**. The harness mirrors the backend contract.

vi.mock('../lib/attach.js', () => ({
  readAttachment: async (file) => ({ name: file.name, type: 'pdf', data: 'data:application/pdf;base64,QUJD', date: '2026-09-10' }),
  viewAttachment: () => {},
}));

const hrFixture = () => ({
  dashboard: { totalEmployees: 2, activeEmployees: 1 },
  employees: [
    { id: 1, empCode: 'E-001', fullName: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', departmentId: 10, department: 'Production',
      designationId: 20, designation: 'Supervisor', reportingManagerId: 3, reportingManager: 'Dev Manager', officialPhone: '040-123',
      workLocation: 'Unit 1', joiningDate: '2024-04-01', daysSinceJoining: 892, lastAppraisalDate: '2026-04-01', nextAppraisalDate: '2027-04-01',
      daysToNextAppraisal: 203, mobile: '9000000001', status: 'Active', leavesEntitled: 12, leavesTaken: 10, leavesRemaining: 2,
      salary: { ctc: 600000, monthlyCash: 5000, apb: 60000, apbPayoutCount: 1, apbMonth1: 10, esi: 0, pf: 21600, pt: 2400, insurance: 0, takeHome: 511000, effectiveFrom: '2024-04-01' },
      docs: { aadhaar: true, pan: false, previousEmployment: false, bankStatement: false },
      bankAccountName: 'Asha Rao', bankAccountNo: '1234567890', bankIfsc: 'HDFC0001', bankBranch: 'Kukatpally' },
    { id: 2, empCode: 'E-002', fullName: 'Bala K', firstName: 'Bala', lastName: 'K', departmentId: 10, department: 'Production', designationId: null, designation: null,
      joiningDate: '2025-01-15', status: 'Left', exitDate: '2026-08-31', leftReason: 'Absconding', salary: null, docs: {} },
    { id: 3, empCode: 'E-003', fullName: 'Dev Manager', firstName: 'Dev', lastName: 'Manager', departmentId: 11, department: 'QC', designationId: 21, designation: 'QC Manager',
      joiningDate: '2020-01-01', status: 'Active', leavesEntitled: 15, leavesRemaining: 15, salary: { ctc: 900000, takeHome: 800000, monthlyCash: 0, apb: 0 }, docs: {} },
  ],
  departments: [{ id: 10, name: 'Production', active: true }, { id: 11, name: 'QC', active: true }],
  designations: [
    { id: 20, title: 'Supervisor', departmentId: 10, departmentName: 'Production', active: true },
    { id: 21, title: 'QC Manager', departmentId: 11, departmentName: 'QC', active: true },
    { id: 22, title: 'Operator', departmentId: 10, departmentName: 'Production', active: true },
  ],
  leaveTypes: [{ id: 30, name: 'Casual Leave', defaultDays: 12, active: true }],
  leaveRequests: [
    { id: 100, employeeId: 1, employeeName: 'Asha Rao', empCode: 'E-001', leaveTypeName: 'Casual Leave', fromDate: '2026-09-01', toDate: '2026-09-03', days: 3, reason: 'Family', status: 'Pending', leavesRemaining: 2, lop: true },
  ],
  audit: [{ id: 1, createdAt: '2026-08-20T09:00:00', actor: 'hradmin', entityType: 'EMPLOYEE', entityId: 1, action: 'CREATE', details: { empCode: 'E-001' } }],
  documents: [{ id: 601, employeeId: 1, docType: 'Aadhaar', title: 'aadhaar.pdf', hasFile: true }],
  increments: [
    { employeeId: 1, empCode: 'E-001', fullName: 'Asha Rao', designationId: 20, designation: 'Supervisor', department: 'Production', joiningDate: '2024-04-01',
      joiningSalary: 480000, currentCtc: 600000, currentTakeHome: 511000, currentApb: 60000, currentCash: 5000, lastIncrementDate: '2026-04-01', lastIncrementAmount: 120000, nextIncrementDue: '2027-04-01', pendingIncrement: null },
  ],
  salaryHistory: [
    { id: 1, kind: 'JOINING', effectiveFrom: '2024-04-01', ctc: 480000, takeHome: 410000, apb: 48000, monthlyCash: 5000, incrementAmount: null },
    { id: 2, kind: 'INCREMENT', effectiveFrom: '2026-04-01', ctc: 600000, takeHome: 511000, apb: 60000, monthlyCash: 5000, incrementAmount: 120000 },
  ],
  bonus: [{ employeeId: 1, empCode: 'E-001', fullName: 'Asha Rao', department: 'Production', annualBonus: 50000, payoutMonth: 10, paid: 20000, pending: 30000, toBePaidOn: 'October' }],
  advances: [
    { id: 401, employeeId: 1, empCode: 'E-001', fullName: 'Asha Rao', currentTakeHome: 511000, amount: 100000, installments: 10, instalmentAmount: 10000, repaid: 30000, balance: 70000, balanceInstalments: 7, takenOn: '2026-05-01', status: 'Open' },
  ],
  payroll: {
    month: '2026-09', runId: null, status: 'Preview',
    lines: [
      { id: 1, employeeId: 1, empCode: 'E-001', fullName: 'Asha Rao', department: 'Production', designation: 'Supervisor', daysPresent: null, takeHome: 42583,
        cashPart: 5000, advanceDeduction: 10000, advanceSuggested: 10000, canteenDeduction: 0, pf: 1800, pt: 200, esi: 0, otherDeductions: 0, lopDays: 1, lopDeduction: 1419,
        bonusPending: 30000, bonusIncluded: 0, netPayable: 31164, edited: false, bankAccountName: 'Asha Rao', bankAccountNo: '1234567890', bankIfsc: 'HDFC0001', bankBranch: 'Kukatpally' },
    ],
  },
});

const openHR = async (opts = {}) => {
  const r = renderApp(<HR />, { role: 'hr', hr: hrFixture(), ...opts });
  await waitFor(() => expect(screen.getByText('Human Resources')).toBeInTheDocument());
  return r;
};
/** Click a workspace tab by its label, scoped to the tab strip. */
const tab = async (label) => {
  const strip = document.querySelector('.step-bar');
  const hit = [...strip.querySelectorAll('.step-tab')].find((el) => new RegExp(label).test(el.textContent));
  if (!hit) throw new Error('No HR tab matching ' + label);
  await userEvent.click(hit);
};

let exported;
beforeEach(() => {
  exported = [];
  window.XLSX = {
    utils: { aoa_to_sheet: (rows) => ({ rows }), book_new: () => ({}), book_append_sheet: (wb, ws) => { wb.ws = ws; }, sheet_to_json: () => [] },
    writeFile: (wb, name) => exported.push({ rows: wb.ws.rows, name }),
    read: () => ({ SheetNames: ['s'], Sheets: { s: {} } }),
  };
});
afterEach(() => vi.restoreAllMocks());

describe('HR role model', () => {
  it('lands the hr role on its own workspace', () => {
    expect(landingPath('hr')).toBe('/hr');
    expect(ROLE_LABEL.hr).toBe('HR');
  });
  it('opens /hr to hr and superadmin only', () => {
    expect(canAccess('hr', '/hr')).toBe(true);
    expect(canAccess('superadmin', '/hr')).toBe(true);
    ['user', 'padmin', 'qc', 'pm', 'plant', 'purchase', 'scrap'].forEach((r) => expect(canAccess(r, '/hr')).toBe(false));
  });
  it('keeps the hr role out of every operations screen', () => {
    ['/po', '/oab', '/daily', '/fg', '/invoice', '/dashboard', '/pdashboard', '/purchase'].forEach((p) => expect(canAccess('hr', p)).toBe(false));
    expect(navTabs('hr')).toEqual([]);
  });
  it('gives superadmin an HR tab alongside the ops tabs', () => {
    expect(navTabs('superadmin').some((t) => t.to === '/hr')).toBe(true);
    expect(navTabs('user').some((t) => t.to === '/hr')).toBe(false);
  });
});

describe('HR — the arithmetic the sheets rely on', () => {
  it('take-home = CTC − APB − monthly cash − ESI − PF − PT − insurance', () => {
    expect(takeHomeOf({ ctc: 100000, apb: 10000, monthlyCash: 5000, esi: 1000, pf: 2000, pt: 200, insurance: 800 })).toBe(81000);
    expect(takeHomeOf({ ctc: 1000, apb: 2000 })).toBe(0);   // never negative
  });
  it('net payable = take-home − advance − canteen − other − loss of pay + bonus', () => {
    expect(netPayableOf({ takeHome: 42583, advanceDeduction: 10000, canteenDeduction: 500, otherDeductions: 0, lopDeduction: 1419, bonusIncluded: 30000 })).toBe(60664);
  });
  it('states experience in years and months', () => {
    expect(experienceText('2024-04-01', '2026-08-31')).toBe('2 years 4 months');
    expect(experienceText('', '2026-08-31')).toBe('-');
  });
});

describe('HR — Overview', () => {
  it('lists only active employees, with their manager, location and appraisal dates', async () => {
    await openHR();
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.queryByText('Bala K')).toBeNull();                       // left the company
    const row = screen.getByText('Asha Rao').closest('tr');
    expect(within(row).getByText('Dev Manager')).toBeInTheDocument();      // reporting manager
    expect(within(row).getByText('Unit 1')).toBeInTheDocument();           // office location
    expect(within(row).getByText('040-123')).toBeInTheDocument();          // official phone
    expect(within(row).getByText('892 days')).toBeInTheDocument();         // days since joining
    expect(within(row).getByText(/in 203 days/)).toBeInTheDocument();      // next appraisal countdown
  });
  it('reports a permission problem plainly instead of showing empty tables', async () => {
    renderApp(<HR />, { role: 'user', hr: null });   // no fixture -> every HR call 403s
    await waitFor(() => expect(screen.getByText(/do not have permission/i)).toBeInTheDocument());
  });
});

describe('HR — Employee details', () => {
  it('lists the columns the brief asked for, with a tick where the Aadhaar is on file', async () => {
    await openHR();
    await tab('Employee details');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    const row = screen.getByText('Asha Rao').closest('tr');
    expect(within(row).getByText('Unit 1')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();                 // leaves remaining
    expect(within(row).getByText(/6,00,000/)).toBeInTheDocument();          // CTC
    expect(within(row).getByText(/5,11,000/)).toBeInTheDocument();          // take-home
    expect(within(row).getByLabelText('Aadhaar for Asha Rao')).toHaveTextContent('✓');
    expect(within(row).getByLabelText('PAN for Asha Rao')).toHaveTextContent('—');
  });

  it('brings the employee to the top for editing when the radio button is picked', async () => {
    await openHR();
    await tab('Employee details');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Select Asha Rao'));
    const form = await screen.findByText('Edit — Asha Rao');
    expect(form.compareDocumentPosition(screen.getByText('Asha Rao').closest('table')) & 4).toBeTruthy();   // form ABOVE the table
    expect(screen.getByLabelText('Employee ID')).toHaveValue('E-001');
    expect(screen.getByLabelText('Employee ID')).toBeDisabled();
    expect(screen.getByLabelText('CTC')).toHaveValue(600000);
    expect(screen.getByLabelText('Account number')).toHaveValue('1234567890');
    // designations narrow to Asha's department (Production): Supervisor + Operator, not QC Manager
    const desig = screen.getByLabelText('Designation');
    expect([...desig.options].map((o) => o.textContent)).toEqual(['—', 'Supervisor', 'Operator']);
  });

  it('creates an employee with an auto-generated ID and a salary whose take-home fills itself in', async () => {
    const { saved } = await openHR();
    await tab('Employee details');
    await userEvent.click(screen.getByText(/Add new employee/));
    expect(screen.getByLabelText('Employee ID')).toHaveAttribute('placeholder', 'auto-generated');
    await userEvent.type(screen.getByLabelText('First Name'), 'Chan');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Dev');
    await userEvent.selectOptions(screen.getByLabelText('Employment Type'), 'Permanent');
    await userEvent.selectOptions(screen.getByLabelText('Work Location'), 'Head Office');
    fireEvent.change(screen.getByLabelText('CTC'), { target: { value: '100000' } });
    fireEvent.change(screen.getByLabelText('APB'), { target: { value: '10000' } });
    fireEvent.change(screen.getByLabelText('Monthly cash'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('PF'), { target: { value: '2000' } });
    expect(screen.getByLabelText('Take-home')).toHaveValue(83000);
    await userEvent.click(screen.getByText(/Save Employee/));

    await waitFor(() => expect(screen.getByText(/Employee added as EMP-0004/)).toBeInTheDocument());
    const post = saved.find((s) => s.hrPath === 'employees' && s.method === 'POST');
    expect(post.body.empCode).toBeUndefined();                              // the server numbers it
    expect(post.body).toMatchObject({ firstName: 'Chan', lastName: 'Dev', employmentType: 'Permanent', workLocation: 'Head Office' });
    expect(post.body.salary).toMatchObject({ ctc: '100000', apb: '10000', monthlyCash: '5000', pf: '2000', takeHome: '83000', apbPayoutCount: 1 });
    expect(post.body.id).toBeUndefined();
    expect(post.body.docs).toBeUndefined();
  });

  it('surfaces a duplicate employee-code conflict from the server', async () => {
    await openHR();
    await tab('Employee details');
    await userEvent.click(screen.getByText(/Add new employee/));
    await userEvent.type(screen.getByLabelText('Employee ID'), 'E-001');   // already taken
    await userEvent.type(screen.getByLabelText('First Name'), 'Clash');
    await userEvent.click(screen.getByText(/Save Employee/));
    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    expect(screen.getByLabelText('Employee ID')).toHaveValue('E-001');
  });

  it('surfaces a server validation error when a required field is missing', async () => {
    await openHR();
    await tab('Employee details');
    await userEvent.click(screen.getByText(/Add new employee/));
    await userEvent.click(screen.getByText(/Save Employee/));
    await waitFor(() => expect(screen.getByText(/First name is required/i)).toBeInTheDocument());
  });

  it('uploads a document through the browse field and ticks the column', async () => {
    const { saved } = await openHR();
    await tab('Employee details');
    await waitFor(() => expect(screen.getByText('Dev Manager')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Select Dev Manager'));
    await screen.findByText('Edit — Dev Manager');
    const file = new File(['%PDF'], 'pan.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText('Browse PAN card'), file);
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/3/documents' && s.method === 'POST')).toBe(true));
    const post = saved.find((s) => s.hrPath === 'employees/3/documents');
    expect(post.body).toMatchObject({ docType: 'PAN', title: 'pan.pdf', data: 'data:application/pdf;base64,QUJD' });
    await waitFor(() => expect(within(screen.getByText('Dev Manager').closest('tr')).getByLabelText('PAN for Dev Manager')).toHaveTextContent('✓'));
  });
});

describe('HR — Salary & advances', () => {
  it('previews the month, creates the run, and recomputes a line as it is edited', async () => {
    const { saved } = await openHR();
    await tab('Salary & advances');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.getByText('Preview')).toBeInTheDocument();
    // the pending bonus is highlighted for inclusion
    expect(screen.getByLabelText('Bonus included for Asha Rao')).toHaveAttribute('title', expect.stringMatching(/30,000/));
    expect(screen.getByText('1 LOP day')).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Create salary run/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'payroll' && s.method === 'POST')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'payroll').body).toEqual({ month: '2026-09' });
    await waitFor(() => expect(screen.getByText('Draft')).toBeInTheDocument());

    const canteen = screen.getByLabelText('Canteen deduction for Asha Rao');
    fireEvent.change(canteen, { target: { value: '500' } });
    fireEvent.blur(canteen);
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'payroll/77/lines/1')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'payroll/77/lines/1').body).toEqual({ canteenDeduction: 500 });
    // 42,583 − 10,000 − 500 − 1,419 = 30,664
    await waitFor(() => expect(screen.getAllByText(/30,664/).length).toBeGreaterThan(0));
  });

  it('exports the bank sheet — account name, number, IFSC, branch, take-home', async () => {
    await openHR();
    await tab('Salary & advances');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Export bank Excel'));
    await waitFor(() => expect(exported.length).toBe(1));
    const [header, first] = exported[0].rows;
    expect(header).toEqual(['Employee ID', 'Employee name', 'Account name', 'Account number', 'IFSC code', 'Branch', 'Take-home salary']);
    expect(first).toEqual(['E-001', 'Asha Rao', 'Asha Rao', '1234567890', 'HDFC0001', 'Kukatpally', 31164]);
    expect(exported[0].name).toBe('Bank_Payments_2026-09.xlsx');
  });

  it('finalises a run and then refuses edits', async () => {
    const { saved } = await openHR();
    await tab('Salary & advances');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByText(/Create salary run/));
    await userEvent.click(await screen.findByText(/Finalise 2026-09/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'payroll/77/finalise')).toBe(true));
    await waitFor(() => expect(screen.getByText('Finalised')).toBeInTheDocument());
    expect(screen.getByLabelText('Canteen deduction for Asha Rao')).toBeDisabled();
  });

  it('records an advance and shows the balance instalments', async () => {
    const { saved } = await openHR();
    await tab('Salary & advances');
    await userEvent.click(screen.getByText('Advances'));
    await waitFor(() => expect(screen.getByLabelText('Balance instalments for Asha Rao')).toHaveTextContent('7'));   // 1,00,000 in 10, 30,000 repaid
    await userEvent.selectOptions(screen.getByLabelText('Employee'), '3');
    fireEvent.change(screen.getByLabelText('Advance taken'), { target: { value: '50000' } });
    fireEvent.change(screen.getByLabelText('To be repaid in (instalments)'), { target: { value: '5' } });
    expect(screen.getByText(/10,000.00 per month/)).toBeInTheDocument();
    await userEvent.click(screen.getByText(/Record advance/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'advances' && s.method === 'POST')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'advances').body).toMatchObject({ employeeId: '3', amount: 50000, installments: 5 });
    await waitFor(() => expect(screen.getByLabelText('Balance instalments for Dev Manager')).toHaveTextContent('5'));
  });
});

describe('HR — Increments & Bonus', () => {
  it('lists increments, edits one with an effective-from date, and shows the salary history', async () => {
    const { saved } = await openHR();
    await tab('Increments');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    const row = screen.getByText('Asha Rao').closest('tr');
    expect(within(row).getByText(/1,20,000/)).toBeInTheDocument();       // last increment amount
    await userEvent.click(screen.getByLabelText('Edit increment for Asha Rao'));
    await screen.findByText('Increment — Asha Rao');
    fireEvent.change(screen.getByLabelText('Revised CTC'), { target: { value: '660000' } });
    fireEvent.change(screen.getByLabelText('Revised Take-home'), { target: { value: '560000' } });
    fireEvent.change(screen.getByLabelText('Revised salary effective from'), { target: { value: '2026-10-01' } });
    await userEvent.click(screen.getByText(/💾 Save/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/1/increments')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'employees/1/increments').body).toMatchObject({ revisedCtc: 660000, revisedTakeHome: 560000, effectiveFrom: '2026-10-01' });

    await userEvent.click(screen.getByLabelText('Salary history for Asha Rao'));
    const dialog = await screen.findByRole('dialog', { name: 'Salary history' });
    await waitFor(() => expect(within(dialog).getByText('At joining')).toBeInTheDocument());
    expect(within(dialog).getByText('Increment 1')).toBeInTheDocument();
    expect(within(dialog).getByText(/\+₹1,20,000/)).toBeInTheDocument();
  });

  it('keeps the amount just typed when the payout month is chosen straight after', async () => {
    // Regression (found in the browser, 2026-09-10): the endpoint writes both fields,
    // and the month change was built from the row the list was LOADED with — so a
    // 50,000 bonus was overwritten with 0 the moment the month was picked.
    const { saved } = await openHR();
    await tab('Increments');
    await userEvent.click(screen.getByText('Bonus'));
    const amount = await screen.findByLabelText('Annual bonus for Asha Rao');
    fireEvent.change(amount, { target: { value: '75000' } });
    fireEvent.blur(amount);
    await waitFor(() => expect(saved.filter((s) => s.hrPath === 'employees/1/bonus').length).toBe(1));
    await userEvent.selectOptions(screen.getByLabelText('Bonus month for Asha Rao'), '12');
    await waitFor(() => expect(saved.filter((s) => s.hrPath === 'employees/1/bonus').length).toBe(2));
    expect(saved.filter((s) => s.hrPath === 'employees/1/bonus')[1].body).toEqual({ annualBonus: 75000, payoutMonth: 12 });
  });

  it('shows the bonus paid and pending, and saves the payout month', async () => {
    const { saved } = await openHR();
    await tab('Increments');
    await userEvent.click(screen.getByText('Bonus'));
    await waitFor(() => expect(screen.getByLabelText('Annual bonus for Asha Rao')).toHaveValue(50000));
    const row = screen.getByText('Asha Rao').closest('tr');
    expect(within(row).getByText(/20,000/)).toBeInTheDocument();          // paid
    expect(within(row).getByText(/30,000/)).toBeInTheDocument();          // pending
    await userEvent.selectOptions(screen.getByLabelText('Bonus month for Asha Rao'), '11');
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/1/bonus')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'employees/1/bonus').body).toEqual({ annualBonus: 50000, payoutMonth: 11 });
  });
});

describe('HR — Leave details', () => {
  it('shows leaves available, flags loss of pay, and approves a request', async () => {
    const { saved } = await openHR();
    await tab('Leave details');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    const row = screen.getByText('Asha Rao').closest('tr');
    expect(within(row).getByText('LOP')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Approve leave 100'));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'leave-requests/100/approve')).toBe(true));
  });

  it('counts the days, warns when the request exceeds the balance, and refuses a backwards range', async () => {
    await openHR();
    await tab('Leave details');
    await waitFor(() => expect(screen.getByLabelText('From')).toBeInTheDocument());
    await userEvent.selectOptions(screen.getByLabelText('Employee'), '1');   // Asha: 2 leaves left
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-03' } });
    expect(screen.getByText(/^3 days/)).toBeInTheDocument();                // inclusive of both ends
    expect(screen.getByText(/beyond the entitlement/)).toBeInTheDocument();   // 3 > 2 available
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-30' } });
    expect(screen.getByText(/Check the dates/)).toBeInTheDocument();
  });

  it('downloads the leave sheet for the reporting manager to sign', async () => {
    await openHR();
    await tab('Leave details');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Download leave sheet'));
    await waitFor(() => expect(exported.length).toBe(1));
    const [header, first] = exported[0].rows;
    expect(header).toContain('Reporting manager signature');
    expect(first).toEqual(['E-001', 'Asha Rao', 2, '2026-09-01', '2026-09-03', 3, 'Family', 'Yes', 'Pending', '']);
  });
});

describe('HR — Admin details', () => {
  it('marks an employee as left with the last working day, the reason and the experience', async () => {
    const { saved } = await openHR();
    await tab('Admin details');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Asha Rao left'));
    fireEvent.change(screen.getByLabelText('Last working day'), { target: { value: '2026-09-30' } });
    expect(screen.getByLabelText('Experience')).toHaveTextContent('2 years 5 months');
    await userEvent.click(screen.getByLabelText('Served notice period'));
    await userEvent.click(screen.getByText(/Confirm — mark as left/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/1/exit')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'employees/1/exit').body).toEqual({ left: true, lastWorkingDay: '2026-09-30', leftReason: 'Served notice period' });
    await waitFor(() => expect(screen.getByText(/marked as left on/)).toBeInTheDocument());
  });

  it('brings a left employee back to current, and keeps the audit trail at hand', async () => {
    const { saved } = await openHR();
    await tab('Admin details');
    await waitFor(() => expect(screen.getByText('Bala K')).toBeInTheDocument());
    expect(within(screen.getByText('Bala K').closest('tr')).getByText('Absconding')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Bala K current'));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/2/exit')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'employees/2/exit').body).toEqual({ left: false });
    await waitFor(() => expect(screen.getByText('hradmin')).toBeInTheDocument());
    expect(screen.getByText(/EMPLOYEE #1/)).toBeInTheDocument();
  });
});
