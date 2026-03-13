import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

export const getHomeData = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;

  switch (role) {
    case 'admin': {
      const [companiesRes, storesRes, employeesRes] = await Promise.all([
        queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM companies`),
        queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM stores WHERE is_active = true`),
        queryOne<{ count: string }>(`SELECT COUNT(*) AS count FROM users WHERE status = 'active' AND role != 'store_terminal'`),
      ]);
      const roleBreakdown = await query<{ role: string; count: string }>(
        `SELECT role, COUNT(*)::int AS count FROM users WHERE status = 'active' GROUP BY role ORDER BY role`
      );
      ok(res, {
        stats: {
          companies: parseInt(companiesRes?.count || '0', 10),
          activeStores: parseInt(storesRes?.count || '0', 10),
          activeEmployees: parseInt(employeesRes?.count || '0', 10),
        },
        roleBreakdown,
      });
      break;
    }

    case 'hr': {
      const [expiringContracts, newHires, pendingApprovals] = await Promise.all([
        query(
          `SELECT id, name, surname, store_id, contract_end_date FROM users
           WHERE company_id = $1 AND status = 'active' AND contract_end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
           ORDER BY contract_end_date LIMIT 10`,
          [companyId]
        ),
        query(
          `SELECT id, name, surname, role, hire_date FROM users
           WHERE company_id = $1 AND hire_date >= DATE_TRUNC('month', CURRENT_DATE)
           ORDER BY hire_date DESC LIMIT 10`,
          [companyId]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM users WHERE company_id = $1 AND status = 'active'`,
          [companyId]
        ),
      ]);
      ok(res, { expiringContracts, newHires, totalEmployees: parseInt(pendingApprovals?.count || '0', 10) });
      break;
    }

    case 'area_manager': {
      const assignedStores = await query(
        `SELECT DISTINCT s.id, s.name, s.code,
          (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.status = 'active')::int AS employee_count
         FROM stores s
         INNER JOIN users emp ON emp.store_id = s.id AND emp.supervisor_id = $1 AND emp.company_id = $2
         WHERE s.is_active = true`,
        [userId, companyId]
      );
      ok(res, { assignedStores });
      break;
    }

    case 'store_manager': {
      const store = await queryOne(
        `SELECT id, name, code, max_staff FROM stores WHERE id = $1 AND company_id = $2`,
        [storeId, companyId]
      );
      const employeeCount = await queryOne<{ count: string }>(
        `SELECT COUNT(*) AS count FROM users WHERE store_id = $1 AND status = 'active'`,
        [storeId]
      );
      ok(res, {
        store,
        employeeCount: parseInt(employeeCount?.count || '0', 10),
      });
      break;
    }

    case 'employee': {
      const profile = await queryOne(
        `SELECT id, name, surname, role, department, store_id FROM users WHERE id = $1`,
        [userId]
      );
      ok(res, { profile });
      break;
    }

    case 'store_terminal': {
      const store = await queryOne(
        `SELECT id, name, code FROM stores WHERE id = $1 AND company_id = $2`,
        [storeId, companyId]
      );
      ok(res, { store });
      break;
    }

    default:
      ok(res, {});
  }
});
