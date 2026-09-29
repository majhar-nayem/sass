-- M-03 -- one Stripe account belongs to one site.
--
-- The Connect webhook resolves a tenant by stripe_account_id. That is only sound if the
-- mapping is unique, which is true of Stripe's ids in reality but was nowhere enforced
-- here — so a duplicate would have silently applied one tenant's account status to
-- another tenant's shop, turning payments on or off for a business that never touched
-- Stripe.
--
-- Found because a test fixture reused an account id across runs and the webhook started
-- resolving to the wrong row.

-- Clean up any duplicates left by development fixtures before the constraint lands.
UPDATE store_settings SET stripe_account_id = NULL, stripe_onboarded_at = NULL
WHERE stripe_account_id IS NOT NULL
  AND site_id NOT IN (
    SELECT DISTINCT ON (stripe_account_id) site_id
    FROM store_settings
    WHERE stripe_account_id IS NOT NULL
    ORDER BY stripe_account_id, created_at ASC
  );

CREATE UNIQUE INDEX store_settings_stripe_account_id_key
  ON store_settings (stripe_account_id)
  WHERE stripe_account_id IS NOT NULL;
