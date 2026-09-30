import PageTabs from '@/components/ui/PageTabs'
import { createAdminClient } from '@/lib/supabase-server'
import TransactionsTab from './transactions-tab'
import ClassifyTab from './classify-tab'

// 통장 내역 — 거래 내역 / 분류 작업 탭 통합 (2026-09-30 UI 2차 정리, 통합 5)
// 옛 주소 /bank-classify 는 ?tab=classify 로 리다이렉트된다. 사이드바 계좌별 바로가기(?bankAccountId=)는
// 두 탭이 공유한다(분류 작업은 기간 없이 미분류 전체 — 사용자 승인 2026-09-30).
export const dynamic = 'force-dynamic'

// 분류 작업 탭 이름에 붙는 미분류 건수 — 이체 연결분·확정분을 뺀 잔여 (classify-groups API와 같은 기준)
async function countUnclassified(): Promise<number | null> {
  try {
    const { count, error } = await createAdminClient()
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .is('transfer_pair_id', null)
      .or('status.neq.confirmed,confirmed_account_id.is.null')
    return error ? null : (count ?? 0)
  } catch { return null }
}

export default async function TransactionsPage({ searchParams }: { searchParams: { tab?: string; bankAccountId?: string } }) {
  const tab = searchParams.tab === 'classify' ? 'classify' : 'list'
  const bankQ = searchParams.bankAccountId ? `bankAccountId=${searchParams.bankAccountId}` : ''
  const unclassified = await countUnclassified()
  return (
    <div className="flex flex-col h-full">
      <h1 className="text-2xl font-bold text-gray-900">통장 내역</h1>
      <PageTabs className="mt-3 mb-3" active={tab} tabs={[
        { key: 'list', label: '거래 내역', href: `/transactions${bankQ ? `?${bankQ}` : ''}` },
        { key: 'classify', label: unclassified === null ? '분류 작업' : `분류 작업 (미분류 ${unclassified.toLocaleString('ko-KR')})`, href: `/transactions?tab=classify${bankQ ? `&${bankQ}` : ''}` },
      ]} />
      {tab === 'classify' ? <ClassifyTab bankAccountId={searchParams.bankAccountId} /> : <TransactionsTab />}
    </div>
  )
}
