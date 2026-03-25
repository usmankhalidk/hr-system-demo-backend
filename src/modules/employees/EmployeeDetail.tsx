import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getEmployee, deactivateEmployee, activateEmployee, uploadEmployeeAvatar } from '../../api/employees';
import { getTrainings, getMedicals, createTraining, updateTraining, createMedical, updateMedical } from '../../api/trainings';
import { translateApiError } from '../../utils/apiErrors';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Employee, UserRole, Training, MedicalCheck, TrainingType } from '../../types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Spinner } from '../../components/ui/Spinner';
import { Alert } from '../../components/ui/Alert';
import { Modal } from '../../components/ui/Modal';
import { DatePicker } from '../../components/ui/DatePicker';
import { EmployeeForm } from './EmployeeForm';
import { MessageBoard } from '../messages/MessageBoard';
import { ComposeMessage } from '../messages/ComposeMessage';

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

// ── Translation lookup maps ────────────────────────────────────────────────────
const MARITAL_STATUS_KEYS: Record<string, string> = {
  'Celibe': 'employees.marital_celibe',
  'Nubile': 'employees.marital_nubile',
  'Coniugato': 'employees.marital_coniugato',
  'Coniugata': 'employees.marital_coniugata',
  'Divorziato': 'employees.marital_divorziato',
  'Divorziata': 'employees.marital_divorziata',
  'Vedovo': 'employees.marital_vedovo',
  'Vedova': 'employees.marital_vedova',
  'Separato': 'employees.marital_separato',
  'Separata': 'employees.marital_separata',
  'Unione Civile': 'employees.marital_unione_civile',
};

const CONTRACT_TYPE_KEYS: Record<string, string> = {
  'Tempo Indeterminato': 'employees.contractType_indeterminato',
  'Tempo Determinato': 'employees.contractType_determinato',
  'Apprendistato': 'employees.contractType_apprendistato',
  'Stage / Tirocinio': 'employees.contractType_stage',
  'Partita IVA / Collaborazione': 'employees.contractType_partita_iva',
  'Altro': 'employees.contractType_altro',
};

const TERMINATION_TYPE_KEYS: Record<string, string> = {
  'Dimissioni volontarie': 'employees.terminationType_dimissioni',
  'Fine contratto': 'employees.terminationType_fine_contratto',
  'Licenziamento': 'employees.terminationType_licenziamento',
  'Pensionamento': 'employees.terminationType_pensionamento',
  'Risoluzione consensuale': 'employees.terminationType_consensuale',
  'Altro': 'employees.terminationType_altro',
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null | undefined, lang: string): string {
  if (!dateStr) return '—';
  try {
    const locale = lang.startsWith('it') ? 'it-IT' : 'en-GB';
    return new Date(dateStr.split('T')[0] + 'T00:00:00Z').toLocaleDateString(locale);
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

  const [trainings, setTrainings] = useState<Training[]>([]);
  const [medicals, setMedicals] = useState<MedicalCheck[]>([]);
  const [trainingsLoading, setTrainingsLoading] = useState(false);
  const [editingTraining, setEditingTraining] = useState<{ trainingType?: TrainingType; startDate?: string | null; endDate?: string | null; editing?: number | null }>({});
  const [editingMedical, setEditingMedical] = useState<{ startDate?: string | null; endDate?: string | null; editing?: number | null }>({});
  const [trainingFormOpen, setTrainingFormOpen] = useState(false);
  const [trainingModalSaving, setTrainingModalSaving] = useState(false);
  const [trainingModalError, setTrainingModalError] = useState<string | null>(null);
  const [medicalFormOpen, setMedicalFormOpen] = useState(false);
  const [medicalModalSaving, setMedicalModalSaving] = useState(false);
  const [medicalModalError, setMedicalModalError] = useState<string | null>(null);

  const [avatarUploading, setAvatarUploading] = useState(false);
  const [showCompose, setShowCompose] = useState(false);

  const employeeId = id && !isNaN(parseInt(id, 10)) ? parseInt(id, 10) : undefined;
  const isAdminOrHr = user?.role === 'admin' || user?.role === 'hr';
  const isAdmin = user?.role === 'admin';
  const isOwnProfile = user?.id === employee?.id;
  const canViewSensitive = isAdminOrHr || isOwnProfile;

  const tRole = (roleKey: string) => (t as (k: string) => string)(`roles.${roleKey}`);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !employeeId) return;
    setAvatarUploading(true);
    try {
      const result = await uploadEmployeeAvatar(employeeId, file);
      showToast(t('employees.avatarSuccess'), 'success');
      await loadEmployee();
    } catch {
      showToast(t('employees.avatarError'), 'error');
    } finally {
      setAvatarUploading(false);
      const input = document.getElementById('avatar-upload') as HTMLInputElement;
      if (input) input.value = '';
    }
  };

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

  useEffect(() => {
    if (!employeeId || !canViewSensitive) return;
    setTrainingsLoading(true);
    Promise.all([getTrainings(employeeId), getMedicals(employeeId)])
      .then(([tr, med]) => { setTrainings(tr); setMedicals(med); })
      .catch(() => {})
      .finally(() => setTrainingsLoading(false));
  }, [employeeId, canViewSensitive]);

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
        {/* Avatar with upload */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%',
            background: employee.avatarFilename ? 'transparent' : avatarBg,
            border: '3px solid rgba(201,151,58,0.40)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '24px', fontWeight: 700, color: '#fff',
            fontFamily: 'var(--font-display)', letterSpacing: '0.04em',
            boxShadow: '0 4px 16px rgba(0,0,0,0.24)',
            overflow: 'hidden',
          }}>
            {employee.avatarFilename ? (
              <img
                src={`/uploads/avatars/${employee.avatarFilename}`}
                alt={fullName}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : initials}
          </div>
          {(isOwnProfile || isAdminOrHr) && (
            <>
              <input
                id="avatar-upload"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                style={{ display: 'none' }}
                onChange={handleAvatarUpload}
              />
              <label
                htmlFor="avatar-upload"
                title={t('employees.changeAvatar')}
                style={{
                  position: 'absolute', bottom: 0, right: 0,
                  width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--accent)', border: '2px solid var(--primary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: avatarUploading ? 'not-allowed' : 'pointer',
                  opacity: avatarUploading ? 0.6 : 1,
                }}
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </label>
            </>
          )}
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
        {isAdminOrHr && (
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
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
            {isAdminOrHr && !isOwnProfile && (
              <button
                onClick={() => setShowCompose(true)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '6px',
                  padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                  border: '1px solid rgba(201,151,58,0.30)',
                  background: 'rgba(201,151,58,0.12)',
                  color: 'rgba(201,151,58,0.9)', fontSize: '13px', fontWeight: 600,
                  fontFamily: 'var(--font-body)', cursor: 'pointer',
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
                {t('employees.sendMessage')}
              </button>
            )}
            {isAdminOrHr && employee.status === 'active' && (
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
            {isAdminOrHr && employee.status === 'inactive' && (
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
            <InfoRow label={t('employees.genderField')} value={
              employee.gender === 'M' ? t('employees.genderMale')
              : employee.gender === 'F' ? t('employees.genderFemale')
              : employee.gender === 'other' ? t('employees.genderOther')
              : '—'
            } />
            <InfoRow label={t('employees.addressField')} value={employee.address ? `${employee.address}${employee.cap ? `, ${employee.cap}` : ''}` : '—'} />
            <InfoRow label={t('employees.firstAidField')} value={
              <span style={{ color: employee.firstAidFlag ? 'var(--success)' : 'var(--text-muted)', fontWeight: 600 }}>
                {employee.firstAidFlag ? t('common.yes') : t('common.no')}
              </span>
            } />
            <InfoRow label={t('employees.maritalStatusField')} value={employee.maritalStatus ? t(MARITAL_STATUS_KEYS[employee.maritalStatus] ?? 'employees.maritalStatusField', { defaultValue: employee.maritalStatus }) : '—'} />
            <InfoRow label={t('employees.contractTypeField')} value={employee.contractType ? t(CONTRACT_TYPE_KEYS[employee.contractType] ?? 'employees.contractTypeField', { defaultValue: employee.contractType }) : '—'} />
            <InfoRow label={t('employees.probationField')} value={employee.probationMonths != null ? `${employee.probationMonths} ${t('employees.months')}` : '—'} />
            <InfoRow label={t('employees.terminationDateField')} value={formatDate(employee.terminationDate, i18n.language)} />
            <InfoRow label={t('employees.terminationTypeField')} value={employee.terminationType ? t(TERMINATION_TYPE_KEYS[employee.terminationType] ?? 'employees.terminationTypeField', { defaultValue: employee.terminationType }) : '—'} last />
          </SectionPanel>
        )}
      </div>

      {/* Training Records */}
      {canViewSensitive && (
        <div style={{ marginTop: 20 }}>
          <SectionPanel title={t('employees.trainingSection')} icon={<IconFile />}>
            {trainingsLoading ? (
              <div style={{ padding: '20px', textAlign: 'center' }}><Spinner size="sm" /></div>
            ) : (
              <div>
                {(['product', 'general', 'low_risk_safety', 'fire_safety'] as TrainingType[]).map((type) => {
                  const record = trainings
                    .filter(tr => tr.trainingType === type)
                    .sort((a, b) => (b.endDate ?? '').localeCompare(a.endDate ?? ''))[0];
                  return (
                    <div key={type} style={{ padding: '10px 0', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {t(`employees.trainingType_${type}`)}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        {record ? (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {formatDate(record.startDate, i18n.language)} → {formatDate(record.endDate, i18n.language)}
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                        )}
                        {isAdminOrHr && (
                          <Button size="sm" variant="secondary" onClick={() => {
                            const toDateStr = (d: string | null | undefined) => d ? d.split('T')[0] : null;
                            setEditingTraining({ trainingType: type, startDate: toDateStr(record?.startDate), endDate: toDateStr(record?.endDate), editing: record?.id ?? null });
                            setTrainingFormOpen(true);
                          }}>
                            {record ? t('common.edit') : t('employees.addTraining')}
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionPanel>
        </div>
      )}

      {/* Medical Checks */}
      {canViewSensitive && (
        <div style={{ marginTop: 20 }}>
          <SectionPanel title={t('employees.medicalSection')} icon={<IconFile />}>
            {medicals.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                {t('employees.noMedicals')}
              </div>
            ) : (
              medicals.map((m, i) => (
                <div key={m.id} style={{ padding: '10px 0', borderBottom: i < medicals.length - 1 ? '1px solid var(--border-light)' : 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)' }}>
                    {t('employees.medicalStartDate')}: {formatDate(m.startDate, i18n.language)} &nbsp;|&nbsp; {t('employees.medicalEndDate')}: {formatDate(m.endDate, i18n.language)}
                  </span>
                  {isAdminOrHr && (
                    <Button size="sm" variant="secondary" onClick={() => {
                      const toDateStr = (d: string | null | undefined) => d ? d.split('T')[0] : null;
                      setEditingMedical({ startDate: toDateStr(m.startDate), endDate: toDateStr(m.endDate), editing: m.id });
                      setMedicalFormOpen(true);
                    }}>
                      {t('common.edit')}
                    </Button>
                  )}
                </div>
              ))
            )}
            {isAdminOrHr && (
              <div style={{ padding: '10px 0' }}>
                <Button size="sm" onClick={() => { setEditingMedical({ editing: null }); setMedicalFormOpen(true); }}>
                  {t('employees.addMedical')}
                </Button>
              </div>
            )}
          </SectionPanel>
        </div>
      )}

      {/* Training Edit Modal */}
      <Modal
        open={trainingFormOpen}
        onClose={() => { setTrainingFormOpen(false); setTrainingModalError(null); }}
        title={editingTraining.editing != null ? t('common.edit') : t('employees.addTraining')}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setTrainingFormOpen(false); setTrainingModalError(null); }} disabled={trainingModalSaving}>{t('common.cancel')}</Button>
            <Button loading={trainingModalSaving} onClick={async () => {
              if (!employeeId) return;
              if (!editingTraining.startDate) {
                setTrainingModalError(t('employees.trainingStartDateRequired', 'La data di inizio è obbligatoria'));
                return;
              }
              setTrainingModalSaving(true);
              setTrainingModalError(null);
              try {
                const payload = {
                  trainingType: editingTraining.trainingType,
                  startDate: editingTraining.startDate,
                  endDate: editingTraining.endDate,
                };
                if (editingTraining.editing != null) {
                  await updateTraining(employeeId, editingTraining.editing, payload);
                } else {
                  await createTraining(employeeId, payload);
                }
                const tr = await getTrainings(employeeId);
                setTrainings(tr);
                setTrainingFormOpen(false);
                setTrainingModalError(null);
              } catch (err: unknown) {
                setTrainingModalError(translateApiError(err, t, t('employees.errorSave')));
              } finally {
                setTrainingModalSaving(false);
              }
            }}>{t('common.save')}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {trainingModalError && (
            <Alert variant="danger" title={t('common.error')} onClose={() => setTrainingModalError(null)}>
              {trainingModalError}
            </Alert>
          )}
          <DatePicker
            label={t('employees.trainingStartDate')}
            value={editingTraining.startDate ?? ''}
            onChange={(v) => setEditingTraining(p => ({ ...p, startDate: v || null }))}
          />
          <DatePicker
            label={t('employees.trainingEndDate')}
            value={editingTraining.endDate ?? ''}
            onChange={(v) => setEditingTraining(p => ({ ...p, endDate: v || null }))}
          />
        </div>
      </Modal>

      {/* Medical Edit Modal */}
      <Modal
        open={medicalFormOpen}
        onClose={() => { setMedicalFormOpen(false); setMedicalModalError(null); }}
        title={editingMedical.editing != null ? t('common.edit') : t('employees.addMedical')}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setMedicalFormOpen(false); setMedicalModalError(null); }} disabled={medicalModalSaving}>{t('common.cancel')}</Button>
            <Button loading={medicalModalSaving} onClick={async () => {
              if (!employeeId) return;
              if (!editingMedical.startDate) {
                setMedicalModalError(t('employees.medicalStartDateRequired', 'La data di inizio è obbligatoria'));
                return;
              }
              setMedicalModalSaving(true);
              setMedicalModalError(null);
              try {
                const payload = { startDate: editingMedical.startDate, endDate: editingMedical.endDate };
                if (editingMedical.editing != null) {
                  await updateMedical(employeeId, editingMedical.editing, payload);
                } else {
                  await createMedical(employeeId, payload);
                }
                const med = await getMedicals(employeeId);
                setMedicals(med);
                setMedicalFormOpen(false);
                setMedicalModalError(null);
              } catch (err: unknown) {
                setMedicalModalError(translateApiError(err, t, t('employees.errorSave')));
              } finally {
                setMedicalModalSaving(false);
              }
            }}>{t('common.save')}</Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {medicalModalError && (
            <Alert variant="danger" title={t('common.error')} onClose={() => setMedicalModalError(null)}>
              {medicalModalError}
            </Alert>
          )}
          <DatePicker
            label={t('employees.medicalStartDate')}
            value={editingMedical.startDate ?? ''}
            onChange={(v) => setEditingMedical(p => ({ ...p, startDate: v || null }))}
          />
          <DatePicker
            label={t('employees.medicalEndDate')}
            value={editingMedical.endDate ?? ''}
            onChange={(v) => setEditingMedical(p => ({ ...p, endDate: v || null }))}
          />
        </div>
      </Modal>

      {/* Communication board — only for own profile */}
      {isOwnProfile && employeeId && (
        <MessageBoard />
      )}

      {/* Compose message modal */}
      {showCompose && employee && (
        <ComposeMessage
          recipientId={employee.id}
          recipientName={fullName}
          onClose={() => setShowCompose(false)}
          onSent={() => showToast(t('messages.successSent'), 'success')}
        />
      )}

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
