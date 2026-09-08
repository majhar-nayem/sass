import type { ReactNode } from 'react'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body style={{ margin: 0, fontFamily: 'var(--font-body, system-ui, sans-serif)' }}>
        {children}
      </body>
    </html>
  )
}
