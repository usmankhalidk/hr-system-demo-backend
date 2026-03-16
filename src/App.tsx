import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import ToastContainer from './components/ui/ToastContainer';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/layout/Layout';
import LoginPage from './modules/auth/LoginPage';
import HomePage from './modules/home/HomePage';
import EmployeeList from './modules/employees/EmployeeList';
import EmployeeDetail from './modules/employees/EmployeeDetail';
import StoreList from './modules/stores/StoreList';
import CompanyList from './modules/companies/CompanyList';
import PermissionsPanel from './modules/permissions/PermissionsPanel';
import ProfilePage from './modules/profile/ProfilePage';

function AppRoutes() {
  const { t } = useTranslation();

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route path="/" element={
        <ProtectedRoute>
          <Layout title={t('nav.dashboard')}><HomePage /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/dipendenti" element={
        <ProtectedRoute>
          <Layout title={t('nav.employees')}><EmployeeList /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/dipendenti/:id" element={
        <ProtectedRoute>
          <Layout title={t('employees.colName')}><EmployeeDetail /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/negozi" element={
        <ProtectedRoute roles={['admin', 'hr', 'area_manager', 'store_manager']}>
          <Layout title={t('nav.stores')}><StoreList /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/aziende" element={
        <ProtectedRoute roles={['admin']}>
          <Layout title={t('nav.companies')}><CompanyList /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/impostazioni/permessi" element={
        <ProtectedRoute roles={['admin']}>
          <Layout title={t('nav.permissions')}><PermissionsPanel /></Layout>
        </ProtectedRoute>
      } />

      <Route path="/profilo" element={
        <ProtectedRoute roles={['employee']}>
          <Layout title={t('profile.title')}><ProfilePage /></Layout>
        </ProtectedRoute>
      } />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <ToastContainer />
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
