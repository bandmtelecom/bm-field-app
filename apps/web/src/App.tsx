import { Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/session';
import Login from './pages/Login';
import Jobs from './pages/Jobs';
import JobRecord from './pages/JobRecord';
import AddVisit from './pages/AddVisit';
import InvoiceView from './pages/InvoiceView';
import Admin from './pages/Admin';
import Closures from './pages/Closures';
import EditLocation from './pages/EditLocation';
import ClosureDetail from './pages/ClosureDetail';

export default function App() {
  const { loading, userId } = useSession();
  if (loading) return <div className="spinner">Loading…</div>;
  if (!userId) return <Login />;

  return (
    <Routes>
      <Route path="/" element={<Jobs />} />
      <Route path="/jobs/:id" element={<JobRecord />} />
      <Route path="/jobs/:id/add" element={<AddVisit />} />
      <Route path="/jobs/:id/invoice" element={<InvoiceView />} />
      <Route path="/locations/:id/edit" element={<EditLocation />} />
      <Route path="/closures" element={<Closures />} />
      <Route path="/closures/:id" element={<ClosureDetail />} />
      <Route path="/admin" element={<Admin />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
