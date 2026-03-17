import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getEmployee, deactivateEmployee, activateEmployee } from '../../api/employees';
import { translateApiError } from '../../utils/apiErrors';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Employee, UserRole } from '../../types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Modal } from '../../components/ui/Modal';
import { EmployeeForm } from './EmployeeForm';

// ── Types & constants ──────────────────────────────────────────────────────────
const ROLE_BADGE_VARIANT: Record<UserRole, 'accent' | 'primary' | 'info' | 'success' | 'warning' | 'neutral'> = {
  admin: 'accent',
  hr: 'info',
  area_manager: 'success',
  store_manager: 'warning',
  employee: 'neutral',
  store_terminal: 'neutral',
};

const AVATAR_PALETTE = ['#0D2137', '#163352', '#8B6914', '#1B4D3E', '#2C5282', '#5B2333'];
function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null | undefined, lang: string): string {
  if (!dateStr) return '—';
  try {
    const locale = lang.startsWith('it') ? 'it-IT' : 'en-GB';
    return new Date(dateStr.split('T')[0] + 'T00:00:00').toLocaleDateString(locale);
  } catch {
    return dateStr;
  }
}

function maskIban(iban: string): string {
  if (iban.length <= 8) return iban;
  return `${iban.slice(0, 4)} •••• •••• ${iban.slice(-4)}`;
}

// ── Info row (horizontal label / value) ───────────────────────────────────────
function InfoRow({ label, value, last }: { label: string; value: React.ReactNode; last?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: '12px', padding: '10px 0',
      borderBottom: last ? 'none' : '1px solid var(--border-light)',
    }}>
      <span style={{
        fontSize: '12px', fontWeight: 600, color: 'var(--text-muted)',
        textTransform: 'uppercase', letterSpacing: '0.05em',
        fontFamily: 'var(--font-body)', flexShrink: 0,
      }}>
        {label}
      </span>
      <span style={{
        fontSize: '13.5px', color: 'var(--text-primary)',
        fontFamily: 'var(--font-body)', textAlign: 'right',
      }}>
        {value || '—'}
      </span>
    </div>
  );
}

// ── Section panel ──────────────────────────────────────────────────────────────
function SectionPanel({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--surface)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)',
      overflow: 'hidden',
    }}>
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid var(--border-light)',
        display: 'flex', alignItems: 'center', gap: '10px',
        background: 'var(--surface-warm)',
      }}>
        <div style={{ color: 'var(--accent)', flexShrink: 0 }}>{icon}</div>
        <h3 style={{
          fontFamily: 'var(--font-display)', fontSize: '13px', fontWeight: 700,
          color: 'var(--text-primary)', margin: 0,
          textTransform: 'uppercase', letterSpacing: '0.04em',
        }}>
          {title}
        </h3>
      </div>
      <div style={{ padding: '4px 20px 8px' }}>{children}</div>
    </div>
  );
}

// ── Icons ──────────────────────────────────────────────────────────────────────
const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
  </svg>
);
const IconFile = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
  </svg>
);
const IconOff = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
  </svg>
);
const IconOn = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const IconBack = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────────
export function EmployeeDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isMobile } = useBreakpoint();
  const { t, i18n } = useTranslation();
  const { showToast } = useToast();

  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [showActivateModal, setShowActivateModal] = useState(false);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const employeeId = id && !isNaN(parseInt(id, 10)) ? parseInt(id, 10) : undefined;
  const isAdminOrHr = user?.role === 'admin' || user?.role === 'hr';
  const isAdmin = user?.role === 'admin';
  const isOwnProfile = user?.id === employee?.id;
  const canViewSensitive = isAdminOrHr || isOwnProfile;

  const tRole = (roleKey: string) => (t as (k: string) => string)(`roles.${roleKey}`);

  const loadEmployee = () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    getEmployee(employeeId)
      .then(setEmployee)
      .catch((err) => {
        setError(translateApiError(err, t, t('employees.errorLoad')));
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!id || isNaN(parseInt(id, 10))) {
      navigate('/dipendenti', { replace: true });
      return;
    }
    loadEmployee();
  }, [employeeId]);

  const handleActivate = async () => {
    if (!employeeId) return;
    setActivating(true);
    setActivateError(null);
    try {
      await activateEmployee(employeeId);
      setShowActivateModal(false);
      showToast(t('employees.activatedSuccess'), 'success');
      loadEmployee();
    } catch (err: unknown) {
      setActivateError(translateApiError(err, t, t('employees.errorActivate')));
    } finally {
      setActivating(false);
    }
  };

  const handleDeactivate = async () => {
    if (!employeeId) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateEmployee(employeeId);
      setShowDeactivateModal(false);
      showToast(t('employees.deactivatedSuccess'), 'success');
      loadEmployee();
    } catch (err: unknown) {
      setDeactivateError(translateApiError(err, t, t('employees.errorDeactivate')));
    } finally {
      setDeactivating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '64px' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !employee) {
    return (
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <Alert variant="danger" title={t('common.error')}>
          {error ?? t('employees.notFound')}
        </Alert>
      </div>
    );
  }

  const fullName = `${employee.name} ${employee.surname}`;
  const initials = `${employee.name?.[0] ?? ''}${employee.surname?.[0] ?? ''}`.toUpperCase();
  const avatarBg = getAvatarColor(fullName);

  const workingTypeLabel = employee.workingType === 'full_time'
    ? t('employees.fullTime')
    : employee.workingType === 'part_time'
    ? t('employees.partTime')
    : '—';

  return (
    <div className="page-enter" style={{ maxWidth: '1000px', margin: '0 auto' }}>

      {/* Back nav */}
      <button
        onClick={() => navigate('/dipendenti')}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          fontSize: '13px', color: 'var(--text-muted)', fontFamily: 'var(--font-body)',
          cursor: 'pointer', background: 'none', border: 'none', padding: '0 0 16px',
          fontWeight: 500, transition: 'color 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
      >
        <IconBack /> {t('employees.backToList')}
      </button>

      {/* Hero card */}
      <div style={{
        background: 'linear-gradient(135deg, var(--primary) 0%, #1A3B5C 100%)',
        borderRadius: 'var(--radius-lg)',
        padding: '28px 32px',
        marginBottom: '24px',
        boxShadow: '0 4px 24px rgba(13,33,55,0.22)',
        display: 'flex',
        alignItems: 'center',
        gap: '24px',
        flexWrap: 'wrap',
      }}>
        {/* Avatar */}
        <div style={{
          width: 72, height: 72, borderRadius: '50%',
          background: avatarBg,
          border: '3px solid rgba(201,151,58,0.40)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '24px', fontWeight: 700, color: '#fff',
          fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
          flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
        }}>
          {initials}
        </div>

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 700,
            color: '#FFFFFF', margin: '0 0 8px', letterSpacing: '-0.02em',
          }}>
            {fullName}
          </h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <Badge variant={ROLE_BADGE_VARIANT[employee.role]}>
              {tRole(employee.role)}
            </Badge>
            <Badge variant={employee.status === 'active' ? 'success' : 'danger'}>
              {employee.status === 'active' ? t('employees.statusActive') : t('employees.statusInactive')}
            </Badge>
          </div>
          <div style={{
            marginTop: '10px', fontSize: '12.5px', color: 'rgba(255,255,255,0.55)',
            display: 'flex', gap: '16px', flexWrap: 'wrap',
          }}>
            {employee.email && <span>{employee.email}</span>}
            {employee.department && <span>· {employee.department}</span>}
            {employee.storeName && <span>· {employee.storeName}</span>}
            {employee.uniqueId && (
              <span style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}>
                · ID: {employee.uniqueId}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {(isAdminOrHr || (isAdmin && employee.status === 'active')) && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {isAdminOrHr && (
              <button
                onClick={() => setShowEditForm(true)}
                className="btn btn-secondary"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(255,255,255,0.20)',
                  background: 'rgba(255,255,255,0.08)',
                  color: '#FFFFFF', fontSize: '13px', fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                <IconEdit /> {t('common.edit')}
              </button>
            )}
            {isAdmin && employee.status === 'active' && (
              <button
                onClick={() => setShowDeactivateModal(true)}
                className="btn btn-danger"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(220,38,38,0.40)',
                  background: 'rgba(220,38,38,0.15)',
                  color: '#FCA5A5', fontSize: '13px', fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                <IconOff /> {t('common.deactivate')}
              </button>
            )}
            {isAdmin && employee.status === 'inactive' && (
              <button
                onClick={() => setShowActivateModal(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(21,128,61,0.40)',
                  background: 'rgba(21,128,61,0.15)',
                  color: '#86EFAC', fontSize: '13px', fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                <IconOn /> {t('common.activate')}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Detail cards */}
      <div style={{ display: 'grid', gridTemplateColumns: (canViewSensitive && !isMobile) ? '1fr 1fr' : '1fr', gap: '20px' }}>

        {/* General info */}
        <SectionPanel title={t('employees.generalInfo')} icon={<IconUser />}>
          <InfoRow label={t('employees.emailField')} value={employee.email} />
          <InfoRow label={t('employees.colUniqueId')} value={
            employee.uniqueId
              ? <span style={{ fontFamily: 'var(--font-display)', fontSize: '12.5px', letterSpacing: '0.04em' }}>{employee.uniqueId}</span>
              : '—'
          } />
          <InfoRow label={t('common.role')} value={
            <Badge variant={ROLE_BADGE_VARIANT[employee.role]}>{tRole(employee.role)}</Badge>
          } />
          <InfoRow label={t('common.status')} value={
            <Badge variant={employee.status === 'active' ? 'success' : 'danger'}>
              {employee.status === 'active' ? t('employees.statusActive') : t('employees.statusInactive')}
            </Badge>
          } />
          <InfoRow label={t('common.department')} value={employee.department ?? '—'} />
          <InfoRow label={t('common.store')} value={employee.storeName ?? '—'} />
          <InfoRow label={t('employees.supervisorField')} value={employee.supervisorName ?? '—'} last />
        </SectionPanel>

        {/* Sensitive / contractual info */}
        {canViewSensitive && (
          <SectionPanel title={t('employees.contractualDetails')} icon={<IconFile />}>
            <InfoRow label={t('employees.hireDateField')} value={formatDate(employee.hireDate, i18n.language)} />
            <InfoRow label={t('employees.contractEndField')} value={
              employee.contractEndDate
                ? <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{formatDate(employee.contractEndDate, i18n.language)}</span>
                : '—'
            } />
            <InfoRow label={t('employees.workingTypeField')} value={workingTypeLabel} />
            <InfoRow label={t('employees.weeklyHoursField')} value={employee.weeklyHours != null ? `${employee.weeklyHours}h` : '—'} />
            <InfoRow label={t('employees.personalEmailField')} value={employee.personalEmail ?? '—'} />
            <InfoRow label={t('employees.dateOfBirthField')} value={formatDate(employee.dateOfBirth, i18n.language)} />
            <InfoRow label={t('employees.ibanField')} value={
              employee.iban
                ? <span style={{ fontFamily: 'var(--font-display)', fontSize: '12px', letterSpacing: '0.06em' }}>{maskIban(employee.iban)}</span>
                : '—'
            } />
            <InfoRow label={t('employees.nationalityField')} value={employee.nationality ?? '—'} />
            <InfoRow label={t('employees.genderField')} value={employee.gender ?? '—'} />
            <InfoRow label={t('employees.addressField')} value={employee.address ? `${employee.address}${employee.cap ? `, ${employee.cap}` : ''}` : '—'} />
            <InfoRow label={t('employees.firstAidField')} value={
              <span style={{ color: employee.firstAidFlag ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                {employee.firstAidFlag ? t('common.yes') : t('common.no')}
              </span>
            } />
            <InfoRow label={t('employees.maritalStatusField')} value={employee.maritalStatus ?? '—'} last />
          </SectionPanel>
        )}
      </div>

      {/* Edit drawer */}
      {showEditForm && employeeId && (
        <EmployeeForm
          employeeId={employeeId}
          onSuccess={() => { setShowEditForm(false); showToast(t('employees.updatedSuccess'), 'success'); loadEmployee(); }}
          onCancel={() => setShowEditForm(false)}
        />
      )}

      {/* Activate modal */}
      <Modal
        open={showActivateModal}
        onClose={() => setShowActivateModal(false)}
        title={t('employees.confirmActivate')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowActivateModal(false)} disabled={activating}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleActivate} loading={activating}>
              {t('common.activate')}
            </Button>
          </>
        }
      >
        {activateError && (
          <div style={{ marginBottom: '12px' }}>
            <Alert variant="danger" title={t('common.error')}>{activateError}</Alert>
          </div>
        )}
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-primary)' }}>
          {t('employees.confirmActivateMsg', { name: fullName })}
        </p>
      </Modal>

      {/* Deactivate modal */}
      <Modal
        open={showDeactivateModal}
        onClose={() => setShowDeactivateModal(false)}
        title={t('employees.confirmDeactivate')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setShowDeactivateModal(false)} disabled={deactivating}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeactivate} loading={deactivating}>
              {t('common.deactivate')}
            </Button>
          </>
        }
      >
        {deactivateError && (
          <div style={{ marginBottom: '12px' }}>
            <Alert variant="danger" title={t('common.error')}>{deactivateError}</Alert>
          </div>
        )}
        <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: '14px', color: 'var(--text-primary)' }}>
          {t('employees.confirmDeactivateMsg', { name: fullName })}
        </p>
      </Modal>
    </div>
  );
}

export default EmployeeDetail;
