import PageTabs from '@/components/ui/PageTabs'
import PreStockView from './pre-stock-view'
import SampleStockView from './sample-stock-view'
import ReviewView from './review-view'

export const dynamic = 'force-dynamic'

// 재고 관리 (재고 관리 트랙 1400 — docs/inventory-track.md, 시안 docs/mockups/재고관리_선매입_시안.html)
// 사무실에 있는 물건의 입고 · 출고 · 실사. 재고 수량은 원본(주문 행 · 조정)에서 계산한다.
//  ?tab=pre    선매입 재고 (기본) — ?asof=YYYY-MM-DD 그날 말 기준 (월별 손익 재고 증감 드릴다운)
//  ?tab=sample 샘플 재고 (요아럽, 800 — 기존 화면 그대로)
//  ?tab=review 확인 필요 (2차, 1401) — 재고 있음 · 새로 매입 / 재고 원가 미배정 / 실사 차이
// 부자재 탭은 3차.
export default function StockPage({ searchParams }: { searchParams: { tab?: string; asof?: string; product?: string } }) {
  const tab = searchParams.tab === 'sample' ? 'sample' : searchParams.tab === 'review' ? 'review' : 'pre'
  const tabs = [
    { key: 'pre', label: '선매입 재고', href: '/orders/stock' },
    { key: 'sample', label: '샘플 재고', href: '/orders/stock?tab=sample' },
    { key: 'review', label: '확인 필요', href: '/orders/stock?tab=review' },
  ]
  return (
    <div>
      <div className="mb-3">
        <h1 className="text-2xl font-bold text-slate-900">재고 관리</h1>
        <p className="mt-1 text-[0.8125rem] text-slate-600">사무실에 있는 물건의 입고 · 출고 · 실사. 재고 수량은 원장에서 자동으로 계산합니다.</p>
      </div>
      <PageTabs tabs={tabs} active={tab} className="mb-4" />
      {tab === 'pre'
        ? <PreStockView asof={searchParams.asof ?? null} productId={searchParams.product ?? null} />
        : tab === 'review' ? <ReviewView /> : <SampleStockView />}
    </div>
  )
}
