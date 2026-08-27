import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderApp } from './harness.jsx';
import HR from '../pages/HR.jsx';
import { landingPath, canAccess, navTabs, ROLE_LABEL } from '../lib/roles.js';

const hrFixture = () => ({
  dashboard: {
    totalEmployees: 42, activeEmployees: 36, onLeave: 3, onNotice: 1,
    inactiveEmployees: 2, newJoiners: 5, pendingLeave: 2, departments: 3,
    byDepartment: [{ name: 'Production', count: 20 }, { name: 'QC', count: 10 }, { name: 'Admin', count: 6 }],
    byStatus: [{ status: 'Active', count: 36 }, { status: 'On Leave', count: 3 }],
  },
  employees: [
    { id: 1, empCode: 'E-001', fullName: 'Asha Rao', firstName: 'Asha', lastName: 'Rao', departmentId: 10, departmentName: 'Production', designationName: 'Supervisor', joiningDate: '2024-04-01', mobile: '9000000001', status: 'Active' },
    { id: 2, empCode: 'E-002', fullName: 'Bala K', firstName: 'Bala', lastName: 'K', departmentId: 11, departmentName: 'QC', designationName: 'Analyst', joiningDate: '2025-01-15', mobile: '9000000002', status: 'On Notice' },
  ],
  departments: [
    { id: 10, name: 'Production', active: true },
    { id: 11, name: 'QC', active: true },
    // Deactivated — must still appear on the management panel (it owns its name).
    { id: 12, name: 'PRINTING', active: false },
  ],
  designations: [{ id: 20, title: 'Supervisor', active: true }],
  leaveTypes: [{ id: 30, name: 'Casual Leave', defaultDays: 12, active: true }],
  leaveRequests: [
    { id: 100, employeeId: 1, employeeName: 'Asha Rao', leaveTypeName: 'Casual Leave', fromDate: '2026-09-01', toDate: '2026-09-03', days: 3, reason: 'Family', status: 'Pending' },
  ],
  audit: [{ id: 1, createdAt: '2026-08-20T09:00:00', actor: 'hradmin', entityType: 'EMPLOYEE', entityId: 1, action: 'CREATE', details: { empCode: 'E-001' } }],
  documents: [],
});

const openHR = async (opts = {}) => {
  const r = renderApp(<HR />, { role: 'hr', hr: hrFixture(), ...opts });
  await waitFor(() => expect(screen.getByText('Human Resources')).toBeInTheDocument());
  return r;
};
/** Click a workspace tab by its label, scoped to the tab strip so the regex
 *  cannot also match a heading or a table cell elsewhere on the page. */
const tab = async (label) => {
  const strip = document.querySelector('.step-bar');
  const hit = [...strip.querySelectorAll('.step-tab')].find((el) => new RegExp(label).test(el.textContent));
  if (!hit) throw new Error('No HR tab matching ' + label);
  await userEvent.click(hit);
};

afterEach(() => vi.restoreAllMocks());

describe('HR role model', () => {
  it('lands the hr role on its own workspace', () => {
    expect(landingPath('hr')).toBe('/hr');
    expect(ROLE_LABEL.hr).toBe('HR');
  });

  it('opens /hr to hr and superadmin only', () => {
    expect(canAccess('hr', '/hr')).toBe(true);
    expect(canAccess('superadmin', '/hr')).toBe(true);
    ['user', 'padmin', 'qc', 'pm', 'plant', 'purchase', 'scrap'].forEach((r) => {
      expect(canAccess(r, '/hr')).toBe(false);
    });
  });

  it('keeps the hr role out of every operations screen', () => {
    ['/po', '/oab', '/daily', '/fg', '/invoice', '/dashboard', '/pdashboard', '/purchase'].forEach((p) => {
      expect(canAccess('hr', p)).toBe(false);
    });
    expect(navTabs('hr')).toEqual([]);
  });

  it('gives superadmin an HR tab alongside the ops tabs', () => {
    const tabs = navTabs('superadmin');
    expect(tabs.some((t) => t.to === '/hr')).toBe(true);
    expect(tabs.some((t) => t.to === '/po')).toBe(true);
    expect(navTabs('user').some((t) => t.to === '/hr')).toBe(false);
  });
});

describe('HR — Overview', () => {
  it('shows the head-count summary and the department split', async () => {
    await openHR();
    expect(screen.getByText('42')).toBeInTheDocument();
    // 36 shows twice: the Active KPI and the by-status table row.
    expect(screen.getAllByText('36')).toHaveLength(2);
    expect(screen.getByText('Production')).toBeInTheDocument();
    expect(screen.getByText('Head-count by status')).toBeInTheDocument();
  });

  it('reports a permission problem plainly instead of showing empty tables', async () => {
    renderApp(<HR />, { role: 'user', hr: null });   // no fixture -> every HR call 403s
    await waitFor(() => expect(screen.getByText(/do not have permission/i)).toBeInTheDocument());
  });
});

describe('HR — Employees', () => {
  it('lists employees with department and status', async () => {
    await openHR();
    await tab('Employees');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());
    expect(screen.getByText('E-001')).toBeInTheDocument();
    expect(screen.getByText('Bala K')).toBeInTheDocument();
  });

  it('filters by the search box only once Search is pressed', async () => {
    await openHR();
    await tab('Employees');
    await waitFor(() => expect(screen.getByText('Bala K')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('Search employees'), 'Asha');
    expect(screen.getByText('Bala K')).toBeInTheDocument();      // not applied yet

    await userEvent.click(screen.getByText('Search'));
    await waitFor(() => expect(screen.queryByText('Bala K')).not.toBeInTheDocument());
    expect(screen.getByText('Asha Rao')).toBeInTheDocument();
  });

  it('creates an employee through POST /api/hr/employees', async () => {
    const { saved } = await openHR();
    await tab('Employees');
    await userEvent.click(screen.getByText(/Add Employee/));

    await userEvent.type(screen.getByLabelText('Employee ID'), 'E-003');
    await userEvent.type(screen.getByLabelText('First Name'), 'Chan');
    await userEvent.type(screen.getByLabelText('Last Name'), 'Dev');
    await userEvent.click(screen.getByText(/Save Employee/));

    await waitFor(() => expect(screen.getByText(/Employee added/)).toBeInTheDocument());
    const post = saved.find((s) => s.hrPath === 'employees' && s.method === 'POST');
    expect(post.body).toMatchObject({ empCode: 'E-003', firstName: 'Chan', lastName: 'Dev' });
    // Server-owned fields must not be echoed back on create.
    expect(post.body.id).toBeUndefined();
    expect(post.body.fullName).toBeUndefined();
  });

  it('surfaces a duplicate employee-code conflict from the server', async () => {
    await openHR();
    await tab('Employees');
    await userEvent.click(screen.getByText(/Add Employee/));

    await userEvent.type(screen.getByLabelText('Employee ID'), 'E-001');   // already taken
    await userEvent.type(screen.getByLabelText('First Name'), 'Clash');
    await userEvent.click(screen.getByText(/Save Employee/));

    await waitFor(() => expect(screen.getByText(/already exists/i)).toBeInTheDocument());
    // The form stays open with the entered values, so the code can be corrected.
    expect(screen.getByLabelText('Employee ID')).toHaveValue('E-001');
  });

  it('surfaces a server validation error when a required field is missing', async () => {
    await openHR();
    await tab('Employees');
    await userEvent.click(screen.getByText(/Add Employee/));

    await userEvent.type(screen.getByLabelText('Employee ID'), 'E-009');   // no first name
    await userEvent.click(screen.getByText(/Save Employee/));

    await waitFor(() => expect(screen.getByText(/First name is required/i)).toBeInTheDocument());
  });

  it('changes a status through the dedicated status endpoint', async () => {
    const { saved } = await openHR();
    await tab('Employees');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());

    await userEvent.selectOptions(screen.getByLabelText('Status for Asha Rao'), 'On Leave');
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'employees/1/status')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'employees/1/status').body).toEqual({ status: 'On Leave', remarks: '' });
  });
});

describe('HR — Departments, designations and leave types', () => {
  it('lists all three and adds a department', async () => {
    const { saved } = await openHR();
    await tab('Departments & Roles');
    await waitFor(() => expect(screen.getByText('Departments')).toBeInTheDocument());
    expect(screen.getByText('Designations')).toBeInTheDocument();
    expect(screen.getByText('Leave Types')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('New Departments'), 'Stores');
    await userEvent.click(within(screen.getByText('Departments').closest('.card')).getByText(/Add/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'departments' && s.method === 'POST')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'departments' && s.method === 'POST').body).toEqual({ name: 'Stores' });
  });

  // Regression (prod 2026-08-27): PRINTING was deactivated, vanished from the panel,
  // and re-adding "printing" 409'd against the invisible row with a bare "HTTP 409".
  it('shows deactivated departments and a human reason on a duplicate name', async () => {
    await openHR();
    await tab('Departments & Roles');
    await waitFor(() => expect(screen.getByText('Departments')).toBeInTheDocument());
    // the deactivated row is still listed (includeInactive) with its box unticked,
    // so the user can simply re-enable it…
    const row = await screen.findByDisplayValue('PRINTING');
    expect(within(row.closest('tr')).getByRole('checkbox')).not.toBeChecked();
    // …and a case-insensitive duplicate add explains itself instead of "HTTP 409".
    await userEvent.type(screen.getByLabelText('New Departments'), 'printing');
    await userEvent.click(within(screen.getByText('Departments').closest('.card')).getByText(/Add/));
    await waitFor(() => expect(screen.getByText(/A department named 'printing' already exists/i)).toBeInTheDocument());
  });

  it('sends the default-days figure when adding a leave type', async () => {
    const { saved } = await openHR();
    await tab('Departments & Roles');
    await waitFor(() => expect(screen.getByText('Leave Types')).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText('New Leave Types'), 'Sick Leave');
    await userEvent.type(screen.getByLabelText('Default days'), '6');
    await userEvent.click(within(screen.getByText('Leave Types').closest('.card')).getByText(/Add/));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'leave-types' && s.method === 'POST')).toBe(true));
    expect(saved.find((s) => s.hrPath === 'leave-types' && s.method === 'POST').body).toEqual({ name: 'Sick Leave', defaultDays: 6 });
  });
});

describe('HR — Leave', () => {
  it('lists pending requests and approves one', async () => {
    const { saved } = await openHR();
    await tab('Leave');
    await waitFor(() => expect(screen.getByText('Asha Rao')).toBeInTheDocument());

    await userEvent.click(screen.getByLabelText('Approve leave 100'));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'leave-requests/100/approve')).toBe(true));
  });

  it('rejects a request through the reject endpoint', async () => {
    const { saved } = await openHR();
    await tab('Leave');
    await waitFor(() => expect(screen.getByLabelText('Reject leave 100')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('Reject leave 100'));
    await waitFor(() => expect(saved.some((s) => s.hrPath === 'leave-requests/100/reject')).toBe(true));
  });

  it('counts leave days inclusively and blocks a backwards range', async () => {
    await openHR();
    await tab('Leave');
    await waitFor(() => expect(screen.getByLabelText('From')).toBeInTheDocument());

    await userEvent.clear(screen.getByLabelText('From'));
    await userEvent.type(screen.getByLabelText('From'), '2026-09-01');
    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2026-09-03');
    expect(screen.getByText('3 days')).toBeInTheDocument();   // inclusive of both ends

    await userEvent.clear(screen.getByLabelText('To'));
    await userEvent.type(screen.getByLabelText('To'), '2026-08-30');
    expect(screen.getByText('Check the dates')).toBeInTheDocument();
  });

  it('refuses to submit without an employee', async () => {
    const { saved } = await openHR();
    await tab('Leave');
    await waitFor(() => expect(screen.getByText('Submit request')).toBeInTheDocument());
    await userEvent.click(screen.getByText('Submit request'));
    expect(screen.getByText(/Choose an employee/)).toBeInTheDocument();
    expect(saved.some((s) => s.hrPath === 'leave-requests' && s.method === 'POST')).toBe(false);
  });
});

describe('HR — Audit', () => {
  it('shows who changed what', async () => {
    await openHR();
    await tab('Audit');
    await waitFor(() => expect(screen.getByText('hradmin')).toBeInTheDocument());
    expect(screen.getByText('CREATE')).toBeInTheDocument();
    expect(screen.getByText(/EMPLOYEE #1/)).toBeInTheDocument();
  });
});
