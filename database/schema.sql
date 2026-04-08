-- =============================================================================
-- HR System Tech Demo - Full Schema (Phase 1 + Phase 2)
-- PostgreSQL — idempotent, safe to re-run
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum type
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM (
      'admin', 'hr', 'area_manager', 'store_manager', 'employee', 'store_terminal'
    );
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. companies
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255) NOT NULL,
  slug       VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. stores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS stores (
  id         SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name       VARCHAR(255) NOT NULL,
  code       VARCHAR(50) NOT NULL,
  address    TEXT,
  cap        VARCHAR(10),
  max_staff  INTEGER DEFAULT 0,
  logo_filename VARCHAR(255),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, code)
);

CREATE INDEX IF NOT EXISTS idx_stores_company ON stores(company_id);

-- ---------------------------------------------------------------------------
-- 4. users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  store_id          INTEGER REFERENCES stores(id) ON DELETE SET NULL,
  supervisor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name              VARCHAR(255) NOT NULL,
  surname           VARCHAR(100),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     VARCHAR(255) NOT NULL,
  role              user_role NOT NULL,
  unique_id         VARCHAR(100),
  department        VARCHAR(100),
  hire_date         DATE,
  termination_date  DATE,
  termination_type  VARCHAR(50),
  contract_end_date DATE,
  working_type      VARCHAR(20) CHECK (working_type IN ('full_time', 'part_time')),
  weekly_hours      NUMERIC(4,1),
  personal_email    VARCHAR(255),
  date_of_birth     DATE,
  nationality       VARCHAR(100),
  gender            VARCHAR(20),
  iban              VARCHAR(34),
  address           TEXT,
  cap               VARCHAR(10),
  first_aid_flag    BOOLEAN DEFAULT false,
  marital_status    VARCHAR(50),
  contract_type     VARCHAR(100),
  probation_months  INTEGER,
  is_super_admin    BOOLEAN DEFAULT false,
  status            VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_company_id    ON users(company_id);
CREATE INDEX IF NOT EXISTS idx_users_email         ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_store_id      ON users(store_id);
CREATE INDEX IF NOT EXISTS idx_users_supervisor_id ON users(supervisor_id);

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS owner_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS banner_filename VARCHAR(255),
  ADD COLUMN IF NOT EXISTS registration_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS company_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS company_phone_numbers TEXT,
  ADD COLUMN IF NOT EXISTS offices_locations TEXT,
  ADD COLUMN IF NOT EXISTS country VARCHAR(100),
  ADD COLUMN IF NOT EXISTS city VARCHAR(100),
  ADD COLUMN IF NOT EXISTS state VARCHAR(100),
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS timezones VARCHAR(255),
  ADD COLUMN IF NOT EXISTS currency VARCHAR(50);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'companies'
      AND constraint_type = 'FOREIGN KEY'
      AND constraint_name = 'companies_owner_user_id_fkey'
  ) THEN
    ALTER TABLE companies
      ADD CONSTRAINT companies_owner_user_id_fkey
      FOREIGN KEY (owner_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'company_groups'
  ) THEN
    ALTER TABLE company_groups
      ADD COLUMN IF NOT EXISTS owner_user_id INTEGER;

    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.table_constraints
      WHERE table_name = 'company_groups'
        AND constraint_type = 'FOREIGN KEY'
        AND constraint_name = 'company_groups_owner_user_id_fkey'
    ) THEN
      ALTER TABLE company_groups
        ADD CONSTRAINT company_groups_owner_user_id_fkey
        FOREIGN KEY (owner_user_id)
        REFERENCES users(id)
        ON DELETE SET NULL;
    END IF;
  END IF;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE TABLE IF NOT EXISTS store_operating_hours (
  id SERIAL PRIMARY KEY,
  store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  open_time TIME,
  close_time TIME,
  peak_start_time TIME,
  peak_end_time TIME,
  planned_shift_count INTEGER,
  planned_staff_count INTEGER,
  shift_plan_notes TEXT,
  is_closed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (
    (is_closed = true AND open_time IS NULL AND close_time IS NULL)
    OR (is_closed = false AND open_time IS NOT NULL AND close_time IS NOT NULL AND open_time < close_time)
  ),
  CHECK (
    (peak_start_time IS NULL AND peak_end_time IS NULL)
    OR (peak_start_time IS NOT NULL AND peak_end_time IS NOT NULL AND peak_start_time < peak_end_time)
  ),
  CHECK (planned_shift_count IS NULL OR planned_shift_count >= 0),
  CHECK (planned_staff_count IS NULL OR planned_staff_count >= 0),
  UNIQUE (store_id, day_of_week)
);
CREATE INDEX IF NOT EXISTS idx_store_operating_hours_store ON store_operating_hours(store_id);

ALTER TABLE store_operating_hours
  ADD COLUMN IF NOT EXISTS peak_start_time TIME,
  ADD COLUMN IF NOT EXISTS peak_end_time TIME,
  ADD COLUMN IF NOT EXISTS planned_shift_count INTEGER,
  ADD COLUMN IF NOT EXISTS planned_staff_count INTEGER,
  ADD COLUMN IF NOT EXISTS shift_plan_notes TEXT;

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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'users_unique_id_company' AND table_name = 'users'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_unique_id_company UNIQUE (company_id, unique_id);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. role_module_permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS role_module_permissions (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role        user_role NOT NULL,
  module_name VARCHAR(100) NOT NULL,
  is_enabled  BOOLEAN DEFAULT true,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, role, module_name)
);

-- ---------------------------------------------------------------------------
-- 6. audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id),
  action      VARCHAR(50) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id   BIGINT,
  old_data    JSONB,
  new_data    JSONB,
  ip_address  VARCHAR(45),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_company ON audit_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity  ON audit_logs(entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- 7. login_attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS login_attempts (
  id           SERIAL PRIMARY KEY,
  email        VARCHAR(255) NOT NULL,
  attempted_at TIMESTAMPTZ DEFAULT NOW(),
  ip_address   VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, attempted_at DESC);

-- ---------------------------------------------------------------------------
-- 8. temporary_store_assignments (Phase 3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS temporary_store_assignments (
  id                  SERIAL PRIMARY KEY,
  company_id          INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  origin_store_id     INTEGER NOT NULL REFERENCES stores(id),
  target_store_id     INTEGER NOT NULL REFERENCES stores(id),
  start_date          DATE NOT NULL,
  end_date            DATE NOT NULL,
  cancel_origin_shifts BOOLEAN NOT NULL DEFAULT true,
  status              VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'cancelled', 'completed')),
  reason              TEXT,
  notes               TEXT,
  created_by          INTEGER REFERENCES users(id),
  cancelled_by        INTEGER REFERENCES users(id),
  cancelled_at        TIMESTAMPTZ,
  cancellation_reason TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  CHECK (start_date <= end_date),
  CHECK (origin_store_id <> target_store_id)
);

CREATE INDEX IF NOT EXISTS idx_temp_assignments_company_user_range
  ON temporary_store_assignments(company_id, user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_company_target_range
  ON temporary_store_assignments(company_id, target_store_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_temp_assignments_status
  ON temporary_store_assignments(status);

-- ---------------------------------------------------------------------------
-- 9. shifts  (Phase 2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id     INTEGER NOT NULL REFERENCES stores(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
  assignment_id INTEGER REFERENCES temporary_store_assignments(id) ON DELETE SET NULL,
  cancelled_by_transfer_id INTEGER REFERENCES temporary_store_assignments(id) ON DELETE SET NULL,
  date         DATE NOT NULL,
  start_time   TIME NOT NULL,
  end_time     TIME NOT NULL,
  break_start  TIME,
  break_end    TIME,
  break_type   VARCHAR(10) DEFAULT 'fixed' CHECK (break_type IN ('fixed', 'flexible')),
  break_minutes INTEGER,
  is_split     BOOLEAN DEFAULT false,
  split_start2 TIME,
  split_end2   TIME,
  status       VARCHAR(20) DEFAULT 'scheduled'
               CHECK (status IN ('scheduled','confirmed','cancelled')),
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shifts_company_date ON shifts(company_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_user_date    ON shifts(user_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_store_date   ON shifts(store_id, date);
CREATE INDEX IF NOT EXISTS idx_shifts_assignment_id ON shifts(assignment_id);
CREATE INDEX IF NOT EXISTS idx_shifts_cancelled_by_transfer_id ON shifts(cancelled_by_transfer_id);

-- ---------------------------------------------------------------------------
-- 9. qr_tokens  (Phase 2 — replay prevention)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS qr_tokens (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  store_id    INTEGER NOT NULL REFERENCES stores(id),
  nonce       VARCHAR(64) NOT NULL,
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at     TIMESTAMPTZ,
  CONSTRAINT qr_nonce_unique UNIQUE (nonce)
);
CREATE INDEX IF NOT EXISTS idx_qr_tokens_company_store ON qr_tokens(company_id, store_id);

-- ---------------------------------------------------------------------------
-- 10. attendance_events  (Phase 2 — replaces legacy attendance table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS attendance_events (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER NOT NULL REFERENCES companies(id),
  store_id      INTEGER NOT NULL REFERENCES stores(id),
  user_id       INTEGER NOT NULL REFERENCES users(id),
  event_type    VARCHAR(20) NOT NULL
                CHECK (event_type IN ('checkin','checkout','break_start','break_end')),
  event_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source        VARCHAR(20) NOT NULL DEFAULT 'qr'
                CHECK (source IN ('qr','manual','sync')),
  qr_token_id   INTEGER REFERENCES qr_tokens(id),
  shift_id      INTEGER REFERENCES shifts(id),
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attendance_events_company ON attendance_events(company_id, event_time);
CREATE INDEX IF NOT EXISTS idx_attendance_events_user    ON attendance_events(user_id, event_time);

-- ---------------------------------------------------------------------------
-- 11. leave_requests
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_requests (
  id                        SERIAL PRIMARY KEY,
  company_id                INTEGER NOT NULL REFERENCES companies(id),
  user_id                   INTEGER NOT NULL REFERENCES users(id),
  store_id                  INTEGER REFERENCES stores(id),
  leave_type                VARCHAR(20) NOT NULL CHECK (leave_type IN ('vacation','sick')),
  start_date                DATE NOT NULL,
  end_date                  DATE NOT NULL,
  status                    VARCHAR(30) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','supervisor_approved','area_manager_approved','hr_approved','rejected')),
  current_approver_role     VARCHAR(30),
  notes                     TEXT,
  medical_certificate_name  TEXT,
  medical_certificate_data  BYTEA,
  created_at                TIMESTAMPTZ DEFAULT NOW(),
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company ON leave_requests(company_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_user    ON leave_requests(user_id);

-- ---------------------------------------------------------------------------
-- 12. leave_approvals
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_approvals (
  id               SERIAL PRIMARY KEY,
  leave_request_id INTEGER NOT NULL REFERENCES leave_requests(id),
  approver_id      INTEGER NOT NULL REFERENCES users(id),
  approver_role    VARCHAR(30) NOT NULL,
  action           VARCHAR(20) NOT NULL CHECK (action IN ('approved','rejected')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 13. leave_balances
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS leave_balances (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id),
  user_id     INTEGER NOT NULL REFERENCES users(id),
  year        INTEGER NOT NULL,
  leave_type  VARCHAR(20) NOT NULL CHECK (leave_type IN ('vacation','sick')),
  total_days  NUMERIC(5,1) NOT NULL DEFAULT 25,
  used_days   NUMERIC(5,1) NOT NULL DEFAULT 0
    CHECK (used_days >= 0 AND used_days <= total_days),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id, year, leave_type)
);
