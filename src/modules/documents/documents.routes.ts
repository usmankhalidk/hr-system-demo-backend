import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireModulePermission, requireRole, enforceCompany } from '../../middleware/auth';
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
  createGenericDocument,
  getGenericDocuments,
  updateGenericDocumentEmployee,
  deleteDocumentUnified,
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

// Enforce module-level permission for all document routes
router.use(authenticate, requireModulePermission('documenti'));

// ---------------------------------------------------------------------------
// Upload directories
// ---------------------------------------------------------------------------

const DOCUMENTS_UPLOAD_DIR = process.env.UPLOADS_DIR
  ? path.join(path.dirname(process.env.UPLOADS_DIR), 'documents')
  : path.join(process.cwd(), 'uploads', 'documents');

fs.mkdirSync(DOCUMENTS_UPLOAD_DIR, { recursive: true });

const DOCUMENTS_SINGLE_DIR = path.join(DOCUMENTS_UPLOAD_DIR, 'single');
const DOCUMENTS_BULK_DIR = path.join(DOCUMENTS_UPLOAD_DIR, 'bulk');

fs.mkdirSync(DOCUMENTS_SINGLE_DIR, { recursive: true });
fs.mkdirSync(DOCUMENTS_BULK_DIR, { recursive: true });

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
      badRequest(res, 'ZIP file too large (max 50MB)', 'FILE_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_ZIP_TYPE') {
      badRequest(res, 'Invalid ZIP file type', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

// --- Multer Generic (Step 1) ---

const genericStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, DOCUMENTS_SINGLE_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safeName}`);
  },
});

const uploadUnifiedMulter = multer({
  storage: genericStorage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const allowed = [...allowedDocMime, 'application/zip', 'application/x-zip-compressed', 'application/octet-stream'];
    if (allowed.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('INVALID_FILE_TYPE'));
    }
  },
}).single('file');

const uploadUnifiedMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  uploadUnifiedMulter(req, res, (err: any) => {
    if (!err) { next(); return; }
    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'File too large (max 100MB)', 'FILE_TOO_LARGE');
      return;
    }
    if (err.message === 'INVALID_FILE_TYPE') {
      badRequest(res, 'Unsupported file type. Use PDF, JPG, PNG or ZIP', 'INVALID_FILE_TYPE');
      return;
    }
    next(err);
  });
};

// --- Step 2 Auto-assignment Logic ---

async function performAutoAssign(
  documentId: number,
  filename: string,
  companyId: number,
  options?: {
    requiresSignature?: boolean;
    expiresAt?: string | null;
    visibleToRoles?: string[];
    uploadedBy?: number;
  },
): Promise<void> {
  // Fetch active employees for this company, including unique_id
  const employees = await query<{
    id: number;
    name: string;
    surname: string;
    unique_id: string | null;
  }>(
    `SELECT id, name, surname, unique_id FROM users WHERE company_id = $1 AND status = 'active'`,
    [companyId],
  );

  // Normalize filename for matching: remove extension and trim
  const cleanBaseName = filename.replace(/\.(pdf|zip|jpg|jpeg|png|webp|bin|docx|xlsx)$/i, '').trim();
  // Normalize: treat spaces and underscores as the same
  const lowerBaseName = cleanBaseName.toLowerCase().replace(/\s+/g, '_');

  let matchedEmpId: number | null = null;

  // 1. Internal ID Match (e.g. EMP001_file.pdf or EMP001 File.pdf)
  // Extract segment before first underscore
  const firstUnderscore = lowerBaseName.indexOf('_');
  const prefix = firstUnderscore > 0 ? lowerBaseName.substring(0, firstUnderscore) : lowerBaseName;

  for (const emp of employees) {
    if (emp.unique_id && emp.unique_id.toLowerCase() === prefix) {
      matchedEmpId = emp.id;
      break;
    }
  }

  // 2. Exact Surname_Name or Name_Surname (e.g. rossi_mario.pdf or mario rossi.pdf)
  if (!matchedEmpId) {
    for (const emp of employees) {
      const s = emp.surname.toLowerCase();
      const n = emp.name.toLowerCase();
      // Match full name in either order
      if (lowerBaseName === `${s}_${n}` || lowerBaseName.startsWith(`${s}_${n}_`) ||
          lowerBaseName === `${n}_${s}` || lowerBaseName.startsWith(`${n}_${s}_`)) {
        matchedEmpId = emp.id;
        break;
      }
    }
  }

  // 3. Single Name Match (e.g. anna.pdf)
  if (!matchedEmpId) {
    for (const emp of employees) {
      if (lowerBaseName === emp.name.toLowerCase()) {
        matchedEmpId = emp.id;
        break;
      }
    }
  }

  // 4. Single Surname Match (e.g. conti.pdf)
  if (!matchedEmpId) {
    for (const emp of employees) {
      if (lowerBaseName === emp.surname.toLowerCase()) {
        matchedEmpId = emp.id;
        break;
      }
    }
  }

  if (matchedEmpId) {
    const empId = matchedEmpId;
    // 1. Update the generic document as assigned
    await updateGenericDocumentEmployee(documentId, empId);

    // 2. Fetch origin doc info to migrate to employee_documents
    const doc = await queryOne<{ file_url: string; mime_type?: string }>(
      `SELECT file_url FROM documents WHERE id = $1`,
      [documentId]
    );

    if (doc) {
      // 3. Fetch first active category for the company automatically
      const categoryRow = await queryOne<{ id: number; name: string }>(
        `SELECT id, name FROM document_categories WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
        [companyId]
      );
      const autoCategoryId = categoryRow?.id || null;
      const autoCategoryName = categoryRow?.name || null;

      // Update the generic document with category name if found
      if (autoCategoryName) {
        await query('UPDATE documents SET category = $1 WHERE id = $2', [autoCategoryName, documentId]);
      }

      // Map extension to mime type
      const ext = path.extname(filename).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.bin': 'application/octet-stream',
        '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
      const mimeType = mimeMap[ext] ?? 'application/octet-stream';

      // Insert into employee_documents (the "rich" table)
      await queryOne<{ id: number }>(
        `INSERT INTO employee_documents (
            company_id, employee_id, category_id, file_name, storage_path, mime_type,
            uploaded_by_user_id, requires_signature, expires_at, is_visible_to_roles
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id`,
        [
          companyId,
          empId,
          autoCategoryId,
          filename,
          doc.file_url,
          mimeType,
          options?.uploadedBy || null,
          options?.requiresSignature || false,
          options?.expiresAt || null,
          options?.visibleToRoles || ['admin', 'hr', 'area_manager', 'store_manager', 'employee']
        ]
      );
    }
  }
}


// --- Secure Download Feature ---

router.get(
  '/:id/download',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    const doc = await queryOne<{
      id: number;
      file_url: string;
      title: string;
      employee_id: number | null;
    }>(
      `SELECT id, file_url, title, employee_id FROM documents WHERE id = $1`,
      [id],
    );

    if (!doc) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    // Permission check: Admin/HR, Owner, or scoped Supervisor/Store Manager
    const isAdminOrHr = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    const isOwner = doc.employee_id === user.userId;

    let isAuthorized = isAdminOrHr || isOwner;

    if (!isAuthorized && doc.employee_id) {
       // Check if manager is authorized for this employee's scope
       if (user.role === 'area_manager') {
         const supervised = await queryOne(`SELECT id FROM users WHERE id = $1 AND supervisor_id = $2 AND company_id = ANY($3)`, [doc.employee_id, user.userId, allowedCompanyIds]);
         if (supervised) isAuthorized = true;
       } else if (user.role === 'store_manager' && user.storeId) {
         const inStore = await queryOne(`SELECT id FROM users WHERE id = $1 AND store_id = $2 AND company_id = ANY($3)`, [doc.employee_id, user.storeId, allowedCompanyIds]);
         if (inStore) isAuthorized = true;
       }
    }

    if (!isAuthorized) {
      forbidden(res, 'Non sei autorizzato a scaricare questo documento');
      return;
    }

    const resolvedPath = path.resolve(doc.file_url);
    if (!fs.existsSync(resolvedPath)) {
      notFound(res, 'File non trovato sul server', 'FILE_NOT_FOUND');
      return;
    }

    // Send file securely using res.download
    res.download(resolvedPath, doc.title);
  }),
);

// --- Manual Assignment & Rename ---

router.put(
  '/:id',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    const { title, employee_id } = req.body;

    if (!title) {
      badRequest(res, 'Il titolo è obbligatorio', 'MISSING_TITLE');
      return;
    }

    // 1. Get existing document
    const doc = await queryOne<{
      id: number;
      file_url: string;
      title: string;
    }>(
      `SELECT id, file_url, title FROM documents WHERE id = $1`,
      [id],
    );

    if (!doc) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    // 2. Prepare paths and renaming
    const oldPath = path.resolve(doc.file_url);
    const ext = path.extname(doc.file_url);
    const newTitle = title.toLowerCase().endsWith(ext.toLowerCase()) ? title : `${title}${ext}`;
    const dir = path.dirname(oldPath);
    const newPath = path.join(dir, `${Date.now()}_${title.replace(/[^a-zA-Z0-9._-]/g, '_')}${ext}`);

    try {
      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
      } else {
        // If file doesn't exist, we just update the DB with the expected path
        // but log a warning (or maybe fail? user says "rename file on disk")
        console.warn(`File not found at ${oldPath}, skipping disk rename`);
      }

      // 3. Update DB
      let autoCategoryName: string | null = null;
      let autoCategoryId: number | null = null;

      if (employee_id) {
        // Resolve company and category for the employee
        const emp = await queryOne<{ company_id: number }>(
          `SELECT company_id FROM users WHERE id = $1`,
          [employee_id]
        );
        if (emp) {
          const categoryRow = await queryOne<{ id: number; name: string }>(
            `SELECT id, name FROM document_categories WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
            [emp.company_id]
          );
          autoCategoryId = categoryRow?.id || null;
          autoCategoryName = categoryRow?.name || null;
        }
      }

      await query(
        `UPDATE documents
            SET title = $1,
                file_url = $2,
                employee_id = $3,
                category = $4
          WHERE id = $5`,
        [newTitle, newPath, employee_id || null, autoCategoryName, id]
      );

      // 4. Migration/Sync to employee_documents
      // We look for existing record using the OLD path (doc.file_url) 
      const existing = await queryOne<{ id: number }>(`SELECT id FROM employee_documents WHERE storage_path = $1 AND deleted_at IS NULL`, [doc.file_url]);

      if (employee_id) {
        // Fetch companyId of the employee to ensure multi-tenant safety
        const emp = await queryOne<{ company_id: number }>(
          `SELECT company_id FROM users WHERE id = $1`,
          [employee_id]
        );

        if (emp) {
          const ext = path.extname(doc.file_url).toLowerCase();
          const mimeMap: Record<string, string> = {
            '.pdf': 'application/pdf',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.webp': 'image/webp',
            '.bin': 'application/octet-stream',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
          const mimeType = mimeMap[ext] ?? 'application/octet-stream';

          if (!existing) {
            // New assignment
            await query(
              `INSERT INTO employee_documents (
                company_id, employee_id, category_id, file_name, storage_path, mime_type,
                uploaded_by_user_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [emp.company_id, employee_id, autoCategoryId, newTitle, newPath, mimeType, req.user!.userId]
            );
          } else {
            // Re-assignment: Update existing record with NEW company and NEW employee
            await query(
              `UPDATE employee_documents 
                  SET company_id = $1, 
                      employee_id = $2, 
                      category_id = $3, 
                      file_name = $4, 
                      storage_path = $5,
                      updated_at = NOW()
                WHERE id = $6`,
              [emp.company_id, employee_id, autoCategoryId, newTitle, newPath, existing.id]
            );
          }
        }
      } else if (existing) {
        // Employee removed: soft delete from employee_documents
        await query(`UPDATE employee_documents SET deleted_at = NOW() WHERE id = $1`, [existing.id]);
      }

      ok(res, { success: true, message: 'Documento aggiornato con successo' });
    } catch (err: any) {
      console.error('Update document error:', err);
      badRequest(res, `Errore durante l'aggiornamento: ${err.message}`);
    }
  }),
);



// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.get(
  '/',
  authenticate,
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, userId, role, storeId } = req.user!;
    const allowedCompanyIds = await resolveAllowedCompanyIds(req.user!);

    const docs = await getGenericDocuments({
      companyId: companyId!,
      employeeId: userId,
      role,
      storeId,
      allowedCompanyIds,
    });
    ok(res, docs);
  }),
);

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
    const docs = await getEmployeeDocuments(user.companyId, user.userId, user.role);
    ok(res, docs);
  }),
);

// ---------------------------------------------------------------------------
// Unified Upload Endpoint
// ---------------------------------------------------------------------------

router.post(
  '/upload',
  authenticate,
  requireRole('admin', 'hr'),
  uploadUnifiedMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      badRequest(res, 'Upload failed: No file received', 'NO_FILE');
      return;
    }

    const { originalname, mimetype, path: tempPath } = req.file;

    // Detect ZIP by extension or mimetype
    const isZip = originalname.toLowerCase().endsWith('.zip') ||
                  ['application/zip', 'application/x-zip-compressed'].includes(mimetype);

    const { requires_signature, expires_at, visible_to_roles } = req.body;
    const requiresSignature = requires_signature === 'true' || requires_signature === true;
    let visibleToRolesArr: string[] | undefined;
    if (visible_to_roles) {
      try {
        const parsed = JSON.parse(visible_to_roles);
        if (Array.isArray(parsed)) visibleToRolesArr = parsed;
      } catch {
        visibleToRolesArr = String(visible_to_roles).split(',').map(r => r.trim()).filter(Boolean);
      }
    }

    const options = {
      requiresSignature,
      expiresAt: expires_at || null,
      visibleToRoles: visibleToRolesArr,
      uploadedBy: req.user!.userId,
    };

    if (isZip) {
      // Handle ZIP
      const timestamp = Date.now();
      const extractDir = path.join(DOCUMENTS_BULK_DIR, String(timestamp));
      fs.mkdirSync(extractDir, { recursive: true });

      try {
        const zip = new AdmZip(tempPath);
        zip.extractAllTo(extractDir, true);

        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.isDirectory) continue;

          const filePath = path.join(extractDir, entry.entryName);
          const doc = await createGenericDocument({
            title: entry.name,
            fileUrl: filePath,
            uploadedBy: req.user!.userId,
            requiresSignature: options.requiresSignature,
            expiresAt: options.expiresAt,
          });

          // Rule based auto-assignment
          await performAutoAssign(doc.id, entry.name, req.user!.companyId!, options);
        }

        ok(res, { success: true, message: 'ZIP extracted and files saved successfully' });
      } catch (err: any) {
        badRequest(res, 'ZIP processing failed', 'ZIP_ERROR');
      } finally {
        // Clean up temp zip file
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }
    } else {
      // Handle Single File
      const destPath = path.join(DOCUMENTS_SINGLE_DIR, req.file.filename);
      fs.renameSync(tempPath, destPath);

      const doc = await createGenericDocument({
        title: originalname,
        fileUrl: destPath,
        uploadedBy: req.user!.userId,
        requiresSignature: options.requiresSignature,
        expiresAt: options.expiresAt,
      });

      // Rule based auto-assignment
      await performAutoAssign(doc.id, originalname, req.user!.companyId!, options);

      ok(res, { success: true, message: 'Files uploaded successfully', document: doc });
    }

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
    const allowedCompanyIds = await resolveAllowedCompanyIds(user);

    if (allowedCompanyIds.length === 0) {
      ok(res, []);
      return;
    }

    // Only admin/hr may see inactive categories
    const canSeeInactive = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    const includeInactive = canSeeInactive && req.query.include_inactive === 'true';

    const categories = await getCategories(allowedCompanyIds, includeInactive);
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
  enforceCompany,
  asyncHandler(async (req: Request, res: Response) => {
    const { name, company_id } = req.body as { name?: string; company_id?: number };
    
    // enforceCompany already ensures req.body.company_id is valid and accessible,
    // or falls back to req.user.companyId if not provided.
    const targetCompanyId = company_id || req.user!.companyId;
    if (!targetCompanyId) {
      badRequest(res, 'ID azienda mancante', 'MISSING_COMPANY_ID');
      return;
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      badRequest(res, 'Il nome della categoria è obbligatorio', 'VALIDATION_ERROR');
      return;
    }
    if (name.trim().length > 100) {
      badRequest(res, 'Il nome della categoria non può superare i 100 caratteri', 'VALIDATION_ERROR');
      return;
    }

    try {
      const category = await createCategory(targetCompanyId, name.trim());
      
      // Retroactive assignment:
      // 1. Update employee_documents
      await query(
        `UPDATE employee_documents 
            SET category_id = $1 
          WHERE company_id = $2 AND category_id IS NULL AND deleted_at IS NULL`,
        [category.id, targetCompanyId]
      );

      // 2. Update generic documents table for consistency
      await query(
        `UPDATE documents d
            SET category = $1
           FROM users u
          WHERE d.employee_id = u.id
            AND u.company_id = $2
            AND d.category IS NULL`,
        [category.name, targetCompanyId]
      );

      created(res, category, 'Categoria creata con successo');
    } catch (err: any) {
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
  enforceCompany,
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      badRequest(res, 'ID categoria non valido', 'BAD_REQUEST');
      return;
    }

    const { name, is_active, company_id, current_company_id } = req.body as {
      name?: string;
      is_active?: boolean;
      company_id?: number;
      current_company_id?: number;
    };

    const sourceCompanyId = current_company_id || req.user!.companyId;
    const destinationCompanyId = company_id;

    if (!sourceCompanyId) {
      badRequest(res, 'ID azienda sorgente mancante', 'MISSING_SOURCE_COMPANY_ID');
      return;
    }

    // enforceCompany already validated company_id (destination) if present.
    // We also need to ensure the user has access to sourceCompanyId if it's different.
    if (sourceCompanyId !== (company_id || req.user!.companyId)) {
      const allowed = await resolveAllowedCompanyIds(req.user!);
      if (!allowed.includes(sourceCompanyId)) {
        forbidden(res, 'Accesso negato all\'azienda sorgente');
        return;
      }
    }

    if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0)) {
      badRequest(res, 'Il nome della categoria non può essere vuoto', 'VALIDATION_ERROR');
      return;
    }

    try {
      const updated = await updateCategory(id, sourceCompanyId, {
        name: name !== undefined ? name.trim() : undefined,
        isActive: is_active,
        companyId: destinationCompanyId,
      });

      if (!updated) {
        notFound(res, 'Categoria non trovata per l\'azienda specificata', 'NOT_FOUND');
        return;
      }

      ok(res, updated, 'Categoria aggiornata con successo');
    } catch (err: any) {
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

    const isAdminOrHr = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    const isAreaManager = user.role === 'area_manager';
    const isStoreManager = user.role === 'store_manager';

    if (!isAdminOrHr && !isAreaManager && !isStoreManager) {
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

    // Scoped check for managers
    if (!isAdminOrHr) {
      if (isAreaManager) {
        const supervised = await queryOne(`SELECT id FROM users WHERE id = $1 AND supervisor_id = $2`, [employeeId, user.userId]);
        if (!supervised) {
          res.status(403).json({ success: false, error: 'Non autorizzato: dipendente fuori ambito', code: 'FORBIDDEN' });
          return;
        }
      } else if (isStoreManager && user.storeId) {
        const inStore = await queryOne(`SELECT id FROM users WHERE id = $1 AND store_id = $2`, [employeeId, user.storeId]);
        if (!inStore) {
          res.status(403).json({ success: false, error: 'Non autorizzato: dipendente fuori ambito', code: 'FORBIDDEN' });
          return;
        }
      }
    }

    const docs = await getEmployeeDocuments(employee.company_id, employeeId, user.role);
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

    const { requires_signature, expires_at, visible_to_roles } = req.body;
    const requiresSignature = requires_signature === 'true' || requires_signature === true;
    const expiresAt: string | null = expires_at ? String(expires_at) : null;

    // Fetch first active category for the company automatically
    const categoryRow = await queryOne<{ id: number }>(
      `SELECT id FROM document_categories WHERE company_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
      [employee.company_id]
    );
    const autoCategoryId = categoryRow?.id || null;

    // Parse visible_to_roles: accept comma-separated string or JSON array string
    let visibleToRoles: string[] | null = null;
    if (visible_to_roles) {
      try {
        const parsed = JSON.parse(visible_to_roles);
        if (Array.isArray(parsed)) visibleToRoles = parsed;
      } catch {
        visibleToRoles = String(visible_to_roles).split(',').map((r) => r.trim()).filter(Boolean);
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
        autoCategoryId,
        originalname,
        storagePath,
        mimetype,
        user.userId,
        requiresSignature,
        expiresAt,
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

    // Role and scope check
    const isAdminOrHr = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    const isOwner = doc.employee_id === user.userId;

    let isAuthorized = isAdminOrHr || isOwner;

    if (!isAuthorized) {
      // Check if the current user's role is allowed to see this document in general
      if (doc.is_visible_to_roles && doc.is_visible_to_roles.includes(user.role)) {
        // For managers, we also verify the employee scope
        if (user.role === 'area_manager') {
          const supervised = await queryOne(`SELECT id FROM users WHERE id = $1 AND supervisor_id = $2`, [doc.employee_id, user.userId]);
          if (supervised) isAuthorized = true;
        } else if (user.role === 'store_manager' && user.storeId) {
          const inStore = await queryOne(`SELECT id FROM users WHERE id = $1 AND store_id = $2`, [doc.employee_id, user.storeId]);
          if (inStore) isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
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

    const deleted = await deleteDocumentUnified(id, user.companyId);
    if (deleted) {
      ok(res, { id }, 'Documento eliminato con successo');
      return;
    }

    notFound(res, 'Documento non trovato o già eliminato');
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
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        const fontSize = 12;
        const lineHeight = fontSize * 1.8;
        const margin = 60;

        // Language detection
        const lang = (req.headers['accept-language'] || req.headers['x-lang'] || 'it').toString().toLowerCase();
        const isIt = lang.startsWith('it');

        const labels = isIt ? {
          title: 'Dettagli Firma Elettronica',
          signedBy: 'Firmato da',
          role: 'Ruolo',
          email: 'Email',
          date: 'Data e Ora',
          ip: 'Indirizzo IP',
          browser: 'Browser',
          disclaimer: 'Questo documento è stato firmato elettronicamente con consenso legale.'
        } : {
          title: 'E-Signature Audit Trail',
          signedBy: 'Signed by',
          role: 'Role',
          email: 'Email',
          date: 'Date and Time',
          ip: 'IP Address',
          browser: 'Browser',
          disclaimer: 'This document has been electronically signed with legal consent.'
        };

        const dateStr = now.toLocaleString(isIt ? 'it-IT' : 'en-US', { 
          timeZone: 'Europe/Rome',
          dateStyle: 'medium',
          timeStyle: 'medium'
        });

        const browser = req.headers['user-agent'] || 'Unknown';

        let y = height - margin;
        
        // Title
        page.drawText(labels.title, { x: margin, y, size: 16, font: fontBold });
        y -= lineHeight * 1.5;

        const drawField = (label: string, value: string) => {
          page.drawText(`${label}:`, { x: margin, y, size: fontSize, font: fontBold });
          page.drawText(value, { x: margin + 100, y, size: fontSize, font });
          y -= lineHeight;
        };

        drawField(labels.signedBy, `${signerName} ${signerSurname}`);
        drawField(labels.role, signerRole);
        drawField(labels.email, signerEmail);
        drawField(labels.date, dateStr);
        drawField(labels.ip, signedIp);
        
        // Browser handling (may wrap)
        page.drawText(`${labels.browser}:`, { x: margin, y, size: fontSize, font: fontBold });
        const browserShort = browser.length > 60 ? browser.substring(0, 57) + '...' : browser;
        page.drawText(browserShort, { x: margin + 100, y, size: fontSize, font });
        y -= lineHeight * 2;

        // Disclaimer
        page.drawText(labels.disclaimer, {
          x: margin,
          y,
          size: 10,
          font,
          color: rgb(0.4, 0.4, 0.4),
        });

        const modifiedPdfBytes = await pdfDoc.save();
        fs.writeFileSync(doc.storage_path, modifiedPdfBytes);
        newStoragePath = doc.storage_path;
      } catch (pdfErr: any) {
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
