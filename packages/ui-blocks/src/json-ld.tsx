import type { BusinessFacts, WebsiteSpec } from '@awning/spec'

/**
 * P-11 -- LocalBusiness structured data.
 *
 * Worth more than most SEO work for this market: it is what puts the phone number,
 * hours and service area into a Google result for "plumber salisbury", which is the
 * search that actually sends a tradie work. Costs a few hours and no runtime weight.
 *
 * Only facts the owner entered. Nothing inferred, nothing invented — a fabricated
 * rating here is the same ACL problem as a fabricated testimonial, with the added
 * detail that Google penalises it separately.
 */
const DAY = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday',
  friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
} as const

export function JsonLd({
  spec,
  business,
  host,
}: {
  spec: WebsiteSpec
  business: BusinessFacts
  host: string
}) {
  const addr = business.address
  const hours = Object.entries(business.openingHours ?? {})
    .filter(([, v]) => v)
    .map(([day, v]) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: DAY[day as keyof typeof DAY] ?? day,
      opens: v!.open,
      closes: v!.close,
    }))

  const data = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: spec.site.businessName,
    ...(spec.site.tagline ? { description: spec.site.tagline } : {}),
    url: `https://${host}`,
    ...(business.phone ? { telephone: business.phone } : {}),
    ...(business.email ? { email: business.email } : {}),
    ...(addr?.suburb
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(addr.line1 ? { streetAddress: addr.line1 } : {}),
            addressLocality: addr.suburb,
            ...(addr.state ? { addressRegion: addr.state } : {}),
            ...(addr.postcode ? { postalCode: addr.postcode } : {}),
            addressCountry: 'AU',
          },
        }
      : {}),
    ...(addr?.lat && addr.lng
      ? { geo: { '@type': 'GeoCoordinates', latitude: addr.lat, longitude: addr.lng } }
      : {}),
    ...(business.serviceAreas.length
      ? { areaServed: business.serviceAreas.map((s) => ({ '@type': 'Place', name: s })) }
      : {}),
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    ...(Object.values(business.socials ?? {}).filter(Boolean).length
      ? { sameAs: Object.values(business.socials).filter(Boolean) }
      : {}),
  }

  return (
    <script
      type="application/ld+json"
      // JSON.stringify escapes nothing dangerous for a JSON-LD block, but `</script>`
      // inside a string would close the tag early, so it is escaped explicitly.
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  )
}
