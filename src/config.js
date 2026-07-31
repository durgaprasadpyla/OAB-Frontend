// Backend API base URL.
//   - Empty (default) = same-origin: the app is served BY the backend (bundled
//     mode on :8080), so /api and /rest are relative.
//   - Set VITE_API_BASE (e.g. http://localhost:8080) to run the frontend on its
//     OWN server/origin, talking to the backend cross-origin. CORS is already
//     open on the backend and auth is a Bearer token (no cookies), so this works
//     without further backend changes.
export const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
