import { Router } from 'express';
import { z } from 'zod';
import { sendMessage, listMessages, unreadCount, markAsRead, getHrRecipient } from './messages.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

const sendMessageSchema = z.object({
  // Frontend axios interceptor sends snake_case keys (recipient_id),
  // but some integrations/tests may still send recipientId.
  recipientId: z.number().int().positive().optional(),
  recipient_id: z.number().int().positive().optional(),
  subject: z.string().min(1, 'Oggetto obbligatorio').max(255),
  body: z.string().min(1, 'Corpo obbligatorio'),
});

// Unread count — must come before '/' to avoid route conflict
router.get(
  '/unread-count',
  authenticate,
  enforceCompany,
  unreadCount,
);

// Inbox for current user
router.get(
  '/',
  authenticate,
  enforceCompany,
  listMessages,
);

// Send message — management roles only
router.post(
  '/',
  authenticate,
  enforceCompany,
  requireRole('admin', 'hr', 'area_manager', 'store_manager'),
  validate(sendMessageSchema),
  sendMessage,
);

// HR recipient helper (for employee chat UI) — must come before /:id/read to avoid shadowing
router.get(
  '/hr',
  authenticate,
  enforceCompany,
  getHrRecipient,
);

// Mark as read — any authenticated user (access control in controller)
router.patch(
  '/:id/read',
  authenticate,
  enforceCompany,
  markAsRead,
);

export default router;
