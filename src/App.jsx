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
import Invoice from './pages/Invoice.jsx';
import Dashboard from './pages/Dashboard.jsx';
import PDashboard from './pages/PDashboard.jsx';
import Plant from './pages/Plant.jsx';
import QC from './pages/QC.jsx';
import PM from './pages/PM.jsx';
import Scrap from './pages/Scrap.jsx';
import Purchase from './pages/Purchase.jsx';

function Protected({ children }) {
  const { isAuthed } = useAuth();
  return isAuthed ? children : <Navigate to="/login" replace />;
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
        <Route path="/invoice" element={<RoleRoute path="/invoice"><Invoice /></RoleRoute>} />
        <Route path="/dashboard" element={<RoleRoute path="/dashboard"><Dashboard /></RoleRoute>} />
        <Route path="/pdashboard" element={<RoleRoute path="/pdashboard"><PDashboard /></RoleRoute>} />
        <Route path="/plant" element={<RoleRoute path="/plant"><Plant /></RoleRoute>} />
        <Route path="/qc" element={<RoleRoute path="/qc"><QC /></RoleRoute>} />
        <Route path="/pm" element={<RoleRoute path="/pm"><PM /></RoleRoute>} />
        <Route path="/scrap" element={<RoleRoute path="/scrap"><Scrap /></RoleRoute>} />
        <Route path="/purchase" element={<RoleRoute path="/purchase"><Purchase /></RoleRoute>} />
        <Route path="*" element={<Landing />} />
      </Route>
    </Routes>
  );
}
