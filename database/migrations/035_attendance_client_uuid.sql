-- =============================================================================
-- Migration 035: Add client_uuid for robust offline sync idempotency
-- =============================================================================
BEGIN;

ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS client_uuid UUID UNIQUE;

-- Create an index for faster lookups during sync
CREATE INDEX IF NOT EXISTS idx_attendance_events_client_uuid ON attendance_events(client_uuid);

COMMIT;
