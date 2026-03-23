import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, notFound, forbidden } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

interface TrainingRow {
  id: number;
  user_id: number;
  company_id: number;
  training_type: string;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  created_at: string;
}

// GET /api/employees/:id/trainings
export const listTrainings = asyncHandler(async (req: Request, res: Response) => {
  const { companyId, role, userId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  if (role === 'employee' && userId !== empId) { forbidden(res, 'Accesso negato'); return; }
  const rows = await query<TrainingRow>(
    `SELECT * FROM employee_trainings WHERE user_id = $1 AND company_id = $2 ORDER BY training_type, start_date DESC`,
    [empId, companyId]
  );
  ok(res, rows);
});

// POST /api/employees/:id/trainings
export const createTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const { training_type, start_date, end_date, notes } = req.body;
  // Verify employee belongs to this company
  const emp = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2`,
    [empId, companyId]
  );
  if (!emp) { notFound(res, 'Dipendente non trovato'); return; }
  const row = await queryOne<TrainingRow>(
    `INSERT INTO employee_trainings (user_id, company_id, training_type, start_date, end_date, notes)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [empId, companyId, training_type, start_date || null, end_date || null, notes || null]
  );
  created(res, row, 'Formazione aggiunta');
});

// PUT /api/employees/:id/trainings/:trainingId
export const updateTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const trainingId = parseInt(req.params.trainingId, 10);
  const { training_type, start_date, end_date, notes } = req.body;
  const row = await queryOne<TrainingRow>(
    `UPDATE employee_trainings SET training_type = $1, start_date = $2, end_date = $3, notes = $4, updated_at = NOW()
     WHERE id = $5 AND user_id = $6 AND company_id = $7 RETURNING *`,
    [training_type, start_date || null, end_date || null, notes || null, trainingId, empId, companyId]
  );
  if (!row) { notFound(res, 'Record formazione non trovato'); return; }
  ok(res, row, 'Formazione aggiornata');
});

// DELETE /api/employees/:id/trainings/:trainingId
export const deleteTraining = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;
  const empId = parseInt(req.params.id, 10);
  const trainingId = parseInt(req.params.trainingId, 10);
  const row = await queryOne(
    `DELETE FROM employee_trainings WHERE id = $1 AND user_id = $2 AND company_id = $3 RETURNING id`,
    [trainingId, empId, companyId]
  );
  if (!row) { notFound(res, 'Record formazione non trovato'); return; }
  ok(res, { id: trainingId }, 'Formazione eliminata');
});
