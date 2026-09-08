# Awning — API, Billing & Ecommerce Architecture

Covers brief deliverables 7 (API), 16 (Stripe billing), 17 (ecommerce).

---

## 1. API architecture

Three surfaces with genuinely different requirements:

| Surface | Style | Auth | Notes |
|---|---|---|---|
| Dashboard | **tRPC** over `/api/trpc` | session cookie + org scope | End-to-end types; no client SDK to maintain |
| Public tenant | **REST** on the renderer | none / Turnstile | Forms, cart, checkout. Must be callable from a cached HTML page |
| Webhooks | **REST** | signature verification | Stripe, Cloudflare |

### tRPC router shape
```
auth.*        me, updateProfile
org.*         get, update, lookupAbn, invite
site.*        create, get, update, publish, unpublish, listVersions, restoreVersion
ai.*          generate, chat (streamed), designDirections, quota
domain.*      list, attach, checkStatus, setPrimary, detach
asset.*       presignUpload, list, delete
form.*        list, markRead, archive, export
product.*     crud, reorder, bulkImportCsv
order.*       list, get, markFulfilled, refund
store.*       getSettings, updateSettings, connectStripe
billing.*     getPlan, createCheckoutSession, createPortalSession, buyAiTopUp
admin.*       (platform admin only) impersonate, forcePublish, overrideQuota
```

Every procedure that touches tenant data goes through `orgProcedure`, which resolves the org from the session, asserts membership, and opens the DB transaction with `SET LOCAL app.org_id`. **There is no other way to get a DB client in app code.** One middleware, enforced by lint rule.

### Public REST endpoints (renderer)
```
POST /api/f/{siteId}/{formKey}     contact form      Turnstile + rate limit + honeypot
POST /api/newsletter/{siteId}      subscribe         consent captured
GET  /api/cart/{siteId}            read cart         signed HttpOnly cookie
POST /api/cart/{siteId}/items      add/update
POST /api/checkout/{siteId}        → Stripe Checkout Session URL
GET  /api/og/{siteId}/{pageId}     dynamic OG image  cached 1 year
GET  /sitemap.xml  /robots.txt     per hostname
POST /api/webhooks/stripe          platform events
POST /api/webhooks/stripe/connect  tenant account events
```

**Idempotency:** every webhook writes to `webhook_events` keyed on the provider event id before processing. Stripe *will* deliver duplicates; a duplicated `checkout.session.completed` that creates two orders and decrements stock twice is the kind of bug that costs a customer.

## 2. Stripe billing (platform → tenant)

Standard Stripe Billing. Nothing clever.

```
Signup (no card)
   └─► 14-day trial, site generatable and previewable, PUBLISH is gated
         └─► "Publish my site" → Stripe Checkout (subscription mode)
               └─► checkout.session.completed webhook
                     └─► subscriptions row → status=active → publish unlocked
```

**Gate publishing, not generation.** Let them see the finished site for free — that is the moment they decide. Asking for a card before they've seen anything kills the funnel; asking after they've seen their own business looking good converts. This one decision is worth more than any pricing tweak.

### Webhooks to handle
| Event | Action |
|---|---|
| `checkout.session.completed` | activate subscription, unlock publish, welcome email |
| `customer.subscription.updated` | plan/quota change, apply proration |
| `invoice.payment_failed` | `past_due`; email day 1, 3, 7; **do not** unpublish |
| `invoice.payment_succeeded` | clear `past_due`, reset AI quota window |
| `customer.subscription.deleted` | grace 7 days → `suspended` → site serves a 402 page |

**Dunning matters more than it sounds at this price point.** Expired cards are the largest involuntary-churn cause for A$49 SaaS. Never take a site offline on the first failure — a tradie whose site vanishes because their card expired will not come back, and they will tell people. 7 days of email, then a banner on the site visible only to the owner, then suspend at 14.

### Australian tax
Enable **Stripe Tax** for AU GST on subscriptions. Awning's invoices must show ABN, the words "Tax Invoice", and the GST component. Store `price_cents_aud` GST-inclusive and market it that way — "A$49/month" to an Australian sole trader means A$49 out of the bank account.

### Founding-member pricing
First 50 customers get A$39/mo locked for 12 months via a distinct Stripe Price with `price_locked_cents` recorded. This is both a genuine urgency lever and a churn brake — leaving means losing the rate.

## 3. Ecommerce: the money never touches the platform

**Stripe Connect Standard.** The tenant connects (or creates) their own Stripe account. Funds settle directly to their bank. Awning creates Checkout Sessions on their behalf via `stripe-account` header.

```ts
const session = await stripe.checkout.sessions.create({
  mode: 'payment',
  line_items,
  payment_method_types: ['card','afterpay_clearpay'],
  shipping_options,
  customer_email,
  success_url, cancel_url,
  metadata: { site_id, cart_id },
}, { stripeAccount: store.stripe_account_id })   // ← funds go to the tenant
```

Why this and not platform-collect-and-remit:

| | Connect Standard | Platform collects |
|---|---|---|
| Who holds the money | The tenant | **You** |
| Regulatory status | Software vendor | Likely a **payment facilitator** — AUSTRAC enrolment, ASIC exposure, possible AFSL, trust-account obligations |
| Refunds & chargebacks | Tenant's problem | **Your** liability |
| Onboarding/KYC | Stripe does it | You'd have to |
| Failed business exits | Nothing owed | You're holding their customers' money |
| Build time | ~3 days | Months, plus legal |

There is no version of platform-collect that is correct for a 3-month MVP by one person. Connect Standard, decided, closed.

*(Take a platform application fee later if you want — Connect supports it — but not in the MVP. A 1% fee on a butcher's Christmas orders buys you a hard conversation and about A$40.)*

### Checkout: hosted, not custom
Stripe Checkout, not Elements. You get Apple Pay, Google Pay, Link, **Afterpay**, 3DS/SCA, address autocomplete, receipt emails and near-zero PCI scope for free. Building a custom checkout is a fortnight you do not have, for a worse conversion rate.

**Afterpay is not optional in Australian gift retail.** Roughly a third of AU under-35 online gift purchases touch a BNPL option; switching it on is one array element.

### GST handling — deliberately simple
- All prices stored and displayed **GST-inclusive**. Never show ex-GST to a consumer.
- `gst_cents` on the order = `round(total × 1/11)` for standard-rated items, computed per line so GST-free lines are excluded.
- `products.gst_free` handles the genuine cases. This matters immediately for Persona B: **fresh, unprocessed meat is GST-free; a cooked or marinated product is not.** A butcher's Christmas catalogue contains both.
- If the tenant isn't GST-registered (turnover < A$75k), `store_settings.abn_on_invoice` is null and receipts omit GST entirely.
- **No tax automation.** Do not build it, do not enable Stripe Tax on Connect for MVP.

### Shipping — four options, no carrier APIs
1. Flat rate (`Standard post — $12`)
2. Free over A$X
3. **Local pickup** (address + instructions) — for a butcher or bakery this is the *primary* method
4. **Local delivery** by postcode list + fee + minimum order

That covers essentially every business in the target market. Live carrier rates, dimensional weight and multi-warehouse are Month 6+.

### The one non-obvious feature to build: pre-orders with deposits
`product_kind = 'preorder'` with `preorder_collect_from` and `deposit_cents`.

Persona B's actual Christmas problem is not "sell products online". It is *"take 200 whole-lamb and gift-box orders in December without losing them off a paper pad, and take a deposit so people actually collect."* Every generic builder does carts; almost none do "pay a A$50 deposit now, collect on 23 December, balance on pickup."

This is a small build (a product kind, a Checkout line item, a pickup date field, a printable pickup list) and it is the difference between "nice website" and "you fixed my December". It is the feature most likely to produce a referral.

### Inventory
Decrement on `checkout.session.completed`, inside the same transaction that creates the order. No reservation during checkout — at 10–100 SKUs and low volume, an occasional oversell is cheaper to handle by hand than a reservation system is to build. Show "only 3 left" below a threshold, allow `allow_backorder` per product.

### Order fulfilment
Deliberately minimal: a list, filters, an order detail, "mark fulfilled", a refund button (full or partial via Connect), a CSV export, and a **printable pickup/delivery run sheet for a date range**. That last one is what a butcher will actually use on 23 December, and no competitor at this price has it.

## 4. Emails

| Email | Trigger | To |
|---|---|---|
| Verify email, welcome | signup | owner |
| Site published 🎉 | first publish | owner |
| **New enquiry** | form submission | owner — *the most valuable email the platform sends* |
| Domain connected | domain → active | owner |
| Domain needs attention | 24h stuck | owner |
| Trial ending (day 11) | cron | owner |
| Payment failed ×3 | webhook | owner |
| Order confirmation | order paid | shopper |
| New order | order paid | owner |
| Christmas cutoff reminder | cron, seasonal | shopper (opted in) |
| Weekly digest: views + enquiries | Monday cron | owner |

Two sending domains: `mail.awning.au` (billing, account) and `send.awningsites.com` (tenant-triggered). Keeps tenant spam complaints away from the reputation of the emails that get you paid. SPF, DKIM and DMARC on both from day one.

The **weekly digest** is a retention feature disguised as an email: "Your site had 240 visits and 6 enquiries this week" is the thing that makes A$49/month feel obviously worth it. Build it in Month 2, not Month 6.
