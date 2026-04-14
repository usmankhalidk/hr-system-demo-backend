-- =============================================================================
-- Migration 037: Structured location/phone fields + ATS remote type override
-- =============================================================================

BEGIN;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone VARCHAR(30),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100);

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS remote_type VARCHAR(20) NOT NULL DEFAULT 'onsite',
  ADD COLUMN IF NOT EXISTS job_city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS job_state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS job_country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS job_postal_code VARCHAR(20),
  ADD COLUMN IF NOT EXISTS job_address TEXT;

UPDATE job_postings
SET remote_type = CASE
  WHEN is_remote = TRUE THEN 'remote'
  ELSE 'onsite'
END
WHERE remote_type IS NULL OR remote_type NOT IN ('onsite', 'hybrid', 'remote');

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_remote_type_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_remote_type_chk
  CHECK (remote_type IN ('onsite', 'hybrid', 'remote'));

COMMIT;
