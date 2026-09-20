# Takedown runbook

> **Draft for legal review.** The timeframes here are a judgement call by an engineer,
> not advice. See `LAWYER-BRIEF.md` §2.5.

What to do when someone reports a site we host. Written down because these arrive
rarely, at a bad moment, and the instinct in the moment is either to ignore it or to
delete everything — and both are wrong.

## The shape of it

Reports arrive at **abuse@awning.au**. Every one gets a reply, even the vexatious ones,
because "we never responded" is the fact that turns a complaint into a problem.

| Category | First response | Action |
|---|---|---|
| Child sexual abuse material | Immediately | Take down without notice. Preserve evidence. Report to the Australian Centre to Counter Child Exploitation. Do not "review" it further than establishing what it is. |
| Credible threat to someone's safety | Immediately | Take down. Contact police. |
| Phishing / malware | Within hours | Take down without notice. Tell the customer after. |
| Defamation claim | 2 business days | Do **not** take down reflexively. See below. |
| Copyright claim | 2 business days | Notify the customer, give them 5 business days to respond or remove. |
| Misleading claims (ACL) | 2 business days | Notify the customer with the specific sentence. Usually fixed in an hour by a phone call. |
| Everything else | 5 business days | Judgement. Write down the reasoning. |

## Taking a site down

```
suspendForAup(db, adminUserId, siteId, reason)
```

It requires a real reason in prose, because the customer is entitled to know what was
removed and why, and it writes to the audit log with the operator's identity. It sets
the site to suspended and bumps the cache epoch so the page stops being served now
rather than when a cache expires.

**It deletes nothing.** A wrong takedown has to be reversible, and if the matter goes
anywhere the content is the evidence. `restoreAfterAup` is the way back, and it is
audited the same way.

## Defamation reports specifically

Resist the reflex to take it down to make the problem go away. A takedown of lawful
criticism is its own problem, and the customer whose site it is has rights too.

- Ask the complainant what exactly is false, in their words, and what harm it caused.
- Put it to the customer and ask them to substantiate it.
- If the customer substantiates it, say no to the complainant and say why.
- If they cannot, ask them to amend it.
- Escalate to the lawyer before refusing a formal concerns notice.

Most of these are a business review dispute between two people who know each other,
and the answer is usually that the content stays and both parties are told so.

## Writing it down

Every report, whatever the outcome, gets a line in the audit log via the suspend or
restore call, or an entry in the abuse mailbox thread where no action was taken. What
we did and why has to be reconstructable a year later by someone who was not there.

## What is not built yet

- There is no in-product abuse report form. The mailbox is the intake.
- There is no automated content scan at publish time. The AI guardrails catch fabricated
  claims at generation, but a customer can type anything into the editor afterwards.
  `docs/07-SECURITY-OPS.md` T12 assumes a publish-time scan; it does not exist.
