import { describe, expect, it } from 'vitest'
import { findSection, setTextAtPath, type WebsiteSpec } from '@awning/spec'
import { applyEditTools, editToolDefinitions, EDIT_TOOL_SCHEMAS, type EditToolCall } from '../edit-tools.js'
import { buildDigest, relevantSections } from '../digest.js'
import { classifyIntent } from '../router.js'
import { summariseChanges } from '../edit.js'

const spec = (): WebsiteSpec =>
  JSON.parse(
    JSON.stringify({
      specVersion: 1,
      site: { businessName: "Dave's Plumbing", industry: 'plumber', style: 'bold-trade', tone: 'direct', locale: 'en-AU', currency: 'AUD', showAbnInFooter: true },
      theme: { primary: '#12324A', secondary: '#F3F5F7', accent: '#E4622B', neutral: '#16181A', headingFont: 'Archivo', bodyFont: 'Inter', radius: 'sm', density: 'comfortable', shadow: 'subtle', buttonStyle: 'solid', darkMode: false },
      nav: { variant: 'simple', showPhone: true, items: [{ label: 'Services', href: '#services' }] },
      pages: [
        {
          id: 'home',
          path: '/',
          title: 'Plumber in Salisbury',
          seo: { title: 'Plumber in Salisbury', description: 'Blocked drains across northern Adelaide.', noindex: false },
          sections: [
            {
              id: 'hero-main', type: 'hero', variant: 'bold', hidden: false, background: 'default', spacing: 'lg',
              props: {
                heading: 'Blocked drains cleared today',
                subheading: 'Two vans across northern Adelaide.',
                primaryCta: { label: 'Call 08 8123 4567', href: 'tel:0881234567', style: 'primary', icon: 'phone' },
                trustPoints: ['Upfront pricing', 'Open 7 days'],
                height: 'medium', align: 'left',
              },
            },
            {
              id: 'services-1', type: 'services', variant: 'cards', hidden: false, background: 'surface', spacing: 'lg', anchor: 'services',
              props: { heading: 'What we do', columns: 3, items: [{ title: 'Blocked drains', description: 'Jet rodding.' }, { title: 'Hot water', description: 'Repairs.' }] },
            },
          ],
        },
      ],
    }),
  )

const call = (name: string, input: Record<string, unknown>): EditToolCall =>
  ({ name, input }) as EditToolCall

describe('applyEditTools', () => {
  it('never mutates the spec it was given', () => {
    const original = spec()
    const before = JSON.stringify(original)
    applyEditTools(original, [call('set_theme', { patch: { primary: '#173B2A' } })])
    expect(JSON.stringify(original)).toBe(before)
  })

  it('applies a theme change', () => {
    const r = applyEditTools(spec(), [
      call('set_theme', { patch: { primary: '#173B2A', accent: '#C9A227' } }),
    ])
    expect(r.spec.theme.primary).toBe('#173B2A')
    expect(r.applied[0]?.summary).toBe('Updated the colours')
  })

  /**
   * The failure the whole tool-call design exists to prevent. A JSON Patch pointer with
   * a stale array index silently rewrites a different section; addressing by id cannot.
   */
  it('changes only the section it was asked to', () => {
    const r = applyEditTools(spec(), [
      call('update_section', { sectionId: 'hero-main', props: { height: 'compact' } }),
    ])
    const hero = findSection(r.spec, 'hero-main')!.section.props as { height: string; heading: string; subheading: string }
    expect(hero.height).toBe('compact')
    expect(hero.heading).toBe('Blocked drains cleared today')
    expect(hero.subheading).toBe('Two vans across northern Adelaide.')
    expect(findSection(r.spec, 'services-1')!.section.props).toEqual(
      findSection(spec(), 'services-1')!.section.props,
    )
  })

  /** Shallow-assigning props is the obvious implementation and it deletes siblings. */
  it('deep-merges props instead of replacing them', () => {
    const r = applyEditTools(spec(), [
      call('update_section', { sectionId: 'hero-main', props: { primaryCta: { label: 'Ring Dave' } } }),
    ])
    const cta = (findSection(r.spec, 'hero-main')!.section.props as { primaryCta: Record<string, string> }).primaryCta
    expect(cta.label).toBe('Ring Dave')
    expect(cta.href).toBe('tel:0881234567') // preserved
    expect(cta.icon).toBe('phone')
  })

  it('rejects an unknown section without touching anything else', () => {
    const r = applyEditTools(spec(), [
      call('update_section', { sectionId: 'hero-main', props: { height: 'tall' } }),
      call('update_section', { sectionId: 'does-not-exist', props: { height: 'tall' } }),
    ])
    expect(r.applied).toHaveLength(1)
    expect(r.rejected).toHaveLength(1)
    expect(r.rejected[0]?.reason).toMatch(/does-not-exist/)
  })

  it('rejects an invented variant', () => {
    const r = applyEditTools(spec(), [
      call('update_section', { sectionId: 'hero-main', variant: 'parallax' }),
    ])
    expect(r.applied).toHaveLength(0)
    expect(r.rejected[0]?.reason).toMatch(/not a variant of hero/)
  })

  it('rejects an invented component type', () => {
    const r = applyEditTools(spec(), [
      call('add_section', { pageId: 'home', type: 'parallaxHero', variant: 'cool', props: {} }),
    ])
    expect(r.rejected).toHaveLength(1)
    expect(r.applied).toHaveLength(0)
  })

  it('rejects a section whose props do not satisfy its schema', () => {
    const r = applyEditTools(spec(), [
      call('add_section', { pageId: 'home', type: 'countdown', variant: 'bar', props: { heading: 'Hurry!' } }),
    ])
    expect(r.rejected[0]?.reason).toMatch(/endsAt/)
  })

  /** ACL: a testimonial the model authored itself must not survive the tool layer. */
  it('rejects an AI-authored testimonial', () => {
    const r = applyEditTools(spec(), [
      call('add_section', {
        pageId: 'home', type: 'testimonials', variant: 'cards',
        props: { items: [{ quote: 'Best plumber in Adelaide, fast and tidy.', author: 'Sarah M.' }] },
      }),
    ])
    expect(r.applied).toHaveLength(0)
    expect(r.rejected[0]?.reason).toMatch(/source/)
  })

  it('accepts a testimonial the owner supplied', () => {
    const r = applyEditTools(spec(), [
      call('add_section', {
        pageId: 'home', type: 'testimonials', variant: 'cards',
        props: { items: [{ quote: 'Came out the same afternoon and sorted it.', author: 'Sarah M.', source: 'customer_supplied' }] },
      }),
    ])
    expect(r.applied).toHaveLength(1)
  })

  it('does three things and reports the one it could not', () => {
    const r = applyEditTools(spec(), [
      call('set_theme', { patch: { primary: '#173B2A' } }),
      call('update_section', { sectionId: 'hero-main', props: { height: 'compact' } }),
      call('toggle_section', { sectionId: 'services-1', hidden: true }),
      call('remove_section', { sectionId: 'nope' }),
    ])
    expect(r.applied).toHaveLength(3)
    expect(r.rejected).toHaveLength(1)
    expect(summariseChanges(r)).toMatch(/and/)
  })

  it('gives added sections unique ids', () => {
    let s = spec()
    for (let i = 0; i < 3; i++) {
      const r = applyEditTools(s, [
        call('add_section', { pageId: 'home', type: 'cta', variant: 'banner', props: { heading: 'Call us', primaryCta: { label: 'Call', href: 'tel:0881234567', style: 'primary', icon: 'phone' } } }),
      ])
      s = r.spec
    }
    const ids = s.pages[0]!.sections.map((x) => x.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('surfaces a question instead of editing', () => {
    const r = applyEditTools(spec(), [
      call('ask_user', { question: 'When does the offer finish?', options: ['20 December', '24 December'] }),
    ])
    expect(r.applied).toHaveLength(0)
    expect(r.question?.question).toMatch(/finish/)
  })

  it('surfaces a refusal as an explanation', () => {
    const r = applyEditTools(spec(), [
      call('explain', { message: "I can't write reviews customers didn't leave." }),
    ])
    expect(r.explanation).toMatch(/can't write reviews/)
  })

  /** A partial reorder list must not delete the sections it omits. */
  it('keeps omitted sections when reordering', () => {
    const r = applyEditTools(spec(), [
      call('reorder_sections', { pageId: 'home', sectionIds: ['services-1'] }),
    ])
    expect(r.spec.pages[0]!.sections.map((s) => s.id)).toEqual(['services-1', 'hero-main'])
  })

  it('exposes a tool definition for every schema', () => {
    const defs = editToolDefinitions()
    expect(defs.map((d) => d.name).sort()).toEqual(Object.keys(EDIT_TOOL_SCHEMAS).sort())
    for (const d of defs) expect(d.description, `${d.name} has no description`).toBeTruthy()
  })
})

describe('the fast path', () => {
  it('sets a nested text field by path', () => {
    const s = setTextAtPath(spec(), 'services-1', 'items.0.title', 'Blocked drains & sewers')
    expect((findSection(s, 'services-1')!.section.props as { items: Array<{ title: string }> }).items[0]!.title).toBe(
      'Blocked drains & sewers',
    )
  })

  it('refuses a path that does not exist rather than creating it', () => {
    expect(() => setTextAtPath(spec(), 'hero-main', 'nonsense', 'x')).toThrow(/does not exist/)
  })

  it('refuses to overwrite a non-text field', () => {
    expect(() => setTextAtPath(spec(), 'hero-main', 'primaryCta', 'x')).toThrow(/not a text field/)
  })
})

describe('the digest', () => {
  it('names every section with its type, variant and a snippet', () => {
    const d = buildDigest(spec())
    expect(d).toMatch(/hero-main \(hero\/bold\)/)
    expect(d).toMatch(/Blocked drains cleared today/)
    expect(d).toMatch(/services-1 \(services\/cards\)/)
  })

  /** The whole point: a fraction of the tokens of the full document. */
  it('is far smaller than the specification it describes', () => {
    const s = spec()
    expect(buildDigest(s).length).toBeLessThan(JSON.stringify(s).length / 2)
  })

  it('finds the section the owner is talking about', () => {
    expect(relevantSections(spec(), 'make the hero smaller')[0]?.id).toBe('hero-main')
    expect(relevantSections(spec(), 'add another service')[0]?.id).toBe('services-1')
    expect(relevantSections(spec(), 'change the banner at the top')[0]?.id).toBe('hero-main')
  })

  it('falls back to something concrete when nothing matches', () => {
    expect(relevantSections(spec(), 'zzzz qqqq')).toHaveLength(1)
  })
})

describe('intent routing', () => {
  it.each([
    ['undo', 'undo'],
    ['undo that', 'undo'],
    ['change it back', 'undo'],
  ])('%s -> undo', (msg) => expect(classifyIntent(msg).kind).toBe('undo'))

  it.each([
    'make the hero smaller',
    'change the colours to dark green and gold',
    'add a Christmas banner',
    'remove the reviews section',
  ])('"%s" is an edit', (msg) => {
    const i = classifyIntent(msg)
    expect(i.kind).toBe('edit')
    expect(i.kind === 'edit' && i.confidence).toBe('high')
  })

  it.each([
    'rewrite the about section to sound warmer',
    'this copy sounds too formal',
    'make it sound more friendly',
  ])('"%s" is a rewrite', (msg) => expect(classifyIntent(msg).kind).toBe('rewrite'))

  it.each(['how do I connect my domain?', 'what does publishing do?'])(
    '"%s" is a question',
    (msg) => expect(classifyIntent(msg).kind).toBe('question'),
  )

  /** A question in form but an instruction in substance. */
  it('treats "can you make the hero smaller?" as an edit, not a question', () => {
    expect(classifyIntent('can you make the hero smaller?').kind).toBe('edit')
  })
})
