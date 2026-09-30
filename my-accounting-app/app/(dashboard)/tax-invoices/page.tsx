import Link from 'next/link'
import PageTabs from '@/components/ui/PageTabs'
import ListTab from './list-tab'
import ClassifyTab from './classify-tab'

// 계산서 내역 — 계산서 목록(매출·매입 × 과세·면세 칩) / 매입 분류 탭 통합 (2026-09-30 UI 2차 정리, 통합 6)
// 옛 주소 /tax-invoices/{sales|purchase}/{taxable|exempt} 는 ?dir=&tax= 칩 상태로,
// /tax-invoices/classify 는 ?tab=classify 로 리다이렉트된다. 딥링크 ?invoiceId= 는 목록 탭이 그대로 읽는다.
type Dir = 'sales' | 'purchase'
type Tax = 'taxable' | 'exempt'

const DIRS: { key: Dir; label: string }[] = [
  { key: 'sales', label: '매출 (받을 돈)' },
  { key: 'purchase', label: '매입 (줄 돈)' },
]
const TAXES: { key: Tax; label: string }[] = [
  { key: 'taxable', label: '과세 · 세금계산서' },
  { key: 'exempt', label: '면세 · 계산서' },
]

export default function TaxInvoicesPage({ searchParams }: { searchParams: { tab?: string; dir?: string; tax?: string } }) {
  const tab = searchParams.tab === 'classify' ? 'classify' : 'list'
  const dir: Dir = searchParams.dir === 'purchase' ? 'purchase' : 'sales'
  const tax: Tax = searchParams.tax === 'exempt' ? 'exempt' : 'taxable'
  const listHref = (d: Dir, t: Tax) => `/tax-invoices?dir=${d}&tax=${t}`

  const chip = (on: boolean) =>
    `px-3 py-1 rounded-full text-sm border transition-colors ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'}`

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">계산서 내역</h1>
      <PageTabs className="mt-3 mb-3" active={tab} tabs={[
        { key: 'list', label: '계산서 목록', href: listHref(dir, tax) },
        { key: 'classify', label: '매입 분류', href: '/tax-invoices?tab=classify' },
      ]} />
      {tab === 'list' && (
        <div className="flex items-center gap-2 flex-wrap mb-4">
          <span className="text-xs text-gray-400">구분</span>
          {DIRS.map(d => <Link key={d.key} href={listHref(d.key, tax)} className={chip(d.key === dir)}>{d.label}</Link>)}
          <span className="w-px h-5 bg-gray-200 mx-1" />
          <span className="text-xs text-gray-400">종류</span>
          {TAXES.map(t => <Link key={t.key} href={listHref(dir, t.key)} className={chip(t.key === tax)}>{t.label}</Link>)}
        </div>
      )}
      {tab === 'classify' ? <ClassifyTab /> : <ListTab key={`${dir}-${tax}`} direction={dir} taxType={tax} />}
    </div>
  )
}
