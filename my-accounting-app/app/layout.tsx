// 루트 레이아웃: HTML 껍데기만 담당
// 인증 상태에 따른 레이아웃 분기는 (dashboard)/layout.tsx와 login/page.tsx에서 처리

import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { cookies } from 'next/headers'
import TopLoader from '@/components/layout/TopLoader'
import { decodeUiPrefs, htmlAttrs, UI_PREFS_COOKIE } from '@/lib/ui-prefs'

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
})
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
})

export const metadata: Metadata = {
  title: 'daolERP - 회계 관리 시스템',
  description: '스마트 회계 관리 시스템',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // 직원별 화면 설정(글자 크기 · 색 테마) — 계정 값의 쿠키 사본을 읽어 첫 화면부터 적용 (깜빡임 없음). 원본은 employees.ui_prefs.
  const ui = htmlAttrs(decodeUiPrefs(cookies().get(UI_PREFS_COOKIE)?.value))
  return (
    <html lang="ko" {...ui}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <TopLoader />
        {children}
      </body>
    </html>
  )
}
