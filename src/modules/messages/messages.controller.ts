import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, forbidden, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// POST /api/messages — send a message to an employee
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, companyId } = req.user!;
  const { recipientId, subject, body } = req.body;

  if (!subject?.trim() || !body?.trim()) {
    badRequest(res, 'Oggetto e corpo del messaggio sono obbligatori', 'MISSING_FIELDS');
    return;
  }

  // Verify recipient exists in same company and is active
  const recipient = await queryOne<{ id: number }>(
    `SELECT id FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [recipientId, companyId],
  );
  if (!recipient) {
    notFound(res, 'Destinatario non trovato in questa azienda');
    return;
  }

  // Area manager: can only message directly supervised employees
  if (role === 'area_manager') {
    const supervised = await queryOne<{ id: number }>(
      `SELECT id FROM users WHERE id = $1 AND supervisor_id = $2 AND company_id = $3`,
      [recipientId, userId, companyId],
    );
    if (!supervised) {
      forbidden(res, 'Puoi inviare messaggi solo ai dipendenti che supervisioni');
      return;
    }
  }

  // Store manager: can only message employees in their store
  if (role === 'store_manager') {
    const inStore = await queryOne<{ id: number }>(
      `SELECT id FROM users
       WHERE id = $1
         AND store_id = (SELECT store_id FROM users WHERE id = $2)
         AND company_id = $3`,
      [recipientId, userId, companyId],
    );
    if (!inStore) {
      forbidden(res, 'Puoi inviare messaggi solo ai dipendenti del tuo negozio');
      return;
    }
  }

  const msg = await queryOne(
    `INSERT INTO messages (company_id, sender_id, recipient_id, subject, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, sender_id, recipient_id, subject, body, is_read, created_at`,
    [companyId, userId, recipientId, subject.trim(), body.trim()],
  );

  created(res, msg, 'Messaggio inviato');
});

// GET /api/messages — inbox for current user
export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;

  const messages = await query(
    `SELECT m.id, m.subject, m.body, m.is_read, m.created_at,
            m.sender_id, m.recipient_id,
            CONCAT(s.name, ' ', s.surname) AS sender_name,
            s.role AS sender_role
     FROM messages m
     JOIN users s ON s.id = m.sender_id
     WHERE m.recipient_id = $1 AND m.company_id = $2
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [userId, companyId],
  );

  ok(res, messages);
});

// GET /api/messages/unread-count
export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM messages WHERE recipient_id = $1 AND company_id = $2 AND is_read = FALSE`,
    [userId, companyId],
  );
  ok(res, { unreadCount: row?.count ?? 0 });
});

// PATCH /api/messages/:id/read
export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;
  const msgId = parseInt(req.params.id, 10);
  if (isNaN(msgId)) { notFound(res, 'Messaggio non trovato'); return; }

  const msg = await queryOne<{ id: number; recipient_id: number }>(
    `SELECT id, recipient_id FROM messages WHERE id = $1 AND company_id = $2`,
    [msgId, companyId],
  );
  if (!msg) { notFound(res, 'Messaggio non trovato'); return; }
  if (msg.recipient_id !== userId) {
    forbidden(res, 'Non puoi modificare questo messaggio');
    return;
  }

  const updated = await queryOne(
    `UPDATE messages SET is_read = TRUE WHERE id = $1 AND company_id = $2
     RETURNING id, subject, body, is_read, created_at, sender_id, recipient_id`,
    [msgId, companyId],
  );

  ok(res, updated);
});
