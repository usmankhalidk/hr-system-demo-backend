export type UserRole = 'admin' | 'hr' | 'area_manager' | 'store_manager' | 'employee' | 'store_terminal';

export interface User {
  id: number;
  companyId: number;
  storeId: number | null;
  supervisorId: number | null;
  name: string;
  surname: string | null;
  email: string;
  role: UserRole;
  status: 'active' | 'inactive';
  isSuperAdmin?: boolean;
}

export interface Company {
  id: number;
  name: string;
  storeCount: number;
  employeeCount: number;
  createdAt: string;
}

export interface Store {
  id: number;
  companyId: number;
  name: string;
  code: string;
  address: string | null;
  cap: string | null;
  maxStaff: number | null;
  isActive: boolean;
  employeeCount?: number;
  createdAt: string;
}

export interface Employee {
  id: number;
  companyId: number;
  storeId: number | null;
  supervisorId: number | null;
  name: string;
  surname: string;
  email: string;
  role: UserRole;
  uniqueId: string | null;
  department: string | null;
  hireDate: string | null;
  contractEndDate: string | null;
  terminationDate: string | null;
  workingType: 'full_time' | 'part_time' | null;
  weeklyHours: number | null;
  status: 'active' | 'inactive';
  firstAidFlag: boolean;
  maritalStatus: string | null;
  storeName?: string;
  supervisorName?: string;
  companyName?: string;
  // Sensitive — only returned for admin/hr or self
  personalEmail?: string | null;
  dateOfBirth?: string | null;
  nationality?: string | null;
  gender?: string | null;
  iban?: string | null;
  address?: string | null;
  cap?: string | null;
  contractType?: string | null;
  probationMonths?: number | null;
}

export type TrainingType = 'product' | 'general' | 'low_risk_safety' | 'fire_safety';

export interface Training {
  id: number;
  userId: number;
  companyId: number;
  training_type: TrainingType;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  createdAt: string;
}

export interface MedicalCheck {
  id: number;
  userId: number;
  companyId: number;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PermissionGrid {
  grid: Record<string, Record<string, boolean>>;
  moduleMeta: Record<string, { active: boolean }>;
}

export type PermissionMap = Record<string, boolean>;

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface ApiError {
  success: false;
  error: string;
  code: string;
}

export interface PaginatedResponse<T> {
  employees: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}
