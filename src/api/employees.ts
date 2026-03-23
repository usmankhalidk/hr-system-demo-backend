import apiClient from './client';
import { Employee, PaginatedResponse } from '../types';

export interface EmployeeListParams {
  search?: string;
  store_id?: number;
  department?: string;
  status?: string;
  role?: string;
  page?: number;
  limit?: number;
  targetCompanyId?: number | null;
}

// ── Field maps ────────────────────────────────────────────────────────────────
// Backend returns snake_case; Employee type uses camelCase.
// These two functions translate in both directions.

function fromApi(raw: Record<string, any>): Employee {
  return {
    id: raw.id,
    companyId: raw.company_id,
    storeId: raw.store_id,
    supervisorId: raw.supervisor_id,
    name: raw.name,
    surname: raw.surname,
    email: raw.email,
    role: raw.role,
    uniqueId: raw.unique_id,
    department: raw.department,
    hireDate: raw.hire_date,
    contractEndDate: raw.contract_end_date,
    terminationDate: raw.termination_date,
    workingType: raw.working_type,
    weeklyHours: raw.weekly_hours,
    status: raw.status,
    firstAidFlag: raw.first_aid_flag,
    maritalStatus: raw.marital_status,
    storeName: raw.store_name,
    supervisorName: raw.supervisor_name,
    companyName: raw.company_name,
    // Sensitive fields (only present for admin/hr/self)
    personalEmail: raw.personal_email,
    dateOfBirth: raw.date_of_birth,
    nationality: raw.nationality,
    gender: raw.gender,
    iban: raw.iban,
    address: raw.address,
    cap: raw.cap,
    contractType: raw.contract_type,
    probationMonths: raw.probation_months,
  };
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  companyId: 'company_id',
  storeId: 'store_id',
  supervisorId: 'supervisor_id',
  uniqueId: 'unique_id',
  hireDate: 'hire_date',
  contractEndDate: 'contract_end_date',
  terminationDate: 'termination_date',
  workingType: 'working_type',
  weeklyHours: 'weekly_hours',
  firstAidFlag: 'first_aid_flag',
  maritalStatus: 'marital_status',
  personalEmail: 'personal_email',
  dateOfBirth: 'date_of_birth',
  contractType: 'contract_type',
  probationMonths: 'probation_months',
};

function toApi(payload: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(payload)) {
    result[CAMEL_TO_SNAKE[k] ?? k] = v;
  }
  return result;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function getEmployees(params?: EmployeeListParams): Promise<PaginatedResponse<Employee>> {
  const query: Record<string, string | number> = {};
  if (params?.search) query.search = params.search;
  if (params?.store_id != null) query.store_id = params.store_id;
  if (params?.department) query.department = params.department;
  if (params?.status) query.status = params.status;
  if (params?.role) query.role = params.role;
  if (params?.page != null) query.page = params.page;
  if (params?.limit != null) query.limit = params.limit;
  if (params?.targetCompanyId != null) query.target_company_id = params.targetCompanyId;
  const { data } = await apiClient.get('/employees', { params: query });
  const raw = data.data as { employees: Record<string, any>[]; total: number; page: number; limit: number; pages: number };
  return { ...raw, employees: raw.employees.map(fromApi) };
}

export async function getEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.get(`/employees/${id}`);
  return fromApi(data.data);
}

export async function createEmployee(payload: Partial<Employee> & { email: string; name: string; surname: string; role: string; password?: string }): Promise<Employee> {
  const { data } = await apiClient.post('/employees', toApi(payload as Record<string, any>));
  return fromApi(data.data);
}

export async function updateEmployee(id: number, payload: Partial<Employee>): Promise<Employee> {
  const { data } = await apiClient.put(`/employees/${id}`, toApi(payload as Record<string, any>));
  return fromApi(data.data);
}

export async function deactivateEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.delete(`/employees/${id}`);
  return fromApi(data.data);
}

export async function activateEmployee(id: number): Promise<Employee> {
  const { data } = await apiClient.patch(`/employees/${id}/activate`);
  return fromApi(data.data);
}
