import type { IndustryName } from '@awning/spec'

/**
 * Industry packs -- the ~800 tokens of context that make a generated site sound like it
 * was written by someone who has been in the trade, rather than by a model that has read
 * about it. Part of the cached prefix, so they cost ~10% of base input after the first
 * call in a session.
 */
export interface IndustryPack {
  /** How the trade describes itself, in its own words. */
  vocabulary: string[]
  typicalServices: string[]
  /** Ordered: what a visitor to this kind of business needs, in the order they need it. */
  sectionOrder: string[]
  palettes: Array<{ name: string; primary: string; accent: string; secondary: string; neutral: string }>
  fonts: Array<[heading: string, body: string]>
  stockKeywords: string[]
  /** Things that are true of this trade in Australia and a US-trained model gets wrong. */
  notes: string
}

const TRADE_SECTIONS = ['hero', 'services', 'imageText', 'testimonials', 'contact', 'contactForm', 'cta']
const FOOD_SECTIONS = ['hero', 'services', 'imageText', 'testimonials', 'contact', 'cta']

export const INDUSTRY_PACKS: Partial<Record<IndustryName, IndustryPack>> = {
  plumber: {
    vocabulary: ['blocked drains', 'burst pipe', 'hot water', 'gas fitting', 'jet rodding', 'callout', 'on the tools'],
    typicalServices: ['Blocked drains', 'Hot water repairs and replacement', 'Burst pipes', 'Gas fitting', 'Leaking taps', 'Bathroom renovations'],
    sectionOrder: TRADE_SECTIONS,
    palettes: [
      { name: 'trade navy', primary: '#12324A', accent: '#E4622B', secondary: '#F3F5F7', neutral: '#16181A' },
      { name: 'deep teal', primary: '#0F3B3A', accent: '#F0A202', secondary: '#F1F4F3', neutral: '#141716' },
      { name: 'slate red', primary: '#23303B', accent: '#C2352B', secondary: '#F4F4F2', neutral: '#15191C' },
    ],
    fonts: [['Archivo', 'Inter'], ['Bebas Neue', 'Work Sans'], ['Outfit', 'Source Sans 3']],
    stockKeywords: ['plumber van', 'pipe wrench', 'bathroom tap', 'hot water system', 'tradesperson'],
    notes: 'Emergency availability and the suburbs covered matter more than anything else. People search "plumber <suburb>", so service areas earn their place. Most visits are a phone in someone\'s hand while water is on the floor: the number must be reachable in one tap.',
  },
  electrician: {
    vocabulary: ['switchboard', 'safety switch', 'RCD', 'power points', 'downlights', 'rewire', 'level 2'],
    typicalServices: ['Switchboard upgrades', 'Safety switches', 'Power points and lighting', 'Fault finding', 'Ceiling fans', 'Smoke alarms'],
    sectionOrder: TRADE_SECTIONS,
    palettes: [
      { name: 'high vis', primary: '#16233A', accent: '#F2B705', secondary: '#F4F5F7', neutral: '#141618' },
      { name: 'electric blue', primary: '#0B3C8A', accent: '#FF6B35', secondary: '#F2F5FA', neutral: '#13161A' },
    ],
    fonts: [['Archivo', 'Inter'], ['Space Grotesk', 'DM Sans']],
    stockKeywords: ['electrician switchboard', 'power point', 'downlight', 'electrical tools'],
    notes: 'Licensing is genuinely required for electrical work in Australia, which makes it exactly the claim you must not invent. Only state a licence number the owner supplied.',
  },
  butcher: {
    vocabulary: ['cut to order', 'dry aged', 'free range', 'grass fed', 'sausages made in house', 'tray', 'whole lamb'],
    typicalServices: ['Beef and lamb', 'Chicken and pork', 'House-made sausages', 'Marinated and ready to cook', 'Bulk packs', 'Christmas orders'],
    sectionOrder: FOOD_SECTIONS,
    palettes: [
      { name: 'butcher green', primary: '#173B2A', accent: '#C9A227', secondary: '#F5EEDC', neutral: '#1A1A1A' },
      { name: 'deep maroon', primary: '#5A1F25', accent: '#D9A441', secondary: '#F7F1E6', neutral: '#191516' },
    ],
    fonts: [['Playfair Display', 'Inter'], ['Fraunces', 'Work Sans']],
    stockKeywords: ['butcher shop counter', 'fresh meat display', 'sausages', 'butcher cutting'],
    notes: 'Fresh unprocessed meat is GST-free; cooked or marinated product is not, and a Christmas catalogue contains both. December is the year: pre-orders with a deposit and a collection date matter far more than a shopping cart. Halal or organic certification is a real credential — display it only if the owner entered it.',
  },
  cafe: {
    vocabulary: ['single origin', 'all day breakfast', 'house blend', 'dog friendly', 'takeaway', 'batch brew'],
    typicalServices: ['All-day breakfast', 'Lunch', 'Coffee and batch brew', 'Catering and functions', 'Takeaway'],
    sectionOrder: FOOD_SECTIONS,
    palettes: [
      { name: 'warm clay', primary: '#3D2B23', accent: '#C4703A', secondary: '#F6F0E8', neutral: '#1C1714' },
      { name: 'sage', primary: '#2F4739', accent: '#D08C45', secondary: '#F3F2EC', neutral: '#171A18' },
    ],
    fonts: [['Fraunces', 'Inter'], ['Instrument Serif', 'DM Sans']],
    stockKeywords: ['cafe interior', 'flat white', 'brunch plate', 'coffee machine'],
    notes: 'Opening hours and the location are the two things a visitor actually wants. A menu people can read on a phone beats a PDF. Australian coffee vocabulary: flat white, long black, piccolo — never "regular coffee".',
  },
  barber: {
    vocabulary: ['skin fade', 'beard trim', 'hot towel', 'walk-ins', 'clipper cut'],
    typicalServices: ['Haircut', 'Skin fade', 'Beard trim', 'Hot towel shave', 'Kids cuts'],
    sectionOrder: ['hero', 'services', 'imageText', 'testimonials', 'contact', 'cta'],
    palettes: [
      { name: 'monochrome', primary: '#151515', accent: '#B08D57', secondary: '#F2F2F0', neutral: '#0E0E0E' },
      { name: 'oxblood', primary: '#2B1B1E', accent: '#9E3B36', secondary: '#F4F0EC', neutral: '#151011' },
    ],
    fonts: [['Bebas Neue', 'Inter'], ['Archivo', 'Work Sans']],
    stockKeywords: ['barber chair', 'haircut fade', 'barber shop interior', 'clippers'],
    notes: 'Price list and walk-in policy convert. Most bookings happen on a phone in the evening.',
  },
}

export const DEFAULT_PACK: IndustryPack = {
  vocabulary: [],
  typicalServices: [],
  sectionOrder: TRADE_SECTIONS,
  palettes: [{ name: 'neutral', primary: '#1B2A33', accent: '#B8431F', secondary: '#F2F2EF', neutral: '#16181A' }],
  fonts: [['Archivo', 'Inter']],
  stockKeywords: ['small business', 'shopfront'],
  notes: '',
}

export function packFor(industry: string): IndustryPack {
  return INDUSTRY_PACKS[industry as IndustryName] ?? DEFAULT_PACK
}
