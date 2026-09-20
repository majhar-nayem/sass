-- O-02 -- a per-org AI allowance on top of the plan's.
--
-- On the subscription rather than the plan: a plan row is shared by every org on it, so
-- editing it to help one customer would quietly give the same grant to all of them.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS ai_actions_bonus integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_bonus_expires_at timestamptz;

-- The operator console lists recent orgs and reads one org's audit trail.
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_type, entity_id, created_at DESC);
