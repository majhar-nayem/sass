# Awning — React Component Architecture

Covers brief deliverable 11.

---

## 1. One source of truth

The component catalogue is defined **once**, in TypeScript, and everything else is generated from it:

```
packages/spec/src/components/hero.ts        ← the ONLY place hero is defined
        │
        ├──► Zod schema        → runtime validation of AI output
        ├──► JSON Schema       → the AI tool definition (via zod-to-json-schema)
        ├──► TS types          → renderer props, fully typed
        ├──► AI catalogue text → the cached prompt prefix
        └──► Storybook stories → visual regression baseline
```

If these ever drift, the AI proposes props the renderer cannot render, and the failure is silent and visual. Generate, never hand-maintain.

```ts
// packages/spec/src/components/hero.ts
export const hero = defineComponent({
  type: 'hero',
  variants: ['minimal','modern','luxury','bold','editorial','split','video','festive'],
  props: z.object({
    eyebrow:      z.string().max(40).optional(),
    heading:      z.string().min(3).max(70),
    subheading:   z.string().max(200).optional(),
    image:        ImageRef.optional(),
    primaryCta:   Cta.optional(),
    secondaryCta: Cta.optional(),
    trustPoints:  z.array(z.string().max(40)).max(4).optional(),
    height:       z.enum(['compact','medium','tall','full']).default('medium'),
    align:        z.enum(['left','center']).default('left'),
  }),
  // consumed by the AI catalogue generator
  aiGuidance: `The first thing a visitor sees. Put the single most valuable
    action in primaryCta — for a trade that is almost always the phone number.
    'split' when there's a strong photo; 'minimal' when there isn't.
    trustPoints are short factual points only, never claims about licensing,
    insurance or years in business unless supplied by the owner.`,
  industryDefaults: { plumber: { variant: 'bold', height: 'medium' },
                      beauty:  { variant: 'minimal', height: 'tall' } },
})
```

## 2. Repository layout

```
awning/
├─ apps/
│  ├─ app/          Next.js — dashboard, onboarding, chat editor, API
│  ├─ render/       Next.js — the tenant renderer (no auth, no admin code)
│  └─ web/          Next.js — marketing site + industry landing pages
├─ packages/
│  ├─ spec/         component definitions, Zod, spec migrations, validators
│  ├─ ui-blocks/    the rendered React components (the catalogue)
│  ├─ ui-kit/       dashboard-only primitives (shadcn/ui)
│  ├─ db/           Prisma schema, client, withOrgContext
│  ├─ ai/           prompts, tools, router, cost meter, eval harness
│  ├─ integrations/ cloudflare, stripe, resend, r2
│  └─ config/       eslint, tsconfig, tailwind preset
└─ tests/
```

`ui-blocks` must never import from `app` or `render`. It receives props and a theme; it knows nothing about tenants, auth or the database. That constraint is what keeps the renderer fast and the components testable.

## 3. Theming — CSS custom properties, not Tailwind class generation

The naive approach is to generate Tailwind classes from the theme. Don't: Tailwind's JIT cannot see runtime values, so you end up with a safelist of thousands of classes or inline styles everywhere.

Instead the renderer emits one `<style>` block of custom properties per site, and every component uses semantic Tailwind classes bound to those properties.

```tsx
// render/app/_sites/[siteId]/layout.tsx
<style dangerouslySetInnerHTML={{ __html: `:root{
  --brand-primary:${t.primary}; --brand-accent:${t.accent};
  --brand-surface:${t.surface}; --brand-on-primary:${autoContrast(t.primary)};
  --font-heading:'${t.headingFont}'; --radius:${RADIUS[t.radius]};
  --section-y:${DENSITY[t.density]};
}`}} />
```

```js
// tailwind.preset.js
colors: { brand: { DEFAULT: 'var(--brand-primary)', accent: 'var(--brand-accent)' } }
```

```tsx
<button className="bg-brand text-brand-onPrimary rounded-[var(--radius)]">
```

One stylesheet for every tenant, fully CDN-cacheable, themed per site by ~15 inlined custom properties. Theme changes cost nothing at render time.

**Sanitise `t.primary` before interpolation.** It is schema-validated to `^#[0-9a-fA-F]{6}$`, but this is a `dangerouslySetInnerHTML` boundary — re-validate at the render site, because a CSS-injection here is a stored XSS on every tenant page. Cheap insurance.

## 4. The renderer

```tsx
export function SpecRenderer({ spec, page, site }: Props) {
  return (
    <SiteContext.Provider value={{ site, theme: spec.theme }}>
      {spec.globals?.announcementBar && <AnnouncementBar {...} />}
      <Navbar {...spec.nav} />
      <main>
        {page.sections.filter(s => !s.hidden).map(s => (
          <SectionBoundary key={s.id} section={s}>
            <Section section={s} />
          </SectionBoundary>
        ))}
      </main>
      <Footer {...spec.footer} />
      {spec.globals?.whatsappBubble?.enabled && <WhatsAppBubble {...} />}
      {spec.globals?.stickyCallBar?.enabled && <StickyCallBar {...} />}
    </SiteContext.Provider>
  )
}

const REGISTRY = { hero: HeroSection, services: ServicesSection, /* ... */ } as const

function Section({ section }) {
  const C = REGISTRY[section.type]
  if (!C) return null                    // forward-compatible: unknown type renders nothing
  return <C variant={section.variant} {...section.props} />
}
```

Two details that matter:

**`SectionBoundary`** is a React error boundary *per section*. One component throwing on malformed props degrades to a hidden section and a Sentry event — it does not white-screen a customer's live website. In a system where content is machine-generated, this is not optional.

**Unknown types render `null`**, never throw. This is what makes rolling deploys safe: a renderer instance running old code encounters a spec containing a component it doesn't know, and simply omits it, rather than 500-ing every request for that tenant until the deploy finishes.

## 5. Variants — data, not branching

```tsx
// BAD: unreviewable after the fourth variant
if (variant === 'luxury') return <div className="py-32 ...">...

// GOOD
const HERO_VARIANTS = {
  minimal:  { wrap:'py-16 md:py-24', title:'text-4xl md:text-6xl font-medium tracking-tight',
              layout:'stack', showImage:false },
  luxury:   { wrap:'py-28 md:py-44', title:'font-heading text-5xl md:text-7xl tracking-tight',
              layout:'centered', showImage:true, overlay:'gradient' },
  bold:     { wrap:'py-14 md:py-20', title:'text-5xl md:text-7xl font-black uppercase',
              layout:'split', showImage:true, accentBar:true },
  festive:  { wrap:'py-20 md:py-28', title:'font-heading text-4xl md:text-6xl',
              layout:'split', showImage:true, decoration:'baubles' },
} satisfies Record<HeroVariant, HeroStyle>
```

One JSX tree, a style table. Adding a variant is a table row plus a Storybook story. This is what makes "20–30 components/variants in Month 1" achievable by one person.

## 6. Performance budget (enforced in CI)

| Constraint | Rule |
|---|---|
| Server Components by default | Only `Navbar` (mobile menu), `ContactForm`, `Countdown`, `Gallery` lightbox, `Cart` are `'use client'` |
| Client JS per page | ≤ 45 KB gzipped. Lighthouse CI fails the build above it |
| Images | `next/image` → Cloudflare loader, AVIF/WebP, explicit dimensions, `priority` on the hero image only |
| Fonts | Self-hosted, `woff2`, latin subset, `font-display:swap`, preload the two in use. Never `<link>` to Google Fonts — it's a third-party RTT on every tenant page and a privacy issue |
| Animation | CSS only. No animation library. Everything respects `prefers-reduced-motion` |
| Icons | The closed `icon` enum, compiled to one inline SVG sprite. Never a whole icon package |
| Third-party scripts | Zero by default |

Target: **mobile Lighthouse ≥ 85, LCP < 2.5s on 4G.** A tradie's customer is on a phone in a carpark.

## 7. Accessibility as a build-time constraint

WCAG 2.1 AA is cheap now and brutal later, and it protects tenants under the DDA:

- `autoContrast()` picks the foreground for any brand colour and the generation validator rejects palettes that fail 4.5:1 on body text.

> ⚠️ **Bug found by the C-05 gate, worth recording.** The first `autoContrast` chose by a luminance threshold of `0.45`. The real crossover is **0.179**, so every mid-tone colour — the oranges, golds and greens a tradie or a butcher actually picks — got white text. The demo site's own accent (`#E4622B`) was rendering white on orange at **3.45:1**, failing AA on every button. Now it compares both candidate ratios, which has no magic number to get wrong.
>
> Second-order detail from the same fix: the dark candidate must be **pure black, not `#111111`**. With `#111111` the worst case across the colour space is 4.33:1, leaving a band of mid-tone colours where *neither* foreground reaches AA. Pure black lifts the worst case to 4.58:1, so a legible foreground always exists. There is a property test over the colour cube asserting exactly that.
- Semantic landmarks (`header`/`nav`/`main`/`footer`), one `h1` per page, no heading-level skips (validated in the spec, not just the DOM).
- Visible focus rings, never `outline:none`.
- `alt` is required by the schema — a content image without it cannot exist.
- Forms: real `<label>`s, `aria-describedby` on errors, error text not colour-only.
- Tap targets ≥ 44 px.
- `axe-core` runs in Playwright across all 26 components × all variants. Zero violations is the merge gate.

## 8. Build order for the catalogue (Month 1)

**Week 3 — the 12 that ship a tradie site (P0):**
Navbar · Hero · Services · About/ImageText · Gallery · Contact · ContactForm · LocationMap · CTA · Footer · WhatsAppBubble · StickyCallBar

**Week 4 — the next 8 (P0/P1):**
Testimonials · FAQ · OpeningHours · ServiceAreas · AnnouncementBar · Stats · Process · RichText

**Week 5 — commerce + seasonal (P1/P2):**
ProductGrid · ProductCard · FeaturedProducts · Newsletter · ChristmasPromo · Countdown · GiftCards · DeliveryInfo · Pricing · Team · Logos

That is 31 components. With the variant-table pattern and shared primitives (`Section`, `Container`, `Heading`, `Button`, `Image`), a component averages 2–3 hours including Storybook and axe. **~80 hours total** — realistically three weeks of a solo dev's component time, which is why the Ship-10 cut list in `10-SHIP10.md` reduces this to 12.

## 9. Spec migrations

The moment a real customer has a published site, the spec schema is a public API.

```ts
// packages/spec/src/migrations/index.ts
const MIGRATIONS: Record<number, (s: any) => any> = {
  2: s => { s.pages.forEach(p => p.sections.forEach(sec => {
        if (sec.type === 'hero' && sec.props.size) {           // renamed size → height
          sec.props.height = LEGACY_SIZE[sec.props.size]; delete sec.props.size }
      })); s.specVersion = 2; return s },
}
export function migrateSpec(spec) {
  while (spec.specVersion < CURRENT) spec = MIGRATIONS[spec.specVersion + 1](spec)
  return spec
}
```

Run **lazily on read** (so no giant backfill and no downtime) and **eagerly in a nightly job** (so old versions don't accumulate migration debt). Never mutate a stored `site_versions` row — write a new version when a migration changes a published spec, so the owner's history stays honest.
