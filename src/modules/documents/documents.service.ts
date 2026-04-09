import { query, queryOne } from '../../config/database';

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
  companyId: number,
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
      WHERE company_id = $1
        ${includeInactive ? '' : 'AND is_active = true'}
      ORDER BY name ASC`,
    [companyId],
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
  companyId: number,
  updates: { name?: string; isActive?: boolean },
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

  if (setParts.length === 0) return null;

  setParts.push(`updated_at = NOW()`);
  params.push(id, companyId);

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
      WHERE id = $${idx++} AND company_id = $${idx++}
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

export async function getEmployeeDocuments(companyId: number, employeeId: number): Promise<DocumentRecord[]> {
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
      WHERE d.company_id = $1
        AND d.employee_id = $2
        AND d.deleted_at IS NULL
      ORDER BY d.uploaded_at DESC, d.id DESC`,
    [companyId, employeeId],
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
