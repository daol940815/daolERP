import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCashPositionRows } from '@/lib/cash-reports'
import { buildHubList } from '@/lib/vendor-hub'
import { buildPurchaseHubList } from '@/lib/purchase-hub'
import MgmtTab from './_components/MgmtTab'
import CashTab from './_components/CashTab'
import WorkTab from './_components/WorkTab'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// ── 통합 대시보드 ────────────────────────────────────────────
// 기존 대시보드(자금·계좌)와 경영대시보드를 한 화면으로 합치고 목적별 탭으로 나눈다.
//  · 공통 요약 줄은 탭과 무관하게 항상 표시 — 처리할 일이 숨은 탭에 묻히지 않게.
//  · 탭 전환은 주소 이동(?tab=)이라 선택한 탭의 데이터만 계산된다.
//    (전부 한 번에 계산하면 허브 집계 2개 때문에 첫 로딩이 느려진다)
//  · 미수·미지급은 허브가 단일 진실 — 요약 줄과 경영 탭이 같은 값을 공유한다.

const TABS = [
  { key: 'mgmt', label: '경영 지표' },
  { key: 'cash', label: '자금·계좌' },
  { key: 'work', label: '작업 현황' },
] as const
type TabKey = typeof TABS[number]['key']

const eok = (n: number) => `${(n / 1e8).toFixed(2)}억`
const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function Metric({
  label, value, sub, valueClass = 'text-gray-900', href,
}: { label: string; value: string; sub?: string; valueClass?: string; href?: string }) {
  const inner = (
    <>
      <div className="text-xs text-gray-400">{label}</div>
      <div className={`text-lg font-bold mt-0.5 ${valueClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </>
  )
  return href
    ? <Link href={href} className="block rounded-lg -m-1 p-1 hover:bg-slate-50">{inner}</Link>
    : <div>{inner}</div>
}

export default async function DashboardPage({
  searchParams,
}: { searchParams?: { tab?: string; from?: string; to?: string; period?: string } }) {
  noStore()
  const admin = createAdminClient()

  const tab: TabKey = TABS.some(t => t.key === searchParams?.tab)
    ? (searchParams!.tab as TabKey)
    : 'mgmt'

  // 공통 요약 줄 — 어느 탭에서나 같은 값을 보여준다.
  // 허브 두 개는 경영/작업 탭에도 넘겨 재계산을 피한다.
  const todayStr = new Date().toISOString().slice(0, 10)
  const [cash, recvRes, payRes, reviewedRes, aliasRes, loanRes] = await Promise.all([
    buildCashPositionRows(admin, null, null),
    buildHubList(admin, null, null),
    buildPurchaseHubList(admin, null, null),
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'reviewed'),
    admin.from('erp_vendor_aliases').select('id', { count: 'exact', head: true })
      .eq('alias_type', 'customer').is('vendor_id', null),
    // 만기 경과 대출 (한도대출은 만기를 관리하지 않아 제외)
    admin.from('loans').select('id', { count: 'exact', head: true })
      .eq('status', 'active').neq('product_type', 'credit_line').lt('maturity_date', todayStr),
  ])

  const fund = 'summary' in cash ? cash.summary : null
  const recv = 'summary' in recvRes ? recvRes.summary : null
  const pay = 'summary' in payRes ? payRes.summary : null
  // 과다지급(음수 잔액)은 미지급금 합계에 섞지 않고 따로 보여준다
  const payOverpaid = 'rows' in payRes
    ? payRes.rows.reduce((s, r) => s + (r.purchase_kind === 'retail' ? 0 : Math.min(0, r.outstanding)), 0)
    : 0
  const reviewed = reviewedRes.count ?? 0

  // 확인 필요 = 만기 경과 대출 + 매출처 별칭 미연결 + 과다지급(있으면 1건)
  const loanOverdue = loanRes.count ?? 0
  const aliasUnlinked = aliasRes.count ?? 0
  const checkParts: string[] = []
  if (loanOverdue > 0) checkParts.push(`대출 만기 ${loanOverdue}`)
  if (aliasUnlinked > 0) checkParts.push(`별칭 미연결 ${aliasUnlinked}`)
  if (payOverpaid < 0) checkParts.push('과다지급')
  const checkCount = loanOverdue + aliasUnlinked + (payOverpaid < 0 ? 1 : 0)

  const qs = (t: TabKey) => {
    const p = new URLSearchParams()
    p.set('tab', t)
    if (searchParams?.from) p.set('from', searchParams.from)
    if (searchParams?.to) p.set('to', searchParams.to)
    if (searchParams?.period) p.set('period', searchParams.period)
    return `/?${p.toString()}`
  }

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900">대시보드</h1>

      {/* 공통 요약 줄 — 탭과 무관하게 항상 표시 */}
      <div className="mt-4 bg-white border border-gray-200 rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Metric label="가용 자금" value={eok(fund?.available_funds ?? 0)}
            sub="보유현금 + 미사용 한도" valueClass="text-blue-600" href="/reports/cash-position" />
          <Metric label="미수금" value={eok(recv?.outstanding_total ?? 0)}
            sub={recv ? `90일 초과 ${eok(recv.over90_total)}` : undefined}
            valueClass={(recv?.outstanding_total ?? 0) > 0 ? 'text-red-600' : 'text-gray-900'}
            href="/sales-hub" />
          <Metric label="미지급금" value={won(pay?.outstanding_total ?? 0)}
            sub={payOverpaid < 0 ? `과다지급 ${won(Math.abs(payOverpaid))} — 계산서 대기` : undefined}
            valueClass={(pay?.outstanding_total ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900'}
            href="/purchase-hub" />
          <Metric label="미확정 거래" value={`${reviewed.toLocaleString('ko-KR')}건`}
            sub="확정하면 손익 반영" valueClass={reviewed > 0 ? 'text-amber-700' : 'text-gray-900'}
            href={qs('work')} />
          <Metric label="확인 필요" value={`${checkCount}건`}
            sub={checkParts.length ? checkParts.join(' · ') : '없음'}
            valueClass={checkCount > 0 ? 'text-amber-800' : 'text-gray-900'}
            href={qs('work')} />
        </div>
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 mt-5 border-b border-gray-200">
        {TABS.map(t => (
          <Link key={t.key} href={qs(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 whitespace-nowrap ${tab === t.key
              ? 'border-slate-900 text-slate-900'
              : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'mgmt' && <MgmtTab searchParams={searchParams} recv={recv} pay={pay} payOverpaid={payOverpaid} />}
      {tab === 'cash' && <CashTab searchParams={searchParams} />}
      {tab === 'work' && <WorkTab pay={pay} payOverpaid={payOverpaid} />}
    </div>
  )
}
