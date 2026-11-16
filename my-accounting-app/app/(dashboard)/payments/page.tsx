import PageTabs from '@/components/ui/PageTabs'
import { createAdminClient } from '@/lib/supabase-server'
import MatchTab from './match-tab'
import DepositsTab from './deposits-tab'
import GuideTab from './guide-tab'
import InvoiceTab from './invoice-tab'

// 결제 확인 — 탭 4개 통합 (2026-11-16 3단계, 시안 docs/mockups/결제확인_통합_시안.html)
//   매칭 대기(결제 기록 ↔ 원본 대조) / 기록 없는 입금(전 입금 매칭 /erp-matching) /
//   결제 안내 대상(전 수금 대상 → 주문 단위 작업 목록) / 계산서 확인(전 계산서 발행 대상 → 확인 목록)
// 옛 주소는 리다이렉트 스텁으로 남긴다(쿼리 보존).
export const dynamic = 'force-dynamic'

const TABS = ['match', 'deposits', 'guide', 'invoice'] as const
type TabKey = typeof TABS[number]

// 탭 이름에 붙는 매칭 대기 건수 (1300 미적용이면 생략)
async function countPending(): Promise<number | null> {
  try {
    const { count, error } = await createAdminClient().from('order_payment_records')
      .select('id', { count: 'exact', head: true }).is('confirmed_at', null)
    return error ? null : (count ?? 0)
  } catch { return null }
}

export default async function PaymentsPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab: TabKey = (TABS as readonly string[]).includes(searchParams.tab ?? '') ? searchParams.tab as TabKey : 'match'
  const pending = await countPending()
  return (
    <div className="w-full">
      <h1 className="text-2xl font-bold text-gray-900">결제 확인</h1>
      <PageTabs className="mt-3 mb-4" active={tab} tabs={[
        { key: 'match', label: pending ? `매칭 대기 ${pending.toLocaleString('ko-KR')}` : '매칭 대기', href: '/payments' },
        { key: 'deposits', label: '기록 없는 입금', href: '/payments?tab=deposits' },
        { key: 'guide', label: '결제 안내 대상', href: '/payments?tab=guide' },
        { key: 'invoice', label: '계산서 확인', href: '/payments?tab=invoice' },
      ]} />
      {tab === 'deposits' ? <DepositsTab /> : tab === 'guide' ? <GuideTab /> : tab === 'invoice' ? <InvoiceTab /> : <MatchTab />}
    </div>
  )
}
