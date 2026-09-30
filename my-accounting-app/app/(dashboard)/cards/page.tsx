import PageTabs from '@/components/ui/PageTabs'
import SalesTab from './sales-tab'
import ExpensesTab from './expenses-tab'

// 카드 내역 — 매출(단말기·PG 카드매출) / 법인카드(사용내역) 탭 통합 (2026-09-30 UI 2차 정리, 통합 후보 3)
// 옛 주소 /card-sales, /card-expenses 는 각 탭으로 리다이렉트된다. 사이드바 카드별 바로가기는
// ?tab=expenses&cardAccountId= 로 연결된다.
export default function CardsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'expenses' ? 'expenses' : 'sales'
  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">카드 내역</h1>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'sales', label: '매출 (카드결제)', href: '/cards' },
        { key: 'expenses', label: '법인카드 사용내역', href: '/cards?tab=expenses' },
      ]} />
      {tab === 'expenses' ? <ExpensesTab /> : <SalesTab />}
    </div>
  )
}
