import type { ReactNode } from 'react'

export const metadata = { title: 'Awning', description: 'AI websites for Australian small businesses' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body
        style={{
          margin: 0,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          background: '#FAFAF7',
          color: '#1B2A33',
        }}
      >
        {children}
      </body>
    </html>
  )
}
