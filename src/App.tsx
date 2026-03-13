import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import EmployeeList from './pages/EmployeeList';
import ShiftScheduling from './pages/ShiftScheduling';
import QRAttendance from './pages/QRAttendance';
import AttendanceLogs from './pages/AttendanceLogs';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Navigate to="/dashboard" replace />} />

          <Route path="/dashboard" element={
            <ProtectedRoute>
              <Layout><Dashboard /></Layout>
            </ProtectedRoute>
          } />

          <Route path="/employees" element={
            <ProtectedRoute>
              <Layout><EmployeeList /></Layout>
            </ProtectedRoute>
          } />

          <Route path="/shifts" element={
            <ProtectedRoute roles={['admin', 'manager']}>
              <Layout><ShiftScheduling /></Layout>
            </ProtectedRoute>
          } />

          <Route path="/qr" element={
            <ProtectedRoute>
              <Layout><QRAttendance /></Layout>
            </ProtectedRoute>
          } />

          <Route path="/attendance" element={
            <ProtectedRoute>
              <Layout><AttendanceLogs /></Layout>
            </ProtectedRoute>
          } />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
