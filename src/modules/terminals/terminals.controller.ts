import { Request, Response } from 'express';
import { pool, query, queryOne } from '../../config/database';
import { ok, created, badRequest, conflict, notFound } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import bcrypt from 'bcryptjs';
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
      u.plain_password,
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

export const listStoresWithTerminalStatus = asyncHandler(async (req: Request, res: Response) => {
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const stores = await query(`
    SELECT 
      s.id, 
      s.name, 
      s.code, 
      s.address, 
      s.cap, 
      s.max_staff, 
      s.company_id,
      c.name as company_name,
      EXISTS (
        SELECT 1 FROM users u 
        WHERE u.store_id = s.id 
        AND u.role = 'store_terminal' 
        AND u.status = 'active'
      ) as "hasTerminal"
    FROM stores s
    LEFT JOIN companies c ON c.id = s.company_id
    WHERE s.company_id = ANY($1)
    ORDER BY c.name, s.name
  `, [allowedCompanyIds]);

  ok(res, stores);
});

export const createTerminal = asyncHandler(async (req: Request, res: Response) => {
  const { store_id, email, password } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (!store_id || !email || !password) {
    return badRequest(res, 'Store ID, email and password are required');
  }

  // Verify store exists and is in scope
  const store = await queryOne<{ id: number; company_id: number; name: string }>(
    'SELECT id, company_id, name FROM stores WHERE id = $1 AND company_id = ANY($2)',
    [store_id, allowedCompanyIds]
  );

  if (!store) {
    return badRequest(res, 'Store not found or access denied');
  }

  // Check if terminal already exists
  const existingTerminal = await queryOne(
    "SELECT id FROM users WHERE store_id = $1 AND role = 'store_terminal' AND status = 'active'",
    [store_id]
  );

  if (existingTerminal) {
    return conflict(res, 'A terminal already exists for this store');
  }

  // Check if email is available
  const emailExists = await queryOne('SELECT id FROM users WHERE email = $1', [email]);
  if (emailExists) {
    return conflict(res, 'Email already in use');
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const terminalRes = await client.query(
      `INSERT INTO users (
         company_id, store_id, name, surname, email, password_hash, plain_password, role, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'store_terminal', 'active') RETURNING id, name, email`,
      [store.company_id, store.id, store.name, 'Terminale', email, passwordHash, password]
    );

    await client.query('COMMIT');
    created(res, terminalRes.rows[0], 'Terminal created successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export const updateTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  const { password } = req.body;
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');
  if (!password || password.length < 8) {
    return badRequest(res, 'Password must be at least 8 characters');
  }

  // Verify terminal exists, is a terminal, and is in scope
  const terminal = await queryOne(
    `SELECT u.id, u.company_id 
     FROM users u 
     WHERE u.id = $1 AND u.role = 'store_terminal' AND u.company_id = ANY($2)`,
    [terminalId, allowedCompanyIds]
  );

  if (!terminal) return notFound(res, 'Terminal not found or access denied');

  const passwordHash = await bcrypt.hash(password, 12);
  await query(
    'UPDATE users SET password_hash = $1, plain_password = $2, updated_at = NOW() WHERE id = $3',
    [passwordHash, password, terminalId]
  );

  ok(res, null, 'Terminal password updated successfully');
});

export const deleteTerminal = asyncHandler(async (req: Request, res: Response) => {
  const terminalId = parseInt(req.params.id, 10);
  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  if (isNaN(terminalId)) return badRequest(res, 'Invalid terminal ID');

  // Verify terminal exists, is a terminal, and is in scope
  const terminal = await queryOne(
    `SELECT u.id, u.company_id 
     FROM users u 
     WHERE u.id = $1 AND u.role = 'store_terminal' AND u.company_id = ANY($2)`,
    [terminalId, allowedCompanyIds]
  );

  if (!terminal) return notFound(res, 'Terminal not found or access denied');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clean up dependencies
    await client.query('DELETE FROM attendance_events WHERE user_id = $1', [terminalId]);
    await client.query('DELETE FROM audit_logs WHERE user_id = $1', [terminalId]);
    
    // Delete the terminal user
    await client.query('DELETE FROM users WHERE id = $1', [terminalId]);

    await client.query('COMMIT');
    ok(res, null, 'Terminal deleted successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});
