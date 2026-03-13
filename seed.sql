-- =============================================================================
-- HR System Tech Demo - Seed Data (Phase 1)
-- =============================================================================
-- Run AFTER schema.sql AND 002_phase1_schema.sql.
-- This file is idempotent: truncates all data and re-inserts from scratch.
-- All demo passwords are 'password123'.
-- Hash: $2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Truncate all tables (cascade handles FKs)
-- ---------------------------------------------------------------------------
TRUNCATE login_attempts, audit_logs, role_module_permissions, attendance, shifts, users, stores, companies RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Companies
-- ---------------------------------------------------------------------------
INSERT INTO companies (name, slug) VALUES
  ('Acme Corp', 'acme'),
  ('Beta Industries', 'beta');

-- ---------------------------------------------------------------------------
-- 3. Stores
-- ---------------------------------------------------------------------------
INSERT INTO stores (company_id, name, code, address, cap, max_staff) VALUES
  (1, 'Negozio Roma Centro',  'ROM-01', 'Via del Corso 100',             '00186', 15),
  (1, 'Negozio Milano Duomo', 'MIL-01', 'Corso Vittorio Emanuele 10',   '20122', 12),
  (2, 'Negozio Napoli',       'NAP-01', 'Via Toledo 50',                 '80134',  8);

-- ---------------------------------------------------------------------------
-- 4. Users - Acme Corp (company_id = 1)
-- Use explicit IDs to allow supervisor_id forward/self references
-- ---------------------------------------------------------------------------
INSERT INTO users (id, company_id, name, surname, email, password_hash, role, store_id, supervisor_id, department, hire_date, working_type, weekly_hours, status, unique_id) VALUES
  (1,  1, 'Marco',     'Rossi',    'admin@acme.com',           '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'admin',          NULL, NULL, NULL,        '2020-01-01', NULL,        NULL, 'active', NULL),
  (2,  1, 'Laura',     'Bianchi',  'hr@acme.com',              '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'hr',             NULL, NULL, NULL,        '2020-03-15', NULL,        NULL, 'active', NULL),
  (3,  1, 'Giuseppe',  'Ferrari',  'areamanager@acme.com',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'area_manager',   NULL, NULL, NULL,        '2019-06-01', NULL,        NULL, 'active', NULL),
  (4,  1, 'Sofia',     'Esposito', 'manager.roma@acme.com',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'store_manager',  1,    3,    NULL,        '2021-02-10', NULL,        NULL, 'active', NULL),
  (5,  1, 'Luca',      'Ricci',    'manager.milano@acme.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'store_manager',  2,    3,    NULL,        '2021-04-20', NULL,        NULL, 'active', NULL),
  (6,  1, 'Anna',      'Conti',    'dipendente1@acme.com',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee',       1,    4,    'Cassa',     '2023-01-15', 'full_time', 40,   'active', 'ACME-001'),
  (7,  1, 'Roberto',   'Mancini',  'dipendente2@acme.com',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee',       1,    4,    'Magazzino', '2022-06-01', 'part_time', 20,   'active', 'ACME-002'),
  (8,  1, 'Chiara',    'Lombardi', 'dipendente3@acme.com',     '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee',       2,    5,    'Cassa',     '2023-03-10', 'full_time', 40,   'active', 'ACME-003'),
  (9,  1, 'Terminale', 'Roma',     'terminal.roma@acme.com',   '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'store_terminal', 1,    NULL, NULL,        '2024-01-01', NULL,        NULL, 'active', NULL);

-- Beta Industries (company_id = 2)
INSERT INTO users (id, company_id, name, surname, email, password_hash, role, store_id, supervisor_id, department, hire_date, working_type, weekly_hours, status, unique_id) VALUES
  (10, 2, 'Giulia',   'De Luca', 'hr@beta.com',      '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'hr',            NULL, NULL, NULL,      '2021-01-10', NULL,        NULL, 'active', NULL),
  (11, 2, 'Antonio',  'Marino',  'manager@beta.com',  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'store_manager', 3,    NULL, NULL,      '2020-09-15', NULL,        NULL, 'active', NULL),
  (12, 2, 'Carol',    'Russo',   'carol@beta.com',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee',      3,    11,   'Vendite', '2023-05-20', 'full_time', 40,   'active', 'BETA-001'),
  (13, 2, 'Marco',    'Bruno',   'marco@beta.com',    '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', 'employee',      3,    11,   'Cassa',   '2024-01-08', 'part_time', 24,   'active', 'BETA-002');

-- Reset sequences to avoid conflicts with future inserts
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));

-- ---------------------------------------------------------------------------
-- 5. role_module_permissions
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

  -- ======= ACME CORP (company_id = 1) =======

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
