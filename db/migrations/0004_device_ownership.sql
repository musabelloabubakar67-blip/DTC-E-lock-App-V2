-- Device ownership is separate from hardware lifecycle.
-- A kit can remain historically registered while its devices are no longer DTC-owned/available.
ALTER TABLE devices ADD COLUMN ownership_status TEXT NOT NULL DEFAULT 'owned' CHECK (ownership_status IN ('owned','released_external'));
ALTER TABLE devices ADD COLUMN ownership_notes TEXT;
ALTER TABLE devices ADD COLUMN ownership_updated_at INTEGER;
