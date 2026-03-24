import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useToast } from '../../context/ToastContext';
import { getStores, createStore, updateStore, deactivateStore, activateStore, deleteStorePermanent } from '../../api/stores';
import { translateApiError } from '../../utils/apiErrors';
import { Store } from '../../types';
import { Table, Column } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Alert } from '../../components/ui/Alert';

interface StoreFormData {
  name: string;
  code: string;
  address: string;
  cap: string;
  maxStaff: string;
}

const emptyForm: StoreFormData = {
  name: '',
  code: '',
  address: '',
  cap: '',
  maxStaff: '',
};

interface FormErrors {
  name?: string;
  code?: string;
}

// Words to skip when deriving a store code from the name
const SKIP_WORDS = new Set([
  'negozio', 'store', 'shop', 'il', 'la', 'lo', 'le', 'gli', 'i',
  'di', 'del', 'della', 'dei', 'delle', 'degli', 'the', 'a', 'an',
]);

function generateStoreCode(name: string, existingCodes: string[]): string {
  const words = name.trim().split(/\s+/);
  const meaningful = words.find((w) => {
    const clean = w.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    return clean.length >= 2 && !SKIP_WORDS.has(clean);
  });
  if (!meaningful) return '';

  const prefix = meaningful
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z]/g, '')
    .slice(0, 3)
    .toUpperCase();

  if (prefix.length < 2) return '';

  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  const nums = existingCodes
    .map((c) => { const m = c.match(pattern); return m ? parseInt(m[1], 10) : NaN; })
    .filter((n) => !isNaN(n));
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1;
  return `${prefix}-${String(next).padStart(2, '0')}`;
}

export function StoreList() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { isMobile } = useBreakpoint();
  const isAdmin = user?.role === 'admin';
  const isAdminOrHr = user?.role === 'admin' || user?.role === 'hr';
  const isSuperAdmin = user?.isSuperAdmin === true;

  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [formData, setFormData] = useState<StoreFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // true while the code field shows an auto-suggested value (new form only)
  const codeIsAuto = useRef(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivatingStore, setDeactivatingStore] = useState<Store | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

  const [activateOpen, setActivateOpen] = useState(false);
  const [activatingStore, setActivatingStore] = useState<Store | null>(null);
  const [activating, setActivating] = useState(false);
  const [activateError, setActivateError] = useState<string | null>(null);

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletingStore, setDeletingStore] = useState<Store | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const loadStores = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStores();
      setStores(data);
    } catch {
      setError(t('stores.errorLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStores();
  }, []);

  const openNewForm = () => {
    setEditingStore(null);
    setFormData(emptyForm);
    setFormErrors({});
    setFormError(null);
    codeIsAuto.current = true;
    setFormOpen(true);
  };

  const openEditForm = (store: Store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      code: store.code,
      address: store.address ?? '',
      cap: store.cap ?? '',
      maxStaff: store.maxStaff != null ? String(store.maxStaff) : '',
    });
    setFormErrors({});
    setFormError(null);
    codeIsAuto.current = false;
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingStore(null);
    setFormData(emptyForm);
    setFormErrors({});
    setFormError(null);
    codeIsAuto.current = false;
  };

  const validateForm = (): boolean => {
    const errors: FormErrors = {};
    if (!formData.name.trim()) errors.name = t('stores.validationName');
    if (!formData.code.trim()) errors.code = t('stores.validationCode');
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;
    setFormSaving(true);
    setFormError(null);
    try {
      const payload: Partial<Store> = {
        name: formData.name.trim(),
        code: formData.code.trim(),
        address: formData.address.trim() || null,
        cap: formData.cap.trim() || null,
        maxStaff: formData.maxStaff ? parseInt(formData.maxStaff, 10) : 0,
      };
      if (editingStore) {
        await updateStore(editingStore.id, payload);
        showToast(t('stores.updatedSuccess'), 'success');
      } else {
        await createStore(payload);
        showToast(t('stores.createdSuccess'), 'success');
      }
      closeForm();
      await loadStores();
    } catch (err: unknown) {
      setFormError(translateApiError(err, t, t('stores.errorSave')));
    } finally {
      setFormSaving(false);
    }
  };

  const openDelete = (store: Store) => {
    setDeletingStore(store);
    setDeleteError(null);
    setDeleteOpen(true);
  };

  const closeDelete = () => {
    setDeleteOpen(false);
    setDeletingStore(null);
    setDeleteError(null);
  };

  const handleDeletePermanent = async () => {
    if (!deletingStore) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStorePermanent(deletingStore.id);
      showToast(t('stores.deletedSuccess'), 'success');
      closeDelete();
      await loadStores();
    } catch (err: unknown) {
      setDeleteError(translateApiError(err, t, t('stores.errorDelete')));
    } finally {
      setDeleting(false);
    }
  };

  const openActivate = (store: Store) => {
    setActivatingStore(store);
    setActivateError(null);
    setActivateOpen(true);
  };

  const closeActivate = () => {
    setActivateOpen(false);
    setActivatingStore(null);
    setActivateError(null);
  };

  const handleActivate = async () => {
    if (!activatingStore) return;
    setActivating(true);
    setActivateError(null);
    try {
      await activateStore(activatingStore.id);
      showToast(t('stores.activatedSuccess'), 'success');
      closeActivate();
      await loadStores();
    } catch (err: unknown) {
      setActivateError(translateApiError(err, t, t('stores.errorActivate')));
    } finally {
      setActivating(false);
    }
  };

  const openConfirm = (store: Store) => {
    setDeactivatingStore(store);
    setDeactivateError(null);
    setConfirmOpen(true);
  };

  const closeConfirm = () => {
    setConfirmOpen(false);
    setDeactivatingStore(null);
    setDeactivateError(null);
  };

  const handleDeactivate = async () => {
    if (!deactivatingStore) return;
    setDeactivating(true);
    setDeactivateError(null);
    try {
      await deactivateStore(deactivatingStore.id);
      showToast(t('stores.deactivatedSuccess'), 'success');
      closeConfirm();
      await loadStores();
    } catch (err: unknown) {
      setDeactivateError(translateApiError(err, t, t('stores.errorDeactivate')));
    } finally {
      setDeactivating(false);
    }
  };

  const columns: Column<Store>[] = [
    ...(isSuperAdmin ? [{
      key: 'companyName' as keyof Store,
      label: t('stores.colCompany'),
      render: (row: Store) => (
        <span style={{ fontSize: '13px', color: row.companyName ? 'var(--text-secondary)' : 'var(--text-disabled)' }}>
          {row.companyName ?? '—'}
        </span>
      ),
    }] : []),
    { key: 'name', label: t('stores.colName') },
    { key: 'code', label: t('stores.colCode') },
    { key: 'address', label: t('stores.colAddress'), render: (row) => row.address ?? '—' },
    { key: 'cap', label: t('stores.colCap'), render: (row) => row.cap ?? '—' },
    { key: 'maxStaff', label: t('stores.colMaxStaff'), render: (row) => String(row.maxStaff) },
    { key: 'employeeCount', label: t('stores.colEmployees'), render: (row) => String(row.employeeCount ?? 0) },
    {
      key: 'isActive',
      label: t('stores.colStatus'),
      render: (row) =>
        row.isActive ? (
          <Badge variant="success">{t('common.active')}</Badge>
        ) : (
          <Badge variant="danger">{t('common.inactive')}</Badge>
        ),
    },
    {
      key: 'actions',
      label: t('stores.colActions'),
      render: (row) => (
        <div style={{ display: 'flex', gap: '8px' }}>
          {isAdmin && (
            <Button size="sm" variant="secondary" onClick={() => openEditForm(row)}>
              {t('common.edit')}
            </Button>
          )}
          {isAdmin && row.isActive && (
            <Button size="sm" variant="danger" onClick={() => openConfirm(row)}>
              {t('common.deactivate')}
            </Button>
          )}
          {isAdmin && !row.isActive && (
            <Button size="sm" variant="success" onClick={() => openActivate(row)}>
              {t('common.activate')}
            </Button>
          )}
          {isAdmin && !row.isActive && (
            <Button size="sm" variant="danger" onClick={() => openDelete(row)}>
              {t('common.delete')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        alignItems: isMobile ? 'flex-start' : 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <div>
          <h1 style={{
            fontSize: '22px',
            fontWeight: 700,
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
            margin: '0 0 3px',
            letterSpacing: '-0.02em',
          }}>
            {t('stores.title')}
          </h1>
          {!loading && (
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', margin: 0 }}>
              {stores.length > 0
                ? t('common.showingResults', { from: 1, to: stores.length, total: stores.length })
                : t('common.noData')}
            </p>
          )}
        </div>
        {isAdminOrHr && (
          <Button onClick={openNewForm}>{t('stores.newStore')}</Button>
        )}
      </div>

      {error && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="danger" title={t('common.error')} onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      <Table<Store>
        columns={columns}
        data={stores}
        loading={loading}
        emptyText={t('stores.noStores')}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={formOpen}
        onClose={closeForm}
        title={editingStore ? t('stores.editStore') : t('stores.newStore')}
        footer={
          <>
            <Button variant="secondary" onClick={closeForm} disabled={formSaving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} loading={formSaving}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {formError && (
            <Alert variant="danger" onClose={() => setFormError(null)}>
              {formError}
            </Alert>
          )}
          <Input
            label={t('stores.fieldName')}
            value={formData.name}
            onChange={(e) => {
              const name = e.target.value;
              setFormData((prev) => {
                if (codeIsAuto.current) {
                  const existingCodes = stores
                    .filter((s) => !editingStore || s.id !== editingStore.id)
                    .map((s) => s.code);
                  const suggested = generateStoreCode(name, existingCodes);
                  return { ...prev, name, code: suggested };
                }
                return { ...prev, name };
              });
            }}
            error={formErrors.name}
            placeholder={t('stores.placeholderName')}
          />
          <div>
            <Input
              label={t('stores.fieldCode')}
              value={formData.code}
              onChange={(e) => {
                codeIsAuto.current = false;
                setFormData((prev) => ({ ...prev, code: e.target.value.toUpperCase() }));
              }}
              error={formErrors.code}
              placeholder={t('stores.placeholderCode')}
            />
            {codeIsAuto.current && formData.code && (
              <p style={{ margin: '4px 0 0', fontSize: '11px', color: 'var(--text-muted)' }}>
                {t('stores.codeAutoHint')}
              </p>
            )}
          </div>
          <Input
            label={t('stores.fieldAddress')}
            value={formData.address}
            onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
            placeholder={t('stores.placeholderAddress')}
          />
          <Input
            label={t('stores.fieldCap')}
            value={formData.cap}
            onChange={(e) => setFormData((prev) => ({ ...prev, cap: e.target.value }))}
            placeholder={t('stores.placeholderCap')}
          />
          <Input
            label={t('stores.fieldMaxStaff')}
            type="number"
            min="0"
            value={formData.maxStaff}
            onChange={(e) => setFormData((prev) => ({ ...prev, maxStaff: e.target.value }))}
            placeholder={t('stores.placeholderMaxStaff')}
          />
        </div>
      </Modal>

      {/* Confirm Deactivate Modal */}
      <Modal
        open={confirmOpen}
        onClose={closeConfirm}
        title={t('stores.confirmDeactivate')}
        footer={
          <>
            <Button variant="secondary" onClick={closeConfirm} disabled={deactivating}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeactivate} loading={deactivating}>
              {t('common.deactivate')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {deactivateError && (
            <Alert variant="danger" onClose={() => setDeactivateError(null)}>
              {deactivateError}
            </Alert>
          )}
          <p style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('stores.confirmDeactivateMsg', { name: deactivatingStore?.name ?? '' })}
          </p>
        </div>
      </Modal>

      {/* Activate Modal */}
      <Modal
        open={activateOpen}
        onClose={closeActivate}
        title={t('stores.confirmActivate')}
        footer={
          <>
            <Button variant="secondary" onClick={closeActivate} disabled={activating}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleActivate} loading={activating}>
              {t('common.activate')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {activateError && (
            <Alert variant="danger" onClose={() => setActivateError(null)}>
              {activateError}
            </Alert>
          )}
          <p style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('stores.confirmActivateMsg', { name: activatingStore?.name ?? '' })}
          </p>
        </div>
      </Modal>

      {/* Permanent Delete Modal */}
      <Modal
        open={deleteOpen}
        onClose={closeDelete}
        title={t('stores.confirmDeleteTitle')}
        footer={
          <>
            <Button variant="secondary" onClick={closeDelete} disabled={deleting}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={handleDeletePermanent} loading={deleting}>
              {t('stores.confirmDeleteBtn')}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {deleteError && (
            <Alert variant="danger" onClose={() => setDeleteError(null)}>
              {deleteError}
            </Alert>
          )}
          <p style={{ margin: 0, color: 'var(--text-primary)' }}>
            {t('stores.confirmDeleteMsg', { name: deletingStore?.name ?? '' })}
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)', fontWeight: 500 }}>
            {t('stores.confirmDeleteWarning')}
          </p>
        </div>
      </Modal>
    </div>
  );
}

export default StoreList;
