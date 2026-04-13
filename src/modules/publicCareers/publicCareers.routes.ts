import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { NextFunction, Request, Response, Router } from 'express';
import { badRequest } from '../../utils/response';
import {
  applyPublicJobHandler,
  getPublicCompanyHandler,
  getPublicJobHandler,
  listAllPublicJobsHandler,
  listPublicJobsHandler,
} from './publicCareers.controller';

const router = Router();

const PUBLIC_CV_UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'cvs');

fs.mkdirSync(PUBLIC_CV_UPLOAD_DIR, { recursive: true });

const allowedMimeTypes = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

const cvStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, PUBLIC_CV_UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.bin').toLowerCase();
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'cv';
    const unique = `${Date.now()}_${Math.round(Math.random() * 1e9)}`;
    cb(null, `${unique}_${baseName}${ext}`);
  },
});

const uploadCv = multer({
  storage: cvStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isDocByName = /\.(pdf|doc|docx)$/i.test(file.originalname);
    if (allowedMimeTypes.includes(file.mimetype) || isDocByName) {
      cb(null, true);
      return;
    }
    cb(new Error('INVALID_CV_FILE_TYPE'));
  },
}).single('resume');

function uploadCvMiddleware(req: Request, res: Response, next: NextFunction): void {
  uploadCv(req, res, (err: any) => {
    if (!err) {
      next();
      return;
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      badRequest(res, 'Il CV supera il limite massimo di 5MB', 'FILE_TOO_LARGE');
      return;
    }

    if (err.message === 'INVALID_CV_FILE_TYPE') {
      badRequest(res, 'Formato CV non supportato. Usa PDF, DOC o DOCX', 'INVALID_FILE_TYPE');
      return;
    }

    next(err);
  });
}

// Required public API contract
router.get('/jobs', listAllPublicJobsHandler);
router.get('/companies/:companySlug', getPublicCompanyHandler);
router.get('/companies/:companySlug/jobs', listPublicJobsHandler);
router.get('/jobs/:jobId', getPublicJobHandler);
router.post('/jobs/:jobId/apply', uploadCvMiddleware, applyPublicJobHandler);

// Backward-compatible aliases for existing frontend route contracts
router.get('/:companySlug/jobs', listPublicJobsHandler);
router.get('/:companySlug/jobs/:jobId', getPublicJobHandler);
router.post('/:companySlug/jobs/:jobId/apply', uploadCvMiddleware, applyPublicJobHandler);

export default router;
