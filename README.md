# Awning — AI Website & eCommerce Builder for Australian Small Businesses

Planning pack, 8 September 2026. Everything here precedes production code.
Codename **Awning** is a placeholder.

**Read first:** [`docs/10-SHIP10.md`](docs/10-SHIP10.md) — the answer to "what is the smallest
version that gets 10 Australian businesses paying in 3 months?"

## The 28 deliverables

| # | Deliverable | Where |
|---|---|---|
| 1 | Product requirements document | [`docs/00-PRD.md`](docs/00-PRD.md) |
| 2 | MVP feature list | [`docs/00-PRD.md`](docs/00-PRD.md) §6 |
| 3 | 3-month development roadmap | [`docs/01-ROADMAP.md`](docs/01-ROADMAP.md) §2 |
| 4 | System architecture diagram | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §2 |
| 5 | Database ERD | [`docs/03-DATA-MODEL.md`](docs/03-DATA-MODEL.md) §1 |
| 6 | PostgreSQL schema | [`schema/schema.sql`](schema/schema.sql) — validated on PG 16 |
| 7 | API architecture | [`docs/06-COMMERCE-BILLING.md`](docs/06-COMMERCE-BILLING.md) §1 |
| 8 | WebsiteSpecification JSON schema | [`schema/website-spec.schema.json`](schema/website-spec.schema.json) |
| 9 | AI system prompt | [`schema/ai-system-prompt.md`](schema/ai-system-prompt.md) |
| 10 | AI editing / patch strategy | [`docs/04-AI-LAYER.md`](docs/04-AI-LAYER.md) §3 |
| 11 | React component architecture | [`docs/05-COMPONENTS.md`](docs/05-COMPONENTS.md) |
| 12 | Multi-tenant architecture | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §4 |
| 13 | Subdomain architecture | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §5 |
| 14 | Custom-domain architecture | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §6 |
| 15 | Cloudflare integration plan | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §7 |
| 16 | Stripe billing architecture | [`docs/06-COMMERCE-BILLING.md`](docs/06-COMMERCE-BILLING.md) §2 |
| 17 | Ecommerce architecture | [`docs/06-COMMERCE-BILLING.md`](docs/06-COMMERCE-BILLING.md) §3 |
| 18 | Security model | [`docs/07-SECURITY-OPS.md`](docs/07-SECURITY-OPS.md) §1–6 |
| 19 | AI cost-control strategy | [`docs/04-AI-LAYER.md`](docs/04-AI-LAYER.md) §6 |
| 20 | Deployment architecture | [`docs/02-ARCHITECTURE.md`](docs/02-ARCHITECTURE.md) §8 |
| 21 | Monitoring / logging strategy | [`docs/07-SECURITY-OPS.md`](docs/07-SECURITY-OPS.md) §7 |
| 22 | Testing strategy | [`docs/07-SECURITY-OPS.md`](docs/07-SECURITY-OPS.md) §8 |
| 23 | Christmas MVP feature plan | [`docs/08-CHRISTMAS.md`](docs/08-CHRISTMAS.md) |
| 24 | Australian launch strategy | [`docs/09-GTM-FINANCE.md`](docs/09-GTM-FINANCE.md) §1 |
| 25 | Pricing experiment | [`docs/09-GTM-FINANCE.md`](docs/09-GTM-FINANCE.md) §2 |
| 26 | 3-month financial model | [`docs/09-GTM-FINANCE.md`](docs/09-GTM-FINANCE.md) §3 |
| 27 | Risks and mitigation | [`docs/09-GTM-FINANCE.md`](docs/09-GTM-FINANCE.md) §4 |
| 28 | Exact development order | [`docs/01-ROADMAP.md`](docs/01-ROADMAP.md) §3 |
| + | **Implementation plan** — ~80 tickets, hours, deps, acceptance criteria | [`docs/11-IMPLEMENTATION.md`](docs/11-IMPLEMENTATION.md) |

## Verified, not just written

```bash
# schema loads clean on Postgres 16, incl. the ACL check constraints
docker run -d --rm --name pg -e POSTGRES_PASSWORD=x -e POSTGRES_DB=awning postgres:16-alpine
docker exec -i pg psql -U postgres -d awning -v ON_ERROR_STOP=1 < schema/schema.sql
```

```bash
# the spec schema rejects fabricated testimonials, invented components,
# evergreen countdowns, missing alt text, smuggled HTML and javascript: URLs
npm i ajv ajv-formats && node tests/spec-guardrails.mjs
```

## The five decisions that differ from the brief

1. **Tenant sites live on a separate registrable domain** (`awningsites.com`, not `*.platform.com`) — otherwise any tenant page can set cookies on the dashboard's parent domain.
2. **The website spec is one JSONB document, not normalised section rows** — version history and atomic publish come free.
3. **AI edits are constrained tool calls, not JSON Patch** — a wrong array index in a patch string silently corrupts the wrong section.
4. **Christmas ships in week 8, not month 3** — Australian retailers decide in October, and the country closes on 20 December.
5. **Money for tenant sales goes to the tenant's own Stripe account** (Connect Standard) — collecting it yourself makes you a payment facilitator.

## The uncomfortable finding

The full brief is ~610 developer hours against ~455 available in 13 weeks, before a single
hour of selling or support. Estimated again bottom-up in the implementation plan it is worse, not
better: the core alone is **283 h, not 230 h**. The resolution: **weeks 1–7 are unconditional** —
identical in every version of this product — the fork is a week-8 hiring decision that must be made
by 25 September, and demand gets tested in week 5 for six hours. See [`docs/01-ROADMAP.md`](docs/01-ROADMAP.md) §0, and
[`docs/11-IMPLEMENTATION.md`](docs/11-IMPLEMENTATION.md) to start building on Monday.
