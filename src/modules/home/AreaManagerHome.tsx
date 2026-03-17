import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { Table } from '../../components/ui';
import type { Column } from '../../components/ui';

interface AssignedStore {
  id: number;
  name: string;
  code: string;
  employeeCount: number;
}

export interface AreaManagerHomeData {
  assignedStores: AssignedStore[];
}

interface AreaManagerHomeProps {
  data: AreaManagerHomeData;
}

const BAR_COLORS = ['#C9973A', '#0D2137', '#0284C7', '#15803D', '#7C3AED', '#B45309'];

const ChartTooltip = ({ active, payload }: { active?: boolean; payload?: any[] }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '8px 12px',
      boxShadow: 'var(--shadow)', fontSize: '12px', fontFamily: 'var(--font-body)',
    }}>
      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{payload[0].payload.name}</span>
      <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>{payload[0].value} employees</span>
    </div>
  );
};

export const AreaManagerHome: React.FC<AreaManagerHomeProps> = ({ data }) => {
  const navigate = useNavigate();
  const { assignedStores } = data;
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();

  const barData = assignedStores.map((s) => ({ name: s.name, value: s.employeeCount, id: s.id }));
  const totalEmployees = assignedStores.reduce((sum, s) => sum + s.employeeCount, 0);

  const storeColumns: Column<AssignedStore>[] = [
    {
      key: 'name', label: t('home.areaManager.colStore'),
      render: (row) => (
        <span
          style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 500 }}
          onClick={() => navigate(`/dipendenti?store_id=${row.id}`)}
        >
          {row.name}
        </span>
      ),
    },
    { key: 'code', label: t('home.areaManager.colCode'), render: (row) => <span style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>{row.code}</span> },
    {
      key: 'employeeCount', label: t('home.areaManager.colEmployees'),
      align: 'right',
      render: (row) => (
        <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: '14px' }}>
          {row.employeeCount}
        </span>
      ),
    },
  ];

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Header banner */}
      <div className="banner-inner" style={{
        background: 'linear-gradient(135deg, #15803D 0%, #166534 100%)',
        borderRadius: 'var(--radius-lg)', padding: '22px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        boxShadow: '0 4px 20px rgba(21,128,61,0.20)',
      }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: '#FFFFFF', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            {t('home.areaManager.title')}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.60)', fontSize: '13px', margin: 0 }}>
            {t('home.areaManager.storesCount', { count: assignedStores.length })}
          </p>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="stat-num" style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'var(--font-display)', color: '#FFFFFF', lineHeight: 1, letterSpacing: '-0.03em' }}>
            {totalEmployees}
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginTop: '2px', fontWeight: 500 }}>
            {t('home.areaManager.totalEmployees')}
          </div>
        </div>
      </div>

      {barData.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : (barData.length > 1 ? '1fr 1fr' : '1fr'), gap: '16px', alignItems: 'start' }}>

          {/* Bar chart */}
          <div style={{
            background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
          }}>
            <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
                {t('home.areaManager.employeesPerStore')}
              </h3>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{t('home.areaManager.employeesPerStoreDesc')}</p>
            </div>
            <div style={{ padding: '20px 20px 12px' }}>
              <ResponsiveContainer width="100%" height={Math.max(120, barData.length * 44)}>
                <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 20, bottom: 0, left: 0 }}>
                  <CartesianGrid horizontal={false} strokeDasharray="3 3" stroke="var(--border-light)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-body)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis
                    type="category" dataKey="name"
                    tick={{ fontSize: 11, fill: 'var(--text-secondary)', fontFamily: 'var(--font-body)' }}
                    axisLine={false} tickLine={false} width={100}
                    tickFormatter={(v: string) => v.length > 14 ? v.slice(0, 14) + '…' : v}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201,151,58,0.06)' }} />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={20}>
                    {barData.map((_, i) => (
                      <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Stat mini-cards */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {assignedStores.map((store, i) => (
              <div
                key={store.id}
                onClick={() => navigate(`/dipendenti?store_id=${store.id}`)}
                className="card-lift"
                style={{
                  background: 'var(--surface)', borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)', borderLeft: `3px solid ${BAR_COLORS[i % BAR_COLORS.length]}`,
                  padding: '14px 16px', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  boxShadow: 'var(--shadow-xs)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', color: 'var(--text-primary)' }}>{store.name}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>{store.code}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{
                    fontSize: '22px', fontWeight: 700, fontFamily: 'var(--font-display)',
                    color: BAR_COLORS[i % BAR_COLORS.length], lineHeight: 1,
                  }}>{store.employeeCount}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    {t('home.areaManager.colEmployees')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Full table */}
      <div style={{
        background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
      }}>
        <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
            {t('home.areaManager.myStores')}
          </h3>
        </div>
        <Table<AssignedStore> flush columns={storeColumns} data={assignedStores} emptyText={t('home.areaManager.noStores')} />
      </div>
    </div>
  );
};

export default AreaManagerHome;
