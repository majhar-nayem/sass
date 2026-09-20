# Component catalogue (spec v1)

You may only use the components and variants below. A component or variant that does not
appear here does not exist. Props not listed are rejected by the schema.

## hero
variants: minimal | modern | luxury | bold | editorial | split | video | festive
props:
  eyebrow?
  heading
  subheading?
  image?
  primaryCta?
  secondaryCta?
  trustPoints?
  height?
  align?

The first thing a visitor sees. Put the single most valuable action in
primaryCta — for a trade that is almost always the phone number. Use 'split' when there
is a strong photo, 'minimal' when there is not. trustPoints are short factual points
only, never claims about licensing, insurance, awards or years in business unless the
owner supplied them.

defaults by industry: plumber → {"variant":"bold","props":{"height":"medium"}}; electrician → {"variant":"bold"}; beauty → {"variant":"minimal","props":{"height":"tall"}}; butcher → {"variant":"split"}

## services
variants: cards | icons | list | alternating | numbered
props:
  heading?
  subheading?
  columns?
  items

What the business actually does, in the owner's words. Two to six items.
Do not pad to fill a grid. priceFrom must be GST-inclusive and prefixed "From " when
indicative.

## imageText
variants: left | right | stacked | overlap
props:
  heading
  body
  image?
  cta?

The "about us" slot. Short. Who they are, where they are based, why
someone would choose a local independent business. No filler.

## testimonials
variants: cards | quote | carousel | compact
props:
  heading?
  items

ONLY testimonials the owner actually supplied. Never write one yourself,
not as a placeholder and not as an example. If the owner gave you none, omit this
section entirely — a site with no testimonials is fine, a site with invented ones is
illegal.

## countdown
variants: bar | block | inline
props:
  heading
  endsAt
  expiredMessage?
  cta?

Requires a real end date from the owner. If you do not have one, call
ask_user — do not invent a deadline. A fake countdown is misleading conduct under the
Australian Consumer Law.

## contact
variants: details | split | map-split | compact
props:
  heading?
  subheading?
  showPhone?
  showEmail?
  showAddress?
  showHours?
  showServiceAreas?
  showMap?
  note?

Contact details, pulled from the business record rather than written by
you — never type a phone number or address into props. Turn on only what the business
actually has. For a trade, showServiceAreas is worth more than showAddress: people
search "plumber Salisbury", not the office address.

## contactForm
variants: stacked | split | inline
props:
  heading?
  subheading?
  submitLabel?
  successMessage?
  fields

Ask for the least you can. Name, phone and a message converts far better
than eight fields. For trades, add a "job type" select when the services are distinct.

## cta
variants: banner | split | centered | strip
props:
  heading
  subheading?
  primaryCta
  secondaryCta?

One clear action. Verbs, specific: "Call for a free quote", not "Learn more".

