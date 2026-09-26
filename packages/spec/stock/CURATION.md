# Curating the stock pool

The pipeline is built; the photographs are a content task, not an engineering one.

## Why this is not generated

AI image generation costs roughly A$0.04–0.08 an image, at six to ten images a site —
the single largest variable cost in the product — for a result that is worse than a
hand-picked photograph. And a generated "photo of your shopfront" that is not their
shopfront is an Australian Consumer Law problem, not just a quality one.

A real photo of Dave's actual van beats any stock image ever taken, so onboarding should
keep nudging for one. The pool exists so a site does not look empty on day one.

## What to add

Target ~40 per industry for the eight niches being sold into first: plumber,
electrician, cleaner, mechanic, barber, cafe, butcher, bakery. Roughly:

- 12 of the work being done (hands, tools, a van, a counter)
- 10 of the place (shopfront, interior, a bench)
- 8 of the product or result (a finished bathroom, a tray of meat, a coffee)
- 6 people, at work, not posing
- 4 detail shots usable as section backgrounds

Look for photographs that could plausibly be Australian: eucalypts, brick veneer, utes,
harsh light. A Californian sunroom reads as stock the instant a local sees it.

## Adding an entry

Append to `manifest.json`, then run `pnpm stock:ingest`.

```json
{
  "id": "plumber-van-suburban",
  "industries": ["plumber", "electrician"],
  "description": "A tradesperson's van parked outside a suburban brick house",
  "tags": ["van", "suburban", "exterior"],
  "kind": "photo",
  "licence": "unsplash",
  "credit": "Jane Doe on Unsplash",
  "sourceUrl": "https://unsplash.com/photos/...",
  "fetchUrl": "https://images.unsplash.com/photo-...?w=2400"
}
```

`description` becomes the alt text when the model does not write its own, so describe
what is actually in the frame.

## Rules the validator enforces

- An `unsplash` or `pexels` entry must carry a credit and a source URL. Getting
  attribution wrong is the same class of mistake as inventing a testimonial.
- A `generated` entry must be `kind: "texture"`. We do not pass generated images off as
  photographs.
- Ids are unique, and every non-generated entry needs a `fetchUrl`.

`pnpm stock:validate` checks all of this and is wired into CI.
