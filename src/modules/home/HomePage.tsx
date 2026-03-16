import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner, Alert } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { getHomeData } from '../../api/home';
import { translateApiError } from '../../utils/apiErrors';
import { AdminHome } from './AdminHome';
import { HRHome } from './HRHome';
import { AreaManagerHome } from './AreaManagerHome';
import { StoreManagerHome } from './StoreManagerHome';
import { EmployeeHome } from './EmployeeHome';
import { TerminalHome } from './TerminalHome';
import type { AdminHomeData } from './AdminHome';
import type { HRHomeData } from './HRHome';
import type { AreaManagerHomeData } from './AreaManagerHome';
import type { StoreManagerHomeData } from './StoreManagerHome';
import type { EmployeeHomeData } from './EmployeeHome';
import type { TerminalHomeData } from './TerminalHome';

const centeredStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '300px',
};

export const HomePage: React.FC = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    getHomeData()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(translateApiError(err, t, t('home.errorLoad')));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div style={centeredStyle}>
        <Spinner size="lg" color="var(--accent)" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: '24px' }}>
        <Alert variant="danger" title={t('common.error')}>
          {error}
        </Alert>
      </div>
    );
  }

  if (!user || !data) {
    return null;
  }

  switch (user.role) {
    case 'admin':
      return <AdminHome data={data as AdminHomeData} />;
    case 'hr':
      return <HRHome data={data as HRHomeData} />;
    case 'area_manager':
      return <AreaManagerHome data={data as AreaManagerHomeData} />;
    case 'store_manager':
      return <StoreManagerHome data={data as StoreManagerHomeData} />;
    case 'employee':
      return <EmployeeHome data={data as EmployeeHomeData} />;
    case 'store_terminal':
      return <TerminalHome data={data as TerminalHomeData} />;
    default:
      return (
        <div style={{ padding: '24px' }}>
          <Alert variant="warning" title={t('home.unknownRole')}>
            {t('home.unknownRoleMsg')}
          </Alert>
        </div>
      );
  }
};

export default HomePage;
