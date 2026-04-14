-- 039_shift_off_day_and_remove_employee_off_days.sql
-- Move off-day handling from employee profile to shift records.

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS is_off_day BOOLEAN NOT NULL DEFAULT false;

UPDATE shifts
SET is_off_day = false
WHERE is_off_day IS NULL;

ALTER TABLE shifts
  DROP CONSTRAINT IF EXISTS shifts_off_day_status_chk;

ALTER TABLE shifts
  ADD CONSTRAINT shifts_off_day_status_chk
  CHECK (NOT is_off_day OR status = 'cancelled');

CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_off_day_unique
  ON shifts(company_id, user_id, store_id, date)
  WHERE is_off_day = true;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_off_days_valid_chk;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_off_days_not_empty_chk;

ALTER TABLE users
  DROP COLUMN IF EXISTS off_days;
