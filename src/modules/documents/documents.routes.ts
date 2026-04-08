import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireModulePermission, requireRole } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound, conflict } from '../../utils/response';
import {
  getEmployeeDocuments,
  getCategories,
  createCategory,
  updateCategory,
  getDocumentById,
  softDeleteDocument,
  updateDocumentVisibility,
  signDocument,
} from './documents.service';
import { resolveAllowedCompanyIds } from '../../utils/companyScope';
import { query, queryOne, pool } from '../../config/database';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Phase 3 placeholder: employee documents, bulk uploads, and e-signature.
// This router is intentionally NOT wired into src/index.ts yet.

const router = Router();

// ---------------------------------------------------------------------------
// Upload directories
// ---------------------------------------------------------------------------

const DOCUMENTS_UPLOAD_DIR = process.env.UPLOADS_DIR
  ? path.join(path.dirname(process.env.UPLOADS_DIR), 'documents')
  : path.join(process.cwd(), 'uploads', 'documents');

fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Multer — single document (10 MB, PDF/JPG/PNG/WebP)
// ---------------------------------------------------------------------------

const allowedDocMime = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const documentsStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCUMENTS_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const employeeId = req.params.employeeId || 'unknown';
    const ext = path.extname(file.originalname) || '.bin';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${employeeId}_${Date.now()}_${safeName}${ext}`);
  },
});

const uploadDocumentMulter = multer({
  storage: documentsStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (allowedDocMime.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
}).single('file');

const uploadDocumentMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  uploadDocumentMulter(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file supera il limite di 10MB', 'FILE_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Formato file non supportato. Usa PDF o immagini (JPG, PNG, WebP)', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

// ---------------------------------------------------------------------------
// Multer — bulk ZIP upload (50 MB)
// ---------------------------------------------------------------------------

const zipStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCUMENTS_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `bulk_${Date.now()}_${safeName}`);
  },
});

const uploadZipMulter = multer({
  storage: zipStorage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_ZIP_TYPE'));
    }
  },
}).single('file');

const uploadZipMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  uploadZipMulter(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il file ZIP supera il limite di 50MB', 'FILE_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_ZIP_TYPE') {
      badRequest(res, 'Formato non supportato. Carica un file ZIP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

// ---------------------------------------------------------------------------
// Valid roles for visibility
// ---------------------------------------------------------------------------

const VALID_ROLES = ['admin', 'hr', 'area_manager', 'store_manager', 'employee'];

// ---------------------------------------------------------------------------
// GET /api/documents/my — current user's documents
// ---------------------------------------------------------------------------

router.get(
  '/my',
  authenticate,
  requireModulePermission('documenti', 'read'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }
    const docs = await getEmployeeDocuments(user.companyId, user.userId);
    ok(res, docs);
  }),
);

// ---------------------------------------------------------------------------
// GET /api/documents/categories
// ---------------------------------------------------------------------------

router.get(
  '/categories',
  authenticate,
  requireModulePermission('documenti', 'read'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    // Only admin/hr may see inactive categories
    const canSeeInactive = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    const includeInactive = canSeeInactive && req.query.include_inactive === 'true';

    const categories = await getCategories(user.companyId, includeInactive);
    ok(res, categories);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/documents/categories
// ---------------------------------------------------------------------------

router.post(
  '/categories',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const { name } = req.body as { name?: string };
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      badRequest(res, 'Il nome della categoria è obbligatorio', 'VALIDATION_ERROR');
      return;
    }
    if (name.trim().length > 100) {
      badRequest(res, 'Il nome della categoria non può superare i 100 caratteri', 'VALIDATION_ERROR');
      return;
    }

    try {
      const category = await createCategory(user.companyId, name.trim());
      created(res, category, 'Categoria creata con successo');
    } catch (err: any) {
      // PostgreSQL unique violation: code 23505
      if (err?.code === '23505') {
        conflict(res, 'Esiste già una categoria con questo nome', 'DUPLICATE_CATEGORY');
        return;
      }
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/documents/categories/:id
// ---------------------------------------------------------------------------

router.patch(
  '/categories/:id',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID categoria non valido', 'BAD_REQUEST');
      return;
    }

    const { name, is_active } = req.body as { name?: string; is_active?: boolean };
    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      badRequest(res, 'Il nome della categoria non può essere vuoto', 'VALIDATION_ERROR');
      return;
    }
    if (name !== undefined && name.trim().length > 100) {
      badRequest(res, 'Il nome della categoria non può superare i 100 caratteri', 'VALIDATION_ERROR');
      return;
    }

    if (name === undefined && is_active === undefined) {
      badRequest(res, 'Nessun campo da aggiornare', 'VALIDATION_ERROR');
      return;
    }

    try {
      const updated = await updateCategory(id, user.companyId, {
        name: name !== undefined ? name.trim() : undefined,
        isActive: is_active,
      });

      if (!updated) {
        notFound(res, 'Categoria non trovata', 'NOT_FOUND');
        return;
      }

      ok(res, updated, 'Categoria aggiornata con successo');
    } catch (err: any) {
      if (err?.code === '23505') {
        conflict(res, 'Esiste già una categoria con questo nome', 'DUPLICATE_CATEGORY');
        return;
      }
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// POST /api/documents/bulk-upload
// ---------------------------------------------------------------------------

router.post(
  '/bulk-upload',
  authenticate,
  requireRole('admin', 'hr'),
  uploadZipMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    if (!req.file) {
      badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
      return;
    }

    // Extra mime-type guard (some clients send application/octet-stream for zip)
    const zipMimes = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    const isZipByName = req.file.originalname.toLowerCase().endsWith('.zip');
    if (!zipMimes.includes(req.file.mimetype) && !isZipByName) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      badRequest(res, 'Formato non supportato. Carica un file ZIP', 'INVALID_FILE_TYPE');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    // Insert upload record
    const uploadRow = await queryOne<{ id: number }>(
      `INSERT INTO bulk_document_uploads
         (company_id, uploaded_by_id, original_name, storage_path, status)
       VALUES ($1, $2, $3, $4, 'processing')
       RETURNING id`,
      [user.companyId, user.userId, req.file.originalname, req.file.path],
    );
    const uploadId = uploadRow!.id;

    try {
      const zip = new AdmZip(req.file.path);
      const entries = zip.getEntries().filter((e) => !e.isDirectory);

      let matchedFiles = 0;
      let unmatchedFiles = 0;
      const unmatchedFileNames: string[] = [];

      for (const entry of entries) {
        const origName = entry.entryName.split('/').pop() ?? entry.entryName;
        const stem = origName.replace(/\.[^.]+$/, '');

        // Normalize: lowercase, strip accents, replace non-alpha with _
        const normalized = stem
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '_');

        // Attempt to find a matching employee
        let matchedEmployeeId: number | null = null;

        // Pattern 3: unique_id prefix (UNIQUEID_...)
        const uniqueIdPart = normalized.split('_')[0];
        if (!matchedEmployeeId && uniqueIdPart) {
          // Try exact unique_id match with the first segment (also try full stem for UNIQUEID only files)
          const tryIds = Array.from(new Set([uniqueIdPart, normalized.replace(/_/g, '-')]));
          for (const tryId of tryIds) {
            const row = await queryOne<{ id: number; company_id: number }>(
              `SELECT id, company_id FROM users WHERE LOWER(unique_id) = $1 AND company_id = ANY($2) LIMIT 1`,
              [tryId, allowedCompanyIds],
            );
            if (row) { matchedEmployeeId = row.id; break; }
          }
        }

        // Pattern 1: SURNAME_NAME
        if (!matchedEmployeeId) {
          const parts = normalized.split('_').filter(Boolean);
          if (parts.length >= 2) {
            const surname = parts[0];
            const name = parts.slice(1).join('_');
            const row = await queryOne<{ id: number }>(
              `SELECT id FROM users
                WHERE LOWER(surname) = $1 AND LOWER(name) = $2
                  AND company_id = ANY($3)
               LIMIT 1`,
              [surname, name, allowedCompanyIds],
            );
            if (row) matchedEmployeeId = row.id;
          }
        }

        // Pattern 2: NAME_SURNAME
        if (!matchedEmployeeId) {
          const parts = normalized.split('_').filter(Boolean);
          if (parts.length >= 2) {
            const name = parts[0];
            const surname = parts.slice(1).join('_');
            const row = await queryOne<{ id: number }>(
              `SELECT id FROM users
                WHERE LOWER(name) = $1 AND LOWER(surname) = $2
                  AND company_id = ANY($3)
               LIMIT 1`,
              [name, surname, allowedCompanyIds],
            );
            if (row) matchedEmployeeId = row.id;
          }
        }

        if (matchedEmployeeId !== null) {
          // Extract and save file
          const fileBytes = entry.getData();
          const destFileName = `${uploadId}_${origName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const destPath = path.join(DOCUMENTS_UPLOAD_DIR, destFileName);
          fs.writeFileSync(destPath, fileBytes);

          // Determine mime type from extension
          const ext = path.extname(origName).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
          };
          const mimeType = mimeMap[ext] ?? 'application/octet-stream';

          // Fetch company_id for the matched employee
          const empRow = await queryOne<{ company_id: number }>(
            `SELECT company_id FROM users WHERE id = $1`,
            [matchedEmployeeId],
          );

          if (empRow) {
            await queryOne<{ id: number }>(
              `INSERT INTO employee_documents
                 (company_id, employee_id, file_name, storage_path, mime_type, uploaded_by_user_id)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING id`,
              [empRow.company_id, matchedEmployeeId, origName, destPath, mimeType, user.userId],
            );
          }

          await queryOne<{ id: number }>(
            `INSERT INTO bulk_document_files
               (bulk_upload_id, original_file_name, employee_id, storage_path, status)
             VALUES ($1, $2, $3, $4, 'matched')
             RETURNING id`,
            [uploadId, origName, matchedEmployeeId, destPath],
          );

          matchedFiles++;
        } else {
          // Unmatched
          await queryOne<{ id: number }>(
            `INSERT INTO bulk_document_files
               (bulk_upload_id, original_file_name, employee_identifier, status)
             VALUES ($1, $2, $3, 'unmatched')
             RETURNING id`,
            [uploadId, origName, normalized],
          );
          unmatchedFiles++;
          unmatchedFileNames.push(origName);
        }
      }

      const totalFiles = entries.length;

      // Update summary
      await queryOne<{ id: number }>(
        `UPDATE bulk_document_uploads
            SET total_files = $2, matched_files = $3, unmatched_files = $4,
                status = 'completed', updated_at = NOW()
          WHERE id = $1
          RETURNING id`,
        [uploadId, totalFiles, matchedFiles, unmatchedFiles],
      );

      ok(res, { uploadId, totalFiles, matchedFiles, unmatchedFiles, unmatchedFileNames });
    } catch (err: any) {
      await queryOne<{ id: number }>(
        `UPDATE bulk_document_uploads
            SET status = 'failed', error_message = $2, updated_at = NOW()
          WHERE id = $1
          RETURNING id`,
        [uploadId, err?.message ?? 'Errore sconosciuto'],
      );
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// GET /api/documents/bulk-upload/:uploadId/report
// ---------------------------------------------------------------------------

router.get(
  '/bulk-upload/:uploadId/report',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const uploadId = parseInt(req.params.uploadId, 10);
    if (Number.isNaN(uploadId)) {
      badRequest(res, 'ID upload non valido', 'BAD_REQUEST');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    const uploadRow = await queryOne<{
      id: number;
      company_id: number;
      uploaded_by_id: number;
      original_name: string;
      storage_path: string;
      status: string;
      total_files: number | null;
      matched_files: number | null;
      unmatched_files: number | null;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, company_id, uploaded_by_id, original_name, storage_path,
              status, total_files, matched_files, unmatched_files, error_message,
              created_at, updated_at
         FROM bulk_document_uploads
        WHERE id = $1`,
      [uploadId],
    );

    if (!uploadRow) {
      notFound(res, 'Upload non trovato', 'NOT_FOUND');
      return;
    }

    if (!allowedCompanyIds.includes(uploadRow.company_id)) {
      forbidden(res, 'Accesso negato');
      return;
    }

    const files = await query<{
      id: number;
      bulk_upload_id: number;
      original_file_name: string;
      employee_id: number | null;
      employee_identifier: string | null;
      storage_path: string | null;
      status: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, bulk_upload_id, original_file_name, employee_id,
              employee_identifier, storage_path, status, error_message,
              created_at, updated_at
         FROM bulk_document_files
        WHERE bulk_upload_id = $1
        ORDER BY id ASC`,
      [uploadId],
    );

    ok(res, {
      upload: {
        id: uploadRow.id,
        companyId: uploadRow.company_id,
        uploadedById: uploadRow.uploaded_by_id,
        originalName: uploadRow.original_name,
        status: uploadRow.status,
        totalFiles: uploadRow.total_files,
        matchedFiles: uploadRow.matched_files,
        unmatchedFiles: uploadRow.unmatched_files,
        errorMessage: uploadRow.error_message,
        createdAt: uploadRow.created_at,
        updatedAt: uploadRow.updated_at,
      },
      files: files.map((f) => ({
        id: f.id,
        bulkUploadId: f.bulk_upload_id,
        originalFileName: f.original_file_name,
        employeeId: f.employee_id,
        employeeIdentifier: f.employee_identifier,
        status: f.status,
        errorMessage: f.error_message,
        createdAt: f.created_at,
        updatedAt: f.updated_at,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// GET /api/documents/employee/:employeeId — HR/Admin view of employee docs
// ---------------------------------------------------------------------------

router.get(
  '/employee/:employeeId',
  authenticate,
  requireModulePermission('documenti', 'read'),
  asyncHandler(async (req: Request, res: Response) => {
    const { user } = req;
    if (!user) {
      res.status(401).json({ success: false, error: 'Non autenticato', code: 'NOT_AUTHENTICATED' });
      return;
    }

    if (!['admin', 'hr', 'area_manager', 'store_manager'].includes(user.role)) {
      res.status(403).json({ success: false, error: 'Accesso negato', code: 'FORBIDDEN' });
      return;
    }

    const employeeId = parseInt(req.params.employeeId, 10);
    if (Number.isNaN(employeeId)) {
      res.status(400).json({ success: false, error: 'ID dipendente non valido', code: 'BAD_REQUEST' });
      return;
    }

    const employee = await queryOne<{ company_id: number }>(
      'SELECT company_id FROM users WHERE id = $1',
      [employeeId],
    );

    if (!employee) {
      res.status(404).json({ success: false, error: 'Dipendente non trovato', code: 'NOT_FOUND' });
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);
    if (!allowedCompanyIds.includes(employee.company_id)) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const docs = await getEmployeeDocuments(employee.company_id, employeeId);
    ok(res, docs);
  }),
);

// ---------------------------------------------------------------------------
// POST /api/documents/employee/:employeeId — upload a document for an employee
// ---------------------------------------------------------------------------

router.post(
  '/employee/:employeeId',
  authenticate,
  requireModulePermission('documenti', 'read'),
  uploadDocumentMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { user } = req;
    if (!user) {
      res.status(401).json({ success: false, error: 'Non autenticato', code: 'NOT_AUTHENTICATED' });
      return;
    }

    if (!['admin', 'hr', 'area_manager', 'store_manager'].includes(user.role)) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      forbidden(res, 'Accesso negato');
      return;
    }

    const employeeId = parseInt(req.params.employeeId, 10);
    if (Number.isNaN(employeeId)) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      badRequest(res, 'ID dipendente non valido', 'BAD_REQUEST');
      return;
    }

    if (!req.file) {
      badRequest(res, 'Nessun file ricevuto', 'NO_FILE');
      return;
    }

    const employee = await queryOne<{ company_id: number }>(
      'SELECT company_id FROM users WHERE id = $1',
      [employeeId],
    );

    if (!employee) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      notFound(res, 'Dipendente non trovato', 'NOT_FOUND');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);
    if (!allowedCompanyIds.includes(employee.company_id)) {
      try { fs.unlinkSync(req.file.path); } catch { /* ignore */ }
      forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
      return;
    }

    const { originalname, mimetype, path: storagePath } = req.file;

    // Parse optional extra fields from body
    const categoryId = req.body.category_id ? parseInt(String(req.body.category_id), 10) : null;
    const requiresSignature = req.body.requires_signature === 'true' || req.body.requires_signature === true;
    const expiresAt: string | null = req.body.expires_at
      ? String(req.body.expires_at)
      : null;

    // Parse visible_to_roles: accept comma-separated string or JSON array string
    let visibleToRoles: string[] | null = null;
    if (req.body.visible_to_roles) {
      try {
        const parsed = JSON.parse(req.body.visible_to_roles);
        if (Array.isArray(parsed)) visibleToRoles = parsed;
      } catch {
        visibleToRoles = String(req.body.visible_to_roles).split(',').map((r) => r.trim()).filter(Boolean);
      }
    }

    const insertResult = await queryOne<{ id: number }>(
      `INSERT INTO employee_documents (
         company_id, employee_id, category_id, file_name, storage_path, mime_type,
         uploaded_by_user_id, requires_signature, expires_at, is_visible_to_roles
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        employee.company_id,
        employeeId,
        categoryId || null,
        originalname,
        storagePath,
        mimetype,
        user.userId,
        requiresSignature,
        expiresAt || null,
        visibleToRoles || ['admin', 'hr', 'area_manager', 'store_manager', 'employee'],
      ],
    );

    ok(res, { id: insertResult?.id ?? null, fileName: originalname }, 'Documento caricato');
  }),
);

// ---------------------------------------------------------------------------
// GET /api/documents/:id/download
// ---------------------------------------------------------------------------

router.get(
  '/:id/download',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    // Look up across all allowed companies for this user
    const doc = await queryOne<{
      id: number;
      company_id: number;
      file_name: string;
      storage_path: string;
      mime_type: string | null;
      is_visible_to_roles: string[];
      deleted_at: string | null;
    }>(
      `SELECT id, company_id, file_name, storage_path, mime_type,
              is_visible_to_roles, deleted_at
         FROM employee_documents
        WHERE id = $1 AND company_id = ANY($2)`,
      [id, allowedCompanyIds],
    );

    if (!doc || doc.deleted_at !== null) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    // Role visibility check
    if (!doc.is_visible_to_roles.includes(user.role) && user.is_super_admin !== true) {
      forbidden(res, 'Non sei autorizzato a scaricare questo documento');
      return;
    }

    // Security: path traversal prevention
    const resolvedPath = path.resolve(doc.storage_path);
    const resolvedDir = path.resolve(DOCUMENTS_UPLOAD_DIR);
    if (!resolvedPath.startsWith(resolvedDir + path.sep) && resolvedPath !== resolvedDir) {
      forbidden(res, 'Percorso file non valido', 'INVALID_PATH');
      return;
    }

    if (!fs.existsSync(resolvedPath)) {
      notFound(res, 'File non trovato sul server', 'FILE_NOT_FOUND');
      return;
    }

    const contentType = doc.mime_type ?? 'application/octet-stream';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
    res.sendFile(resolvedPath);
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/documents/:id — soft delete
// ---------------------------------------------------------------------------

router.delete(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    // Look up the document to validate company scope
    const doc = await queryOne<{ id: number; company_id: number; deleted_at: string | null }>(
      `SELECT id, company_id, deleted_at FROM employee_documents WHERE id = $1`,
      [id],
    );

    if (!doc || !allowedCompanyIds.includes(doc.company_id)) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    if (doc.deleted_at !== null) {
      notFound(res, 'Documento già eliminato', 'NOT_FOUND');
      return;
    }

    const deleted = await softDeleteDocument(id, doc.company_id);
    if (!deleted) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    ok(res, { id }, 'Documento eliminato con successo');
  }),
);

// ---------------------------------------------------------------------------
// PATCH /api/documents/:id/visibility
// ---------------------------------------------------------------------------

router.patch(
  '/:id/visibility',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    const { roles } = req.body as { roles?: string[] };
    if (!Array.isArray(roles) || roles.length === 0) {
      badRequest(res, 'Il campo roles è obbligatorio e deve essere un array non vuoto', 'VALIDATION_ERROR');
      return;
    }

    const invalidRoles = roles.filter((r) => !VALID_ROLES.includes(r));
    if (invalidRoles.length > 0) {
      badRequest(res, `Ruoli non validi: ${invalidRoles.join(', ')}`, 'INVALID_ROLES');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    const doc = await queryOne<{ id: number; company_id: number; deleted_at: string | null }>(
      `SELECT id, company_id, deleted_at FROM employee_documents WHERE id = $1`,
      [id],
    );

    if (!doc || !allowedCompanyIds.includes(doc.company_id) || doc.deleted_at !== null) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    const updated = await updateDocumentVisibility(id, doc.company_id, roles);
    if (!updated) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    ok(res, { id, isVisibleToRoles: roles }, 'Visibilità aggiornata con successo');
  }),
);

// ---------------------------------------------------------------------------
// POST /api/documents/:id/sign — e-signature
// ---------------------------------------------------------------------------

router.post(
  '/:id/sign',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    const doc = await queryOne<{
      id: number;
      company_id: number;
      employee_id: number;
      file_name: string;
      storage_path: string;
      mime_type: string | null;
      requires_signature: boolean;
      signed_at: string | null;
      deleted_at: string | null;
    }>(
      `SELECT id, company_id, employee_id, file_name, storage_path, mime_type,
              requires_signature, signed_at, deleted_at
         FROM employee_documents
        WHERE id = $1 AND company_id = ANY($2)`,
      [id, allowedCompanyIds],
    );

    if (!doc || doc.deleted_at !== null) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    if (!doc.requires_signature) {
      badRequest(res, 'Questo documento non richiede firma', 'SIGNATURE_NOT_REQUIRED');
      return;
    }

    if (doc.signed_at !== null) {
      conflict(res, 'Documento già firmato', 'ALREADY_SIGNED');
      return;
    }

    // Authorization: employee signing own doc, or admin/hr signing on behalf
    const isAdminOrHr = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    if (!isAdminOrHr && user.userId !== doc.employee_id) {
      forbidden(res, 'Non sei autorizzato a firmare questo documento');
      return;
    }

    // Fetch signer's full name and role from DB for signature_meta
    const signerInfo = await queryOne<{
      name: string;
      surname: string;
      role: string;
      email: string;
    }>(
      `SELECT name, surname, role, email FROM users WHERE id = $1`,
      [user.userId],
    );

    const signerName = signerInfo?.name ?? '';
    const signerSurname = signerInfo?.surname ?? '';
    const signerRole = signerInfo?.role ?? user.role;
    const signerEmail = signerInfo?.email ?? user.email ?? '';

    // Resolve caller's IP
    const forwardedFor = req.headers['x-forwarded-for'];
    const signedIp = Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : req.ip ?? '0.0.0.0';

    const now = new Date();
    const signatureMeta: Record<string, unknown> = {
      signerName,
      signerSurname,
      signerRole,
      signerEmail,
      timestamp: now.toISOString(),
      ip: signedIp,
      userAgent: req.headers['user-agent'] ?? '',
    };

    let newStoragePath: string | undefined;

    // Append signature page to PDF if applicable
    if (doc.mime_type === 'application/pdf') {
      try {
        const pdfBytes = fs.readFileSync(doc.storage_path);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const fontSize = 12;
        const lineHeight = fontSize * 1.6;
        const margin = 60;

        const dateStr = now.toLocaleString('it-IT', { timeZone: 'Europe/Rome' });
        const lines = [
          'Documento firmato digitalmente',
          '',
          `Firmato da: ${signerName} ${signerSurname}`,
          `Ruolo: ${signerRole}`,
          `Data: ${dateStr}`,
          `IP: ${signedIp}`,
        ];

        let y = height - margin;
        for (const line of lines) {
          if (line === '') { y -= lineHeight / 2; continue; }
          page.drawText(line, {
            x: margin,
            y,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
          y -= lineHeight;
        }

        const modifiedPdfBytes = await pdfDoc.save();
        fs.writeFileSync(doc.storage_path, modifiedPdfBytes);
        newStoragePath = doc.storage_path; // same path, overwritten in place
      } catch (pdfErr: any) {
        // PDF manipulation failure is non-fatal — we still record the signature
        signatureMeta['pdfSignatureError'] = pdfErr?.message ?? 'Errore PDF';
      }
    }

    const updated = await signDocument(id, {
      signedByUserId: user.userId,
      signedIp,
      signatureMeta,
      newStoragePath,
    });

    if (!updated) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    // Never expose internal storage path
    const { storagePath: _sp, ...safeDoc } = updated;
    ok(res, safeDoc, 'Documento firmato con successo');
  }),
);

export default router;
