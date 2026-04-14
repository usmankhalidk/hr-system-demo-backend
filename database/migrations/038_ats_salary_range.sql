-- =============================================================================
-- Migration 038: ATS salary range fields
-- =============================================================================

BEGIN;

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS salary_min INTEGER,
  ADD COLUMN IF NOT EXISTS salary_max INTEGER;

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_salary_range_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_salary_range_chk
  CHECK (
    (salary_min IS NULL OR salary_min >= 0)
    AND (salary_max IS NULL OR salary_max >= 0)
    AND (salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max)
  );

COMMIT;
