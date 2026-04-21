import { Request, Response } from 'express';
import { query, queryOne } from '../../config/database';
import { ok, created, forbidden, notFound, badRequest } from '../../utils/response';
import { asyncHandler } from '../../utils/asyncHandler';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';

async function resolveMessageCompanyId(req: Request, res: Response): Promise<number | null> {
  if (!req.user) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return null;
  }

  const explicit =
    req.body?.company_id ??
    req.body?.target_company_id ??
    req.query?.company_id ??
    req.query?.target_company_id ??
    req.params?.company_id;

  const fallbackCompanyId = req.user.companyId;
  const targetCompanyId = explicit != null ? parseInt(String(explicit), 10) : fallbackCompanyId;

  if (targetCompanyId == null || Number.isNaN(targetCompanyId)) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return null;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user);
  if (!allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return null;
  }

  return targetCompanyId;
}

// POST /api/messages — send a message to an employee
export const sendMessage = asyncHandler(async (req: Request, res: Response) => {
  const { userId, role } = req.user!;
  const { recipientId, recipient_id, subject, body } = req.body as {
    recipientId?: number;
    recipient_id?: number;
    company_id?: number;
    target_company_id?: number;
    subject?: string;
    body: string;
  };

  const companyId = await resolveMessageCompanyId(req, res);
  if (companyId == null) {
    return;
  }

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

  const rawRecipient = recipientId ?? recipient_id;
  const numRecipientId = typeof rawRecipient === 'number'
    ? rawRecipient
    : parseInt(String(rawRecipient), 10);
  if (!Number.isFinite(numRecipientId)) {
    badRequest(res, 'Destinatario non valido', 'INVALID_RECIPIENT');
    return;
  }

  if (!body?.trim()) {
    badRequest(res, 'Il corpo del messaggio è obbligatorio', 'MISSING_FIELDS');
    return;
  }

  const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';

  // Try the requested company first, then any company the caller can access.
  let recipient = await queryOne<{ id: number; role: string; company_id: number }>(
    `SELECT id, role, company_id FROM users WHERE id = $1 AND company_id = $2 AND status = 'active'`,
    [numRecipientId, companyId],
  );
  if (!recipient) {
    recipient = await queryOne<{ id: number; role: string; company_id: number }>(
      `SELECT id, role, company_id FROM users WHERE id = $1 AND company_id = ANY($2) AND status = 'active'`,
      [numRecipientId, allowedCompanyIds],
    );
  }
  if (!recipient) {
    notFound(res, 'Destinatario non trovato in questa azienda');
    return;
  }

  const messageCompanyId = recipient.company_id;

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
        [numRecipientId, userId, messageCompanyId],
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
        [numRecipientId, userId, messageCompanyId],
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
    [messageCompanyId, userId, numRecipientId, normalizedSubject, body.trim()],
  );

  created(res, msg, 'Messaggio inviato');
});

// GET /api/messages/hr — returns the HR contact for current company
export const getHrRecipient = asyncHandler(async (req: Request, res: Response) => {
  const companyId = await resolveMessageCompanyId(req, res);
  if (companyId == null) {
    return;
  }

  const hr = await queryOne<{ id: number; name: string; surname: string | null }>(
    `SELECT id, name, surname
     FROM users
     WHERE company_id = $1 AND role = 'hr' AND status = 'active'
     ORDER BY name, surname
     LIMIT 1`,
    [companyId],
  );

  if (!hr) { notFound(res, "Contatto HR non trovato in questa azienda"); return; }

  const recipientName = hr.surname ? `${hr.name} ${hr.surname}` : hr.name;
  ok(res, { recipientId: hr.id, recipientName }, 'Contatto HR trovato');
});

// GET /api/messages — inbox + sent for current user
export const listMessages = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;

  const explicitCompany =
    req.body?.company_id ??
    req.body?.target_company_id ??
    req.query?.company_id ??
    req.query?.target_company_id ??
    req.params?.company_id;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    ok(res, []);
    return;
  }

  const targetCompanyId = explicitCompany != null ? parseInt(String(explicitCompany), 10) : null;
  const companyIds = targetCompanyId != null ? [targetCompanyId] : allowedCompanyIds;

  if (targetCompanyId != null && !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return;
  }

  const messages = await query(
    `SELECT m.id, m.subject, m.body,
            -- Sent messages are always "read" from the sender's perspective
            CASE WHEN m.recipient_id = $1 THEN m.is_read ELSE true END AS is_read,
            m.created_at,
            m.company_id,
            c.name AS company_name,
            m.sender_id, m.recipient_id,
            COALESCE(NULLIF(BTRIM(CONCAT(COALESCE(s.name, ''), ' ', COALESCE(s.surname, ''))), ''), CONCAT('User #', m.sender_id::TEXT)) AS sender_name,
            s.role AS sender_role,
                 s.avatar_filename AS sender_avatar_filename,
            COALESCE(NULLIF(BTRIM(CONCAT(COALESCE(r.name, ''), ' ', COALESCE(r.surname, ''))), ''), CONCAT('User #', m.recipient_id::TEXT)) AS recipient_name,
            r.role AS recipient_role,
                 r.avatar_filename AS recipient_avatar_filename,
            CASE WHEN m.recipient_id = $1 THEN 'received' ELSE 'sent' END AS direction
     FROM messages m
     LEFT JOIN users s ON s.id = m.sender_id
     LEFT JOIN users r ON r.id = m.recipient_id
     LEFT JOIN companies c ON c.id = m.company_id
     WHERE (m.recipient_id = $1 OR m.sender_id = $1) AND m.company_id = ANY($2)
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [userId, companyIds],
  );

  ok(res, messages);
});

// GET /api/messages/unread-count
export const unreadCount = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;

  const explicitCompany =
    req.body?.company_id ??
    req.body?.target_company_id ??
    req.query?.company_id ??
    req.query?.target_company_id ??
    req.params?.company_id;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    ok(res, { unreadCount: 0 });
    return;
  }

  const targetCompanyId = explicitCompany != null ? parseInt(String(explicitCompany), 10) : null;
  const companyIds = targetCompanyId != null ? [targetCompanyId] : allowedCompanyIds;

  if (targetCompanyId != null && !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return;
  }

  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM messages WHERE recipient_id = $1 AND company_id = ANY($2) AND is_read = FALSE`,
    [userId, companyIds],
  );
  ok(res, { unreadCount: row?.count ?? 0 });
});

// PATCH /api/messages/:id/read
export const markAsRead = asyncHandler(async (req: Request, res: Response) => {
  const { userId } = req.user!;
  const explicitCompany =
    req.body?.company_id ??
    req.body?.target_company_id ??
    req.query?.company_id ??
    req.query?.target_company_id ??
    req.params?.company_id;

  const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);
  if (allowedCompanyIds.length === 0) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return;
  }

  const targetCompanyId = explicitCompany != null ? parseInt(String(explicitCompany), 10) : null;
  const companyIds = targetCompanyId != null ? [targetCompanyId] : allowedCompanyIds;

  if (targetCompanyId != null && !allowedCompanyIds.includes(targetCompanyId)) {
    forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
    return;
  }

  const msgId = parseInt(req.params.id, 10);
  if (isNaN(msgId)) { notFound(res, 'Messaggio non trovato'); return; }

  const msg = await queryOne<{ id: number; recipient_id: number }>(
    `SELECT id, recipient_id FROM messages WHERE id = $1 AND company_id = ANY($2)`,
    [msgId, companyIds],
  );
  if (!msg) { notFound(res, 'Messaggio non trovato'); return; }
  if (msg.recipient_id !== userId) {
    forbidden(res, 'Non puoi modificare questo messaggio');
    return;
  }

  const updated = await queryOne(
    `UPDATE messages SET is_read = TRUE WHERE id = $1 AND company_id = ANY($2)
     RETURNING id, subject, body, is_read, created_at, sender_id, recipient_id`,
    [msgId, companyIds],
  );

  ok(res, updated);
});
