import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { Table } from '../../components/ui';
import type { Column } from '../../components/ui';

interface ExpiringContract {
  id: number;
  name: string;
  surname: string;
  storeId: number;
  contractEndDate: string;
}

interface NewHire {
  id: number;
  name: string;
  surname: string;
  role: string;
  hireDate: string;
}

interface MonthlyHire {
  month: string; // 'YYYY-MM'
  count: number;
}

interface StatusItem {
  status: string;
  count: number;
}

export interface HRHomeData {
  expiringContracts: ExpiringContract[];
  newHires: NewHire[];
  totalEmployees: number;
  monthlyHires?: MonthlyHire[];
  statusBreakdown?: StatusItem[];
  expiringTrainings?: Array<{
    id: number; trainingType: string; endDate: string;
    userId: number; name: string; surname: string;
  }>;
  expiringMedicals?: Array<{
    id: number; endDate: string;
    userId: number; name: string; surname: string;
  }>;
}

interface HRHomeProps {
  data: HRHomeData;
}

function formatDate(dateStr: string, lang: string): string {
  try {
    const locale = lang.startsWith('it') ? 'it-IT' : 'en-GB';
    return new Date(dateStr).toLocaleDateString(locale);
  } catch { return dateStr; }
}

// Fill missing months so the chart always has 6 bars
function buildMonthSeries(raw: MonthlyHire[], lang: string): { label: string; value: number }[] {
  const months: { label: string; value: number }[] = [];
  const locale = lang === 'en' ? 'en-GB' : 'it-IT';
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const found = raw.find((r) => r.month === key);
    const label = d.toLocaleDateString(locale, { month: 'short' });
    months.push({ label, value: found?.count ?? 0 });
  }
  return months;
}

const IconUsers = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
  </svg>
);

const ChartTooltip = ({ active, payload, label }: { active?: boolean; payload?: any[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)', padding: '8px 12px',
      boxShadow: 'var(--shadow)', fontSize: '12px', fontFamily: 'var(--font-body)',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: 'var(--text-muted)' }}>{payload[0].value} {payload[0].name}</div>
    </div>
  );
};

const SectionCard: React.FC<{ title: string; subtitle: string; badge?: { label: string; color: string }; children: React.ReactNode }> = ({ title, subtitle, badge, children }) => (
  <div style={{
    background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
  }}>
    <div style={{
      padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px',
    }}>
      <div>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>{title}</h3>
        <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{subtitle}</p>
      </div>
      {badge && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: '3px 9px', borderRadius: '999px',
          background: `${badge.color}12`, border: `1px solid ${badge.color}25`,
          fontSize: '11px', fontWeight: 600, color: badge.color, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: badge.color, display: 'inline-block' }}/>
          {badge.label}
        </span>
      )}
    </div>
    <div>{children}</div>
  </div>
);

export const HRHome: React.FC<HRHomeProps> = ({ data }) => {
  const { expiringContracts, newHires, totalEmployees, monthlyHires = [], statusBreakdown = [] } = data;
  const { t, i18n } = useTranslation();
  const { isMobile, isTablet } = useBreakpoint();
  const navigate = useNavigate();
  const tRole = (role: string) => (t as (k: string) => string)(`roles.${role}`);

  const monthSeries = buildMonthSeries(monthlyHires, i18n.language);

  const statusPieData = statusBreakdown.map((s) => ({
    name: s.status === 'active' ? t('employees.statusActive') : t('employees.statusInactive'),
    value: s.count,
    color: s.status === 'active' ? '#15803D' : '#DC2626',
  }));

  const contractColumns: Column<ExpiringContract>[] = [
    { key: 'name', label: t('home.hr.colEmployee'), render: (row) => <span style={{ fontWeight: 500 }}>{row.name} {row.surname}</span> },
    {
      key: 'contractEndDate', label: t('home.hr.colEndDate'), align: 'right',
      render: (row) => <span style={{ color: 'var(--warning)', fontWeight: 600, fontSize: '12.5px' }}>{formatDate(row.contractEndDate, i18n.language)}</span>,
    },
  ];

  const hireColumns: Column<NewHire>[] = [
    { key: 'name', label: t('home.hr.colEmployee'), render: (row) => <span style={{ fontWeight: 500 }}>{row.name} {row.surname}</span> },
    { key: 'role', label: t('common.role'), render: (row) => <span style={{ color: 'var(--text-muted)', fontSize: '12.5px' }}>{tRole(row.role) ?? row.role}</span> },
    {
      key: 'hireDate', label: t('home.hr.colHireDate'), align: 'right',
      render: (row) => <span style={{ color: 'var(--success)', fontWeight: 600, fontSize: '12.5px' }}>{formatDate(row.hireDate, i18n.language)}</span>,
    },
  ];

  return (
    <div className="page-enter" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Welcome + stat */}
      <div className="banner-inner" style={{
        background: 'linear-gradient(135deg, #0284C7 0%, #0369A1 100%)',
        borderRadius: 'var(--radius-lg)', padding: '22px 28px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px',
        boxShadow: '0 4px 20px rgba(2,132,199,0.20)',
      }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: '#FFFFFF', margin: '0 0 4px', letterSpacing: '-0.02em' }}>
            {t('home.hr.title')}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.60)', fontSize: '13px', margin: 0 }}>
            {t('home.hr.subtitle')}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 10,
            background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.20)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
          }}><IconUsers /></div>
          <div>
            <div className="stat-num" style={{ fontSize: '32px', fontWeight: 700, fontFamily: 'var(--font-display)', color: '#FFFFFF', lineHeight: 1, letterSpacing: '-0.03em' }}>
              {totalEmployees}
            </div>
            <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.55)', marginTop: '2px', fontWeight: 500 }}>
              {t('home.hr.totalEmployees')}
            </div>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: '16px', alignItems: 'start' }}>

        {/* Monthly hires bar chart */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.hr.monthlyHires')}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0 }}>{t('home.hr.monthlyHiresDesc')}</p>
          </div>
          <div style={{ padding: '20px 20px 12px' }}>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={monthSeries} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border-light)" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-body)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)', fontFamily: 'var(--font-body)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(201,151,58,0.06)' }} />
                <Bar dataKey="value" name={t('home.hr.hiresLabel')} fill="#C9973A" radius={[4, 4, 0, 0]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Active vs inactive donut */}
        <div style={{
          background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', overflow: 'hidden',
        }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-light)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 2px', letterSpacing: '-0.01em' }}>
              {t('home.hr.employeeStatus')}
            </h3>
          </div>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
            <div style={{ width: 120, height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={statusPieData} cx="50%" cy="50%" innerRadius={36} outerRadius={54} paddingAngle={3} dataKey="value" strokeWidth={0}>
                    {statusPieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '100%' }}>
              {statusPieData.map((entry) => (
                <div key={entry.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
                    <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{entry.name}</span>
                  </div>
                  <span style={{ fontSize: '13px', fontWeight: 700, color: entry.color, fontFamily: 'var(--font-display)' }}>{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tables row */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '16px' }}>
        <SectionCard
          title={t('home.hr.expiringContracts')}
          subtitle={t('home.hr.expiringContractsDesc')}
          badge={expiringContracts.length > 0 ? { label: t('home.hr.expiringBadge', { count: expiringContracts.length }), color: '#B45309' } : undefined}
        >
          <Table<ExpiringContract> flush columns={contractColumns} data={expiringContracts} emptyText={t('home.hr.noExpiringContracts')} />
        </SectionCard>
        <SectionCard
          title={t('home.hr.newHires')}
          subtitle={t('home.hr.newHiresDesc')}
          badge={newHires.length > 0 ? { label: t('home.hr.newHiresBadge', { count: newHires.length }), color: '#15803D' } : undefined}
        >
          <Table<NewHire> flush columns={hireColumns} data={newHires} emptyText={t('home.hr.noNewHires')} />
        </SectionCard>
      </div>

      {/* Expiring Trainings */}
      {(data.expiringTrainings?.length ?? 0) > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', background: 'rgba(234,88,12,0.05)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#ea580c', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('home.hr.expiringTrainings')}
            </h3>
          </div>
          <div>
            {data.expiringTrainings!.map((tr) => {
              const daysLeft = Math.ceil((new Date(tr.endDate).getTime() - Date.now()) / 86400000);
              return (
                <div key={tr.id}
                  onClick={() => navigate(`/dipendenti/${tr.userId}`)}
                  style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{tr.name} {tr.surname}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 8 }}>{t(`employees.trainingType_${tr.trainingType}`)}</span>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: daysLeft <= 14 ? '#dc2626' : '#ea580c', background: daysLeft <= 14 ? 'rgba(220,38,38,0.1)' : 'rgba(234,88,12,0.1)', padding: '2px 8px', borderRadius: 20 }}>
                    {daysLeft}{t('leave.days_label')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expiring Medical Checks */}
      {(data.expiringMedicals?.length ?? 0) > 0 && (
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', background: 'rgba(124,58,237,0.05)' }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 700, color: '#7c3aed', margin: 0, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              {t('home.hr.expiringMedicals')}
            </h3>
          </div>
          <div>
            {data.expiringMedicals!.map((m) => {
              const daysLeft = Math.ceil((new Date(m.endDate).getTime() - Date.now()) / 86400000);
              return (
                <div key={m.id}
                  onClick={() => navigate(`/dipendenti/${m.userId}`)}
                  style={{ padding: '10px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                >
                  <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{m.name} {m.surname}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: daysLeft <= 14 ? '#dc2626' : '#7c3aed', background: daysLeft <= 14 ? 'rgba(220,38,38,0.1)' : 'rgba(124,58,237,0.1)', padding: '2px 8px', borderRadius: 20 }}>
                    {daysLeft}{t('leave.days_label')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default HRHome;
