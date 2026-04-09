-- =============================================================================
-- Migration 024: Extend store operating hours with peak windows and shift planning
-- =============================================================================

ALTER TABLE store_operating_hours
  ADD COLUMN IF NOT EXISTS peak_start_time TIME,
  ADD COLUMN IF NOT EXISTS peak_end_time TIME,
  ADD COLUMN IF NOT EXISTS planned_shift_count INTEGER,
  ADD COLUMN IF NOT EXISTS planned_staff_count INTEGER,
  ADD COLUMN IF NOT EXISTS shift_plan_notes TEXT;

-- Normalize inconsistent historical rows where only one peak boundary exists.
UPDATE store_operating_hours
SET peak_start_time = NULL,
    peak_end_time = NULL
WHERE (peak_start_time IS NULL) <> (peak_end_time IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'store_operating_hours'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'store_operating_hours_peak_pair_chk'
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_peak_pair_chk
      CHECK (
        (peak_start_time IS NULL AND peak_end_time IS NULL)
        OR (peak_start_time IS NOT NULL AND peak_end_time IS NOT NULL AND peak_start_time < peak_end_time)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'store_operating_hours'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'store_operating_hours_peak_inside_opening_chk'
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_peak_inside_opening_chk
      CHECK (
        is_closed = true
        OR peak_start_time IS NULL
        OR (peak_start_time >= open_time AND peak_end_time <= close_time)
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'store_operating_hours'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'store_operating_hours_planned_shift_count_chk'
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_planned_shift_count_chk
      CHECK (planned_shift_count IS NULL OR planned_shift_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'store_operating_hours'
      AND constraint_type = 'CHECK'
      AND constraint_name = 'store_operating_hours_planned_staff_count_chk'
  ) THEN
    ALTER TABLE store_operating_hours
      ADD CONSTRAINT store_operating_hours_planned_staff_count_chk
      CHECK (planned_staff_count IS NULL OR planned_staff_count >= 0);
  END IF;
END $$;
