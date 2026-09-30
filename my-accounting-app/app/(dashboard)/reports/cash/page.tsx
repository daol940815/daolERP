import PageTabs from '@/components/ui/PageTabs'
import PositionTab from './position-tab'
import DailyTab from './daily-tab'

// 자금 · 계좌 — 계좌 통합현황 / 자금일보 탭 통합 (2026-09-30 UI 2차 정리, 통합 후보 2)
// 옛 주소 /reports/cash-position, /reports/daily-cash 는 각 탭으로 리다이렉트된다.
export default function CashReportPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'daily' ? 'daily' : 'position'
  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">자금 · 계좌</h1>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'position', label: '계좌 통합현황', href: '/reports/cash' },
        { key: 'daily', label: '자금일보', href: '/reports/cash?tab=daily' },
      ]} />
      {tab === 'daily' ? <DailyTab /> : <PositionTab />}
    </div>
  )
}
