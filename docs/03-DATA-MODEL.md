# Awning — Data Model & ERD

Covers brief deliverables 5 and 6. Full DDL in `../schema/schema.sql`.

---

## 1. ERD

```
┌──────────┐
│  users   │
└────┬─────┘
     │ n:m via memberships (role: owner|admin|staff)
     ▼
┌──────────────┐        ┌────────────────┐        ┌──────────────┐
│organizations │───1:1──│ subscriptions  │───n:1──│    plans     │
│  (tenant)    │        └────────────────┘        └──────────────┘
└──────┬───────┘
       │ 1:n  (MVP enforces exactly 1)
       ▼
┌───────────────────────────────────────────────────────────────┐
│                            sites                              │
│  slug · status · draft_version_id · published_version_id      │
└───┬──────┬──────┬──────┬───────┬───────┬───────┬───────┬──────┘
    │      │      │      │       │       │       │       │
    │      │      │      │       │       │       │       └─► site_analytics_daily
    │      │      │      │       │       │       └─► form_submissions
    │      │      │      │       │       └─► ai_conversations ─► ai_messages
    │      │      │      │       └─► site_assets
    │      │      │      └─► site_domains        (hostname state machine)
    │      │      └─► site_versions              (spec_json, immutable, the source of truth)
    │      └─► products ─► product_variants
    │                   └─► product_images
    └─► orders ─► order_items
             └─► store_customers
    └─► discount_codes
    └─► shipping_rates
    └─► store_settings   (1:1, Stripe Connect acct, GST, pickup address)

┌───────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ templates │   │ ai_usage     │   │ audit_log    │   │ jobs (BullMQ │
│ (seed)    │   │ (metered)    │   │              │   │  in Redis)   │
└───────────┘   └──────────────┘   └──────────────┘   └──────────────┘
```

## 2. The one decision that matters: spec-as-document, not spec-as-rows

The brief lists `site_pages`, `site_sections`, `site_content` as separate tables. **Don't do that in the MVP.**

Store the entire website as one validated JSON document in `site_versions.spec_json` (JSONB), and keep `sites.draft_version_id` / `sites.published_version_id` as pointers.

| | Normalised rows | **Single JSONB spec** |
|---|---|---|
| Load a page to render | 5–8 joins, N+1 risk | 1 row, 1 index hit |
| Undo / version history | Shadow tables for every entity — genuinely painful | Insert a row. Done. |
| Atomic publish | Multi-table transaction, partial-publish bugs | One pointer update |
| AI patch application | Row-level diffing across 4 tables | Apply patch to an object in memory, validate, insert new version |
| Schema evolution | A migration per component prop change | A versioned spec migration function, run lazily |
| Query "all sites using hero-luxury" | Easy SQL | `jsonb_path_exists` + GIN index — still easy |
| Two people editing at once | Row-level | Optimistic lock on `sites.draft_version_id` (fine — these are sole traders) |

The normalised model is the right answer for a mature product with a visual editor and collaborative editing. It is the wrong answer for a 3-month MVP where **version history and atomic publish are P0 features** and the JSONB model gives you both for free.

Products, orders and form submissions *are* relational and belong in real tables — they are queried, aggregated, and touched by systems other than the renderer. The spec references products by ID; it does not embed them.

**Escape hatch:** GIN index on `spec_json` from day one, so analytics queries over specs stay possible without a rewrite.

## 3. Key tables and why they look like that

### `site_versions` — immutable, append-only
Every generation and every accepted AI edit inserts a row. Never updated, never deleted (prune >90 days old and >50 versions deep with a nightly job). Carries `parent_version_id` so history is a chain, `created_by` (`user | ai | system | template`), the `patch_json` that produced it, and the natural-language `summary` shown in the history UI ("Changed colours to dark green and gold").

`spec_version` (integer) records which spec schema generation the document conforms to, so `migrateSpec()` can upgrade old documents lazily at read time.

### `site_domains` — one row per hostname, not per domain
`www.dave.com.au` and `dave.com.au` are two rows pointing at the same site, one flagged `is_primary`. The non-primary 301s. Includes `kind` = `subdomain | custom`, the full state enum, the Cloudflare hostname id, and human-readable error text (see `02-ARCHITECTURE.md` §6).

### `ai_usage` — metered per action, not per token only
Row per AI call: org, site, `action_type` (`generate | edit | rewrite | seo | image_prompt`), model, input/output/cache tokens, computed `cost_cents_aud`, latency, `success`, `retry_count`. This table powers the quota check, the circuit breaker, the per-customer margin report, and the "which prompt is expensive" investigation. Partition by month once it gets big; it won't in 3 months.

### `products` — GST-inclusive integer cents
`price_cents` is the **GST-inclusive** price the customer pays, always. `compare_at_cents` is nullable and requires `compare_at_attested_at` to be non-null before the renderer will show a strikethrough (ACL). `gst_free` boolean for the genuine cases (most fresh unprocessed food — relevant for Persona B the butcher: fresh meat is GST-free, cooked/prepared items are not).

**Never store money as float.** Integer cents, AUD only in MVP.

### `orders` — snapshot everything
An order stores the product name, price and GST at time of purchase as denormalised columns, not just a product FK. Prices change; a receipt from November must still render in March. Includes `stripe_checkout_session_id`, `stripe_payment_intent_id`, and the Connect `stripe_account_id` that received the funds.

### `form_submissions` — the feature tradies actually pay for
Store the payload as JSONB plus extracted `email`/`phone`/`name` columns for the inbox UI. Retain 24 months, then purge (Privacy Act minimisation). Includes `spam_score`, `turnstile_passed`, source page, referrer, and `notified_at`.

### `audit_log`
Actor, org, action, entity, before/after hash, IP, user agent. Needed the first time a customer says "I never deleted that page" — and needed for the impersonation feature so support access is accountable.

## 4. Indexing plan (the ones that will actually matter)

```sql
-- hot path: every single tenant request
CREATE UNIQUE INDEX ON site_domains (hostname) WHERE status = 'active';
CREATE INDEX ON sites (published_version_id);

-- version history UI
CREATE INDEX ON site_versions (site_id, created_at DESC);

-- spec introspection ("which sites use component X")
CREATE INDEX ON site_versions USING GIN (spec_json jsonb_path_ops);

-- quota enforcement, called before every AI action
CREATE INDEX ON ai_usage (org_id, created_at DESC);

-- storefront
CREATE INDEX ON products (site_id, status, position);
CREATE INDEX ON orders (site_id, created_at DESC);
CREATE UNIQUE INDEX ON orders (stripe_checkout_session_id);

-- inbox
CREATE INDEX ON form_submissions (site_id, created_at DESC) WHERE is_spam = false;
```

## 5. Row-Level Security

Enable RLS on every org-scoped table as **defence in depth** — the application always scopes by `org_id` anyway, but RLS is what saves you the day someone forgets a `where` clause in a hand-written query at 1am.

```sql
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_isolation ON sites
  USING (org_id = current_setting('app.org_id', true)::uuid);
```

With Prisma this requires a transaction-scoped `SET LOCAL app.org_id = '...'` on the same connection. Wrap it once in a `withOrgContext(orgId, fn)` helper and make it the only way app code gets a DB client. The renderer uses a separate, read-mostly DB role that can bypass RLS for published content only (it resolves tenants by hostname before any org is known).

## 6. Data retention

| Data | Retention | Reason |
|---|---|---|
| `site_versions` | 90 days or last 50, whichever is greater | Undo is only useful recently; storage is cheap but not free |
| `form_submissions` | 24 months, then hard delete | APP 11.2 — destroy when no longer needed |
| `orders` / `order_items` | 7 years | ATO record-keeping obligation |
| `ai_messages` | 12 months | Debugging + eval corpus |
| `ai_usage` | 7 years (aggregated after 12 months) | Financial records |
| `audit_log` | 24 months | |
| Deleted account | 30-day soft delete, then purge; sites 404 immediately | Gives you a recovery window for accidental cancellations |
