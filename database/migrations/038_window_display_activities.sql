-- 038_window_display_activities.sql
CREATE TABLE IF NOT EXISTS window_display_activities (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  store_id    INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  year_month  VARCHAR(7) NOT NULL,
  flagged_by  INTEGER NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_store_month UNIQUE (store_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_wda_company_store ON window_display_activities(company_id, store_id);
CREATE INDEX IF NOT EXISTS idx_wda_date ON window_display_activities(date);
