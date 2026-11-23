import { api } from '../api.js';

// BloomFlex V2 — Machine Calendar (per-machine operating windows).
// A window is { shift: 'A'|'B'|'C', from: 'HH:mm', to: 'HH:mm' }; to <= from means it
// runs past midnight. A save that would strand a started job answers 409 (err.message
// lists the jobs).
const q = (o) => Object.entries(o).filter(([, v]) => v != null && v !== '')
  .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

export const machineCalendarApi = {
  // → { from, days, dates[], machines:[{ id, code, name, departmentId, departmentName,
  //      weekly:[{dow, windows, off}], days:[{ date, source, windows, hours, capacityMinutes, text }] }] }
  get: (from, days = 7, department) => api('/api/planning/machine-calendar?' + q({ from, days, department })),
  saveDay: (machineId, date, windows) => api('/api/planning/machine-calendar/day', { method: 'PUT', body: { machineId, date, windows } }),
  resetDay: (machineId, date) => api('/api/planning/machine-calendar/day?' + q({ machineId, date }), { method: 'DELETE' }),
  saveWeekly: (machineId, dow, windows) => api('/api/planning/machine-calendar/weekly', { method: 'PUT', body: { machineId, dow, windows } }),
};

export const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dowOf = (iso) => new Date(iso + 'T00:00:00Z').getUTCDay();   // 0 = Sunday, as the server
