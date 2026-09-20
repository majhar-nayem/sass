import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
// From the generated module, not the package barrel: the barrel pulls in tRPC,
// Stripe and node:crypto, none of which a page rendering static text needs — and
// webpack refuses to bundle node:crypto for this entry at all.
import { LEGAL_DOCUMENTS, legalDocument } from '@awning/api/legal-documents'

/**
 * O-05b -- the terms, readable without an account.
 *
 * Terms nobody can read before signing up are not terms anyone agreed to, and the
 * version and hash are shown because this page is the thing an acceptance record
 * points at.
 */
export function generateStaticParams() {
  return LEGAL_DOCUMENTS.map((d) => ({ doc: d.id }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>
}): Promise<Metadata> {
  const doc = legalDocument((await params).doc)
  return doc ? { title: `${doc.title} — Awning` } : { title: 'Not found' }
}

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const doc = legalDocument((await params).doc)
  if (!doc) return notFound()

  return (
    <main className="mx-auto max-w-[68ch] px-6 py-16">
      <article className="legal-prose">
        {renderMarkdown(doc.body)}
      </article>
      <hr className="my-10 border-neutral-200" />
      <p className="text-sm text-neutral-500">
        Version {doc.version}. This is the text recorded against your acceptance —
        reference <code className="font-mono">{doc.sha256.slice(0, 12)}</code>.
      </p>
    </main>
  )
}

/**
 * A deliberately small Markdown subset rather than a dependency.
 *
 * These documents are ours, their shape is known, and the input is not user-supplied,
 * so nothing here interpolates HTML.
 */
function renderMarkdown(md: string) {
  const blocks = md.split(/\n{2,}/)
  return blocks.map((block, i) => {
    const b = block.trim()
    if (!b) return null
    if (b.startsWith('> ')) {
      return (
        <blockquote key={i} className="my-6 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-sm">
          {inline(b.replace(/^> ?/gm, ''))}
        </blockquote>
      )
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(b)
    if (h) {
      const level = h[1]!.length
      const text = inline(h[2]!)
      const cls = ['text-3xl font-semibold mt-0 mb-6', 'text-xl font-semibold mt-10 mb-3', 'text-base font-semibold mt-7 mb-2', 'text-base font-semibold mt-6 mb-2'][level - 1]
      if (level === 1) return <h1 key={i} className={cls}>{text}</h1>
      if (level === 2) return <h2 key={i} className={cls}>{text}</h2>
      if (level === 3) return <h3 key={i} className={cls}>{text}</h3>
      return <h4 key={i} className={cls}>{text}</h4>
    }
    if (/^[-*] /.test(b)) {
      return (
        <ul key={i} className="my-4 list-disc space-y-1.5 pl-6">
          {b.split('\n').map((li, j) => (
            <li key={j}>{inline(li.replace(/^[-*] /, ''))}</li>
          ))}
        </ul>
      )
    }
    return <p key={i} className="my-4 leading-relaxed">{inline(b)}</p>
  })
}

/** Bold, code and links — the only inline markup these documents use. */
function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g)
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i} className="rounded bg-neutral-100 px-1 py-0.5 font-mono text-[0.9em]">{p.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p)
    if (link) {
      const href = link[2]!.replace(/^\.\//, '/legal/').replace(/\.md$/, '').toLowerCase()
      return <a key={i} className="text-[#B8431F] underline" href={href}>{link[1]}</a>
    }
    return <span key={i}>{p}</span>
  })
}
