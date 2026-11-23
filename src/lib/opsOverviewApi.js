// BloomFlex V2 — Operations Overview client (kept out of api.js so branches merge cleanly).
import { api } from '../api.js';

export const opsOverviewApi = {
  /** GET /api/overview — `date` is the browser's today (yyyy-MM-dd). */
  get: (date) => api('/api/overview' + (date ? '?date=' + encodeURIComponent(date) : '')),
};
