-- =============================================================================
-- Migration 037: Ensure Presenze module permissions for all roles
-- =============================================================================
BEGIN;

-- 1. Ensure 'presenze' write permission is enabled for all relevant roles across all companies
-- This fixes the 403 Forbidden error encountered during offline synchronization.
INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled)
SELECT c.id, r.role, 'presenze', true
FROM companies c
CROSS JOIN (VALUES 
  ('admin'::user_role), 
  ('hr'::user_role), 
  ('area_manager'::user_role), 
  ('store_manager'::user_role), 
  ('employee'::user_role), 
  ('store_terminal'::user_role)
) AS r(role)
ON CONFLICT (company_id, role, module_name) 
DO UPDATE SET is_enabled = true;

COMMIT;
