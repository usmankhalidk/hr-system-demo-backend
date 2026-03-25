import { Router } from 'express';
import { z } from 'zod';
import { sendMessage, listMessages, unreadCount, markAsRead } from './messages.controller';
import { authenticate, requireRole, enforceCompany } from '../../middleware/auth';
import { validate } from '../../middleware/validate';

const router = Router();

const sendMessageSchema = z.object({
  recipientId: z.number().int().positive(),
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
  requireRole('admin', 'hr', 'area_manager', 'store_manager'),
  enforceCompany,
  validate(sendMessageSchema),
  sendMessage,
);

// Mark as read — any authenticated user (access control in controller)
router.patch(
  '/:id/read',
  authenticate,
  enforceCompany,
  markAsRead,
);

export default router;
