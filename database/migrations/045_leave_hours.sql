-- =============================================================================
-- Migration 045: Add hours column for partial-day leave requests
-- =============================================================================

BEGIN;

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS hours SMALLINT DEFAULT NULL;

-- hours must be between 1 and 7 when specified (8 hours = full day)
ALTER TABLE leave_requests
  ADD CONSTRAINT chk_leave_hours CHECK (hours IS NULL OR (hours >= 1 AND hours <= 7));

COMMIT;
