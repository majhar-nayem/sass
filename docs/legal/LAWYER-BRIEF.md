# Brief for review

**To the solicitor reviewing this:** the attached drafts were written by the engineer
who built the product, not by a lawyer. They are a starting point to make your review
cheaper, not an attempt to do your job. Please mark them up freely.

This note sets out what the business actually does, then the specific questions we know
we cannot answer ourselves. The law moves; please treat every statutory reference here
as something to verify rather than rely on.

---

## 1. What the business does

Awning is a subscription website builder for Australian small businesses — plumbers,
butchers, cafés, tradespeople. A customer answers seven questions, an AI writes a first
draft of their website, they edit it in plain English, and we host it at either
`<name>.awningsites.com` or a domain they own.

Commercially relevant facts:

- **Our customers are small businesses.** Typically sole traders and businesses with
  fewer than five employees. Target price around A$49–99/month.
- **It is a standard-form contract.** Nobody negotiates. Sign-up is a web form.
- **We hold their customers' personal information.** Enquiry forms capture a member of
  the public's name, phone number, email and message, addressed to the tradesperson.
  For online shops we also hold order and delivery details.
- **Payments**: subscriptions via Stripe Billing. Where a customer sells online, Stripe
  Connect (Standard) — funds go directly to the customer's own Stripe account and never
  touch a balance we control.
- **The content is AI-generated.** That is the product. It is reviewed by the customer
  before publishing, but they are non-expert and many will skim.

---

## 2. The questions

### 2.1 Unfair contract terms — the one we are most worried about

Our customers are small businesses and our contract is standard form, so we understand
the unfair contract terms regime in the Australian Consumer Law applies to us, and that
since the November 2023 amendments a court can impose civil penalties for *proposing* an
unfair term, not merely refuse to enforce it.

We have tried to draft defensively: notice before price rises, cancel-any-time, no
automatic rollover into an unnotified price, a data export on exit, and no unilateral
variation without notice and a right to leave.

**Please tell us which terms remain at risk**, particularly:

- clause 7 (no availability commitment) — is a flat "we do not promise uptime"
  acceptable at this price, or does it need a floor?
- clause 9 (suspension for AUP breach, immediate where content is seriously harmful) —
  is "we decide what is seriously harmful" too broad?
- clause 5 (no pro-rata refund on early cancellation) — is this unfair for an annual
  plan specifically?
- clause 10 (minor changes without notice) — is the minor/material line drawn safely?

### 2.2 Our Privacy Act position — please draft, do not review

We have deliberately not drafted Awning's own privacy policy, because it turns on a
question we cannot answer: whether the small business operator exemption applies to us,
and whether we should opt in regardless.

Relevant facts: turnover will be well under A$3m for at least the first year. But we
hold personal information about members of the public on behalf of our customers, and
that information is the whole point of the product — an enquiry the tradesperson never
receives is a lost job. We expect the exemption is either unavailable or commercially
untenable, and we would rather comply from day one than retrofit.

We would also value a view on the privacy reform currently in train and what it means
for a business at this size starting now.

### 2.3 Offshore disclosure — we found an inconsistency and want it resolved properly

Primary data lives in Sydney (database, object storage, application servers). But:

- **enquiry notification emails go through Resend, a United States provider.** Those
  emails contain the enquirer's name, phone number and message.
- Stripe, our error tracker and the AI provider are also overseas. The AI provider
  receives the business's own content, not enquiry data. The error tracker receives
  scrubbed payloads with personal information removed before sending.

The full list is in `SUBPROCESSORS.md`.

Two things follow, and we would like both confirmed:

1. Our disclosure of enquiry data to a US provider engages APP 8 and the accountability
   that comes with it. What do we need in place — contractual terms with the
   subprocessor, disclosure in the policy, or both?
2. **We had this wrong.** The tenant privacy policy we generate said personal
   information is stored "on secure servers in Australia" and said nothing about
   overseas disclosure. We have corrected the generator, but please check the new
   wording, because it appears on every customer's website and is a representation
   *they* make to *their* customers.

### 2.4 Liability for AI-generated claims

This is the question we would most like a clear answer on, because it shapes the
product and not only the contract.

The AI writes a first draft of a small business's marketing copy. It can produce a
sentence that is misleading — "20 years' experience", "fully licensed", "cheapest in
Adelaide" — about a business whose actual position it does not know. The customer
approves and publishes it.

We have built guardrails: the system refuses to generate testimonials, credentials,
awards, superlatives and countdowns with fabricated deadlines, and validation rejects
them if they somehow appear. A customer can still type anything into the editor.

- Where does liability sit between us and the customer if a published claim is
  misleading under the ACL?
- Does our involvement in generating the text make us a party to the conduct, or
  accessorially liable?
- Do the guardrails help our position, or does building them create an expectation that
  we catch everything? **If they create more exposure than they remove, we would still
  keep them, but we want to know.**
- Is the warning in clause 2 of the terms doing enough work, and should it also appear
  at the moment of publishing rather than only in the terms?

### 2.5 Liability for what customers publish

We host other people's websites on our domain. Please advise on:

- **Defamation.** Post-*Voller* we are conscious that hosting can carry exposure. Does
  the serious harm threshold and the innocent dissemination defence give us adequate
  protection given we have a takedown process?
- **Copyright.** Our understanding is that Australia's safe harbour scheme is narrower
  than the US position and may not extend to a commercial service provider like us.
  Please confirm, and tell us what our takedown process needs to look like to be worth
  having.
- Is `TAKEDOWN-RUNBOOK.md` adequate, and are the timeframes in it sensible?

### 2.6 Smaller items

- **Consumer guarantees.** We understand the ACL "consumer" threshold means our
  business customers are consumers regardless of business use, so the guarantees apply
  and cannot be excluded. Clause 8 is drafted on that basis — please confirm.
- **Stripe Connect.** Funds never touch an account we control. Please confirm this
  keeps us clear of financial services licensing.
- **Spam Act.** We offer a newsletter signup. What do we need to say to customers about
  their obligations, and do we carry any as the sending infrastructure?
- **Company details.** The drafts have placeholders for ABN, registered address and
  contact. Advise on the entity to contract through.
- **Tenant-facing terms.** Does a member of the public who submits an enquiry on a
  customer's site need anything from us, or is the customer's own privacy policy enough?

---

## 3. What we need back, in priority order

1. Awning's privacy policy (drafted by you).
2. Terms of Service marked up — especially the unfair contract terms exposure in §2.1.
3. A written view on §2.4, AI-generated claims. A paragraph is fine; we need to know
   which way to build.
4. Acceptable Use Policy marked up.
5. Whether the takedown runbook is fit for purpose.

Budget is approximately A$1,500. If that does not cover all five, please do them in
that order and tell us what is left.
