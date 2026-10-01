import Link from 'next/link'

// 한 화면 안의 탭 줄 — 제목 아래에 두고, 탭은 ?tab= 링크로 전환한다.
// (통합 화면 공용: 기초잔액 · 자금 · 계좌 · 카드 내역 등. docs/ui-reorg-track.md 2차 정리)
export interface PageTab {
  key: string
  label: string
  href: string
}

export default function PageTabs({ tabs, active, className = '' }: { tabs: PageTab[]; active: string; className?: string }) {
  return (
    <div className={`flex gap-1 border-b border-gray-200 ${className}`}>
      {tabs.map(t => {
        const on = t.key === active
        return (
          <Link key={t.key} href={t.href}
            className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
              on ? 'border-slate-900 text-slate-900' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
