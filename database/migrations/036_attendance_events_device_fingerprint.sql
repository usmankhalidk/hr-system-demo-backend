-- =============================================================================
-- Migration 036: Add device_fingerprint to attendance_events
-- =============================================================================
BEGIN;

ALTER TABLE attendance_events
  ADD COLUMN IF NOT EXISTS device_fingerprint VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_ip INET;

COMMIT;
