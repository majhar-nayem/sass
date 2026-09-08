# Awning — Christmas MVP Feature Plan

Covers brief deliverable 23. **Ships week 8 (by 2 November), not Month 3.** See `01-ROADMAP.md` §1.

---

## 1. Who Christmas is actually for

Segment the target list honestly, because "Christmas features" mean three completely different things:

| Segment | What Christmas means | Willingness to pay | Build cost |
|---|---|---|---|
| **Food & gift retail** — butchers, bakeries, seafood, delis, florists, gift shops, hampers | 30–50% of annual profit lands in three weeks. Pre-orders, deposits, collection slots, delivery cutoffs. | **Very high.** Will pay A$99/mo + A$899 setup in October without hesitation. | High — needs commerce |
| **Hospitality** — restaurants, cafés, caterers | Christmas function bookings, set menus, catering enquiries, altered trading hours. | High. | **Low — this is a form and a PDF menu, not a shopping cart** |
| **Trades & services** — plumbers, sparkies, cleaners | Shutdown dates, emergency callout rates, a pre-Christmas booking rush (cleaners, gardeners before guests arrive). | Low for "Christmas", normal for a website. | Trivial |

**The non-obvious one is hospitality.** A restaurant that needs "Christmas function enquiries, set menu, we're closed 25–26 Dec" needs a form and a landing page — no cart, no Stripe Connect, no inventory. That is the **cheapest Christmas revenue available**, and it is buildable inside the Ship-10 scope. If ecommerce slips, hospitality is still a live Christmas market.

Sell Christmas hardest to retail and hospitality. Sell trades a website that happens to mention the shutdown.

## 2. Feature set

### Components (week 8)
| Component | Variants | Note |
|---|---|---|
| `christmasPromo` | banner · hero · offer-cards · gift-guide | The workhorse |
| `countdown` | — | **Requires a real `endsAt`.** No evergreen timers (ACL) |
| `giftCards` | — | Stripe Checkout, digital delivery, no expiry under ACL |
| `deliveryInfo` | cutoff · zones · pickup | "Order by 20 Dec for Christmas delivery" |
| `openingHours` | holiday-override | SA/VIC/NSW public holidays pre-loaded per state |
| `announcementBar` | festive variant | |
| `newsletter` | christmas variant | "Be first to hear when orders open" |

Decoration (`snow`, `baubles`, `tinsel`, `stars`) is **CSS-only**, respects `prefers-reduced-motion`, and defaults to `none`. Never a canvas loop — it would destroy the mobile performance budget on the busiest traffic day of the year.

### The `apply_christmas_pack` tool

> **Owner:** *"Create a Christmas landing page for my gift shop. Free shipping over $100 and 15% off Christmas gifts until December 20."*

One tool call:

```jsonc
{ "name":"apply_christmas_pack", "input":{
  "preset":"retail-gift",
  "offerText":"15% off all Christmas gifts",
  "discountCode":"XMAS15",
  "freeShippingOverCents":10000,
  "endsAt":"2026-12-20T23:59:00+10:30",
  "deliveryCutoff":"2026-12-18T17:00:00+10:30"
}}
```

Deterministically produces: a `/christmas` page (festive hero → gift-guide → productGrid filtered to the Christmas category → deliveryInfo → countdown → newsletter), a festive announcement bar site-wide, a `XMAS15` discount code, a "Christmas Gifts" product category, delivery-cutoff notices on product and cart pages, holiday trading hours in the footer, and Christmas SEO metadata.

Copy is written by Haiku; the structure is a template. This keeps it fast, cheap and consistent — and it means a broken Christmas page is a template bug you fix once, not a generation lottery.

### Seasonal templates (6, not 7)
`Christmas Butcher & Deli` · `Christmas Bakery & Cakes` · `Christmas Restaurant & Functions` · `Christmas Gift & Homewares` · `Christmas Florist & Hampers` · `Christmas Beauty & Salon`

Each pre-wired with the right structure for its trade — the butcher template leads with pre-orders and a collection date, the restaurant template leads with a function-enquiry form and a set menu, the salon leads with gift vouchers and last-appointment-before-Christmas.

Trades get the Christmas *section pack* (shutdown dates + emergency rates), not a template. They don't want a festive website.

### Auto-expiry — the detail everyone forgets
On **27 December** a cron job flags every site with active Christmas content and emails the owner: *"Want us to take the Christmas banner down? Reply 'yes' and it's done in a minute."* One click removes the pack and restores the previous section arrangement (trivially — it's a `site_versions` restore).

A butcher's site still shouting "Order your Christmas ham!" in February is exactly the kind of thing that makes a customer cancel. This is a ~4-hour build that measurably protects January retention.

## 3. Australian Christmas — the content rules

Encode these in the industry packs, because a US-trained model gets them wrong by default:

- **It is summer.** Prawns, seafood, cold ham, backyard, cricket, stone fruit, pavlova, the beach, 38°C. Never snow, fireplaces, "cosy winter", mulled wine, or a Northern-Hemisphere sweater.
- **"Christmas break" / "shutdown"** — most trades close ~20 Dec to ~13 Jan. Say the actual dates.
- **Public holidays are state-based.** SA: 25, 26 Dec + 1 Jan (+ substitute days when they fall on a weekend). Boxing Day trading rules differ by state.
- **Christmas Eve is the biggest retail day**, not Christmas Day.
- **Pre-orders and collection windows** are how Australian butchers, bakers and seafood shops actually trade in December. Not "add to cart, ship in 5 days".
- Multicultural markets matter in Adelaide: a halal butcher's December is Christmas *and* summer-holiday catering. Don't assume a single festive frame.

## 4. Sales campaign

**Message by segment — the generic one converts worst:**

| Segment | Line |
|---|---|
| Butcher / bakery / seafood | *"Take Christmas orders online instead of on a notepad. Deposits paid up front. Live this week."* |
| Restaurant / café | *"Christmas function enquiries, straight to your inbox. Set menu online by Friday."* |
| Gift / florist / homewares | *"Sell your Christmas range online before the rush. Afterpay included."* |
| Salon / beauty | *"Sell gift vouchers online. People buy them at 11pm on 23 December."* |
| Trades | *"A website in 20 minutes — and it'll tell everyone your shutdown dates."* |

**Offer:** *"We'll build it free. Look at it. Pay A$39/month only if you want to keep it."* Removes every objection at once, and the build is nearly free to you. Pair with the done-for-you setup fee for retail, where the real money is.

**Timeline:** 15–31 Oct first contact · 1–15 Nov close · 15–30 Nov live and indexed · 1 Dec stop selling Christmas.

**Hard promise, made deliberately:** *"Live before December, or you don't pay."* You can make that promise honestly because publishing is a status change. Almost nobody else in the market can.
