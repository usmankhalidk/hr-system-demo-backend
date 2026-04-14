-- =============================================================================
-- Migration 040: ATS feed metadata + status/salary period hardening
-- =============================================================================

BEGIN;

ALTER TABLE job_postings
  ADD COLUMN IF NOT EXISTS salary_period VARCHAR(20),
  ADD COLUMN IF NOT EXISTS experience VARCHAR(100),
  ADD COLUMN IF NOT EXISTS education VARCHAR(100),
  ADD COLUMN IF NOT EXISTS category VARCHAR(255),
  ADD COLUMN IF NOT EXISTS expiration_date DATE;

ALTER TABLE job_postings
  ALTER COLUMN job_country SET DEFAULT 'IT';

UPDATE job_postings
SET job_country = 'IT'
WHERE job_country IS NULL OR btrim(job_country) = '';

ALTER TABLE job_postings
  DROP CONSTRAINT IF EXISTS job_postings_salary_period_chk;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_salary_period_chk
  CHECK (
    salary_period IS NULL
    OR salary_period IN ('per anno', 'al mese', 'all''ora', 'a settimana')
  );

DO $$
DECLARE
  constraint_row RECORD;
BEGIN
  FOR constraint_row IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'job_postings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE job_postings DROP CONSTRAINT IF EXISTS %I', constraint_row.conname);
  END LOOP;
END
$$;

ALTER TABLE job_postings
  ADD CONSTRAINT job_postings_status_chk
  CHECK (status IN ('draft', 'published', 'closed'));

COMMIT;
