-- =============================================================================
-- HR System Tech Demo - Seed Data (Phase 1)
-- =============================================================================
-- Run AFTER schema.sql AND 002_phase1_schema.sql.
-- This file is idempotent: truncates all data and re-inserts from scratch.
-- All demo passwords are 'password123'.
-- Hash: $2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Truncate all tables (cascade handles FKs)
-- ---------------------------------------------------------------------------
TRUNCATE login_attempts, audit_logs, role_module_permissions, attendance, shifts, users, stores, companies RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Companies
-- ---------------------------------------------------------------------------
INSERT INTO companies (name, slug) VALUES
  ('FUSARO UOMO', 'fusaro-uomo'),
  ('Beta Industries', 'beta');

-- ---------------------------------------------------------------------------
-- 3. Stores
-- ---------------------------------------------------------------------------
INSERT INTO stores (company_id, name, code, address, cap, max_staff) VALUES
  (1, 'Negozio Roma Centro',  'ROM-01', 'Via del Corso 100',             '00186', 15),
  (1, 'Negozio Milano Duomo', 'MIL-01', 'Corso Vittorio Emanuele 10',   '20122', 12),
  (2, 'Negozio Napoli',       'NAP-01', 'Via Toledo 50',                 '80134',  8);

-- ---------------------------------------------------------------------------
-- 4. Users - FUSARO UOMO (company_id = 1)
-- Use explicit IDs to allow supervisor_id forward/self references
-- All personal data uses realistic Italian demo values.
-- ---------------------------------------------------------------------------
INSERT INTO users (
  id, company_id, name, surname, email, password_hash,
  role, store_id, supervisor_id,
  department, hire_date, contract_end_date, working_type, weekly_hours,
  status, unique_id,
  personal_email, date_of_birth, nationality, gender,
  iban, address, cap,
  first_aid_flag, marital_status
) VALUES
  -- Admin
  (1, 1, 'Marco', 'Rossi', 'admin@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'admin', NULL, NULL,
   'Direzione', '2020-01-01', NULL, NULL, NULL,
   'active', NULL,
   'marco.rossi.privato@gmail.com', '1975-03-15', 'Italiana', 'M',
   'IT60X0542811101000000112233', 'Via della Conciliazione 45', '00193',
   true, 'Coniugato'),

  -- HR
  (2, 1, 'Laura', 'Bianchi', 'hr@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'hr', NULL, NULL,
   'Risorse Umane', '2020-03-15', NULL, NULL, NULL,
   'active', NULL,
   'laura.bianchi.hr@gmail.com', '1982-07-22', 'Italiana', 'F',
   'IT60X0542811101000000223344', 'Via Nazionale 12', '00184',
   false, 'Nubile'),

  -- Area Manager
  (3, 1, 'Giuseppe', 'Ferrari', 'areamanager@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'area_manager', NULL, NULL,
   'Operations', '2019-06-01', NULL, NULL, NULL,
   'active', NULL,
   'g.ferrari.privato@libero.it', '1978-11-05', 'Italiana', 'M',
   'IT60X0542811101000000334455', 'Piazza Venezia 3', '00186',
   true, 'Coniugato'),

  -- Store Manager - Roma
  (4, 1, 'Sofia', 'Esposito', 'manager.roma@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'store_manager', 1, 3,
   'Gestione Negozio', '2021-02-10', NULL, NULL, NULL,
   'active', NULL,
   'sofia.esposito@gmail.com', '1985-04-18', 'Italiana', 'F',
   'IT60X0542811101000000445566', 'Via del Corso 88', '00186',
   false, 'Nubile'),

  -- Store Manager - Milano
  (5, 1, 'Luca', 'Ricci', 'manager.milano@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'store_manager', 2, 3,
   'Gestione Negozio', '2021-04-20', NULL, NULL, NULL,
   'active', NULL,
   'luca.ricci.mi@gmail.com', '1983-09-30', 'Italiana', 'M',
   'IT60X0542811101000000556677', 'Via Montenapoleone 5', '20121',
   true, 'Coniugato'),

  -- Employee 1 - Roma Cassa, full_time
  (6, 1, 'Anna', 'Conti', 'dipendente1@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'employee', 1, 4,
   'Cassa', '2023-01-15', NULL, 'full_time', 40,
   'active', 'ACME-001',
   'anna.conti.privata@gmail.com', '1995-02-14', 'Italiana', 'F',
   'IT60X0542811101000000667788', 'Via Tiburtina 200', '00162',
   true, 'Nubile'),

  -- Employee 2 - Roma Magazzino, part_time, fixed-term
  (7, 1, 'Roberto', 'Mancini', 'dipendente2@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'employee', 1, 4,
   'Magazzino', '2022-06-01', '2026-12-31', 'part_time', 20,
   'active', 'ACME-002',
   'roberto.mancini99@gmail.com', '1998-08-20', 'Italiana', 'M',
   'IT60X0542811101000000778899', 'Via Prenestina 55', '00176',
   false, 'Celibe'),

  -- Employee 3 - Milano Cassa, full_time
  (8, 1, 'Chiara', 'Lombardi', 'dipendente3@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'employee', 2, 5,
   'Cassa', '2023-03-10', NULL, 'full_time', 40,
   'active', 'ACME-003',
   'chiara.lombardi.mi@gmail.com', '1996-05-07', 'Italiana', 'F',
   'IT60X0542811101000000889900', 'Corso Buenos Aires 60', '20124',
   false, 'Nubile'),

  -- Store Terminal - Roma (kiosk account, no personal data)
  (9, 1, 'Terminale', 'Roma', 'terminal.roma@fusarouomo.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'store_terminal', 1, NULL,
   NULL, '2024-01-01', NULL, NULL, NULL,
   'active', NULL,
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL,
   false, NULL);

-- ---------------------------------------------------------------------------
-- 5. Users - Beta Industries (company_id = 2)
-- ---------------------------------------------------------------------------
INSERT INTO users (
  id, company_id, name, surname, email, password_hash,
  role, store_id, supervisor_id,
  department, hire_date, contract_end_date, working_type, weekly_hours,
  status, unique_id,
  personal_email, date_of_birth, nationality, gender,
  iban, address, cap,
  first_aid_flag, marital_status
) VALUES
  -- HR - Beta
  (10, 2, 'Giulia', 'De Luca', 'hr@beta.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'hr', NULL, NULL,
   'Risorse Umane', '2021-01-10', NULL, NULL, NULL,
   'active', NULL,
   'giulia.deluca.privata@gmail.com', '1980-12-03', 'Italiana', 'F',
   'IT60X0542811101000000990011', 'Via Toledo 30', '80134',
   false, 'Coniugata'),

  -- Store Manager - Napoli
  (11, 2, 'Antonio', 'Marino', 'manager@beta.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'store_manager', 3, NULL,
   'Gestione Negozio', '2020-09-15', NULL, NULL, NULL,
   'active', NULL,
   'antonio.marino.na@libero.it', '1977-06-25', 'Italiana', 'M',
   'IT60X0542811101000001001122', 'Via Caracciolo 14', '80122',
   true, 'Coniugato'),

  -- Employee - Beta Vendite, full_time
  (12, 2, 'Carol', 'Russo', 'carol@beta.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'employee', 3, 11,
   'Vendite', '2023-05-20', NULL, 'full_time', 40,
   'active', 'BETA-001',
   'carol.russo.privata@gmail.com', '1992-10-11', 'Italiana', 'F',
   'IT60X0542811101000001112233', 'Via Chiaia 55', '80121',
   false, 'Nubile'),

  -- Employee - Beta Cassa, part_time, fixed-term
  (13, 2, 'Marco', 'Bruno', 'marco@beta.com',
   '$2a$10$e/ULie.9SQf5MIQSNjkxEO7.xAyc6zv/qysVTE4mVFhZum/BjT5VG',
   'employee', 3, 11,
   'Cassa', '2024-01-08', '2026-09-30', 'part_time', 24,
   'active', 'BETA-002',
   'marco.bruno2000@gmail.com', '2000-01-30', 'Italiana', 'M',
   'IT60X0542811101000001223344', 'Via Mergellina 8', '80122',
   false, 'Celibe');

-- Reset sequences to avoid conflicts with future inserts
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- ---------------------------------------------------------------------------
-- 6. role_module_permissions
-- 6 roles × 8 modules × 2 companies = 96 rows
--
-- Phase 1 active modules: dipendenti, impostazioni
-- Deferred modules (is_enabled=false): turni, presenze, permessi, documenti, ats, report
--
-- dipendenti:   admin=true, hr=true, area_manager=true, store_manager=true,
--               employee=false, store_terminal=false
-- impostazioni: admin=true, all others=false
-- ---------------------------------------------------------------------------
INSERT INTO role_module_permissions (company_id, role, module_name, is_enabled) VALUES

  -- ======= FUSARO UOMO (company_id = 1) =======

  -- dipendenti
  (1, 'admin',          'dipendenti', true),
  (1, 'hr',             'dipendenti', true),
  (1, 'area_manager',   'dipendenti', true),
  (1, 'store_manager',  'dipendenti', true),
  (1, 'employee',       'dipendenti', false),
  (1, 'store_terminal', 'dipendenti', false),

  -- impostazioni
  (1, 'admin',          'impostazioni', true),
  (1, 'hr',             'impostazioni', false),
  (1, 'area_manager',   'impostazioni', false),
  (1, 'store_manager',  'impostazioni', false),
  (1, 'employee',       'impostazioni', false),
  (1, 'store_terminal', 'impostazioni', false),

  -- turni (deferred - Phase 2+)
  (1, 'admin',          'turni', false),
  (1, 'hr',             'turni', false),
  (1, 'area_manager',   'turni', false),
  (1, 'store_manager',  'turni', false),
  (1, 'employee',       'turni', false),
  (1, 'store_terminal', 'turni', false),

  -- presenze (deferred - Phase 2+)
  (1, 'admin',          'presenze', false),
  (1, 'hr',             'presenze', false),
  (1, 'area_manager',   'presenze', false),
  (1, 'store_manager',  'presenze', false),
  (1, 'employee',       'presenze', false),
  (1, 'store_terminal', 'presenze', false),

  -- permessi (deferred - Phase 2+)
  (1, 'admin',          'permessi', false),
  (1, 'hr',             'permessi', false),
  (1, 'area_manager',   'permessi', false),
  (1, 'store_manager',  'permessi', false),
  (1, 'employee',       'permessi', false),
  (1, 'store_terminal', 'permessi', false),

  -- documenti (deferred - Phase 2+)
  (1, 'admin',          'documenti', false),
  (1, 'hr',             'documenti', false),
  (1, 'area_manager',   'documenti', false),
  (1, 'store_manager',  'documenti', false),
  (1, 'employee',       'documenti', false),
  (1, 'store_terminal', 'documenti', false),

  -- ats (deferred - Phase 2+)
  (1, 'admin',          'ats', false),
  (1, 'hr',             'ats', false),
  (1, 'area_manager',   'ats', false),
  (1, 'store_manager',  'ats', false),
  (1, 'employee',       'ats', false),
  (1, 'store_terminal', 'ats', false),

  -- report (deferred - Phase 2+)
  (1, 'admin',          'report', false),
  (1, 'hr',             'report', false),
  (1, 'area_manager',   'report', false),
  (1, 'store_manager',  'report', false),
  (1, 'employee',       'report', false),
  (1, 'store_terminal', 'report', false),

  -- ======= BETA INDUSTRIES (company_id = 2) =======

  -- dipendenti
  (2, 'admin',          'dipendenti', true),
  (2, 'hr',             'dipendenti', true),
  (2, 'area_manager',   'dipendenti', true),
  (2, 'store_manager',  'dipendenti', true),
  (2, 'employee',       'dipendenti', false),
  (2, 'store_terminal', 'dipendenti', false),

  -- impostazioni
  (2, 'admin',          'impostazioni', true),
  (2, 'hr',             'impostazioni', false),
  (2, 'area_manager',   'impostazioni', false),
  (2, 'store_manager',  'impostazioni', false),
  (2, 'employee',       'impostazioni', false),
  (2, 'store_terminal', 'impostazioni', false),

  -- turni (deferred - Phase 2+)
  (2, 'admin',          'turni', false),
  (2, 'hr',             'turni', false),
  (2, 'area_manager',   'turni', false),
  (2, 'store_manager',  'turni', false),
  (2, 'employee',       'turni', false),
  (2, 'store_terminal', 'turni', false),

  -- presenze (deferred - Phase 2+)
  (2, 'admin',          'presenze', false),
  (2, 'hr',             'presenze', false),
  (2, 'area_manager',   'presenze', false),
  (2, 'store_manager',  'presenze', false),
  (2, 'employee',       'presenze', false),
  (2, 'store_terminal', 'presenze', false),

  -- permessi (deferred - Phase 2+)
  (2, 'admin',          'permessi', false),
  (2, 'hr',             'permessi', false),
  (2, 'area_manager',   'permessi', false),
  (2, 'store_manager',  'permessi', false),
  (2, 'employee',       'permessi', false),
  (2, 'store_terminal', 'permessi', false),

  -- documenti (deferred - Phase 2+)
  (2, 'admin',          'documenti', false),
  (2, 'hr',             'documenti', false),
  (2, 'area_manager',   'documenti', false),
  (2, 'store_manager',  'documenti', false),
  (2, 'employee',       'documenti', false),
  (2, 'store_terminal', 'documenti', false),

  -- ats (deferred - Phase 2+)
  (2, 'admin',          'ats', false),
  (2, 'hr',             'ats', false),
  (2, 'area_manager',   'ats', false),
  (2, 'store_manager',  'ats', false),
  (2, 'employee',       'ats', false),
  (2, 'store_terminal', 'ats', false),

  -- report (deferred - Phase 2+)
  (2, 'admin',          'report', false),
  (2, 'hr',             'report', false),
  (2, 'area_manager',   'report', false),
  (2, 'store_manager',  'report', false),
  (2, 'employee',       'report', false),
  (2, 'store_terminal', 'report', false);

-- =============================================================================
-- End of seed data
-- =============================================================================
