-- F-07 -- adapt the existing auth tables to what Better Auth requires.
--
-- Probed from getAuthTables() rather than guessed. We keep ONE users table: the
-- alternative (letting Better Auth own a separate `user` table) would leave two
-- identities per person and a join on every request.

-- Better Auth stores a credential password on the account row, not the user. Keeping a
-- second password column invites writing to the wrong one.
ALTER TABLE users DROP COLUMN IF EXISTS password_hash;

-- sessions ------------------------------------------------------------------
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS token text;
UPDATE auth_sessions SET token = gen_random_uuid()::text WHERE token IS NULL;
ALTER TABLE auth_sessions ALTER COLUMN token SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_key ON auth_sessions (token);
ALTER TABLE auth_sessions
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- accounts ------------------------------------------------------------------
-- Better Auth tracks access and refresh expiry separately; our single expires_at
-- was always the access token's.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'auth_accounts' AND column_name = 'expires_at') THEN
    ALTER TABLE auth_accounts RENAME COLUMN expires_at TO access_token_expires_at;
  END IF;
END $$;

ALTER TABLE auth_accounts
  ADD COLUMN IF NOT EXISTS refresh_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS id_token text,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS password text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- verification --------------------------------------------------------------
-- Email OTP and verification links. Rows are short-lived and high-churn.
CREATE TABLE IF NOT EXISTS auth_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier  text NOT NULL,
  value       text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_verifications_identifier_idx
  ON auth_verifications (identifier);
-- Expired rows are dead weight; a partial index keeps the sweep cheap.
CREATE INDEX IF NOT EXISTS auth_verifications_expires_idx
  ON auth_verifications (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON auth_verifications TO awning_app;
