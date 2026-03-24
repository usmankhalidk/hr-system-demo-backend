import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

export const getHomeData = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId, storeId } = req.user!;

  switch (role) {
    case 'admin': {
      const [companiesRes, storesRes, employeesRes, roleBreakdown, storeBreakdown] = await Promise.all([
        queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM companies WHERE id = $1`,
          [companyId]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM stores WHERE company_id = $1 AND is_active = true`,
          [companyId]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM users WHERE company_id = $1 AND status = 'active' AND role != 'store_terminal'`,
          [companyId]
        ),
        query<{ role: string; count: number }>(
          `SELECT role, COUNT(*)::int AS count
           FROM users
           WHERE company_id = $1 AND status = 'active'
           GROUP BY role ORDER BY count DESC`,
          [companyId]
        ),
        query<{ name: string; count: number }>(
          `SELECT s.name, COUNT(u.id)::int AS count
           FROM stores s
           LEFT JOIN users u ON u.store_id = s.id AND u.status = 'active'
           WHERE s.company_id = $1 AND s.is_active = true
           GROUP BY s.id, s.name ORDER BY count DESC LIMIT 10`,
          [companyId]
        ),
      ]);
      ok(res, {
        stats: {
          companies: parseInt(companiesRes?.count || '0', 10),
          activeStores: parseInt(storesRes?.count || '0', 10),
          activeEmployees: parseInt(employeesRes?.count || '0', 10),
        },
        roleBreakdown,
        storeBreakdown,
      });
      break;
    }

    case 'hr': {
      const [expiringContracts, newHires, totalEmployeesRes, monthlyHires, statusBreakdown, expiringTrainings, expiringMedicals] = await Promise.all([
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
        query<{ month: string; count: number }>(
          `SELECT TO_CHAR(DATE_TRUNC('month', hire_date), 'YYYY-MM') AS month, COUNT(*)::int AS count
           FROM users
           WHERE company_id = $1 AND hire_date >= DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months'
           GROUP BY DATE_TRUNC('month', hire_date)
           ORDER BY 1`,
          [companyId]
        ),
        query<{ status: string; count: number }>(
          `SELECT status, COUNT(*)::int AS count FROM users WHERE company_id = $1 GROUP BY status`,
          [companyId]
        ),
        // Trainings expiring within 60 days
        query(
          `SELECT t.id, t.training_type, t.end_date,
                  u.id AS user_id, u.name, u.surname
           FROM employee_trainings t
           JOIN users u ON u.id = t.user_id
           WHERE t.company_id = $1 AND t.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
           ORDER BY t.end_date LIMIT 10`,
          [companyId]
        ),
        // Medical checks expiring within 60 days
        query(
          `SELECT m.id, m.end_date,
                  u.id AS user_id, u.name, u.surname
           FROM employee_medical_checks m
           JOIN users u ON u.id = m.user_id
           WHERE m.company_id = $1 AND m.end_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '60 days'
           ORDER BY m.end_date LIMIT 10`,
          [companyId]
        ),
      ]);
      ok(res, {
        expiringContracts,
        newHires,
        totalEmployees: parseInt(totalEmployeesRes?.count || '0', 10),
        monthlyHires,
        statusBreakdown,
        expiringTrainings,
        expiringMedicals,
      });
      break;
    }

    case 'area_manager': {
      const assignedStores = await query(
        `SELECT DISTINCT s.id, s.name, s.code,
          (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.status = 'active')::int AS employee_count
         FROM stores s
         INNER JOIN users emp ON emp.store_id = s.id AND emp.supervisor_id = $1 AND emp.company_id = $2
         WHERE s.is_active = true AND s.company_id = $2`,
        [userId, companyId]
      );
      ok(res, { assignedStores });
      break;
    }

    case 'store_manager': {
      if (!storeId) {
        ok(res, { store: null, employeeCount: 0, todayShifts: [], todayAttendance: {} });
        break;
      }
      const [store, employeeCount, todayShifts, todayAttendanceSummary] = await Promise.all([
        queryOne(
          `SELECT id, name, code, max_staff FROM stores WHERE id = $1 AND company_id = $2`,
          [storeId, companyId]
        ),
        queryOne<{ count: string }>(
          `SELECT COUNT(*) AS count FROM users WHERE store_id = $1 AND company_id = $2 AND status = 'active'`,
          [storeId, companyId]
        ),
        query(
          `SELECT s.id, u.name, u.surname, s.start_time, s.end_time, s.status,
                  (
                    SELECT ae.event_type
                    FROM attendance_events ae
                    WHERE ae.user_id = s.user_id
                      AND ae.store_id = s.store_id
                      AND ae.event_time::DATE = CURRENT_DATE
                    ORDER BY ae.event_time DESC
                    LIMIT 1
                  ) AS latest_event
           FROM shifts s
           JOIN users u ON u.id = s.user_id
           WHERE s.store_id = $1 AND s.company_id = $2
             AND s.date = CURRENT_DATE
             AND s.status != 'cancelled'
           ORDER BY s.start_time`,
          [storeId, companyId]
        ),
        query<{ event_type: string; count: string }>(
          `SELECT event_type, COUNT(*)::int AS count
           FROM attendance_events
           WHERE store_id = $1 AND company_id = $2
             AND event_time::DATE = CURRENT_DATE
           GROUP BY event_type`,
          [storeId, companyId]
        ),
      ]);
      ok(res, {
        store,
        employeeCount: parseInt(employeeCount?.count || '0', 10),
        todayShifts,
        todayAttendance: Object.fromEntries(
          todayAttendanceSummary.map((r) => [r.event_type, parseInt(r.count, 10)])
        ),
      });
      break;
    }

    case 'employee': {
      const [profile, nextShiftRow, leaveBalances, birthdayRow, companySettings, turniPermission] = await Promise.all([
        queryOne(
          `SELECT u.id, u.name, u.surname, u.role, u.department,
                  s.name AS store_name
           FROM users u
           LEFT JOIN stores s ON s.id = u.store_id
           WHERE u.id = $1 AND u.company_id = $2`,
          [userId, companyId]
        ),
        queryOne(
          `SELECT s.id, TO_CHAR(s.date, 'YYYY-MM-DD') AS date,
                  s.start_time, s.end_time, s.status,
                  st.name AS store_name
           FROM shifts s
           JOIN stores st ON st.id = s.store_id
           WHERE s.user_id = $1 AND s.company_id = $2
             AND s.status != 'cancelled'
             AND s.date >= CURRENT_DATE
           ORDER BY s.date, s.start_time
           LIMIT 1`,
          [userId, companyId]
        ),
        query<{ leave_type: string; total_days: string; used_days: string }>(
          `SELECT leave_type, total_days, used_days
           FROM leave_balances
           WHERE user_id = $1 AND company_id = $2
             AND year = EXTRACT(YEAR FROM CURRENT_DATE)::int`,
          [userId, companyId]
        ),
        queryOne<{ is_birthday: boolean }>(
          `SELECT (
             date_of_birth IS NOT NULL
             AND EXTRACT(MONTH FROM date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
             AND EXTRACT(DAY   FROM date_of_birth) = EXTRACT(DAY   FROM CURRENT_DATE)
           ) AS is_birthday
           FROM users WHERE id = $1`,
          [userId]
        ),
        queryOne<{ show_leave_balance_to_employee: boolean }>(
          `SELECT show_leave_balance_to_employee FROM companies WHERE id = $1`,
          [companyId]
        ),
        queryOne<{ is_enabled: boolean }>(
          `SELECT is_enabled FROM role_module_permissions
           WHERE company_id = $1 AND role = 'employee' AND module_name = 'turni'`,
          [companyId]
        ),
      ]);
      ok(res, {
        profile,
        nextShift: nextShiftRow ?? null,
        leaveBalance: leaveBalances.map((b) => ({
          leaveType:  b.leave_type,
          totalDays:  parseFloat(b.total_days),
          usedDays:   parseFloat(b.used_days),
          remaining:  parseFloat(b.total_days) - parseFloat(b.used_days),
        })),
        isBirthday: birthdayRow?.is_birthday ?? false,
        showLeaveBalance: companySettings?.show_leave_balance_to_employee ?? true,
        showShifts: turniPermission?.is_enabled ?? true,
      });
      break;
    }

    case 'store_terminal': {
      if (!storeId) {
        ok(res, { store: null });
        break;
      }
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
