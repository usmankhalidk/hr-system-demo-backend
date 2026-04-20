// @ts-nocheck
import { pool, queryOne } from '../config/database';
import { approveLeave } from '../modules/leave/leave.controller';

async function run() {
  try {
    const leaveId = 97;

    const req = {
      params: { id: String(leaveId) },
      user: {
        userId: 4, // store manager ID we found earlier
        role: 'store_manager',
        companyId: 1,
        storeId: 1,
        is_super_admin: false,
        groups: []
      },
      body: {}
    } as any;

    const res = {
      status: (code: number) => {
        console.log("Status:", code);
        return res;
      },
      json: (data: any) => {
        console.log("JSON:", data);
        return res;
      }
    } as any;

    const result = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      WHERE t.relname = 'leave_requests' AND c.conname = 'leave_requests_status_check'
    `);
    console.log(result.rows);

  } catch (err) {
    console.error("Approve Leave threw error:", err);
  } finally {
    await pool.end();
  }
}

run();
