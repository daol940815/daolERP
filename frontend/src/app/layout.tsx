import type { Metadata } from 'next'
import './globals.css'
import Providers from './providers'

export const metadata: Metadata = {
  title: 'FinBook - 경리 관리 시스템',
  description: '금융거래 통합 조회 및 관리',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
