import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, requireModulePermission, requireRole, enforceCompany } from '../../middleware/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { ok, created, badRequest, forbidden, notFound, conflict } from '../../utils/response';
import {
  getEmployeeDocuments,
  getCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getDocumentById,
  softDeleteDocument,
  updateDocumentVisibility,
  signDocument,
  signGenericDocument,
  createGenericDocument,
  getGenericDocuments,
  updateGenericDocumentEmployee,
  deleteDocumentUnified,
  getDeletedDocuments,
  restoreDocument,
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
    employeeId?: number | null;
  },
): Promise<void> {
  // Fetch active employees for this company, including unique_id
  const employees = await query<{
    id: number;
    name: string;
    surname: string;
    unique_id: string | null;
  }>(
    `SELECT id, name, surname, unique_id FROM users WHERE company_id = $1 AND status = 'active' AND role <> 'admin'`,
    [companyId],
  );

  // Normalize filename for matching: remove extension and trim
  const cleanBaseName = filename.replace(/\.(pdf|zip|jpg|jpeg|png|webp|bin|docx|xlsx)$/i, '').trim();
  // Split into tokens (lowercase)
  const tokens = cleanBaseName.toLowerCase().split(/[_\s.-]+/).filter(Boolean);
  const fullLowerName = cleanBaseName.toLowerCase();

  const matchesLevel1: number[] = []; // ID Match
  const matchesLevel2: number[] = []; // Full name Match
  const matchesLevel3: number[] = []; // Single name/surname token Match

  for (const emp of employees) {
    const name = emp.name.toLowerCase();
    const surname = emp.surname.toLowerCase();
    const uid = emp.unique_id?.toLowerCase();

    // Level 1: Unique ID (highest priority)
    if (uid && tokens.includes(uid)) {
      matchesLevel1.push(emp.id);
      continue;
    }

    // Level 2: Full Name (Surname_Name or Name_Surname tokens anywhere)
    if (fullLowerName.includes(`${name} ${surname}`) || 
        fullLowerName.includes(`${surname} ${name}`) ||
        fullLowerName.includes(`${name}_${surname}`) ||
        fullLowerName.includes(`${surname}_${name}`)) {
      matchesLevel2.push(emp.id);
      continue;
    }

    // Level 3: Partial token match
    if (tokens.includes(name) || tokens.includes(surname)) {
      matchesLevel3.push(emp.id);
    }
  }

  let matchedEmpId: number | null = options?.employeeId !== undefined ? options.employeeId : null;
  
  if (matchedEmpId === null) {
    if (matchesLevel1.length === 1) {
      matchedEmpId = matchesLevel1[0];
    } else if (matchesLevel1.length === 0 && matchesLevel2.length === 1) {
      matchedEmpId = matchesLevel2[0];
    } else if (matchesLevel1.length === 0 && matchesLevel2.length === 0 && matchesLevel3.length === 1) {
      matchedEmpId = matchesLevel3[0];
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

// --- Unified Download Route ---
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

    const doc = await getDocumentById(id, user.companyId!, user);

    if (!doc) {
      notFound(res, 'Documento non trovato o non autorizzato', 'NOT_FOUND');
      return;
    }

    const resolvedPath = path.resolve(doc.storagePath);
    if (!fs.existsSync(resolvedPath)) {
      notFound(res, 'File non trovato sul server', 'FILE_NOT_FOUND');
      return;
    }

    res.download(resolvedPath, doc.fileName);
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
      is_visible_to_roles: string[];
    }>(
      `SELECT id, file_url, title, is_visible_to_roles FROM documents WHERE id = $1`,
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
        const emp = await queryOne<{ company_id: number; role: string }>(
          `SELECT company_id, role FROM users WHERE id = $1`,
          [employee_id]
        );
        
        if (emp && emp.role === 'admin') {
          badRequest(res, 'I documenti non possono essere assegnati agli amministratori', 'FORBIDDEN_ASSIGNMENT');
          return;
        }

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
                uploaded_by_user_id, is_visible_to_roles
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [emp.company_id, employee_id, autoCategoryId, newTitle, newPath, mimeType, req.user!.userId, doc.is_visible_to_roles]
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
    const docs = await getEmployeeDocuments(user.companyId, user.userId, user);
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

    const { requires_signature, expires_at, visible_to_roles, employee_id } = req.body;

    // Requirement: Admin or HR must set Expiration Date
    if (['admin', 'hr'].includes(req.user!.role) && (!expires_at || String(expires_at).trim() === '')) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      badRequest(res, 'La data di scadenza è obbligatoria per Admin e HR', 'EXPIRY_DATE_REQUIRED');
      return;
    }

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
      employeeId: employee_id ? parseInt(String(employee_id), 10) : undefined
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
            companyId: req.user!.companyId!,
            title: entry.name,
            fileUrl: filePath,
            uploadedBy: req.user!.userId,
            requiresSignature: options.requiresSignature,
            expiresAt: options.expiresAt,
            isVisibleToRoles: options.visibleToRoles,
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
        companyId: req.user!.companyId!,
        title: originalname,
        fileUrl: destPath,
        uploadedBy: req.user!.userId,
        requiresSignature: options.requiresSignature,
        expiresAt: options.expiresAt,
        isVisibleToRoles: options.visibleToRoles,
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
      const existing = await queryOne(`SELECT id FROM document_categories WHERE company_id = $1`, [targetCompanyId]);
      if (existing) {
        conflict(res, 'Questa azienda ha già una categoria. Puoi solo modificarla.', 'CATEGORY_EXISTS');
        return;
      }

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

      if (name !== undefined) {
         await query(
           `UPDATE documents d
               SET category = $1 
              FROM users u
             WHERE d.employee_id = u.id
               AND u.company_id = $2`,
           [updated.name, updated.companyId]
         );
      }

      ok(res, updated, 'Categoria aggiornata con successo');
    } catch (err: any) {
      throw err;
    }
  }),
);

// ---------------------------------------------------------------------------
// DELETE /api/documents/categories/:id
// ---------------------------------------------------------------------------

router.delete(
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

    const companyId = req.body.current_company_id || req.query.current_company_id || req.user!.companyId;
    if (!companyId) {
      badRequest(res, 'ID azienda mancante', 'MISSING_COMPANY_ID');
      return;
    }

    const deleted = await deleteCategory(id, companyId);
    if (!deleted) {
      notFound(res, 'Categoria non trovata', 'NOT_FOUND');
      return;
    }

    ok(res, { id }, 'Categoria eliminata con successo');
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

    const hasCrossCompanyAccess = allowedCompanyIds.length > 1;

    // Scoped check for managers: skip if caller has cross-company access (Area Managers for a group)
    if (!isAdminOrHr && !hasCrossCompanyAccess) {
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

    const docs = await getEmployeeDocuments(employee.company_id, employeeId, user);
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

    // Requirement: Admin or HR must set Expiration Date
    if (['admin', 'hr'].includes(user.role) && (!expires_at || String(expires_at).trim() === '')) {
      if (req.file?.path) { try { fs.unlinkSync(req.file.path); } catch { /* ignore */ } }
      badRequest(res, 'La data di scadenza è obbligatoria per Admin e HR', 'EXPIRY_DATE_REQUIRED');
      return;
    }

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

    const deleted = await deleteDocumentUnified(id, allowedCompanyIds);
    if (deleted) {
      ok(res, { id }, 'Documento eliminato con successo');
      return;
    }

    notFound(res, 'Documento non trovato o già eliminato');
  }),
);

// ---------------------------------------------------------------------------
// GET /api/documents/trash — fetch trash bin
// ---------------------------------------------------------------------------

router.get(
  '/trash',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const employeeId = req.query.employee_id ? parseInt(req.query.employee_id as string, 10) : undefined;
    const allowedCompanyIds = await resolveAllowedCompanyIds(user);
    const docs = await getDeletedDocuments(allowedCompanyIds, employeeId);
    ok(res, docs);

  }),
);

// ---------------------------------------------------------------------------
// POST /api/documents/:source/:id/restore — recover a soft-deleted document
// ---------------------------------------------------------------------------

router.post(
  '/:source/:id/restore',
  authenticate,
  requireRole('admin', 'hr'),
  asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;
    if (!user.companyId) {
      res.status(403).json({ success: false, error: 'Accesso negato: azienda non valida', code: 'COMPANY_MISMATCH' });
      return;
    }

    const id = parseInt(req.params.id, 10);
    const source = req.params.source as 'documents' | 'employee_documents';

    if (Number.isNaN(id)) {
      badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
      return;
    }

    if (source !== 'documents' && source !== 'employee_documents') {
      badRequest(res, 'Sorgente documento non valida', 'INVALID_SOURCE');
      return;
    }

    const restored = await restoreDocument(id, user.companyId, user.userId, source);
    if (restored) {
      ok(res, { id }, 'Documento ripristinato con successo');
      return;
    }

    notFound(res, 'Documento non trovato nel cestino o già ripristinato');
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

    // Collision-aware lookup for visibility update
    let docData: { id: number; company_id: number; source: 'employee_documents' | 'documents' } | null = null;

    const empDoc = await queryOne<{ id: number; company_id: number }>(
      `SELECT id, company_id FROM employee_documents WHERE id = $1 AND company_id = ANY($2) AND deleted_at IS NULL`,
      [id, allowedCompanyIds],
    );

    if (empDoc) {
      docData = { id: empDoc.id, company_id: empDoc.company_id, source: 'employee_documents' };
    } else {
      const genDoc = await queryOne<{ id: number; company_id: number }>(
        `SELECT id, company_id FROM documents WHERE id = $1 AND company_id = ANY($2)`,
        [id, allowedCompanyIds],
      );
      if (genDoc) {
        docData = { id: genDoc.id, company_id: genDoc.company_id, source: 'documents' };
      }
    }

    if (!docData) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    let updated = false;
    if (docData.source === 'employee_documents') {
      updated = await updateDocumentVisibility(id, docData.company_id, roles);
    } else {
      // Update generic document visibility
      await query(`UPDATE documents SET is_visible_to_roles = $1 WHERE id = $2`, [roles, id]);
      updated = true;
    }

    if (!updated) {
      notFound(res, 'Documento non trovato per l\'aggiornamento', 'NOT_FOUND');
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
    try {
      const user = req.user!;
      if (!user.companyId) {
        forbidden(res, 'Accesso negato: azienda non valida', 'COMPANY_MISMATCH');
        return;
      }

      const id = parseInt(req.params.id, 10);
      if (Number.isNaN(id)) {
        badRequest(res, 'ID documento non valido', 'BAD_REQUEST');
        return;
      }

      const allowedCompanyIds = await resolveAllowedCompanyIds(user);

      // Look up across both potential tables - Handle ID Collisions
      let docData: any = null;

      // 1. Try employee_documents
      const empDoc = await queryOne<{
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

      // 2. Try generic documents
      const genDocRow = await queryOne<{
        id: number;
        company_id: number;
        employee_id: number | null;
        title: string;
        file_url: string;
        requires_signature: boolean;
        signed_at: string | null;
      }>(
        `SELECT id, company_id, employee_id, title, file_url,
                requires_signature, signed_at
           FROM documents
          WHERE id = $1 AND company_id = ANY($2)`,
        [id, allowedCompanyIds],
      );

      // Decision Logic: If both exist, pick the most relevant one
      if (empDoc && genDocRow) {
        const genDoc = {
          id: genDocRow.id,
          company_id: genDocRow.company_id,
          employee_id: genDocRow.employee_id,
          file_name: genDocRow.title,
          storage_path: genDocRow.file_url,
          mime_type: genDocRow.file_url.toLowerCase().endsWith('.pdf') ? 'application/pdf' : null,
          requires_signature: genDocRow.requires_signature,
          signed_at: genDocRow.signed_at,
          sourceTable: 'documents'
        };

        // If one is assigned to the current user and the other isn't, pick the assigned one
        const empIsAssigned = empDoc.employee_id === user.userId;
        const genIsAssigned = genDoc.employee_id === user.userId;

        if (genIsAssigned && !empIsAssigned) {
          docData = genDoc;
        } else if (empIsAssigned && !genIsAssigned) {
          docData = { ...empDoc, sourceTable: 'employee_documents' };
        } else {
          // If both assigned (or neither), prefer the one that is NOT signed yet
          if (genDoc.signed_at === null && empDoc.signed_at !== null) {
            docData = genDoc;
          } else {
            docData = { ...empDoc, sourceTable: 'employee_documents' };
          }
        }
      } else if (empDoc && empDoc.deleted_at === null) {
        docData = { ...empDoc, sourceTable: 'employee_documents' };
      } else if (genDocRow) {
        docData = {
          id: genDocRow.id,
          company_id: genDocRow.company_id,
          employee_id: genDocRow.employee_id,
          file_name: genDocRow.title,
          storage_path: genDocRow.file_url,
          mime_type: genDocRow.file_url.toLowerCase().endsWith('.pdf') ? 'application/pdf' : null,
          requires_signature: genDocRow.requires_signature,
          signed_at: genDocRow.signed_at,
          sourceTable: 'documents'
        };
      }

    if (!docData) {
      notFound(res, 'Documento non trovato', 'NOT_FOUND');
      return;
    }

    if (!docData.requires_signature) {
      badRequest(res, 'Questo documento non richiede firma', 'SIGNATURE_NOT_REQUIRED');
      return;
    }

    if (docData.signed_at !== null) {
      conflict(res, 'Documento già firmato', 'ALREADY_SIGNED');
      return;
    }

    // New Expiry Check: Reject if document is expired
    if (docData.expires_at && new Date(docData.expires_at) < new Date()) {
      const isIt = (req.headers['x-lang'] || 'it') === 'it';
      badRequest(
        res, 
        isIt ? 'Impossibile firmare: il documento è scaduto' : 'Cannot sign: the document has expired', 
        'DOCUMENT_EXPIRED'
      );
      return;
    }

    // Role-agnostic Authorization: owner (assigned user) or admin/hr
    const isAdminOrHr = ['admin', 'hr'].includes(user.role) || user.is_super_admin === true;
    if (!isAdminOrHr && user.userId !== docData.employee_id) {
      forbidden(res, 'Non sei autorizzato a firmare questo documento');
      return;
    }

    // Signer info gathering
    const signerInfo = await queryOne<{ name: string; surname: string; role: string; email: string }>(
      `SELECT name, surname, role, email FROM users WHERE id = $1`,
      [user.userId],
    );

    const signerName = signerInfo?.name ?? '';
    const signerSurname = signerInfo?.surname ?? '';
    const signerRole = signerInfo?.role ?? user.role;
    const signerEmail = signerInfo?.email ?? user.email ?? '';

    // IP Normalization
    const forwardedFor = req.headers['x-forwarded-for'];
    let signedIp = Array.isArray(forwardedFor) ? forwardedFor[0] : (typeof forwardedFor === 'string' ? forwardedFor.split(',')[0].trim() : req.ip ?? '0.0.0.0');
    if (signedIp.startsWith('::ffff:')) signedIp = signedIp.substring(7);
    else if (signedIp === '::1') signedIp = '127.0.0.1';

    // Timestamp handling - handle both camelCase and snake_case from frontend
    const body = req.body as any;
    const rawSignedAt = body.signedAt || body.signed_at;
    const rawSignedAtDisplay = body.signedAtDisplay || body.signed_at_display;
    
    // Diagnostic log update
    console.log('[DEBUG_SIGN] Derived values - rawSignedAt:', rawSignedAt, 'rawSignedAtDisplay:', rawSignedAtDisplay);
    
    const now = rawSignedAt ? new Date(rawSignedAt) : new Date();
    const finalDate = isNaN(now.getTime()) ? new Date() : now;

    const signatureMeta: Record<string, unknown> = {
      signerName,
      signerSurname,
      signerRole,
      signerEmail,
      timestamp: finalDate.toISOString(),
      signedAtDisplay: rawSignedAtDisplay || null,
      ip: signedIp,
      userAgent: req.headers['user-agent'] ?? '',
    };

    let newStoragePath: string | undefined;

    // PDF modification
    if (docData.mime_type === 'application/pdf' || docData.storage_path.toLowerCase().endsWith('.pdf')) {
      try {
        const fullPath = path.resolve(docData.storage_path);
        if (!fs.existsSync(fullPath)) throw new Error(`File not found at ${fullPath}`);
        
        const pdfBytes = fs.readFileSync(fullPath);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

        const page = pdfDoc.addPage();
        const { height } = page.getSize();
        const fontSize = 12;
        const lineHeight = fontSize * 1.8;
        const margin = 60;

        const lang = (req.headers['accept-language'] || req.headers['x-lang'] || 'it').toString().toLowerCase();
        const isIt = lang.startsWith('it');
        
        const labels = isIt ? {
          title: 'Dettagli Firma Elettronica (Verify V3)',
          signedBy: 'Firmato da',
          role: 'Ruolo',
          email: 'Email',
          date: 'Data e Ora',
          ip: 'Indirizzo IP',
          browser: 'Browser',
          disclaimer: 'Questo documento è stato firmato elettronicamente con consenso legale.'
        } : {
          title: 'E-Signature Audit Trail (Verify V3)',
          signedBy: 'Signed by',
          role: 'Role',
          email: 'Email',
          date: 'Date and Time',
          ip: 'IP Address',
          browser: 'Browser',
          disclaimer: 'This document has been electronically signed with legal consent.'
        };

        const roleMap: Record<string, string> = isIt ? {
          admin: 'Amministratore',
          hr: 'Risorse Umane',
          area_manager: 'Area Manager',
          store_manager: 'Store Manager',
          employee: 'Dipendente',
          store_terminal: 'Terminale Negozio'
        } : {
          admin: 'Administrator',
          hr: 'Human Resources',
          area_manager: 'Area Manager',
          store_manager: 'Store Manager',
          employee: 'Employee',
          store_terminal: 'Store Terminal'
        };

        const displayRole = roleMap[signerRole] || signerRole;
        
        // Priority: 
        // 1. Explicit display string from client
        // 2. Format the ISO date from client using server locale as backup
        // 3. Current server time as ultimate fallback
        const dateStr = rawSignedAtDisplay || finalDate.toLocaleString(isIt ? 'it-IT' : 'en-US', { 
          dateStyle: 'medium', 
          timeStyle: 'medium',
          hour12: false 
        });
        
        console.log('[DEBUG_SIGN] Final dateStr for PDF:', dateStr);

        let y = height - margin;
        page.drawText(labels.title, { x: margin, y, size: 16, font: fontBold });
        y -= lineHeight * 1.5;

        const drawField = (label: string, value: string) => {
          page.drawText(`${label}:`, { x: margin, y, size: fontSize, font: fontBold });
          page.drawText(value, { x: margin + 100, y, size: fontSize, font });
          y -= lineHeight;
        };

        drawField(labels.signedBy, `${signerName} ${signerSurname}`);
        drawField(labels.role, displayRole);
        drawField(labels.email, signerEmail);
        drawField(labels.date, dateStr);
        drawField(labels.ip, signedIp);
        
        const browser = req.headers['user-agent'] || 'Unknown';
        page.drawText(`${labels.browser}:`, { x: margin, y, size: fontSize, font: fontBold });
        page.drawText(browser.length > 60 ? browser.substring(0, 57) + '...' : browser, { x: margin + 100, y, size: fontSize, font });
        y -= lineHeight * 2;

        page.drawText(labels.disclaimer, { x: margin, y, size: 10, font, color: rgb(0.4, 0.4, 0.4) });

        const modifiedPdfBytes = await pdfDoc.save();
        
        // Generate a new unique filename for the signed version
        const dir = path.dirname(fullPath);
        const ext = path.extname(fullPath);
        const baseName = path.basename(fullPath, ext);
        const newFileName = `signed_${user.userId}_${Date.now()}_${baseName}${ext}`;
        const newFullPath = path.join(dir, newFileName);
        
        fs.writeFileSync(newFullPath, modifiedPdfBytes);
        
        // The path we store in the database (relative or absolute as per convention)
        // Here we use the same directory structure but the new file name
        newStoragePath = path.join(path.dirname(docData.storage_path), newFileName);
      } catch (pdfErr: any) {
        signatureMeta['pdfSignatureError'] = pdfErr?.message ?? 'Errore PDF';
      }
    }

    // Update the correct table
    let updated: any = null;
    if (docData.sourceTable === 'employee_documents') {
      updated = await signDocument(id, {
        signedByUserId: user.userId,
        signedIp,
        signatureMeta,
        newStoragePath, // Use the new signed file path
        signedAt: finalDate.toISOString(),
      });

      // SYNC: Update corresponding record in 'documents' table if exists
      if (updated) {
        await query(
          `UPDATE documents 
              SET signed_at = $1, 
                  signed_by_user_id = $2, 
                  signed_ip = $3::inet, 
                  signature_meta = $4,
                  file_url = $5
            WHERE (file_url = $6 OR file_url = $7) AND (employee_id = $8 OR employee_id IS NULL)`,
          [
            finalDate.toISOString(), 
            user.userId, 
            signedIp, 
            signatureMeta, 
            newStoragePath || docData.storage_path, 
            docData.storage_path, 
            newStoragePath || docData.storage_path,
            docData.employee_id
          ]
        );
      }
    } else {
      updated = await signGenericDocument(id, {
        signedByUserId: user.userId,
        signedIp,
        signatureMeta,
        newStoragePath,
        signedAt: finalDate.toISOString(),
      });

      // SYNC: Update corresponding record in 'employee_documents' table if exists
      if (updated) {
        await query(
          `UPDATE employee_documents 
              SET signed_at = $1, 
                  signed_by_user_id = $2, 
                  signed_ip = $3::inet, 
                  signature_meta = $4,
                  storage_path = $5
            WHERE storage_path = $6 AND employee_id = $7`,
          [
            finalDate.toISOString(), 
            user.userId, 
            signedIp, 
            signatureMeta, 
            newStoragePath || docData.storage_path, 
            docData.storage_path, 
            docData.employee_id
          ]
        );
      }
    }

    if (!updated) {
      notFound(res, 'Documento non trovato per l\'aggiornamento', 'NOT_FOUND');
      return;
    }

    // Success response
    const { storage_path: _sp1, storagePath: _sp2, fileUrl: _sp3, file_url: _sp4, ...safeDoc } = updated;
    ok(res, {
      ...safeDoc,
      signedAt: finalDate.toISOString(),
      signedByUserId: user.userId,
      signedIp,
      signatureMeta
    }, 'Documento firmato con successo');
    } catch (error: any) {
      console.error('SIGN_ERROR_DETAILS:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Errore durante la firma del documento', 
        details: error.message,
        code: 'SIGN_ERROR' 
      });
    }
  }),
);

export default router;
