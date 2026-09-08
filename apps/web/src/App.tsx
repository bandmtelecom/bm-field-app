import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useSession } from './lib/session';
import Login from './pages/Login';
import Jobs from './pages/Jobs';
import JobRecord from './pages/JobRecord';
import AddLocation from './pages/AddLocation';
import FinishVisit from './pages/FinishVisit';
import InvoiceView from './pages/InvoiceView';
import Admin from './pages/Admin';
import Closures from './pages/Closures';
import EditLocation from './pages/EditLocation';
import ChangePassword from './pages/ChangePassword';
import Archive from './pages/Archive';
import ClosureDetail from './pages/ClosureDetail';

function JobRecordRedirect() {
  const { id } = useParams();
  return <Navigate to={`/jobs/${id}`} replace />;
}

export default function App() {
  const { loading, userId } = useSession();
  if (loading) return <div className="spinner">Loading…</div>;
  if (!userId) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Jobs />} />
      <Route path="/jobs/:id" element={<JobRecord />} />
      {/* 0014: the lead starts a visit from the job screen; each man adds his
          own location onto it; the lead finishes it. The old one-shot
          /jobs/:id/add form is gone — a stale bookmark lands on the job. */}
      <Route path="/jobs/:id/add" element={<JobRecordRedirect />} />
      <Route path="/jobs/:id/visits/:visitId/add-location" element={<AddLocation />} />
      <Route path="/jobs/:id/visits/:visitId/finish" element={<FinishVisit />} />
      <Route path="/jobs/:id/invoice" element={<InvoiceView />} />
      <Route path="/locations/:id/edit" element={<EditLocation />} />
      <Route path="/password" element={<ChangePassword />} />
      <Route path="/archive" element={<Archive />} />
      <Route path="/closures" element={<Closures />} />
      <Route path="/closures/:id" element={<ClosureDetail />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
