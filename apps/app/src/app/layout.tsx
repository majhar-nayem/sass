import type { ReactNode } from 'react'
import '@/styles/globals.css'

export const metadata = { title: 'Awning', description: 'AI websites for Australian small businesses' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  )
}
