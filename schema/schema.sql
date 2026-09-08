-- ============================================================================
-- Awning — PostgreSQL schema (MVP)
-- Target: PostgreSQL 16, Neon ap-southeast-2
-- Money: integer cents, AUD, GST-INCLUSIVE unless a column says otherwise.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ---------------------------------------------------------------- enums ----
CREATE TYPE member_role        AS ENUM ('owner','admin','staff');
CREATE TYPE site_status        AS ENUM ('draft','published','unpublished','suspended','deleted');
CREATE TYPE domain_kind        AS ENUM ('subdomain','custom');
CREATE TYPE domain_status      AS ENUM ('pending','verifying','ssl_pending','active','failed','detached');
CREATE TYPE version_author     AS ENUM ('user','ai','system','template');
CREATE TYPE ai_action_type     AS ENUM ('generate','edit','rewrite','seo','christmas','image_prompt','support');
CREATE TYPE sub_status         AS ENUM ('trialing','active','past_due','canceled','incomplete','paused');
CREATE TYPE product_status     AS ENUM ('draft','active','archived');
CREATE TYPE product_kind       AS ENUM ('physical','giftcard','preorder','service');
CREATE TYPE order_status       AS ENUM ('pending','paid','fulfilled','cancelled','refunded','partially_refunded');
CREATE TYPE fulfilment_method  AS ENUM ('shipping','pickup','local_delivery','digital');
CREATE TYPE discount_kind      AS ENUM ('percent','fixed','free_shipping');

-- ============================================================ IDENTITY ======

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           citext NOT NULL UNIQUE,
  email_verified  boolean NOT NULL DEFAULT false,
  name            text,
  avatar_url      text,
  phone           text,
  password_hash   text,                       -- null when social-only
  last_login_at   timestamptz,
  is_platform_admin boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Better Auth owns sessions/accounts/verifications; shown for completeness.
CREATE TABLE auth_sessions (
  id           text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at   timestamptz NOT NULL,
  ip_address   inet,
  user_agent   text,
  impersonated_by uuid REFERENCES users(id),   -- support impersonation, always logged
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_sessions (user_id);

CREATE TABLE auth_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider      text NOT NULL,                 -- 'google' | 'credential'
  provider_account_id text NOT NULL,
  access_token  text, refresh_token text, expires_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

-- ======================================================== ORGANISATIONS =====

CREATE TABLE organizations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  slug            citext NOT NULL UNIQUE,
  -- Australian business identity
  abn             char(11),                    -- validated by checksum, not just length
  acn             char(9),
  legal_name      text,
  gst_registered  boolean NOT NULL DEFAULT false,
  state           text,                        -- NSW VIC QLD SA WA TAS NT ACT
  timezone        text NOT NULL DEFAULT 'Australia/Adelaide',
  -- billing
  stripe_customer_id text UNIQUE,
  billing_email   citext,
  -- lifecycle
  onboarding_completed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  CONSTRAINT abn_shape CHECK (abn IS NULL OR abn ~ '^[0-9]{11}$')
);

CREATE TABLE memberships (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      member_role NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);
CREATE INDEX ON memberships (user_id);

-- ============================================================= BILLING ======

CREATE TABLE plans (
  code              text PRIMARY KEY,          -- 'founding','business','store'
  name              text NOT NULL,
  price_cents_aud   integer NOT NULL,          -- GST-inclusive display price
  interval          text NOT NULL DEFAULT 'month',
  stripe_price_id   text,
  ai_actions_month  integer NOT NULL,
  ai_hard_cap_cents integer NOT NULL,          -- circuit breaker, AUD cents
  max_sites         integer NOT NULL DEFAULT 1,
  max_pages         integer NOT NULL DEFAULT 10,
  max_products      integer NOT NULL DEFAULT 0,
  storage_mb        integer NOT NULL DEFAULT 500,
  custom_domain     boolean NOT NULL DEFAULT false,
  ecommerce         boolean NOT NULL DEFAULT false,
  remove_branding   boolean NOT NULL DEFAULT false,
  is_public         boolean NOT NULL DEFAULT true,
  sort_order        integer NOT NULL DEFAULT 0
);

CREATE TABLE subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  plan_code         text NOT NULL REFERENCES plans(code),
  status            sub_status NOT NULL DEFAULT 'trialing',
  stripe_subscription_id text UNIQUE,
  current_period_start timestamptz,
  current_period_end   timestamptz,
  trial_ends_at     timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at       timestamptz,
  cancel_reason     text,
  -- grandfathered founding pricing
  price_locked_cents integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON subscriptions (status, current_period_end);

CREATE TABLE setup_fees (                        -- done-for-you engagements
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  tier        text NOT NULL,                    -- 'express','standard','store'
  amount_cents integer NOT NULL,
  stripe_payment_intent_id text UNIQUE,
  paid_at     timestamptz,
  delivered_at timestamptz,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =============================================================== SITES ======

CREATE TABLE templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  industries    text[] NOT NULL DEFAULT '{}',   -- ['plumber','electrician']
  tags          text[] NOT NULL DEFAULT '{}',   -- ['christmas','ecommerce','premium']
  spec_json     jsonb NOT NULL,                 -- a complete WebsiteSpecification with {{placeholders}}
  spec_version  integer NOT NULL DEFAULT 1,
  thumbnail_url text,
  preview_url   text,
  is_seasonal   boolean NOT NULL DEFAULT false,
  active_from   date,
  active_to     date,
  is_active     boolean NOT NULL DEFAULT true,
  usage_count   integer NOT NULL DEFAULT 0,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON templates USING GIN (industries);
CREATE INDEX ON templates USING GIN (tags);

CREATE TABLE sites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name                  text NOT NULL,
  slug                  citext NOT NULL UNIQUE,        -- the subdomain label
  status                site_status NOT NULL DEFAULT 'draft',
  industry              text,
  template_id           uuid REFERENCES templates(id),
  draft_version_id      uuid,                          -- FK added after site_versions
  published_version_id  uuid,
  published_at          timestamptz,
  first_published_at    timestamptz,
  -- rendering / cache
  cache_epoch           integer NOT NULL DEFAULT 1,    -- bumped on publish -> versioned cache key
  -- business facts, kept relational because forms/emails/JSON-LD all need them
  business_phone        text,
  business_email        citext,
  business_address      jsonb,                         -- {line1,suburb,state,postcode,lat,lng}
  service_areas         text[] NOT NULL DEFAULT '{}',
  whatsapp_number       text,
  socials               jsonb NOT NULL DEFAULT '{}',
  opening_hours         jsonb,                         -- incl. holiday overrides
  -- seo
  seo_title             text,
  seo_description       text,
  og_image_url          text,
  favicon_url           text,
  noindex               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT slug_shape CHECK (slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])$' AND slug !~ '^xn--')
);
CREATE INDEX ON sites (org_id);
CREATE INDEX ON sites (status) WHERE status = 'published';

CREATE TABLE site_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  version           integer NOT NULL,
  parent_version_id uuid REFERENCES site_versions(id),
  spec_json         jsonb NOT NULL,
  spec_version      integer NOT NULL DEFAULT 1,
  patch_json        jsonb,                     -- the tool calls that produced this version
  summary           text,                      -- "Changed colours to dark green and gold"
  created_by        version_author NOT NULL,
  created_by_user   uuid REFERENCES users(id),
  ai_conversation_id uuid,
  byte_size         integer,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, version)
);
CREATE INDEX ON site_versions (site_id, created_at DESC);
CREATE INDEX ON site_versions USING GIN (spec_json jsonb_path_ops);

ALTER TABLE sites ADD CONSTRAINT sites_draft_fk
  FOREIGN KEY (draft_version_id) REFERENCES site_versions(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE sites ADD CONSTRAINT sites_published_fk
  FOREIGN KEY (published_version_id) REFERENCES site_versions(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE site_domains (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id           uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  hostname          citext NOT NULL UNIQUE,
  kind              domain_kind NOT NULL,
  status            domain_status NOT NULL DEFAULT 'pending',
  is_primary        boolean NOT NULL DEFAULT false,
  redirect_to_primary boolean NOT NULL DEFAULT false,
  cf_hostname_id    text,
  verification_txt  text,
  ssl_status        text,
  last_checked_at   timestamptz,
  check_attempts    integer NOT NULL DEFAULT 0,
  error_code        text,
  error_message_human text,
  activated_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- the single hottest index in the system
CREATE UNIQUE INDEX site_domains_active_host ON site_domains (hostname) WHERE status = 'active';
CREATE INDEX ON site_domains (site_id);
CREATE UNIQUE INDEX ON site_domains (site_id) WHERE is_primary;
CREATE INDEX ON site_domains (status, last_checked_at)
  WHERE status IN ('pending','verifying','ssl_pending');

CREATE TABLE site_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind          text NOT NULL,                 -- 'logo','image','favicon','product','og'
  r2_key        text NOT NULL UNIQUE,
  public_url    text NOT NULL,
  filename      text,
  mime_type     text NOT NULL,
  bytes         integer NOT NULL,
  width         integer, height integer,
  blurhash      text,
  alt_text      text,
  source        text NOT NULL DEFAULT 'upload', -- 'upload','stock','ai'
  stock_credit  text,                           -- attribution when required
  uploaded_by   uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON site_assets (site_id, kind);
CREATE INDEX ON site_assets (org_id);

-- ============================================================== AI ==========

CREATE TABLE ai_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id),
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_conversations (site_id, updated_at DESC);

CREATE TABLE ai_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL,               -- 'user','assistant','system'
  content         text,
  tool_calls      jsonb,
  resulting_version_id uuid REFERENCES site_versions(id),
  rejected        boolean NOT NULL DEFAULT false,
  reject_reason   text,                        -- 'schema_invalid','quota','banned_claim','refusal'
  feedback        smallint,                    -- -1 / null / +1
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_messages (conversation_id, created_at);

CREATE TABLE ai_usage (
  id              bigserial PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id         uuid REFERENCES sites(id) ON DELETE SET NULL,
  user_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  action_type     ai_action_type NOT NULL,
  model           text NOT NULL,
  input_tokens    integer NOT NULL DEFAULT 0,
  output_tokens   integer NOT NULL DEFAULT 0,
  cache_read_tokens    integer NOT NULL DEFAULT 0,
  cache_write_tokens   integer NOT NULL DEFAULT 0,
  cost_cents_aud  numeric(10,4) NOT NULL DEFAULT 0,
  latency_ms      integer,
  success         boolean NOT NULL DEFAULT true,
  retry_count     smallint NOT NULL DEFAULT 0,
  error_code      text,
  counts_to_quota boolean NOT NULL DEFAULT true,   -- retries after OUR bug do not
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON ai_usage (org_id, created_at DESC);
CREATE INDEX ON ai_usage (created_at DESC);

-- =========================================================== LEAD CAPTURE ===

CREATE TABLE form_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  form_key      text NOT NULL DEFAULT 'contact',
  payload       jsonb NOT NULL,
  name          text, email citext, phone text, message text,
  source_path   text,
  referrer      text,
  ip_hash       text,                          -- hashed, not raw: APP 3 minimisation
  user_agent    text,
  turnstile_passed boolean NOT NULL DEFAULT false,
  is_spam       boolean NOT NULL DEFAULT false,
  spam_score    numeric(3,2),
  notified_at   timestamptz,
  read_at       timestamptz,
  archived_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON form_submissions (site_id, created_at DESC) WHERE is_spam = false;

CREATE TABLE newsletter_subscribers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  name          text,
  -- Spam Act 2003 evidence of consent
  consented_at  timestamptz NOT NULL,
  consent_text  text NOT NULL,
  consent_ip_hash text,
  unsubscribed_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, email)
);

-- ============================================================ ECOMMERCE =====

CREATE TABLE store_settings (
  site_id             uuid PRIMARY KEY REFERENCES sites(id) ON DELETE CASCADE,
  stripe_account_id   text,                    -- Connect Standard: tenant's own account
  stripe_onboarded_at timestamptz,
  currency            char(3) NOT NULL DEFAULT 'AUD',
  prices_include_gst  boolean NOT NULL DEFAULT true,   -- always true in AU
  abn_on_invoice      char(11),
  pickup_enabled      boolean NOT NULL DEFAULT false,
  pickup_address      jsonb,
  pickup_instructions text,
  local_delivery_enabled boolean NOT NULL DEFAULT false,
  local_delivery_postcodes text[] NOT NULL DEFAULT '{}',
  local_delivery_fee_cents integer,
  local_delivery_min_cents integer,
  order_email_bcc     citext,
  christmas_cutoff_date date,
  christmas_cutoff_message text,
  terms_url           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_categories (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id   uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name      text NOT NULL,
  slug      text NOT NULL,
  position  integer NOT NULL DEFAULT 0,
  is_seasonal boolean NOT NULL DEFAULT false,
  UNIQUE (site_id, slug)
);

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  category_id     uuid REFERENCES product_categories(id) ON DELETE SET NULL,
  kind            product_kind NOT NULL DEFAULT 'physical',
  status          product_status NOT NULL DEFAULT 'draft',
  title           text NOT NULL,
  slug            text NOT NULL,
  description     text,
  price_cents     integer NOT NULL,            -- GST-INCLUSIVE
  compare_at_cents integer,
  compare_at_attested_at timestamptz,          -- ACL: no strikethrough without this
  gst_free        boolean NOT NULL DEFAULT false,   -- fresh unprocessed food etc.
  sku             text,
  track_inventory boolean NOT NULL DEFAULT true,
  inventory_qty   integer NOT NULL DEFAULT 0,
  allow_backorder boolean NOT NULL DEFAULT false,
  weight_grams    integer,
  requires_shipping boolean NOT NULL DEFAULT true,
  -- pre-order / deposit (Christmas hams, whole lamb, custom cakes)
  preorder_collect_from date,
  deposit_cents   integer,
  position        integer NOT NULL DEFAULT 0,
  seo_title       text, seo_description text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, slug),
  CONSTRAINT price_positive CHECK (price_cents >= 0),
  CONSTRAINT compare_at_needs_attestation
    CHECK (compare_at_cents IS NULL OR compare_at_attested_at IS NOT NULL)
);
CREATE INDEX ON products (site_id, status, position);

CREATE TABLE product_variants (              -- ONE axis only in MVP (size OR weight)
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  option_name   text NOT NULL,               -- 'Size'
  option_value  text NOT NULL,               -- '1kg'
  price_cents   integer,                     -- null = inherit
  sku           text,
  inventory_qty integer NOT NULL DEFAULT 0,
  position      integer NOT NULL DEFAULT 0
);
CREATE INDEX ON product_variants (product_id);

CREATE TABLE product_images (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id  uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  asset_id    uuid NOT NULL REFERENCES site_assets(id) ON DELETE CASCADE,
  position    integer NOT NULL DEFAULT 0
);

CREATE TABLE shipping_rates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name          text NOT NULL,               -- 'Standard post (3-6 days)'
  method        fulfilment_method NOT NULL DEFAULT 'shipping',
  price_cents   integer NOT NULL,
  free_over_cents integer,
  applies_to_states text[] NOT NULL DEFAULT '{}',   -- empty = all AU
  position      integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE discount_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  code          citext NOT NULL,
  kind          discount_kind NOT NULL,
  value         integer NOT NULL,            -- percent (1-100) or cents
  min_spend_cents integer,
  starts_at     timestamptz,
  ends_at       timestamptz,
  max_redemptions integer,
  redemption_count integer NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, code)
);

CREATE TABLE store_customers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id       uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  email         citext NOT NULL,
  name          text,
  phone         text,
  marketing_consent boolean NOT NULL DEFAULT false,
  consented_at  timestamptz,
  order_count   integer NOT NULL DEFAULT 0,
  total_spent_cents bigint NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, email)
);

CREATE TABLE orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id         uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  customer_id     uuid REFERENCES store_customers(id) ON DELETE SET NULL,
  order_number    integer NOT NULL,           -- per-site, human friendly
  status          order_status NOT NULL DEFAULT 'pending',
  -- money, all GST-inclusive AUD cents
  subtotal_cents  integer NOT NULL,
  shipping_cents  integer NOT NULL DEFAULT 0,
  discount_cents  integer NOT NULL DEFAULT 0,
  total_cents     integer NOT NULL,
  gst_cents       integer NOT NULL DEFAULT 0, -- the GST component OF the total
  discount_code   text,
  -- fulfilment
  fulfilment      fulfilment_method NOT NULL DEFAULT 'shipping',
  ship_to         jsonb,
  pickup_at       timestamptz,
  -- contact snapshot
  email           citext NOT NULL,
  phone           text,
  customer_name   text,
  notes           text,
  -- stripe
  stripe_account_id text NOT NULL,            -- the tenant's connected account
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id   text UNIQUE,
  paid_at         timestamptz,
  fulfilled_at    timestamptz,
  cancelled_at    timestamptz,
  refunded_cents  integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, order_number)
);
CREATE INDEX ON orders (site_id, created_at DESC);
CREATE INDEX ON orders (site_id, status);

CREATE TABLE order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES products(id) ON DELETE SET NULL,
  variant_id    uuid REFERENCES product_variants(id) ON DELETE SET NULL,
  -- snapshot: a receipt must render correctly forever
  title         text NOT NULL,
  variant_label text,
  sku           text,
  unit_price_cents integer NOT NULL,
  quantity      integer NOT NULL,
  line_total_cents integer NOT NULL,
  gst_free      boolean NOT NULL DEFAULT false,
  image_url     text
);
CREATE INDEX ON order_items (order_id);

-- ============================================================== OPS =========

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES organizations(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  impersonator_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,                  -- 'site.publish','domain.attach','plan.change'
  entity_type text, entity_id uuid,
  before_hash text, after_hash text,
  metadata    jsonb,
  ip_hash     text,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (org_id, created_at DESC);
CREATE INDEX ON audit_log (action, created_at DESC);

CREATE TABLE site_analytics_daily (
  site_id     uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  day         date NOT NULL,
  pageviews   integer NOT NULL DEFAULT 0,
  visitors    integer NOT NULL DEFAULT 0,
  form_submissions integer NOT NULL DEFAULT 0,
  phone_clicks integer NOT NULL DEFAULT 0,
  whatsapp_clicks integer NOT NULL DEFAULT 0,
  orders      integer NOT NULL DEFAULT 0,
  revenue_cents bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, day)
);

CREATE TABLE webhook_events (                  -- idempotency for Stripe/Cloudflare
  id          text PRIMARY KEY,                -- provider event id
  provider    text NOT NULL,
  type        text NOT NULL,
  payload     jsonb NOT NULL,
  processed_at timestamptz,
  error       text,
  attempts    smallint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ================================================== ROW LEVEL SECURITY ======
-- App connects as role `awning_app` and sets app.org_id per transaction.
-- Renderer connects as `awning_render` (BYPASSRLS, read-mostly) because it
-- resolves a tenant by hostname before any org context exists.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sites','site_versions','site_domains','site_assets',
      'ai_conversations','ai_usage','form_submissions','newsletter_subscribers',
      'products','product_categories','orders','store_customers','discount_codes',
      'shipping_rates','setup_fees','subscriptions','memberships']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

CREATE POLICY org_isolation ON sites
  USING (org_id = current_setting('app.org_id', true)::uuid);
CREATE POLICY org_isolation ON site_versions
  USING (site_id IN (SELECT id FROM sites WHERE org_id = current_setting('app.org_id', true)::uuid));
-- ... equivalent policies for each site-scoped table (generated in migration 0002)

-- ==================================================== SEED: plans ===========
INSERT INTO plans (code,name,price_cents_aud,ai_actions_month,ai_hard_cap_cents,
                   max_pages,max_products,storage_mb,custom_domain,ecommerce,
                   remove_branding,is_public,sort_order) VALUES
 ('founding','Founding Member',3900, 400, 600, 10,  0,  500,true ,false,true ,false,0),
 ('business','Business',       4900, 400, 600, 10,  0, 1000,true ,false,true ,true ,1),
 ('store',   'Store',          9900, 800,1200, 20,100, 5000,true ,true ,true ,true ,2);
-- NOTE: no 'starter' and no 'pro'. A A$19 customer consumes the same support as a
-- A$99 one, and a fourth plan is a decision the buyer has to make at the till.
-- See docs/09-GTM-FINANCE.md §2.
