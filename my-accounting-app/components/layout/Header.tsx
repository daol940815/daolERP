'use client'

import { usePathname } from 'next/navigation'

// 경로별 페이지 제목 매핑
const pageTitles: Record<string, string> = {
  '/':              '대시보드',
  '/transactions':  '거래 내역',
  '/upload':        '파일 업로드',
  '/journal':       '분개 현황',
  '/ledger':        '계정별 원장',
  '/accounts':      '계정과목',
  '/settings':      '설정',
}

export default function Header() {
  const pathname = usePathname()

  // 현재 경로에 맞는 제목 가져오기 (매칭 없으면 빈 문자열)
  const title = pageTitles[pathname] ?? ''

  // 오늘 날짜를 한국어 형식으로 표시
  const today = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  })

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-6">
      {/* 페이지 제목 */}
      <h2 className="text-base font-semibold text-slate-800">
        {title}
      </h2>

      {/* 오늘 날짜 */}
      <span className="text-sm text-slate-500">{today}</span>
    </header>
  )
}
