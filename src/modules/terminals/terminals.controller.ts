import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

export const listTerminals = asyncHandler(async (req: Request, res: Response) => {
  const { role, userId, companyId: callerCompanyId } = req.user!;
  const { search, status, company_id, store_id, page = '1', limit = '20' } = req.query as Record<string, string>;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  
  let where = "u.role = 'store_terminal'";
  const params: any[] = [];

  // Company filtering based on role and query
  if (company_id) {
    const requestedId = parseInt(company_id, 10);
    if (allowedCompanyIds.includes(requestedId)) {
      params.push(requestedId);
      where += ` AND u.company_id = $${params.length}`;
    } else {
      // If requested company is not allowed, force empty result
      where += " AND 1=0";
    }
  } else {
    params.push(allowedCompanyIds);
    where += ` AND u.company_id = ANY($${params.length})`;
  }

  // Store filtering
  if (store_id) {
    params.push(parseInt(store_id, 10));
    where += ` AND u.store_id = $${params.length}`;
  }

  // Status filtering
  if (status) {
    params.push(status);
    where += ` AND u.status = $${params.length}`;
  }

  // Search filtering (name or email)
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
  }

  // Count total for pagination
  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM users u WHERE ${where}`,
    params
  ).catch(err => {
    console.error('Error in listTerminals count query:', err);
    throw err;
  });
  const total = parseInt(countRow?.count || '0', 10);

  // Fetch data
  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const offset = (pageNum - 1) * limitNum;

  params.push(limitNum, offset);
  const terminals = await query(`
    SELECT 
      u.id, 
      u.name, 
      u.email, 
      u.role, 
      u.status, 
      u.company_id, 
      u.store_id,
      c.name as company_name,
      s.name as store_name
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    LEFT JOIN stores s ON s.id = u.store_id
    WHERE ${where}
    ORDER BY c.name, s.name, u.name
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `, params).catch(err => {
    console.error('Error in listTerminals data query:', err);
    throw err;
  });

  ok(res, {
    data: terminals,
    meta: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum)
    }
  });
});
