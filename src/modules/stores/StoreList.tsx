import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { getStores, createStore, updateStore, deactivateStore } from '../../api/stores';
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

export function StoreList() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { showToast } = useToast();
  const isAdmin = user?.role === 'admin';

  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<Store | null>(null);
  const [formData, setFormData] = useState<StoreFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deactivatingStore, setDeactivatingStore] = useState<Store | null>(null);
  const [deactivating, setDeactivating] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);

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
    setFormOpen(true);
  };

  const openEditForm = (store: Store) => {
    setEditingStore(store);
    setFormData({
      name: store.name,
      code: store.code,
      address: store.address ?? '',
      cap: store.cap ?? '',
      maxStaff: String(store.maxStaff),
    });
    setFormErrors({});
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingStore(null);
    setFormData(emptyForm);
    setFormErrors({});
    setFormError(null);
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
        </div>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '24px',
      }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          margin: 0,
        }}>
          {t('stores.title')}
        </h1>
        {isAdmin && (
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
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={formErrors.name}
            placeholder={t('stores.placeholderName')}
          />
          <Input
            label={t('stores.fieldCode')}
            value={formData.code}
            onChange={(e) => setFormData((prev) => ({ ...prev, code: e.target.value }))}
            error={formErrors.code}
            placeholder={t('stores.placeholderCode')}
          />
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
    </div>
  );
}

export default StoreList;
