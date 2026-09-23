-- Older local databases may have the initial schema without this nullable archive marker.
-- This remains safe on fresh databases where 0000 already created the column.
ALTER TABLE "customer_assets"
  ADD COLUMN IF NOT EXISTS "archived_at" timestamp with time zone;
