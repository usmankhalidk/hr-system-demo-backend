-- HR System Tech Demo - Seed Data
-- Run AFTER schema.sql
-- Passwords are all "password123" (bcrypt hashed)

-- Companies
INSERT INTO companies (name, slug) VALUES
  ('Acme Corp', 'acme-corp'),
  ('Beta Industries', 'beta-industries');

-- Users
-- Admin (company 1) - password: password123
INSERT INTO users (company_id, name, email, password_hash, role) VALUES
  (1, 'Alice Admin', 'admin@acme.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.admin123', 'admin');

-- Manager (company 1) - password: password123
INSERT INTO users (company_id, name, email, password_hash, role) VALUES
  (1, 'Mike Manager', 'manager@acme.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.mgr123', 'manager');

-- Employees (company 1) - password: password123
INSERT INTO users (company_id, name, email, password_hash, role) VALUES
  (1, 'Emma Employee', 'emma@acme.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.emp1', 'employee'),
  (1, 'Evan Employee', 'evan@acme.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.emp2', 'employee');

-- Manager (company 2)
INSERT INTO users (company_id, name, email, password_hash, role) VALUES
  (2, 'Bob Beta', 'manager@beta.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.bob', 'manager');

-- Employee (company 2)
INSERT INTO users (company_id, name, email, password_hash, role) VALUES
  (2, 'Carol Beta', 'carol@beta.com',
   '$2b$10$YourHashHere.ReplaceWithActualBcryptHash.carol', 'employee');

-- NOTE: The actual seed is generated via `npm run seed` in the backend.
-- This file is for reference. The seed script hashes passwords correctly.
