---
id: subprocessors
title: Who else handles your data
version: 1
effective: DRAFT — not in force
---

> **Draft for legal review. Not in force. Not legal advice.**

Running a website means other companies are involved. This is all of them, what they
get, and where they are. Customers need this to write their own privacy policy
accurately, and we need it to keep ours honest.

**Kept current.** If a provider on this list changes, the tenant privacy policy
generator changes with it — `packages/spec/src/subprocessors.ts` is the machine-readable
copy and `pnpm gen:legal` checks the two agree.

| Provider | What it handles | Personal information? | Where |
|---|---|---|---|
| Neon | The database — site content, enquiries, orders | **Yes** | Sydney, Australia |
| Fly.io | The servers that run the websites | **Yes**, in transit | Sydney, Australia |
| Cloudflare R2 | Uploaded images and logos | Only if a customer uploads one | Asia-Pacific |
| Cloudflare | DNS, TLS, caching of public pages | No | Global edge |
| Upstash | Cache of which website answers which address | No | Sydney, Australia |
| **Resend** | **Sends enquiry notifications and account email** | **Yes — enquirer name, phone, email, message** | **United States** |
| Stripe | Subscription billing, and customer payments where a shop is enabled | **Yes** — cardholder and order details | Global; Australian entity |
| Anthropic | Generates and edits website copy | The business's own details. **Not** enquiry data. | United States |
| Sentry | Error reports | **No** — personal information is stripped before sending | Per project region |

## The two that matter

**Resend is in the United States.** When someone fills in an enquiry form on a customer's
website, the notification email carrying their name, phone number and message is sent
through a US provider. That is a cross-border disclosure and it must be disclosed — it
is the reason the generated tenant privacy policy no longer claims that everything
stays in Australia.

**Sentry never receives personal information.** Not as a policy, as a mechanism: request
bodies, cookies, query strings and credential headers are removed, and every field is
run through a scrubber, before an event leaves the process
(`packages/integrations/src/observability.ts`, tested in `observability.test.ts`).
Saying "we don't send PII to our error tracker" is worth nothing without that.

## Anthropic and training

Website copy generated for a customer is sent to Anthropic's API. It contains the
business's own description of itself — not their customers' enquiries, which never go
near the AI. Confirm the current API data-retention and training position before this
document goes live.
