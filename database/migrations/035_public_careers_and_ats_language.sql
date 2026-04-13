-- =============================================================================
-- Migration 035: ATS language/job type + public careers support
-- =============================================================================

BEGIN;

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS language VARCHAR(10) NOT NULL DEFAULT 'it',
  ADD COLUMN IF NOT EXISTS job_type VARCHAR(20) NOT NULL DEFAULT 'fulltime';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_postings_language_chk'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_language_chk
      CHECK (language IN ('it', 'en'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'job_postings_job_type_chk'
  ) THEN
    ALTER TABLE job_postings
      ADD CONSTRAINT job_postings_job_type_chk
      CHECK (job_type IN ('fulltime', 'parttime', 'internship'));
  END IF;
END
$$;

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS cover_letter TEXT,
  ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applicant_locale VARCHAR(10);

CREATE INDEX IF NOT EXISTS idx_candidates_job_email_lower
  ON candidates (job_posting_id, lower(email))
  WHERE email IS NOT NULL;

ALTER TABLE stores
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS country VARCHAR(100);

COMMIT;
