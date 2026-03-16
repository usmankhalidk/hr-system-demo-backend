import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../context/ToastContext';
import { getCompanies, updateCompany } from '../../api/companies';
import { translateApiError } from '../../utils/apiErrors';
import { Company } from '../../types';
import { Table, Column } from '../../components/ui/Table';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Alert } from '../../components/ui/Alert';

interface CompanyFormData {
  name: string;
}

const emptyForm: CompanyFormData = {
  name: '',
};

interface FormErrors {
  name?: string;
}

export function CompanyList() {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [formData, setFormData] = useState<CompanyFormData>(emptyForm);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [formSaving, setFormSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCompanies = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCompanies();
      setCompanies(data);
    } catch {
      setError(t('companies.errorLoad'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const openEditForm = (company: Company) => {
    setEditingCompany(company);
    setFormData({ name: company.name });
    setFormErrors({});
    setFormError(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingCompany(null);
    setFormData(emptyForm);
    setFormErrors({});
    setFormError(null);
  };

  const validateForm = (): boolean => {
    const errors: FormErrors = {};
    if (!formData.name.trim()) {
      errors.name = t('companies.validationName');
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSave = async () => {
    if (!editingCompany || !validateForm()) return;
    setFormSaving(true);
    setFormError(null);
    try {
      await updateCompany(editingCompany.id, {
        name: formData.name.trim(),
      });
      closeForm();
      showToast(t('companies.updatedSuccess'), 'success');
      await loadCompanies();
    } catch (err) {
      setFormError(translateApiError(err, t, t('companies.errorSave')));
    } finally {
      setFormSaving(false);
    }
  };

  const columns: Column<Company>[] = [
    { key: 'name', label: t('companies.colName') },
    { key: 'storeCount', label: t('companies.colStores'), render: (row) => String(row.storeCount) },
    { key: 'employeeCount', label: t('companies.colEmployees'), render: (row) => String(row.employeeCount) },
    {
      key: 'actions',
      label: t('companies.colActions'),
      render: (row) => (
        <Button size="sm" variant="secondary" onClick={() => openEditForm(row)}>
          {t('common.edit')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{
          fontSize: '24px',
          fontWeight: 700,
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-display)',
          margin: 0,
        }}>
          {t('companies.title')}
        </h1>
      </div>

      {error && (
        <div style={{ marginBottom: '16px' }}>
          <Alert variant="danger" title={t('common.error')} onClose={() => setError(null)}>
            {error}
          </Alert>
        </div>
      )}

      <Table<Company>
        columns={columns}
        data={companies}
        loading={loading}
        emptyText={t('companies.noCompanies')}
      />

      <Modal
        open={formOpen}
        onClose={closeForm}
        title={t('companies.editCompany')}
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
            label={t('companies.fieldName')}
            value={formData.name}
            onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
            error={formErrors.name}
            placeholder={t('companies.placeholderName')}
          />
        </div>
      </Modal>
    </div>
  );
}

export default CompanyList;
