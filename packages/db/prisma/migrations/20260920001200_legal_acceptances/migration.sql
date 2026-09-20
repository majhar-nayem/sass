-- O-05b -- a record of who agreed to what.
--
-- Terms you cannot prove someone accepted are not much use in the moment you need
-- them. This records the document, the version AND the hash of the exact text, so
-- editing a document later does not rewrite history: the row still points at the
-- words that were on screen.
--
-- Its own table rather than columns on organizations, because acceptance is an event
-- that recurs (a material change means accepting again) and because it is the person
-- who accepts, not the company.

CREATE TABLE legal_acceptances (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Nullable: terms are accepted at signup, which can be before an org exists.
  org_id       uuid REFERENCES organizations(id) ON DELETE CASCADE,
  document_id  text NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  -- Hex SHA-256 of the document body at the moment of acceptance.
  sha256       char(64) NOT NULL,
  accepted_at  timestamptz NOT NULL DEFAULT now(),
  -- Hashed, not raw: we need to show acceptance came from somewhere, not to build a
  -- location history of our customers.
  ip_hash      text,
  user_agent   text,

  -- Accepting the same version twice is a duplicate click, not a second agreement.
  CONSTRAINT one_acceptance_per_version UNIQUE (user_id, document_id, version)
);

CREATE INDEX legal_acceptances_user_idx ON legal_acceptances (user_id, document_id);
CREATE INDEX legal_acceptances_org_idx ON legal_acceptances (org_id) WHERE org_id IS NOT NULL;

-- RLS: scoped to the org like everything else; rows taken at signup have no org yet.
ALTER TABLE legal_acceptances ENABLE ROW LEVEL SECURITY;

CREATE POLICY legal_acceptances_org_isolation ON legal_acceptances
  USING (org_id IS NULL OR org_id = current_setting('app.org_id', true)::uuid);

GRANT SELECT, INSERT ON legal_acceptances TO awning_app;
