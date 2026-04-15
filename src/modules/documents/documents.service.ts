import { query, queryOne } from '../../config/database';
import { UserRole } from '../../config/jwt';

// ---------------------------------------------------------------------------
// Document Categories
// ---------------------------------------------------------------------------

export interface DocumentCategory {
  id: number;
  companyId: number;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function mapCategory(row: {
  id: number;
  company_id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}): DocumentCategory {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCategories(
  companyIds: number[],
  includeInactive = false,
): Promise<DocumentCategory[]> {
  const rows = await query<{
    id: number;
    company_id: number;
    name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, company_id, name, is_active, created_at, updated_at
       FROM document_categories
      WHERE company_id = ANY($1)
        ${includeInactive ? '' : 'AND is_active = true'}
      ORDER BY name ASC`,
    [companyIds],
  );
  return rows.map(mapCategory);
}

export async function createCategory(companyId: number, name: string): Promise<DocumentCategory> {
  const row = await queryOne<{
    id: number;
    company_id: number;
    name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO document_categories (company_id, name)
     VALUES ($1, $2)
     RETURNING id, company_id, name, is_active, created_at, updated_at`,
    [companyId, name],
  );
  return mapCategory(row!);
}

export async function updateCategory(
  id: number,
  currentCompanyId: number,
  updates: { name?: string; isActive?: boolean; companyId?: number },
): Promise<DocumentCategory | null> {
  const setParts: string[] = [];
  const params: unknown[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    setParts.push(`name = $${idx++}`);
    params.push(updates.name);
  }
  if (updates.isActive !== undefined) {
    setParts.push(`is_active = $${idx++}`);
    params.push(updates.isActive);
  }
  if (updates.companyId !== undefined) {
    setParts.push(`company_id = $${idx++}`);
    params.push(updates.companyId);
  }

  if (setParts.length === 0) return null;

  setParts.push(`updated_at = NOW()`);

  const whereIdIdx = idx++;
  const whereCompanyIdx = idx++;
  params.push(id, currentCompanyId);

  const row = await queryOne<{
    id: number;
    company_id: number;
    name: string;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE document_categories
        SET ${setParts.join(', ')}
      WHERE id = $${whereIdIdx} AND company_id = $${whereCompanyIdx}
      RETURNING id, company_id, name, is_active, created_at, updated_at`,
    params,
  );

  return row ? mapCategory(row) : null;
}

// ---------------------------------------------------------------------------
// Document Record
// ---------------------------------------------------------------------------

export interface DocumentRecord {
  id: number;
  companyId: number;
  employeeId: number;
  categoryId: number | null;
  categoryName: string | null;
  fileName: string;
  storagePath: string;
  mimeType: string | null;
  uploadedByUserId: number | null;
  uploadedAt: string;
  requiresSignature: boolean;
  signedAt: string | null;
  signedByUserId: number | null;
  signedIp: string | null;
  signatureMeta: Record<string, unknown> | null;
  expiresAt: string | null;
  isVisibleToRoles: string[];
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapDocumentRecord(row: {
  id: number;
  company_id: number;
  employee_id: number;
  category_id: number | null;
  category_name: string | null;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  uploaded_by_user_id: number | null;
  uploaded_at: string;
  requires_signature: boolean;
  signed_at: string | null;
  signed_by_user_id: number | null;
  signed_ip: string | null;
  signature_meta: Record<string, unknown> | null;
  expires_at: string | null;
  is_visible_to_roles: string[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}): DocumentRecord {
  return {
    id: row.id,
    companyId: row.company_id,
    employeeId: row.employee_id,
    categoryId: row.category_id,
    categoryName: row.category_name,
    fileName: row.file_name,
    storagePath: row.storage_path,
    mimeType: row.mime_type,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedAt: row.uploaded_at,
    requiresSignature: row.requires_signature,
    signedAt: row.signed_at,
    signedByUserId: row.signed_by_user_id,
    signedIp: row.signed_ip,
    signatureMeta: row.signature_meta,
    expiresAt: row.expires_at,
    isVisibleToRoles: row.is_visible_to_roles,
    deletedAt: row.deleted_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const DOC_SELECT = `
  SELECT d.id,
         d.company_id,
         d.employee_id,
         d.category_id,
         c.name AS category_name,
         d.file_name,
         d.storage_path,
         d.mime_type,
         d.uploaded_by_user_id,
         d.uploaded_at,
         d.requires_signature,
         d.signed_at,
         d.signed_by_user_id,
         d.signed_ip::text AS signed_ip,
         d.signature_meta,
         d.expires_at,
         d.is_visible_to_roles,
         d.deleted_at,
         d.created_at,
         d.updated_at
    FROM employee_documents d
    LEFT JOIN document_categories c ON c.id = d.category_id
`;

export async function getDocumentById(id: number, companyId: number): Promise<DocumentRecord | null> {
  const row = await queryOne<{
    id: number;
    company_id: number;
    employee_id: number;
    category_id: number | null;
    category_name: string | null;
    file_name: string;
    storage_path: string;
    mime_type: string | null;
    uploaded_by_user_id: number | null;
    uploaded_at: string;
    requires_signature: boolean;
    signed_at: string | null;
    signed_by_user_id: number | null;
    signed_ip: string | null;
    signature_meta: Record<string, unknown> | null;
    expires_at: string | null;
    is_visible_to_roles: string[];
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `${DOC_SELECT}
      WHERE d.id = $1 AND d.company_id = $2`,
    [id, companyId],
  );
  return row ? mapDocumentRecord(row) : null;
}

export async function getEmployeeDocuments(
  companyId: number,
  employeeId: number,
  filterRole?: string,
): Promise<DocumentRecord[]> {
  let where = 'd.company_id = $1 AND d.employee_id = $2 AND d.deleted_at IS NULL';
  const params: any[] = [companyId, employeeId];

  // If the user role is not admin/hr, we strictly filter by visibility
  if (filterRole && !['admin', 'hr'].includes(filterRole)) {
    where += ' AND ($3 = ANY(d.is_visible_to_roles) OR d.is_visible_to_roles IS NULL)';
    params.push(filterRole);
  }

  const rows = await query<{
    id: number;
    company_id: number;
    employee_id: number;
    category_id: number | null;
    category_name: string | null;
    file_name: string;
    storage_path: string;
    mime_type: string | null;
    uploaded_by_user_id: number | null;
    uploaded_at: string;
    requires_signature: boolean;
    signed_at: string | null;
    signed_by_user_id: number | null;
    signed_ip: string | null;
    signature_meta: Record<string, unknown> | null;
    expires_at: string | null;
    is_visible_to_roles: string[];
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `${DOC_SELECT}
      WHERE ${where}
      ORDER BY d.uploaded_at DESC, d.id DESC`,
    params,
  );
  return rows.map(mapDocumentRecord);
}


export async function softDeleteDocument(id: number, companyId: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE employee_documents
        SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [id, companyId],
  );
  return row !== null;
}

export async function updateDocumentVisibility(
  id: number,
  companyId: number,
  roles: string[],
): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE employee_documents
        SET is_visible_to_roles = $3, updated_at = NOW()
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
      RETURNING id`,
    [id, companyId, roles],
  );
  return row !== null;
}

export async function signDocument(
  id: number,
  options: {
    signedByUserId: number;
    signedIp: string;
    signatureMeta: Record<string, unknown>;
    newStoragePath?: string;
  },
): Promise<DocumentRecord | null> {
  const setParts = [
    `signed_at = NOW()`,
    `signed_by_user_id = $2`,
    `signed_ip = $3::inet`,
    `signature_meta = $4`,
    `updated_at = NOW()`,
  ];
  const params: unknown[] = [id, options.signedByUserId, options.signedIp, options.signatureMeta];

  if (options.newStoragePath) {
    params.push(options.newStoragePath);
    setParts.push(`storage_path = $${params.length}`);
  }

  const row = await queryOne<{
    id: number;
    company_id: number;
    employee_id: number;
    category_id: number | null;
    category_name: string | null;
    file_name: string;
    storage_path: string;
    mime_type: string | null;
    uploaded_by_user_id: number | null;
    uploaded_at: string;
    requires_signature: boolean;
    signed_at: string | null;
    signed_by_user_id: number | null;
    signed_ip: string | null;
    signature_meta: Record<string, unknown> | null;
    expires_at: string | null;
    is_visible_to_roles: string[];
    deleted_at: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE employee_documents d
        SET ${setParts.join(', ')}
      WHERE d.id = $1 AND d.deleted_at IS NULL
      RETURNING
        d.id,
        d.company_id,
        d.employee_id,
        d.category_id,
        NULL::text AS category_name,
        d.file_name,
        d.storage_path,
        d.mime_type,
        d.uploaded_by_user_id,
        d.uploaded_at,
        d.requires_signature,
        d.signed_at,
        d.signed_by_user_id,
        d.signed_ip::text AS signed_ip,
        d.signature_meta,
        d.expires_at,
        d.is_visible_to_roles,
        d.deleted_at,
        d.created_at,
        d.updated_at`,
    params,
  );
  return row ? mapDocumentRecord(row) : null;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Generic Documents (Step 1)
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------

export interface GenericDocument {
  id: number;
  title: string;
  fileUrl: string;
  category: string | null;
  employeeId: number | null;
  uploadedBy: number;
  requiresSignature: boolean;
  expiresAt: string | null;
  isVisibleToRoles: string[];
  createdAt: string;
  signedAt?: string | null;
}

export async function createGenericDocument(data: {
  title: string;
  fileUrl: string;
  category?: string;
  employeeId?: number;
  uploadedBy: number;
  requiresSignature?: boolean;
  expiresAt?: string | null;
  isVisibleToRoles?: string[];
}): Promise<GenericDocument> {
  const row = await queryOne<{
    id: number;
    title: string;
    file_url: string;
    category: string | null;
    employee_id: number | null;
    uploaded_by: number;
    requires_signature: boolean;
    expires_at: string | null;
    created_at: string;
  }>(
    `INSERT INTO documents (title, file_url, category, employee_id, uploaded_by, requires_signature, expires_at, is_visible_to_roles)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, title, file_url, category, employee_id, uploaded_by, requires_signature, expires_at, is_visible_to_roles, created_at`,
    [
      data.title, 
      data.fileUrl, 
      data.category || null, 
      data.employeeId || null, 
      data.uploadedBy,
      data.requiresSignature || false,
      data.expiresAt || null,
      data.isVisibleToRoles || ['admin','hr','area_manager','store_manager','employee']
    ],
  );

  return {
    id: row!.id,
    title: row!.title,
    fileUrl: row!.file_url,
    category: row!.category,
    employeeId: row!.employee_id,
    uploadedBy: row!.uploaded_by,
    requiresSignature: row!.requires_signature,
    expiresAt: row!.expires_at,
    isVisibleToRoles: row!.is_visible_to_roles,
    createdAt: row!.created_at,
  };
}

export async function getGenericDocuments(options: {
  companyId: number;
  employeeId?: number;
  role: UserRole;
  storeId?: number | null;
  allowedCompanyIds?: number[];
}): Promise<(GenericDocument & { employeeName?: string })[]> {
  let where = '1=1';
  const params: any[] = [];

  // Scoping logic based on role
  if (options.role === 'admin') {
    // Admin: see all documents in allowed companies
    const ids = options.allowedCompanyIds || [options.companyId];
    where = '(u_up.company_id = ANY($1) OR e.company_id = ANY($1))';
    params.push(ids);
  } else if (options.role === 'hr') {
    // HR: see all documents in their company
    where = '(u_up.company_id = $1 OR e.company_id = $1)';
    params.push(options.companyId);
  } else if (options.role === 'area_manager' && options.employeeId) {
    // Area Manager: see documents of employees they supervise + their own + role-shared
    where = `(
      (e.supervisor_id = $1 OR d.employee_id = $1 OR $2 = ANY(COALESCE(d.is_visible_to_roles, ARRAY[]::text[])))
      AND (e.company_id = $3 OR u_up.company_id = $3)
    )`;
    params.push(options.employeeId, options.role, options.companyId);
  } else if (options.role === 'store_manager' && options.storeId) {
    // Store Manager: see documents of employees in their store + their own + role-shared
    where = `(
      (e.store_id = $1 OR d.employee_id = $2 OR $3 = ANY(COALESCE(d.is_visible_to_roles, ARRAY[]::text[])))
      AND (e.company_id = $4 OR u_up.company_id = $4)
    )`;
    params.push(options.storeId, options.employeeId, options.role, options.companyId);
  } else if (options.role === 'employee' && options.employeeId) {
    // Employee: see ONLY their own documents
    where = 'd.employee_id = $1';
    params.push(options.employeeId);
  } else {
    // Default safe state: no documents
    where = '1=0';
  }

  const rows = await query<{
    id: number;
    title: string;
    file_url: string;
    category: string | null;
    employee_id: number | null;
    uploaded_by: number;
    requires_signature: boolean;
    expires_at: string | null;
    is_visible_to_roles: string[];
    created_at: string;
    employee_name: string | null;
    signed_at: string | null;
  }>(
    `SELECT d.*, CONCAT(e.name, ' ', e.surname) AS employee_name,
            (SELECT max(ed.signed_at) FROM employee_documents ed WHERE ed.storage_path = d.file_url AND ed.employee_id = d.employee_id AND ed.deleted_at IS NULL) as signed_at
       FROM documents d
       LEFT JOIN users e ON e.id = d.employee_id
       LEFT JOIN users u_up ON u_up.id = d.uploaded_by
      WHERE ${where}
      ORDER BY d.created_at DESC`,
    params,
  );

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    fileUrl: r.file_url,
    category: r.category,
    employeeId: r.employee_id,
    uploadedBy: r.uploaded_by,
    requiresSignature: r.requires_signature,
    expiresAt: r.expires_at,
    isVisibleToRoles: r.is_visible_to_roles,
    createdAt: r.created_at,
    employeeName: r.employee_name || undefined,
    signedAt: r.signed_at,
  }));
}

export async function updateGenericDocumentEmployee(id: number, employeeId: number | null): Promise<void> {
  await query('UPDATE documents SET employee_id = $1 WHERE id = $2', [employeeId, id]);
}

export async function deleteDocumentUnified(id: number, companyId: number): Promise<boolean> {
  // 1. Try finding in documents table (generic/unassigned)
  const genericDoc = await queryOne<{ id: number; file_url: string }>(
    `SELECT id, file_url FROM documents 
      WHERE id = $1 AND uploaded_by IN (SELECT id FROM users WHERE company_id = $2)`,
    [id, companyId]
  );

  if (genericDoc) {
    const path = genericDoc.file_url;
    // Delete from generic
    await query(`DELETE FROM documents WHERE id = $1`, [id]);
    // Also clean up assigned version if any (matching by path)
    await query(
      `UPDATE employee_documents SET deleted_at = NOW(), updated_at = NOW() 
        WHERE storage_path = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [path, companyId]
    );
    return true;
  }

  // 2. Try finding in employee_documents table
  const employeeDoc = await queryOne<{ id: number; storage_path: string }>(
    `SELECT id, storage_path FROM employee_documents 
      WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
    [id, companyId]
  );

  if (employeeDoc) {
    const path = employeeDoc.storage_path;
    // Soft delete
    await query(
      `UPDATE employee_documents SET deleted_at = NOW(), updated_at = NOW() 
        WHERE id = $1 AND company_id = $2`,
      [id, companyId]
    );
    // Also clean up generic version if any
    await query(
      `DELETE FROM documents 
        WHERE file_url = $1 AND uploaded_by IN (SELECT id FROM users WHERE company_id = $2)`,
      [path, companyId]
    );
    return true;
  }

  return false;
}
