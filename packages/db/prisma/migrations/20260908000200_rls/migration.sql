-- Row-Level Security — defence in depth (docs/07-SECURITY-OPS.md §2).
--
-- Two roles, deliberately:
--   * the OWNER role runs migrations, the seed and the RENDERER. Postgres exempts a
--     table owner from RLS unless FORCE is set, and we do not set FORCE — the renderer
--     resolves a tenant by hostname before any org context exists, so it cannot supply one.
--   * awning_app is a non-owner role used by all dashboard/API code. RLS applies to it,
--     so a forgotten `where org_id = ...` returns zero rows instead of someone else's data.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'awning_app') THEN
    CREATE ROLE awning_app LOGIN;   -- password set out of band, never in a migration
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO awning_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO awning_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO awning_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO awning_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO awning_app;

-- Tables that carry org_id directly.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','site_assets','ai_usage','setup_fees','subscriptions','memberships']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I
        USING (org_id = current_setting('app.org_id', true)::uuid)
        WITH CHECK (org_id = current_setting('app.org_id', true)::uuid)
    $f$, t);
  END LOOP;
END $$;

-- Tables reached through a site.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['site_versions','site_domains','ai_conversations','form_submissions',
                           'newsletter_subscribers','products','product_categories','orders',
                           'store_customers','discount_codes','shipping_rates','store_settings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON %I', t);
    EXECUTE format($f$
      CREATE POLICY org_isolation ON %I
        USING (site_id IN (SELECT id FROM sites
                           WHERE org_id = current_setting('app.org_id', true)::uuid))
        WITH CHECK (site_id IN (SELECT id FROM sites
                                WHERE org_id = current_setting('app.org_id', true)::uuid))
    $f$, t);
  END LOOP;
END $$;

-- organizations is keyed on id, not org_id.
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS org_isolation ON organizations;
CREATE POLICY org_isolation ON organizations
  USING (id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (id = current_setting('app.org_id', true)::uuid);

-- Reference data every tenant may read.
GRANT SELECT ON plans, templates TO awning_app;
