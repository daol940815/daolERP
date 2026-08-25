import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
// 미수·미지급은 허브를 단일 진실로 삼는다 (2026-08-25 전환). 값은 셸에서 한 번 계산해 받는다.
import type { HubListSummary } from '@/lib/vendor-hub'
import type { PurchaseHubListSummary } from '@/lib/purchase-hub'
import { buildVendorAnalysisRows } from '@/lib/vendor-analysis'
import { buildMonthlyPL } from '@/lib/pl-report'
import { buildVatEstimate } from '@/lib/vat-report'
import { getPeriodRange } from '@/lib/period-presets'

export const maxDuration = 60

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const pct = (n: number | null | undefined) => `${(n ?? 0).toFixed(1)}%`

function Card({
  label, value, sub, href, valueClass = 'text-gray-900',
}: { label: string; value: string; sub?: string; href?: string; valueClass?: string }) {
  const inner = (
    <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm h-full">
      <p className="text-xs text-gray-400 mb-1.5">{label}</p>
      <p className={`text-xl font-bold ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
  return href ? <Link href={href} className="block hover:shadow-md transition-shadow rounded-xl">{inner}</Link> : inner
}

function SectionHeader({ title, href, linkLabel }: { title: string; href: string; linkLabel: string }) {
  return (
    <div className="flex items-center justify-between mb-3 mt-8">
      <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
      <Link href={href} className="text-xs text-blue-600 hover:underline">{linkLabel} →</Link>
    </div>
  )
}

export default async function MgmtTab({
  searchParams, recv, pay, payOverpaid,
}: {
  searchParams?: { from?: string; to?: string }
  recv: HubListSummary | null
  pay: PurchaseHubListSummary | null
  payOverpaid: number
}) {
  noStore()
  const admin = createAdminClient()

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // 기간: URL 파라미터(YYYY-MM-DD), 없으면 당월
  const def = getPeriodRange('당월')
  const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
  const from = isDate(searchParams?.from) ? searchParams!.from! : def.from
  const to = isDate(searchParams?.to) ? searchParams!.to! : def.to
  const monthFrom = from.slice(0, 7)
  const monthTo = to.slice(0, 7)

  const [
    vendorSales,
    monthlyPL,
    vatEstimate,
    loansRes,
  ] = await Promise.all([
    buildVendorAnalysisRows(admin, from, to),
    buildMonthlyPL(admin, monthFrom, monthTo),
    buildVatEstimate(admin, from, to),
    admin.from('loans').select('current_balance, monthly_principal, monthly_interest, maturity_date, status'),
  ])


  const topVendors = 'rows' in vendorSales ? vendorSales.rows.slice(0, 5) : []

  const plItems = 'result' in monthlyPL ? monthlyPL.result.items : []
  // 기간이 여러 달이면 월별 값을 합산한다
  const findItem = (key: string) =>
    (plItems.find(i => i.key === key)?.values ?? []).reduce((s, v) => s + v, 0)
  const revenue = findItem('revenue')
  const grossProfit = findItem('gross_profit')
  const operatingProfit = findItem('operating_profit')

  const vat = 'result' in vatEstimate ? vatEstimate.result : null

  // 대출 현황 (loans 마스터 — 402 미실행이면 빈 목록으로 표시)
  type LoanRow = { current_balance: number; monthly_principal: number; monthly_interest: number; maturity_date: string | null; status: string }
  const loanRows: LoanRow[] = loansRes.error ? [] : ((loansRes.data ?? []) as LoanRow[])
  const activeLoans = loanRows.filter(l => l.status === 'active')
  const loanBalance   = activeLoans.reduce((s, l) => s + (l.current_balance ?? 0), 0)
  const loanPrincipal = activeLoans.reduce((s, l) => s + (l.monthly_principal ?? 0), 0)
  const loanInterest  = activeLoans.reduce((s, l) => s + (l.monthly_interest ?? 0), 0)
  const in6Months = new Date(now.getFullYear(), now.getMonth() + 6, now.getDate()).toISOString().slice(0, 10)
  const loanOverdue = activeLoans.filter(l => l.maturity_date && l.maturity_date < todayStr).length
  const loanDueSoon = activeLoans.filter(l => l.maturity_date && l.maturity_date >= todayStr && l.maturity_date <= in6Months).length

  return (
    <div>
      {/* 대출 현황 */}
      <SectionHeader title="대출 현황 (대출 마스터 기준)" href="/loans" linkLabel="대출 관리" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card
          label="대출 잔액 합계"
          value={won(loanBalance)}
          sub={`상환 중 ${activeLoans.length}건`}
          valueClass={loanBalance > 0 ? 'text-rose-600' : 'text-gray-900'}
          href="/loans"
        />
        <Card
          label="월 원리금 상환 (참고)"
          value={won(loanPrincipal + loanInterest)}
          sub={`원금 ${won(loanPrincipal)} · 이자 ${won(loanInterest)} (변동)`}
          href="/loans"
        />
        <Card
          label="만기 경과 · 6개월 내 도래"
          value={`${loanOverdue}건 · ${loanDueSoon}건`}
          sub={loanOverdue > 0 ? '만기 경과 대출 확인 필요' : undefined}
          valueClass={loanOverdue > 0 ? 'text-red-600' : 'text-gray-900'}
          href="/loans"
        />
      </div>

      {/* 미수금/미지급금 — 허브 기준 (현재 시점 잔액) */}
      <SectionHeader title="미수금 · 미지급금 (허브 기준 · 현재 시점 잔액)" href="/sales-hub" linkLabel="매출처 허브" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          label="미수금 총계"
          value={won(recv?.outstanding_total ?? 0)}
          sub={recv ? `90일 초과: ${won(recv.over90_total)} · 거래처 ${recv.active_vendors.toLocaleString('ko-KR')}곳` : undefined}
          valueClass={recv && recv.outstanding_total > 0 ? 'text-red-600' : 'text-gray-900'}
          href="/sales-hub"
        />
        <Card
          label="미지급금 총계"
          value={won(pay?.outstanding_total ?? 0)}
          sub={pay
            ? `90일 초과: ${won(pay.over90_total)}`
              + (payOverpaid < 0 ? ` · 과다지급 ${won(Math.abs(payOverpaid))}` : '')
            : undefined}
          valueClass={pay && pay.outstanding_total > 0 ? 'text-rose-600' : 'text-gray-900'}
          href="/purchase-hub"
        />
      </div>
      {payOverpaid < 0 && (
        <p className="text-xs text-amber-700 mt-2">
          매입처 허브에 과다지급(음수 잔액)이 {won(Math.abs(payOverpaid))} 있습니다 —
          기준일(2026-06-30) 이후 매입 세금계산서가 아직 업로드되지 않아 지급만 집계된 상태일 수 있습니다.
          계산서를 올리면 해소됩니다.
        </p>
      )}

      {/* 이번달 손익 */}
      <SectionHeader title={`손익 (${monthFrom === monthTo ? monthFrom : `${monthFrom} ~ ${monthTo}`})`} href="/reports/monthly-pl" linkLabel="월별 손익현황" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="매출" value={won(revenue)} href="/reports/monthly-pl" />
        <Card label="매출이익" value={won(grossProfit)} valueClass={grossProfit >= 0 ? 'text-blue-600' : 'text-red-600'} href="/reports/monthly-pl" />
        <Card label="영업이익" value={won(operatingProfit)} valueClass={operatingProfit >= 0 ? 'text-blue-600' : 'text-red-600'} sub="법인카드/급여/감가상각 미반영" href="/reports/monthly-pl" />
      </div>

      {/* 예상 부가세 */}
      <SectionHeader title="예상 부가세 (선택 기간)" href="/reports/vat-estimate" linkLabel="예상 부가세" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="매출세액" value={won(vat?.sales_tax ?? 0)} valueClass="text-blue-600" href="/reports/vat-estimate" />
        <Card label="매입세액" value={won(vat?.purchase_tax ?? 0)} valueClass="text-rose-600" href="/reports/vat-estimate" />
        <Card
          label={(vat?.estimated_vat ?? 0) < 0 ? '예상 환급액' : '예상 납부액'}
          value={won(Math.abs(vat?.estimated_vat ?? 0))}
          valueClass={(vat?.estimated_vat ?? 0) < 0 ? 'text-emerald-600' : 'text-gray-900'}
          href="/reports/vat-estimate"
        />
      </div>

      {/* 매출처 Top 5 */}
      <SectionHeader title="매출처 TOP 5 (선택 기간)" href="/reports/vendor-sales" linkLabel="거래처별 매출 분석" />
      {topVendors.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">선택 기간에 매출 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">매출처 (ERP)</th>
                <th className="py-2.5 px-3 font-medium">연결 거래처</th>
                <th className="py-2.5 px-3 font-medium text-right">순매출</th>
                <th className="py-2.5 px-3 font-medium text-right">매출이익</th>
                <th className="py-2.5 px-3 font-medium text-right">이익률</th>
              </tr>
            </thead>
            <tbody>
              {topVendors.map(v => (
                <tr key={v.alias_id ?? 'none'} className="border-b border-gray-100">
                  <td className="py-2 px-3 min-w-0"><p className="truncate max-w-[220px] text-gray-900">{v.erp_name}</p></td>
                  <td className="py-2 px-3 text-gray-600">{v.vendor_name ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(v.sales_amount)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${v.profit_amount >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{won(v.profit_amount)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${v.profit_rate >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{pct(v.profit_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
