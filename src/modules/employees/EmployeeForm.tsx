import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { getEmployee, createEmployee, updateEmployee, getEmployees } from '../../api/employees';
import { translateApiError } from '../../utils/apiErrors';
import { getStores } from '../../api/stores';
import { Employee, Store, UserRole } from '../../types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Select } from '../../components/ui/Select';
import { Alert } from '../../components/ui/Alert';
import { Spinner } from '../../components/ui/Spinner';
import { DatePicker } from '../../components/ui/DatePicker';

interface EmployeeFormProps {
  employeeId?: number;
  onSuccess: () => void;
  onCancel: () => void;
}

interface FormData {
  name: string;
  surname: string;
  email: string;
  uniqueId: string;
  role: UserRole | '';
  storeId: string;
  supervisorId: string;
  department: string;
  hireDate: string;
  contractEndDate: string;
  workingType: 'full_time' | 'part_time' | '';
  weeklyHours: string;
  personalEmail: string;
  dateOfBirth: string;
  nationality: string;
  gender: string;
  iban: string;
  address: string;
  cap: string;
  firstAidFlag: boolean;
  maritalStatus: string;
  contractType: string;
  probationMonths: string;
  terminationDate: string;
  terminationType: string;
}

const initialFormData: FormData = {
  name: '', surname: '', email: '', uniqueId: '', role: '',
  storeId: '', supervisorId: '', department: '',
  hireDate: '', contractEndDate: '', workingType: '', weeklyHours: '',
  personalEmail: '', dateOfBirth: '', nationality: '', gender: '',
  iban: '', address: '', cap: '', firstAidFlag: false, maritalStatus: '',
  contractType: '', probationMonths: '', terminationDate: '', terminationType: '',
};

function generateUniqueId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = 'EMP-';
  for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '10px',
      margin: '4px 0 20px',
    }}>
      <span style={{
        fontSize: '10px', fontWeight: 700, color: 'var(--text-muted)',
        fontFamily: 'var(--font-display)', textTransform: 'uppercase',
        letterSpacing: '0.1em', whiteSpace: 'nowrap',
      }}>
        {label}
      </span>
      <div style={{ flex: 1, height: '1px', background: 'var(--border-light)' }} />
    </div>
  );
}

export function EmployeeForm({ employeeId, onSuccess, onCancel }: EmployeeFormProps) {
  const isEditMode = employeeId !== undefined;
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();

  const row2: React.CSSProperties = {
    display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '14px', marginBottom: '14px',
  };
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [stores, setStores] = useState<Store[]>([]);
  const [supervisors, setSupervisors] = useState<Employee[]>([]);
  const [loadingSupervisors, setLoadingSupervisors] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingData, setLoadingData] = useState(isEditMode);
  const [error, setError] = useState<string | null>(null);
  const [step1Errors, setStep1Errors] = useState<Partial<Record<keyof FormData, string>>>({});

  const tRole = (roleKey: string) => (t as (k: string) => string)(`roles.${roleKey}`);

  useEffect(() => {
    getStores().then(setStores).catch(() => {
      setError(t('employees.errorLoadStores'));
    });
  }, []);

  // Load supervisor options (same company, filtered client-side)
  useEffect(() => {
    let mounted = true;
    setLoadingSupervisors(true);
    getEmployees({ limit: 500 })
      .then((res) => {
        if (!mounted) return;
        const eligibleRoles: UserRole[] = ['admin', 'hr', 'area_manager', 'store_manager'];
        const list = (res?.employees ?? [])
          .filter((e) => eligibleRoles.includes(e.role))
          .filter((e) => (employeeId ? e.id !== employeeId : true));
        setSupervisors(list);
      })
      .catch(() => {
        // Non-blocking: user can still save without supervisor
        if (!mounted) return;
        setSupervisors([]);
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingSupervisors(false);
      });
    return () => { mounted = false; };
  }, [employeeId]);

  // Auto-generate uniqueId for new employees only
  useEffect(() => {
    if (!isEditMode) {
      setFormData((prev) => ({ ...prev, uniqueId: generateUniqueId() }));
    }
  }, [isEditMode]);

  useEffect(() => {
    if (!isEditMode || !employeeId) return;
    let mounted = true;
    setLoadingData(true);
    getEmployee(employeeId)
      .then((emp) => {
        if (!mounted) return;
        setFormData({
          name: emp.name ?? '',
          surname: emp.surname ?? '',
          email: emp.email ?? '',
          uniqueId: emp.uniqueId ?? '',
          role: emp.role ?? '',
          storeId: emp.storeId != null ? String(emp.storeId) : '',
          supervisorId: emp.supervisorId != null ? String(emp.supervisorId) : '',
          department: emp.department ?? '',
          hireDate: emp.hireDate ?? '',
          contractEndDate: emp.contractEndDate ?? '',
          workingType: emp.workingType ?? '',
          weeklyHours: emp.weeklyHours != null ? String(emp.weeklyHours) : '',
          personalEmail: emp.personalEmail ?? '',
          dateOfBirth: emp.dateOfBirth ?? '',
          nationality: emp.nationality ?? '',
          gender: emp.gender ?? '',
          iban: emp.iban ?? '',
          address: emp.address ?? '',
          cap: emp.cap ?? '',
          firstAidFlag: emp.firstAidFlag ?? false,
          maritalStatus: emp.maritalStatus ?? '',
          contractType: emp.contractType ?? '',
          probationMonths: emp.probationMonths != null ? String(emp.probationMonths) : '',
          terminationDate: emp.terminationDate ? emp.terminationDate.split('T')[0] : '',
          terminationType: emp.terminationType ?? '',
        });
      })
      .catch(() => {
        if (!mounted) return;
        setError(t('employees.errorLoadData'));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingData(false);
      });
    return () => { mounted = false; };
  }, [isEditMode, employeeId]);

  const set = (field: keyof FormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (step1Errors[field]) setStep1Errors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateStep1 = (): boolean => {
    const errs: Partial<Record<keyof FormData, string>> = {};
    if (!formData.name.trim()) errs.name = t('employees.fieldRequired');
    if (!formData.surname.trim()) errs.surname = t('employees.fieldRequired');
    if (!formData.email.trim()) {
      errs.email = t('employees.fieldRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      errs.email = t('employees.emailInvalid');
    }
    if (!formData.role) errs.role = t('employees.fieldRequired');
    if (!isEditMode && !formData.uniqueId.trim()) errs.uniqueId = t('employees.fieldRequired');
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleNext = () => { if (validateStep1()) setStep(2); };
  const handleBack = () => setStep(1);

  const validateStep2 = (): string | null => {
    // Weekly hours
    if (formData.weeklyHours) {
      const hours = parseFloat(formData.weeklyHours);
      if (isNaN(hours) || hours < 0 || hours > 80) return t('employees.weeklyHoursInvalid');
    }
    // Probation months max
    if (formData.probationMonths) {
      const months = parseInt(formData.probationMonths, 10);
      if (isNaN(months) || months < 0 || months > 60) return t('employees.probationInvalid');
    }
    // Personal email format
    if (formData.personalEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.personalEmail)) {
      return t('employees.emailInvalid');
    }
    // Italian CAP: exactly 5 digits
    if (formData.cap && !/^\d{5}$/.test(formData.cap.trim())) {
      return t('employees.capInvalid');
    }
    // IBAN basic check: 15–34 alphanumeric chars
    if (formData.iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(formData.iban.trim().toUpperCase())) {
      return t('employees.ibanInvalid');
    }
    // contractEndDate must be after hireDate
    if (formData.hireDate && formData.contractEndDate && formData.contractEndDate < formData.hireDate) {
      return t('employees.contractEndBeforeHire');
    }
    // Termination date/type must both be set or neither
    if (formData.terminationDate && !formData.terminationType) return t('employees.terminationTypeMissing');
    if (formData.terminationType && !formData.terminationDate) return t('employees.terminationDateMissing');
    // Termination date must not be before hire date
    if (formData.hireDate && formData.terminationDate && formData.terminationDate < formData.hireDate) {
      return t('employees.terminationBeforeHire');
    }
    return null;
  };

  const handleSubmit = async () => {
    const step2Error = validateStep2();
    if (step2Error) { setError(step2Error); return; }
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: formData.name,
        surname: formData.surname,
        email: formData.email,
        uniqueId: formData.uniqueId || undefined,
        role: formData.role as UserRole,
        storeId: formData.storeId ? parseInt(formData.storeId, 10) : null,
        supervisorId: formData.supervisorId ? parseInt(formData.supervisorId, 10) : null,
        department: formData.department || undefined,
        hireDate: formData.hireDate || undefined,
        contractEndDate: formData.contractEndDate || undefined,
        workingType: (formData.workingType as 'full_time' | 'part_time') || null,
        weeklyHours: formData.weeklyHours ? parseFloat(formData.weeklyHours) : null,
        personalEmail: formData.personalEmail || null,
        dateOfBirth: formData.dateOfBirth || null,
        nationality: formData.nationality || null,
        gender: formData.gender || null,
        iban: formData.iban || null,
        address: formData.address || null,
        cap: formData.cap || null,
        firstAidFlag: formData.firstAidFlag,
        maritalStatus: formData.maritalStatus || null,
        contractType: formData.contractType || null,
        probationMonths: formData.probationMonths ? parseInt(formData.probationMonths, 10) : null,
        terminationDate: formData.terminationDate || null,
        terminationType: formData.terminationType || null,
      };
      if (isEditMode && employeeId) {
        await updateEmployee(employeeId, payload);
      } else {
        await createEmployee({ ...payload, email: formData.email, name: formData.name, surname: formData.surname, role: formData.role as UserRole });
      }
      onSuccess();
    } catch (err: unknown) {
      setError(translateApiError(err, t, t('employees.errorSave')));
    } finally {
      setLoading(false);
    }
  };

  const drawerTitle = isEditMode ? t('employees.editEmployee') : t('employees.newEmployeeTitle');

  return createPortal(
    <div
      className="drawer-backdrop"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        display: 'flex', justifyContent: 'flex-end',
        background: 'rgba(13, 33, 55, 0.48)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onCancel}
    >
      {/* Drawer panel */}
      <div
        className="drawer-panel"
        style={{
          position: 'relative',
          width: 'min(560px, 100vw)',
          height: '100%',
          background: 'var(--surface)',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 48px rgba(0,0,0,0.16)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Gold-to-navy accent stripe at top */}
        <div style={{
          height: '3px', flexShrink: 0,
          background: 'linear-gradient(90deg, var(--accent) 0%, var(--primary) 100%)',
        }} />

        {/* Header */}
        <div style={{
          padding: '20px 24px 18px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        }}>
          <div>
            <h2 style={{
              fontSize: '17px', fontWeight: 700, color: 'var(--text-primary)',
              fontFamily: 'var(--font-display)', margin: '0 0 3px', letterSpacing: '-0.02em',
            }}>
              {drawerTitle}
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, fontFamily: 'var(--font-body)' }}>
              {isEditMode
                ? t('employees.editEmployee')
                : `${t('employees.step1')} & ${t('employees.step2')}`}
            </p>
          </div>
          <button
            onClick={onCancel}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: '4px 6px',
              fontSize: '22px', lineHeight: 1, borderRadius: 'var(--radius-sm)',
              display: 'flex', alignItems: 'center', marginTop: '-2px',
              transition: 'color 0.15s',
            }}
            aria-label="Chiudi"
          >
            ×
          </button>
        </div>

        {/* Step indicator */}
        <div style={{
          padding: '14px 24px',
          borderBottom: '1px solid var(--border-light)',
          background: 'var(--surface-warm)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {([1, 2] as const).map((s, i) => (
              <React.Fragment key={s}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                    background: step >= s ? 'var(--primary)' : 'var(--border)',
                    color: step >= s ? '#fff' : 'var(--text-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: '11px', fontWeight: 700, fontFamily: 'var(--font-display)',
                    transition: 'background 0.25s ease, color 0.25s ease',
                    boxShadow: step === s ? '0 0 0 3px rgba(13,33,55,0.12)' : 'none',
                  }}>
                    {step > s ? '✓' : s}
                  </div>
                  <span style={{
                    fontSize: '10px', fontFamily: 'var(--font-body)',
                    fontWeight: step === s ? 700 : 400,
                    color: step === s ? 'var(--primary)' : 'var(--text-muted)',
                    textTransform: 'uppercase', letterSpacing: '0.07em', whiteSpace: 'nowrap',
                  }}>
                    {s === 1 ? t('employees.step1') : t('employees.step2')}
                  </span>
                </div>
                {i === 0 && (
                  <div style={{
                    flex: 1, height: '2px', margin: '0 10px', marginBottom: '18px',
                    background: step > 1 ? 'var(--primary)' : 'var(--border)',
                    transition: 'background 0.3s ease',
                    borderRadius: '2px',
                  }} />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '16px' : '24px' }}>
          {loadingData ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '56px' }}>
              <Spinner size="md" />
            </div>
          ) : (
            <>
              {error && (
                <div style={{ marginBottom: '16px' }}>
                  <Alert variant="danger" title={t('common.error')}>{error}</Alert>
                </div>
              )}

              {/* ── Step 1 ── */}
              {step === 1 && (
                <div>
                  <SectionDivider label={t('employees.step1')} />
                  <div style={row2}>
                    <Input
                      label={`${t('common.name')} *`}
                      value={formData.name}
                      onChange={(e) => set('name', e.target.value)}
                      error={step1Errors.name}
                    />
                    <Input
                      label={`${t('common.surname')} *`}
                      value={formData.surname}
                      onChange={(e) => set('surname', e.target.value)}
                      error={step1Errors.surname}
                    />
                  </div>
                  <div style={row2}>
                    <Input
                      label={`${t('employees.emailField')} *`}
                      type="email"
                      value={formData.email}
                      onChange={(e) => set('email', e.target.value)}
                      error={step1Errors.email}
                    />
                    <div>
                      <Input
                        label={isEditMode ? t('employees.colUniqueId') : `${t('employees.colUniqueId')} *`}
                        value={formData.uniqueId}
                        onChange={(e) => set('uniqueId', e.target.value)}
                        error={step1Errors.uniqueId}
                      />
                      {!isEditMode && (
                        <button
                          type="button"
                          onClick={() => set('uniqueId', generateUniqueId())}
                          style={{
                            marginTop: '5px', background: 'none', border: 'none',
                            cursor: 'pointer', fontSize: '11px', color: 'var(--accent)',
                            fontFamily: 'var(--font-body)', fontWeight: 500,
                            padding: '2px 0', display: 'flex', alignItems: 'center', gap: '4px',
                          }}
                        >
                          ↻ {t('employees.regenerateId')}
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{ marginBottom: '14px' }}>
                    <Select
                      label={`${t('common.role')} *`}
                      value={formData.role}
                      onChange={(e) => set('role', e.target.value)}
                      error={step1Errors.role}
                    >
                      <option value="">{t('employees.selectRole')}</option>
                      <option value="admin">{tRole('admin')}</option>
                      <option value="hr">{tRole('hr')}</option>
                      <option value="area_manager">{tRole('area_manager')}</option>
                      <option value="store_manager">{tRole('store_manager')}</option>
                      <option value="employee">{tRole('employee')}</option>
                      <option value="store_terminal">{tRole('store_terminal')}</option>
                    </Select>
                  </div>

                  <SectionDivider label={t('common.store')} />
                  <div style={row2}>
                    <Select
                      label={t('common.store')}
                      value={formData.storeId}
                      onChange={(e) => set('storeId', e.target.value)}
                    >
                      <option value="">{t('employees.noStore')}</option>
                      {stores.map((s) => (
                        <option key={s.id} value={String(s.id)}>{s.name}</option>
                      ))}
                    </Select>
                  <Select
                    label={t('employees.supervisorField')}
                    value={formData.supervisorId}
                    onChange={(e) => set('supervisorId', e.target.value)}
                    disabled={loadingSupervisors}
                  >
                    <option value="">{t('employees.noSupervisor')}</option>
                    {supervisors.map((s) => (
                      <option key={s.id} value={String(s.id)}>
                        {s.name} {s.surname} ({tRole(s.role)}){s.storeName ? ` — ${s.storeName}` : ''}
                      </option>
                    ))}
                  </Select>
                  </div>
                  <div>
                    <Input
                      label={t('common.department')}
                      value={formData.department}
                      onChange={(e) => set('department', e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* ── Step 2 ── */}
              {step === 2 && (
                <div>
                  <SectionDivider label={t('employees.hireDateField')} />
                  <div style={row2}>
                    <DatePicker
                      label={t('employees.hireDateField')}
                      value={formData.hireDate}
                      onChange={(v) => set('hireDate', v)}
                    />
                    <DatePicker
                      label={t('employees.contractEndField')}
                      value={formData.contractEndDate}
                      onChange={(v) => set('contractEndDate', v)}
                    />
                  </div>
                  <div style={row2}>
                    <Select
                      label={t('employees.workingTypeField')}
                      value={formData.workingType}
                      onChange={(e) => set('workingType', e.target.value)}
                    >
                      <option value="">{t('employees.selectOption')}</option>
                      <option value="full_time">{t('employees.fullTime')}</option>
                      <option value="part_time">{t('employees.partTime')}</option>
                    </Select>
                    <Input
                      label={t('employees.weeklyHoursField')}
                      type="number"
                      min="0" max="80" step="0.5"
                      value={formData.weeklyHours}
                      onChange={(e) => set('weeklyHours', e.target.value)}
                    />
                  </div>

                  <SectionDivider label={t('employees.contractualDetails')} />
                  <div style={row2}>
                    <Input
                      label={t('employees.personalEmailField')}
                      type="email"
                      value={formData.personalEmail}
                      onChange={(e) => set('personalEmail', e.target.value)}
                    />
                    <DatePicker
                      label={t('employees.dateOfBirthField')}
                      value={formData.dateOfBirth}
                      onChange={(v) => set('dateOfBirth', v)}
                      initialViewYear={new Date().getFullYear() - 30}
                    />
                  </div>
                  <div style={row2}>
                    <Input
                      label={t('employees.nationalityField')}
                      value={formData.nationality}
                      onChange={(e) => set('nationality', e.target.value)}
                    />
                    <Select
                      label={t('employees.genderField')}
                      value={formData.gender}
                      onChange={(e) => set('gender', e.target.value)}
                    >
                      <option value="">{t('employees.selectOption')}</option>
                      <option value="M">{t('employees.genderMale')}</option>
                      <option value="F">{t('employees.genderFemale')}</option>
                      <option value="other">{t('employees.genderOther')}</option>
                    </Select>
                  </div>
                  <div style={{ marginBottom: '14px' }}>
                    <Input
                      label={t('employees.ibanField')}
                      value={formData.iban}
                      onChange={(e) => set('iban', e.target.value)}
                      placeholder={t('employees.ibanPlaceholder')}
                    />
                  </div>

                  <SectionDivider label={t('employees.addressField')} />
                  <div style={row2}>
                    <Input
                      label={t('employees.addressField')}
                      value={formData.address}
                      onChange={(e) => set('address', e.target.value)}
                    />
                    <Input
                      label={t('employees.capField')}
                      value={formData.cap}
                      onChange={(e) => set('cap', e.target.value)}
                    />
                  </div>
                  <div style={row2}>
                    <Select
                      label={t('employees.maritalStatusField')}
                      value={formData.maritalStatus}
                      onChange={(e) => set('maritalStatus', e.target.value)}
                    >
                      <option value="">{t('employees.selectOption')}</option>
                      <option value="Celibe">{t('employees.marital_celibe')}</option>
                      <option value="Nubile">{t('employees.marital_nubile')}</option>
                      <option value="Coniugato">{t('employees.marital_coniugato')}</option>
                      <option value="Coniugata">{t('employees.marital_coniugata')}</option>
                      <option value="Divorziato">{t('employees.marital_divorziato')}</option>
                      <option value="Divorziata">{t('employees.marital_divorziata')}</option>
                      <option value="Vedovo">{t('employees.marital_vedovo')}</option>
                      <option value="Vedova">{t('employees.marital_vedova')}</option>
                      <option value="Separato">{t('employees.marital_separato')}</option>
                      <option value="Separata">{t('employees.marital_separata')}</option>
                      <option value="Unione Civile">{t('employees.marital_unione_civile')}</option>
                    </Select>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '9px', paddingTop: '22px' }}>
                      <input
                        id="firstAidFlag"
                        type="checkbox"
                        checked={formData.firstAidFlag}
                        onChange={(e) => set('firstAidFlag', e.target.checked)}
                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: 'var(--primary)' }}
                      />
                      <label
                        htmlFor="firstAidFlag"
                        style={{
                          fontSize: '13px', fontWeight: 500,
                          color: 'var(--text-primary)', fontFamily: 'var(--font-body)',
                          cursor: 'pointer',
                        }}
                      >
                        {t('employees.firstAidField')}
                      </label>
                    </div>
                  </div>
                  <div style={row2}>
                    <Select
                      label={t('employees.contractTypeField')}
                      value={formData.contractType}
                      onChange={(e) => set('contractType', e.target.value)}
                    >
                      <option value="">{t('employees.selectOption')}</option>
                      <option value="Tempo Indeterminato">{t('employees.contractType_indeterminato')}</option>
                      <option value="Tempo Determinato">{t('employees.contractType_determinato')}</option>
                      <option value="Apprendistato">{t('employees.contractType_apprendistato')}</option>
                      <option value="Stage / Tirocinio">{t('employees.contractType_stage')}</option>
                      <option value="Partita IVA / Collaborazione">{t('employees.contractType_partita_iva')}</option>
                      <option value="Altro">{t('employees.contractType_altro')}</option>
                    </Select>
                    <Input
                      label={t('employees.probationField')}
                      type="number"
                      min="0"
                      value={formData.probationMonths}
                      onChange={(e) => set('probationMonths', e.target.value)}
                      placeholder={t('employees.probationPlaceholder')}
                    />
                  </div>
                  <div style={row2}>
                    <DatePicker
                      label={t('employees.terminationDateField')}
                      value={formData.terminationDate}
                      onChange={(v) => set('terminationDate', v)}
                    />
                    <Select
                      label={t('employees.terminationTypeField')}
                      value={formData.terminationType}
                      onChange={(e) => set('terminationType', e.target.value)}
                    >
                      <option value="">{t('employees.selectOption')}</option>
                      <option value="Dimissioni volontarie">{t('employees.terminationType_dimissioni')}</option>
                      <option value="Fine contratto">{t('employees.terminationType_fine_contratto')}</option>
                      <option value="Licenziamento">{t('employees.terminationType_licenziamento')}</option>
                      <option value="Pensionamento">{t('employees.terminationType_pensionamento')}</option>
                      <option value="Risoluzione consensuale">{t('employees.terminationType_consensuale')}</option>
                      <option value="Altro">{t('employees.terminationType_altro')}</option>
                    </Select>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border)',
          background: 'var(--surface-warm)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          flexShrink: 0,
        }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              background: 'none', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '8px 16px',
              fontSize: '13px', color: 'var(--text-secondary)',
              fontFamily: 'var(--font-body)', cursor: 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {t('common.cancel')}
          </button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {step === 2 && (
              <Button variant="secondary" onClick={handleBack} disabled={loading}>
                ← {t('common.back')}
              </Button>
            )}
            {step === 1 && (
              <Button variant="primary" onClick={handleNext}>
                {t('common.next')} →
              </Button>
            )}
            {step === 2 && (
              <Button variant="primary" onClick={handleSubmit} loading={loading}>
                {t('common.save')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default EmployeeForm;
