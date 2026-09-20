-- auth_sessions.impersonated_by had no ON DELETE rule, which meant two things:
-- removing an operator was blocked by any session they had ever opened, and until
-- then their impersonated sessions stayed live.
--
-- CASCADE rather than SET NULL: revoking an operator must revoke what they opened. The
-- durable record of who did what lives in audit_log, which is not touched by this.
ALTER TABLE auth_sessions DROP CONSTRAINT IF EXISTS auth_sessions_impersonated_by_fkey;
ALTER TABLE auth_sessions
  ADD CONSTRAINT auth_sessions_impersonated_by_fkey
  FOREIGN KEY (impersonated_by) REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS auth_sessions_impersonated_idx
  ON auth_sessions (impersonated_by) WHERE impersonated_by IS NOT NULL;

-- audit_log is the record that must outlive the people in it: a deleted operator's
-- actions still need an attributable row. SET NULL keeps the row and drops the link.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_impersonator_id_fkey;
ALTER TABLE audit_log
  ADD CONSTRAINT audit_log_impersonator_id_fkey
  FOREIGN KEY (impersonator_id) REFERENCES users(id) ON DELETE SET NULL;
