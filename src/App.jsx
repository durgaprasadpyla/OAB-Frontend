import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import { DataProvider } from './data.jsx';
import { landingPath } from './lib/roles.js';
import Shell from './components/Shell.jsx';
import RoleRoute from './components/RoleRoute.jsx';
import Login from './pages/Login.jsx';
import NewPO from './pages/NewPO.jsx';
import OabBoard from './pages/OabBoard.jsx';
import DailyUpdate from './pages/DailyUpdate.jsx';
import FGLedger from './pages/FGLedger.jsx';
import Invoice from './pages/Invoice.jsx';
import DispatchBySO from './pages/DispatchBySO.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PDashboard from './pages/PDashboard.jsx';
import Plant from './pages/Plant.jsx';
import QC from './pages/QC.jsx';
import PM from './pages/PM.jsx';
import Scrap from './pages/Scrap.jsx';
import Purchase from './pages/Purchase.jsx';
import HR from './pages/HR.jsx';
import RepPortal from './pages/RepPortal.jsx';
import QuotationDesk from './pages/QuotationDesk.jsx';
import SalesAdmin from './pages/SalesAdmin.jsx';
import ChangePasswordGate from './components/ChangePasswordGate.jsx';

function Protected({ children }) {
  const { isAuthed, mustChangePassword, passwordChanged } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  // A forced change blocks the whole authed area — the app is not usable until
  // it is done, so this replaces the content rather than overlaying it.
  if (mustChangePassword) return <ChangePasswordGate onDone={passwordChanged} />;
  return children;
}

function Landing() {
  const { role } = useAuth();
  return <Navigate to={landingPath(role)} replace />;
}

// Native app: every screen is a real React component (no legacy iframe). The
// DataProvider (the 8 module blobs) is mounted only inside the authed area.
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected><DataProvider><Shell /></DataProvider></Protected>}>
        <Route path="/po" element={<RoleRoute path="/po"><NewPO /></RoleRoute>} />
        <Route path="/oab" element={<RoleRoute path="/oab"><OabBoard /></RoleRoute>} />
        <Route path="/daily" element={<RoleRoute path="/daily"><DailyUpdate /></RoleRoute>} />
        <Route path="/fg" element={<RoleRoute path="/fg"><FGLedger /></RoleRoute>} />
        <Route path="/invoice" element={<RoleRoute path="/invoice"><Invoice /></RoleRoute>} />
        <Route path="/specdisp" element={<RoleRoute path="/specdisp"><DispatchBySO /></RoleRoute>} />
        <Route path="/dashboard" element={<RoleRoute path="/dashboard"><Dashboard /></RoleRoute>} />
        <Route path="/pdashboard" element={<RoleRoute path="/pdashboard"><PDashboard /></RoleRoute>} />
        <Route path="/plant" element={<RoleRoute path="/plant"><Plant /></RoleRoute>} />
        <Route path="/qc" element={<RoleRoute path="/qc"><QC /></RoleRoute>} />
        <Route path="/pm" element={<RoleRoute path="/pm"><PM /></RoleRoute>} />
        <Route path="/scrap" element={<RoleRoute path="/scrap"><Scrap /></RoleRoute>} />
        <Route path="/purchase" element={<RoleRoute path="/purchase"><Purchase /></RoleRoute>} />
        <Route path="/hr" element={<RoleRoute path="/hr"><HR /></RoleRoute>} />
        <Route path="/rep" element={<RoleRoute path="/rep"><RepPortal /></RoleRoute>} />
        <Route path="/quotes" element={<RoleRoute path="/quotes"><QuotationDesk /></RoleRoute>} />
        <Route path="/sdashboard" element={<RoleRoute path="/sdashboard"><SalesAdmin /></RoleRoute>} />
        <Route path="*" element={<Landing />} />
      </Route>
    </Routes>
  );
}
