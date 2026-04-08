-- Migration 025: Unique Device Token
-- Ensures that a device token is only assigned to one user at a time.
-- Postgres UNIQUE allows multiple NULLs, so unregistered users won't conflict.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_registered_device_token'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT uq_users_registered_device_token UNIQUE (registered_device_token);
  END IF;
END $$;
