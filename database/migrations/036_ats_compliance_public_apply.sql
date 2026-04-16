-- =============================================================================
-- Migration 036: ATS language/job type expansion + public application fields
-- =============================================================================

BEGIN;

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS is_remote BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS department VARCHAR(120),
  ADD COLUMN IF NOT EXISTS weekly_hours INTEGER,
  ADD COLUMN IF NOT EXISTS contract_type VARCHAR(80);

UPDATE job_postings
SET language = 'it'
WHERE language IS NULL OR language NOT IN ('it', 'en', 'both');

UPDATE job_postings
SET job_type = CASE
  WHEN lower(job_type) IN ('full_time', 'fulltime') THEN 'fulltime'
  WHEN lower(job_type) IN ('part_time', 'parttime') THEN 'parttime'
  WHEN lower(job_type) IN ('contract') THEN 'contract'
  WHEN lower(job_type) IN ('internship', 'intern') THEN 'internship'
  ELSE 'fulltime'
END
WHERE job_type IS NULL
   OR lower(job_type) NOT IN ('fulltime', 'parttime', 'contract', 'internship');

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_language_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_language_chk
  CHECK (language IN ('it', 'en', 'both'));

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_job_type_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_job_type_chk
  CHECK (job_type IN ('fulltime', 'parttime', 'contract', 'internship'));

ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS cv_path TEXT,
  ADD COLUMN IF NOT EXISTS linkedin_url TEXT,
  ADD COLUMN IF NOT EXISTS gdpr_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

UPDATE candidates
SET cv_path = resume_path
WHERE cv_path IS NULL AND resume_path IS NOT NULL;

UPDATE candidates
SET gdpr_consent = TRUE
WHERE consent_accepted_at IS NOT NULL;

COMMIT;
