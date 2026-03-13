import { Router } from 'express';
import { z } from 'zod';
import {
  listEmployees,
  getEmployee,
  createEmployee,
  updateEmployee,
  deactivateEmployee,
} from './employees.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';
import { auditLog } from '../../middleware/auditLog';

const router = Router();

const createEmployeeSchema = z.object({
  name: z.string().min(1, 'Nome obbligatorio').max(100),
  surname: z.string().min(1, 'Cognome obbligatorio').max(100),
  email: z.string().email('Email non valida'),
  role: z.enum(['admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal']),
  store_id: z.number().int().optional().nullable(),
  supervisor_id: z.number().int().optional().nullable(),
  unique_id: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  hire_date: z.string().optional().nullable(),
  contract_end_date: z.string().optional().nullable(),
  working_type: z.enum(['full_time', 'part_time']).optional().nullable(),
  weekly_hours: z.number().min(0).max(80).optional().nullable(),
  personal_email: z.string().email().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  nationality: z.string().max(100).optional().nullable(),
  gender: z.string().max(20).optional().nullable(),
  iban: z.string().max(34).optional().nullable(),
  address: z.string().optional().nullable(),
  cap: z.string().max(10).optional().nullable(),
  first_aid_flag: z.boolean().optional(),
  marital_status: z.string().max(50).optional().nullable(),
  password: z.string().min(8).optional(), // initial password
});

// Update schema: same as create but email/role changes restricted
const updateEmployeeSchema = createEmployeeSchema.omit({ email: true, password: true });

const allManagementRoles = ['admin', 'hr', 'area_manager', 'store_manager'] as const;

router.get(
  '/',
  authenticate,
  requireRole(...allManagementRoles),
  enforceCompany,
  listEmployees,
);

router.get(
  '/:id',
  authenticate,
  requireRole(...allManagementRoles, 'employee'),
  enforceCompany,
  getEmployee,
);

router.post(
  '/',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  validate(createEmployeeSchema),
  auditLog('employee'),
  createEmployee,
);

router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  enforceCompany,
  validate(updateEmployeeSchema),
  auditLog('employee'),
  updateEmployee,
);

router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  enforceCompany,
  auditLog('employee'),
  deactivateEmployee,
);

export default router;
