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
-- 8. shifts  (Phase 2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS shifts (
  id           SERIAL PRIMARY KEY,
  company_id   INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id     INTEGER NOT NULL REFERENCES stores(id),
  user_id      INTEGER NOT NULL REFERENCES users(id),
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
