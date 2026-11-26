import PageTabs from '@/components/ui/PageTabs'
import KeywordTabView from './keyword-tab'

// 키워드 관리 (2026-11-26 사용자 결정 — 시안 docs/mockups/통장키워드_관리_시안.html)
// 통장 키워드(vendors.bank_keywords) · 계산서 키워드(vendors.match_aliases) 두 탭, 같은 모양. 서버 로직 lib/keyword-admin.ts
export const dynamic = 'force-dynamic'

export default function KeywordsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === 'invoice' ? 'invoice' : 'bank'
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-slate-900">키워드 관리</h1>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'bank', label: '통장 키워드', href: '/keywords' },
        { key: 'invoice', label: '계산서 키워드', href: '/keywords?tab=invoice' },
      ]} />
      <KeywordTabView key={tab} tab={tab} />
    </div>
  )
}
