-- P-01 -- onboarding drafts.
--
-- Keyed by user rather than by org, because the whole point is to survive the case
-- where the org does not exist yet: someone answers four of seven questions, closes the
-- tab, and comes back. Roughly a fifth of signups drop mid-wizard, and without this
-- every one of them starts again from nothing.
CREATE TABLE IF NOT EXISTS onboarding_drafts (
  user_id     uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  answers     jsonb NOT NULL DEFAULT '{}'::jsonb,
  step        smallint NOT NULL DEFAULT 0,
  -- Emailed as a resume link so the tab is not the only way back in.
  resume_token text NOT NULL DEFAULT encode(gen_random_bytes(18), 'hex'),
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS onboarding_drafts_resume_token ON onboarding_drafts (resume_token);

GRANT SELECT, INSERT, UPDATE, DELETE ON onboarding_drafts TO awning_app;

-- Deliberately NOT under org RLS: a draft exists before its org does, so there is no
-- org_id to scope by. It is keyed on user_id and only ever read for the signed-in user.
