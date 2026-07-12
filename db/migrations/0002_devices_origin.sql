-- Queryable provenance for devices (§3 mismatch flow): distinguishes devices registered inline
-- during a verification mismatch correction from normally-registered ones, without relying on
-- audit_log history alone. SQLite backfills all existing rows with the DEFAULT automatically.
ALTER TABLE devices ADD COLUMN origin TEXT NOT NULL DEFAULT 'registered' CHECK (origin IN ('registered','discovered'));
