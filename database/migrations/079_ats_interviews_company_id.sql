-- Add company_id to interviews table for better data organization and querying
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- Backfill company_id from candidates table
UPDATE interviews i
SET company_id = c.company_id
FROM candidates c
WHERE i.candidate_id = c.id
  AND i.company_id IS NULL;

-- Delete any orphaned interviews that don't have a valid candidate or company_id
-- This handles edge cases where data integrity was compromised
DELETE FROM interviews
WHERE company_id IS NULL;

-- Only set NOT NULL if there are rows in the table
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM interviews LIMIT 1) THEN
    ALTER TABLE interviews ALTER COLUMN company_id SET NOT NULL;
  END IF;
END $$;

-- Add foreign key constraint only if it doesn't exist
-- Use NOT VALID to skip validation on existing rows, then validate separately
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_interviews_company'
  ) THEN
    -- Add constraint without immediate validation
    ALTER TABLE interviews
    ADD CONSTRAINT fk_interviews_company
    FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE
    NOT VALID;
    
    -- Validate the constraint (will succeed if table is empty or all rows are valid)
    ALTER TABLE interviews VALIDATE CONSTRAINT fk_interviews_company;
  END IF;
END $$;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_interviews_company_id ON interviews(company_id);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate_company ON interviews(candidate_id, company_id);
