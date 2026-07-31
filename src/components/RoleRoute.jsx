import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { canAccess, landingPath } from '../lib/roles.js';

/** Guards a route: if the signed-in role can't access `path`, bounce to its landing. */
export default function RoleRoute({ path, children }) {
  const { role } = useAuth();
  if (!canAccess(role, path)) return <Navigate to={landingPath(role)} replace />;
  return children;
}
