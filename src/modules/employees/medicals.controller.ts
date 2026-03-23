import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface MedicalRow {
  id: number; user_id: number; company_id: number;
  start_date: string | null; end_date: string | null; notes: string | null; created_at: string;
}

export const listMedicals = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (role === 'employee' && userId !== empId) { forbidden(res, 'Accesso negato'); return; }
  const rows = await query<MedicalRow>(
    `SELECT * FROM employee_medical_checks WHERE user_id = $1 AND company_id = $2 ORDER BY start_date DESC`,
    [empId, companyId]
  );
  ok(res, rows);
});

export const createMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const { start_date, end_date, notes } = req.body;
  // Verify employee belongs to this company
  const emp = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
    [empId, companyId]
  );
  if (!emp) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<MedicalRow>(
    `INSERT INTO employee_medical_checks (user_id, company_id, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [empId, companyId, start_date || null, end_date || null, notes || null]
  );
  created(res, row, 'Visita medica aggiunta');
});

export const updateMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const medId = parseInt(req.params.medicalId, 10);
  const { start_date, end_date, notes } = req.body;
  const row = await queryOne<MedicalRow>(
    `UPDATE employee_medical_checks SET start_date = $1, end_date = $2, notes = $3, updated_at = NOW()
     WHERE id = $4 AND user_id = $5 AND company_id = $6 RETURNING *`,
    [start_date || null, end_date || null, notes || null, medId, empId, companyId]
  );
  if (!row) { notFound(res, 'Visita medica non trovata'); return; }
  ok(res, row, 'Visita medica aggiornata');
});

export const deleteMedical = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const medId = parseInt(req.params.medicalId, 10);
  const row = await queryOne(
    `DELETE FROM employee_medical_checks WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id`,
    [medId, empId, companyId]
  );
  if (!row) { notFound(res, 'Visita medica non trovata'); return; }
  ok(res, { id: medId }, 'Visita medica eliminata');
});
