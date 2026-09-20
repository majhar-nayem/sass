'use client'
import type { ReactNode } from 'react'
import { AssetContext } from './primitives.js'

/**
 * A Context Provider cannot be rendered from a server component — React needs the
 * provider itself to live on the client, even when its children are server-rendered.
 * SpecRenderer is a server component, so the provider is wrapped here.
 *
 * Worth knowing that renderToStaticMarkup does not enforce the server/client boundary,
 * so the accessibility suite rendered this happily while the real renderer 500'd. Only
 * requesting an actual page caught it.
 */
export function AssetProvider({
  value,
  children,
}: {
  value: Record<string, string>
  children: ReactNode
}) {
  return <AssetContext.Provider value={value}>{children}</AssetContext.Provider>
}
