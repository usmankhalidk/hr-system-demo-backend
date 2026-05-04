import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// GET /api/automations
export const getAutomations = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) {
    notFound(res, 'Company not found');
    return;
  }

  const automations = await query<{ automation_id: string; is_enabled: boolean }>(
    `SELECT automation_id, is_enabled FROM company_automations WHERE company_id = $1`,
    [companyId],
  );

  // Return a map of automation_id -> is_enabled
  const automationsMap = automations.reduce((acc, row) => {
    acc[row.automation_id] = row.is_enabled;
    return acc;
  }, {} as Record<string, boolean>);

  ok(res, automationsMap);
});

// PUT /api/automations/:id
export const updateAutomation = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  if (!companyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { id } = req.params;
  const { isEnabled } = req.body;

  if (typeof isEnabled !== 'boolean') {
    badRequest(res, 'isEnabled must be a boolean');
    return;
  }

  const result = await queryOne<{ automation_id: string; is_enabled: boolean }>(
    `INSERT INTO company_automations (company_id, automation_id, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, automation_id)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
     RETURNING automation_id, is_enabled`,
    [companyId, id, isEnabled],
  );

  ok(res, result);
});
