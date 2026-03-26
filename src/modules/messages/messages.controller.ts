import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, forbidden, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';

// POST /api/messages — send a message to an employee
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role, companyId } = req.user!;
  const { recipientId, recipient_id, subject, body } = req.body as {
    recipientId?: number;
    recipient_id?: number;
    subject: string;
    body: string;
  };

  const rawRecipient = recipientId ?? recipient_id;
  const numRecipientId = typeof rawRecipient === 'number'
    ? rawRecipient
    : parseInt(String(rawRecipient), 10);
  if (!Number.isFinite(numRecipientId)) {
    badRequest(res, 'Destinatario non valido', 'INVALID_RECIPIENT');
    return;
  }

  if (!subject?.trim() || !body?.trim()) {
    badRequest(res, 'Oggetto e corpo del messaggio sono obbligatori', 'MISSING_FIELDS');
    return;
  }

  // Verify recipient exists in same company and is active
  const recipient = await queryOne<{ id: number; role: string }>(
    `SELECT id, role FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [numRecipientId, companyId],
  );
  if (!recipient) {
    notFound(res, 'Destinatario non trovato in questa azienda');
    return;
  }

  // Employee can only chat with HR.
  if (role === 'employee') {
    if (recipient.role !== 'hr') {
      forbidden(res, "Puoi inviare messaggi solo all'HR");
      return;
    }
  }

  // Area manager: can message HR/admin for escalation, OR directly supervised employees
  if (role === 'area_manager') {
    const isHrOrAdmin = recipient.role === 'hr' || recipient.role === 'admin';
    if (!isHrOrAdmin) {
      const supervised = await queryOne<{ id: number }>(
        `SELECT id FROM users WHERE id = $1 AND supervisor_id = $2 AND company_id = $3`,
        [numRecipientId, userId, companyId],
      );
      if (!supervised) {
        forbidden(res, 'Puoi inviare messaggi solo ai dipendenti che supervisioni o all\'HR');
        return;
      }
    }
  }

  // Store manager: can message HR/admin for escalation, OR employees in their store
  if (role === 'store_manager') {
    const isHrOrAdmin = recipient.role === 'hr' || recipient.role === 'admin';
    if (!isHrOrAdmin) {
      const inStore = await queryOne<{ id: number }>(
        `SELECT id FROM users
         WHERE id = $1
           AND store_id = (SELECT store_id FROM users WHERE id = $2)
           AND company_id = $3`,
        [numRecipientId, userId, companyId],
      );
      if (!inStore) {
        forbidden(res, 'Puoi inviare messaggi solo ai dipendenti del tuo negozio o all\'HR');
        return;
      }
    }
  }

  const msg = await queryOne(
    `INSERT INTO messages (company_id, sender_id, recipient_id, subject, body)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, company_id, sender_id, recipient_id, subject, body, is_read, created_at`,
    [companyId, userId, numRecipientId, subject.trim(), body.trim()],
  );

  created(res, msg, 'Messaggio inviato');
});

// GET /api/messages/hr — returns the HR contact for current company
export const getHrRecipient = asyncHandler(async (req: Request, res: Response) => {
  const { companyId } = req.user!;

  const hr = await queryOne<{ id: number; name: string; surname: string | null }>(
    `SELECT id, name, surname
     FROM users
     WHERE company_id = $1 AND role = 'hr' AND status = 'active'
     ORDER BY id
     LIMIT 1`,
    [companyId],
  );

  if (!hr) { notFound(res, "Contatto HR non trovato in questa azienda"); return; }

  const recipientName = hr.surname ? `${hr.name} ${hr.surname}` : hr.name;
  ok(res, { recipientId: hr.id, recipientName }, 'Contatto HR trovato');
});

// GET /api/messages — inbox + sent for current user
export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const { userId, companyId } = req.user!;

  const messages = await query(
    `SELECT m.id, m.subject, m.body,
            -- Sent messages are always "read" from the sender's perspective
            CASE WHEN m.recipient_id = $1 THEN m.is_read ELSE true END AS is_read,
            m.created_at,
            m.sender_id, m.recipient_id,
            CONCAT(s.name, ' ', s.surname) AS sender_name,
            s.role AS sender_role,
            CONCAT(r.name, ' ', r.surname) AS recipient_name,
            r.role AS recipient_role,
            CASE WHEN m.recipient_id = $1 THEN 'received' ELSE 'sent' END AS direction
     FROM messages m
     JOIN users s ON s.id = m.sender_id
     JOIN users r ON r.id = m.recipient_id
     WHERE (m.recipient_id = $1 OR m.sender_id = $1) AND m.company_id = $2
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
