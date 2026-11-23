import { api } from '../api.js';

// BloomFlex V2 — stock reconciliation: the period movement report and physical counts.
// Approve / reject are Super Admin only on the server, and never change stock.
const q = (params) => {
  const s = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => { if (v != null && v !== '') s.set(k, v); });
  const t = s.toString();
  return t ? '?' + t : '';
};

export const stockCountApi = {
  movement: ({ from, to, item } = {}) => api('/api/stores/stock-movement' + q({ from, to, item })),
  counts: (status) => api('/api/stores/stock-counts' + q({ status })),
  submit: (body) => api('/api/stores/stock-counts', { method: 'POST', body }),
  approve: (id, note) => api(`/api/stores/stock-counts/${id}/approve`, { method: 'POST', body: note ? { note } : {} }),
  reject: (id, note) => api(`/api/stores/stock-counts/${id}/reject`, { method: 'POST', body: note ? { note } : {} }),
};
