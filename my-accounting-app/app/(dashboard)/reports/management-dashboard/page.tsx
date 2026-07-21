import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import { buildCashPositionRows, buildDailyCashRows } from '@/lib/cash-reports'
import { buildReceivableAgingRows, buildPayableAgingRows } from '@/lib/erp-reports'
import { buildVendorAnalysisRows } from '@/lib/vendor-analysis'
import { buildMonthlyPL } from '@/lib/pl-report'
import { buildVatEstimate } from '@/lib/vat-report'
import { getPeriodRange } from '@/lib/period-presets'
import PeriodFilter from './period-filter'

export const dynamic = 'force-dynamic'
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

export default async function ManagementDashboardPage({
  searchParams,
}: { searchParams?: { from?: string; to?: string } }) {
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
  // 미수·미지급 Aging은 시점 기준이라 기간 종료일(미래면 오늘)을 기준일로 쓴다
  const asOf = to < todayStr ? to : todayStr

  const [
    cashPosition,
    dailyCash,
    receivableAging,
    payableAging,
    vendorSales,
    monthlyPL,
    vatEstimate,
  ] = await Promise.all([
    // 자금현황은 저량(현재 시점) 지표 — 기간 선택과 무관하게 항상 최신 잔액 기준.
    // 과거 시점 잔액이 필요하면 계좌 통합현황 화면에서 기간을 조정한다.
    buildCashPositionRows(admin, null, null),
    buildDailyCashRows(admin, from, to, null),
    buildReceivableAgingRows(admin, asOf),
    buildPayableAgingRows(admin, asOf),
    buildVendorAnalysisRows(admin, from, to),
    buildMonthlyPL(admin, monthFrom, monthTo),
    buildVatEstimate(admin, from, to),
  ])

  const fundSummary = 'summary' in cashPosition ? cashPosition.summary : null
  const accountCount = 'rows' in cashPosition ? cashPosition.rows.length : 0

  const dailyRows = 'rows' in dailyCash ? dailyCash.rows : []
  const monthDeposit    = dailyRows.reduce((s, r) => s + r.deposit, 0)
  const monthWithdrawal = dailyRows.reduce((s, r) => s + r.withdrawal, 0)

  const recvTotal = 'total' in receivableAging ? receivableAging.total : null
  const payTotal  = 'total' in payableAging ? payableAging.total : null

  const topVendors = 'rows' in vendorSales ? vendorSales.rows.slice(0, 5) : []

  const plItems = 'result' in monthlyPL ? monthlyPL.result.items : []
  // 기간이 여러 달이면 월별 값을 합산한다
  const findItem = (key: string) =>
    (plItems.find(i => i.key === key)?.values ?? []).reduce((s, v) => s + v, 0)
  const revenue = findItem('revenue')
  const grossProfit = findItem('gross_profit')
  const operatingProfit = findItem('operating_profit')

  const vat = 'result' in vatEstimate ? vatEstimate.result : null

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">경영대시보드</h1>
        <p className="text-sm mt-1 text-gray-500">자금·미수금·미지급금·손익·부가세 현황을 한눈에 확인합니다. (기간: {from} ~ {to})</p>
        <PeriodFilter from={from} to={to} />
      </div>

      {/* 자금현황 */}
      <SectionHeader title="자금현황 (잔액은 현재 시점 기준 · 입출금만 선택 기간)" href="/reports/cash-position" linkLabel="계좌 통합현황" />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card label="보유 현금" value={won(fundSummary?.held_cash)} sub={`계좌 ${accountCount}개`} href="/reports/cash-position" />
        <Card label="기간 입금" value={won(monthDeposit)} valueClass="text-blue-600" href="/reports/daily-cash" />
        <Card label="기간 출금" value={won(monthWithdrawal)} valueClass="text-rose-600" href="/reports/daily-cash" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <Card
          label="마이너스통장 사용액"
          value={won(fundSummary?.overdraft_used)}
          valueClass={(fundSummary?.overdraft_used ?? 0) > 0 ? 'text-rose-600' : 'text-gray-900'}
          href="/reports/cash-position"
        />
        <Card
          label="순현금/순차입 포지션"
          value={won(fundSummary?.net_cash)}
          valueClass={(fundSummary?.net_cash ?? 0) < 0 ? 'text-rose-600' : 'text-gray-900'}
          href="/reports/cash-position"
        />
        <Card label="가용 자금" value={won(fundSummary?.available_funds)} valueClass="text-blue-600" href="/reports/cash-position" />
      </div>

      {/* 미수금/미지급금 */}
      <SectionHeader title={`미수금 · 미지급금 (기준일 ${asOf})`} href="/reports/receivables-aging" linkLabel="Aging 분석" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card
          label="미수금 총계"
          value={won(recvTotal?.total ?? 0)}
          sub={recvTotal ? `90일 초과: ${won(recvTotal.bucket_over)}` : undefined}
          valueClass={recvTotal && recvTotal.total > 0 ? 'text-red-600' : 'text-gray-900'}
          href="/reports/receivables-aging"
        />
        <Card
          label="미지급금 총계"
          value={won(payTotal?.total ?? 0)}
          sub={payTotal ? `90일 초과: ${won(payTotal.bucket_over)}` : undefined}
          valueClass={payTotal && payTotal.total > 0 ? 'text-rose-600' : 'text-gray-900'}
          href="/reports/payables-aging"
        />
      </div>

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
