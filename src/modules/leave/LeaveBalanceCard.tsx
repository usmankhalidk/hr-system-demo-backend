import React from 'react';
import { useTranslation } from 'react-i18next';
import { LeaveBalance } from '../../api/leave';

interface Props {
  balances: LeaveBalance[];
  loading?: boolean;
}

function BalancePill({ balance }: { balance: LeaveBalance }) {
  const { t } = useTranslation();
  const isVacation = balance.leaveType === 'vacation';
  const color = isVacation ? 'var(--accent)' : 'var(--info)';
  const usedPct = balance.totalDays > 0
    ? Math.min(100, (balance.usedDays / balance.totalDays) * 100)
    : 0;

  return (
    <div
      style={{
        background: isVacation ? 'var(--accent-light)' : 'var(--info-bg)',
        borderRadius: 'var(--radius)',
        padding: '12px 16px',
        minWidth: 140,
        flex: '1 1 140px',
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
        {t(`leave.type_${balance.leaveType}`)}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
        {balance.remainingDays}
        <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 4 }}>
          {t('leave.days_remaining')}
        </span>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
        {t('leave.balance_used_of', { used: balance.usedDays, total: balance.totalDays })}
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 8, height: 6, borderRadius: 3, background: 'rgba(0,0,0,0.06)' }}>
        <div
          style={{
            width: `${usedPct}%`, height: '100%',
            background: color, borderRadius: 3,
            transition: 'width 0.4s ease',
          }}
        />
      </div>
    </div>
  );
}

export function LeaveBalanceCard({ balances, loading }: Props) {
  const { t } = useTranslation();

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '16px 20px',
        marginBottom: 20,
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <div style={{
        fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)',
        marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5,
      }}>
        {t('leave.balance_title')}
      </div>
      {loading ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('common.loading')}</div>
      ) : balances.length === 0 ? (
        <div style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{t('leave.no_balance')}</div>
      ) : (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {balances.map((b) => (
            <BalancePill key={`${b.leaveType}-${b.year}`} balance={b} />
          ))}
        </div>
      )}
    </div>
  );
}
