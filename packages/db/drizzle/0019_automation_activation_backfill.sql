-- Turning a rule on must not replay domain-event backlog from before activation.
-- Preserve known cutoffs; updated_at is the best available legacy activation boundary.
UPDATE automation_rules
SET active_from = coalesce(active_from, updated_at)
WHERE status = 'active';
