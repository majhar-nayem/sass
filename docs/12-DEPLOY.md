# Deployment runbook (F-06)

Two Fly apps in Sydney, one Neon Postgres, one Upstash Redis, one Docker image built
twice. Everything here has been exercised locally against the real image; the parts that
need an account are marked **[needs account]** and are the only untested steps.

```
Dockerfile ──build-arg APP=app────► awning-app     app.awning.au       (dashboard + cron + migrations)
           └─build-arg APP=render─► awning-render  *.awningsites.com   (every customer website)
```

---

## 1. Provision, in this order

Each step depends on the one before it.

### Neon **[needs account]**
Create the project in **ap-southeast-2 (Sydney)**. Anywhere else adds ~150ms to every
query and the renderer makes several per page.

You need **three** connection strings, and they are not interchangeable:

| Variable | Role | Pooled? | Used by |
|---|---|---|---|
| `DATABASE_URL` | owner | yes | renderer, tenant resolution — RLS-exempt by design |
| `APP_DATABASE_URL` | `awning_app` | yes | every authenticated request — **RLS applies** |
| `DIRECT_URL` | owner | **no** | `prisma migrate deploy` only |

`DIRECT_URL` must be unpooled: PgBouncer breaks the advisory lock and the DDL session
that migrations depend on.

The first `prisma migrate deploy` creates the `awning_app` role, without a password —
a migration is version-controlled and a password must never be. Set it out of band,
once, then build `APP_DATABASE_URL` from it:

```sql
ALTER ROLE awning_app PASSWORD '<generate one>';
```

> **The one that bites.** If `APP_DATABASE_URL` is missing or is the owner's string, the
> request path connects as the owner, Postgres exempts owners from RLS, and every tenant
> boundary in the product is off at once — with nothing visibly wrong until one customer
> sees another's data. Both apps now refuse to boot in that state
> (`apps/*/src/instrumentation.ts`), so the machine never joins the pool and Fly keeps
> the previous release serving. Do not "fix" that by removing the check.

### Upstash **[needs account]**
Sydney region, TLS. `REDIS_URL` is the `rediss://` string — ioredis infers TLS from the
scheme. Redis is a cache, not a store: if it is unreachable the renderer resolves
tenants straight from Postgres, which is correct and slower, so the deep health check
reports an absent cache as `off` rather than failing.

### R2, Cloudflare, Stripe, Resend, Anthropic **[needs account]**
Keys go in `.env.production` (gitignored). `.env.example` is the full list.

### Fly **[needs account]**
```bash
fly apps create awning-app    --org <org>
fly apps create awning-render --org <org>
./deploy/secrets.sh awning-app    .env.production
./deploy/secrets.sh awning-render .env.production
```
`secrets.sh` deliberately gives the renderer a smaller set: no Stripe key, no Anthropic
key, no Cloudflare token. It serves public websites and holds no credential it does not
need — a key that is not there cannot leak from there.

---

## 2. Deploy

```bash
./deploy/release.sh          # dashboard, then renderer, then health
```

The dashboard goes first because its `release_command` applies the migrations. A failed
`release_command` aborts the deploy and the old machines keep serving.

Migrations are **expand-only**: add a column, deploy code that writes it, and only drop
the old one a release later. Never ship a destructive migration alongside the code that
stops using the column — with 50 live customer websites, a bad migration at 9pm is the
outage that ends the trial.

**Rollback** is `fly releases rollback -a awning-app`. It rolls back code, not the
database, which is exactly why migrations are expand-only. A customer's site content
rolls back through `site_versions`, which is a product feature.

---

## 3. The scheduled sweep

Domains, dunning and the digest, via `POST /api/cron?job=all` behind `CRON_SECRET`.

```bash
CRON_SECRET=... ./deploy/schedule-cron.sh     # Fly scheduled machine
```

Fly's `--schedule daily` does not let you choose the hour. If the digest has to arrive
at 7am Adelaide, use `.github/workflows/cron.yml` instead and set the repository
variable `CRON_ENABLED=true`. It runs at 20:30 UTC, which is 7:00am ACDT — correct
through the Christmas window, an hour early in winter. Adelaide's half-hour offset plus
daylight saving cannot be expressed in one cron expression.

---

## 4. Health

| Endpoint | Depth | Interval | Purpose |
|---|---|---|---|
| `/api/health` | process only | 15s | liveness — must not depend on anything |
| `/api/health/deep` | both DB roles + cache | 60s | readiness — gates the rolling deploy |

The split is deliberate. A shallow check that touched the database would take every
machine out during one Neon blip; a deploy gated only on a shallow check happily ships a
machine that cannot reach its database.

Beyond this, `runCanaries()` fetches real published tenant hostnames the way a visitor
would — checking `/api/health` only proves the process is up, and when the renderer is
broken every customer's website is broken at once.

---

## 5. Observability (F-11)

### Logs

One JSON object per line on stdout, every line carrying `request_id`. That is what turns
twelve unrelated lines into one story, and it is taken from `x-request-id`, `cf-ray` or
`fly-request-id` when the edge already assigned one, so the two sides of a hop join up.

**There is no Axiom client in the application.** Fly already collects stdout, and a log
shipper is configured once at the platform rather than as a token in every process —
one less credential that can leak from a running machine, and no lost logs when the
shipper is down. To attach Axiom, deploy Fly's log shipper into the org; the app does
not change:

```bash
fly ext log-shipper create      # then choose Axiom and give it the dataset token
```

Query with `request_id`, `org_id`, `site_id`, `service`, `route`, `event`.

### Errors

`reportError()` is the single funnel: it always writes a log line, and additionally
reports to Sentry when a DSN is configured. Tags carry the tenant — `org_id`, `site_id`,
`service`, `route` — because "something threw" is not actionable when fifty businesses
share a renderer.

Without `SENTRY_DSN` nothing is initialised, nothing is sent and nothing is printed.
That is the normal state in development.

### What is deliberately never sent

This platform holds enquiry forms full of names, phone numbers and addresses belonging
to people who gave them to a plumber, not to us. Under the Australian Privacy Principles
those are not ours to forward to an error tracker, and an error tracker is exactly where
they end up by default — inside request bodies, query strings and breadcrumbs.

So: `sendDefaultPii: false`, request bodies and cookies dropped, the query string
stripped from **both** `query_string` and `url`, credential headers redacted, `user`
removed, query and http breadcrumbs stripped of their data, and no session replay on
either app. Every field a caller passes to the logger or to `reportError` goes through
the scrubber whether or not they remembered to.

`scrubEvent()` lives in `packages/integrations/src/observability.ts` rather than in each
app's Sentry config, because it is the privacy boundary of the whole system and it needs
tests rather than good intentions.

---

## 6. What has actually been verified

Run locally against the built image and the Compose database:

- both images build (`app` 643MB, `render` 471MB)
- the renderer container **serves a real tenant website** over HTTP, resolved by `Host`
- `/api/health` and `/api/health/deep` return 200 on both, with `ownerDb`, `appDb` and
  `cache` all reporting ok
- `prisma migrate deploy` runs **from inside the image**, the way Fly's release command
  will
- a container missing `APP_DATABASE_URL` exits 1 and never serves a request

Two defects were found this way and fixed, neither of which any test would have caught:

1. **Next's file tracing does not copy Prisma's query engine** into the standalone
   output. The container booted, passed the shallow health check, and failed every
   request that touched the database. The engine is now staged explicitly into
   `apps/<app>/.prisma`.
2. **The RLS fallback described above**, which was silent by design in development and
   catastrophic in production.

### Observability, verified against a fake ingest

There is no Sentry account, so a local HTTP server stood in for Sentry's ingest endpoint
and the SDK's real network path was exercised against it. With a published site
deliberately made invalid, a request to that tenant produced:

- a log line carrying `request_id`, `service`, `org_id`, `site_id`, `route`, and the
  validation error that caused it
- one Sentry event tagged `org_id`, `site_id`, `service`, `route`, with `request_id` in
  extras — which is F-11's acceptance criterion
- with a request carrying a session cookie, a bearer token and `?email=&token=&phone=`,
  **none of those five values appeared anywhere in the outbound payload**

That last check found a real hole: deleting `event.request.query_string` is cosmetic,
because `event.request.url` carries the identical values and `url` is the copy that
actually gets sent.

It also found the subtler one. **Next bundles `instrumentation.ts` separately from the
server chunks that serve a request**, so a module-scope `const` exists twice with
separate state: the request handler wrote context into one copy and `onRequestError`
read an empty one. Every log line still looked correct and the errors simply arrived
untagged — the exact failure this ticket exists to prevent. The observability state now
lives on `globalThis`, the same way the Prisma clients do.

**Not verified, because it needs accounts:** anything against real Neon, Upstash, Fly or
Cloudflare — TLS to Neon's pooler, Upstash connection limits, Fly's health-gated rolling
deploy, and the `awning_app` role creation running as Neon's `neondb_owner`.

**Also unverified:** anything against real Sentry — quota, rate limiting, source-map
upload, and whether release health works with Fly's machine versions.

**Architecture note:** images are built with `--remote-only` on Fly's amd64 builders.
The local proof above was an arm64 build on Apple silicon, which is why the Prisma
generator lists both Linux targets.
