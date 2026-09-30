import PageTabs from '@/components/ui/PageTabs'
import ListTab from './list-tab'
import ClassifyTab from './classify-tab'

// 계산서 내역 — 계산서 목록(매출·매입 × 과세·면세 칩) / 매입 분류 탭 통합 (2026-09-30 UI 2차 정리, 통합 6)
// 옛 주소 /tax-invoices/{sales|purchase}/{taxable|exempt} 는 ?dir=&tax= 칩 상태로,
// /tax-invoices/classify 는 ?tab=classify 로 리다이렉트된다. 딥링크 ?invoiceId= 는 목록 탭이 그대로 읽는다.
// 칩 전환은 목록 탭 안(클라이언트 상태)에서 하고 URL만 맞춘다 — 필터가 유지되도록.
type Dir = 'sales' | 'purchase'
type Tax = 'taxable' | 'exempt'

export default function TaxInvoicesPage({ searchParams }: { searchParams: { tab?: string; dir?: string; tax?: string } }) {
  const tab = searchParams.tab === 'classify' ? 'classify' : 'list'
  const dir: Dir = searchParams.dir === 'purchase' ? 'purchase' : 'sales'
  const tax: Tax = searchParams.tax === 'exempt' ? 'exempt' : 'taxable'
  const listHref = (d: Dir, t: Tax) => `/tax-invoices?dir=${d}&tax=${t}`

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">계산서 내역</h1>
      <PageTabs className="mt-3 mb-3" active={tab} tabs={[
        { key: 'list', label: '계산서 목록', href: listHref(dir, tax) },
        { key: 'classify', label: '매입 분류', href: '/tax-invoices?tab=classify' },
      ]} />
      {tab === 'classify' ? <ClassifyTab /> : <ListTab direction={dir} taxType={tax} />}
    </div>
  )
}
