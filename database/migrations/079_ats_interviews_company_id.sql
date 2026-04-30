-- Add company_id to interviews table for better data organization and querying
ALTER TABLE interviews ADD COLUMN IF NOT EXISTS company_id INTEGER;

-- Backfill company_id from candidates table
UPDATE interviews i
SET company_id = c.company_id
FROM candidates c
WHERE i.candidate_id = c.id
  AND i.company_id IS NULL;

-- Make company_id NOT NULL after backfill
ALTER TABLE interviews ALTER COLUMN company_id SET NOT NULL;

-- Add foreign key constraint
ALTER TABLE interviews
ADD CONSTRAINT fk_interviews_company
FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_interviews_company_id ON interviews(company_id);
CREATE INDEX IF NOT EXISTS idx_interviews_candidate_company ON interviews(candidate_id, company_id);
