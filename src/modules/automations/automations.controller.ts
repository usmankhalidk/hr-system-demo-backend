import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// GET /api/automations
export const getAutomations = asyncHandler(async (req: Request, res: Response) => {
  const explicit = req.query.company_id || req.body.company_id;
  const targetCompanyId = explicit ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const automations = await query<{ automation_id: string; is_enabled: boolean }>(
    `SELECT automation_id, is_enabled FROM company_automations WHERE company_id = $1`,
    [targetCompanyId],
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
  const explicit = req.body.company_id || req.query.company_id;
  const targetCompanyId = explicit ? parseInt(String(explicit), 10) : req.user!.companyId;

  if (!targetCompanyId) {
    notFound(res, 'Company not found');
    return;
  }

  const { id } = req.params;
  const { is_enabled } = req.body;

  if (typeof is_enabled !== 'boolean') {
    badRequest(res, 'is_enabled must be a boolean');
    return;
  }

  const result = await queryOne<{ automation_id: string; is_enabled: boolean }>(
    `INSERT INTO company_automations (company_id, automation_id, is_enabled)
     VALUES ($1, $2, $3)
     ON CONFLICT (company_id, automation_id)
     DO UPDATE SET is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
     RETURNING automation_id, is_enabled`,
    [targetCompanyId, id, is_enabled],
  );

  ok(res, result);
});
