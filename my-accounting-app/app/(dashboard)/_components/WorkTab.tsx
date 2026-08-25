import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'
import type { PurchaseHubListSummary } from '@/lib/purchase-hub'

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`

function CountCard({
  label, value, sub, href, alert = false,
}: { label: string; value: string; sub?: string; href?: string; alert?: boolean }) {
  const inner = (
    <div className={`rounded-xl border p-5 h-full ${alert
      ? 'bg-amber-50 border-amber-300' : 'bg-white border-gray-200'}`}>
      <p className={`text-xs mb-1.5 ${alert ? 'text-amber-700' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-xl font-bold ${alert ? 'text-amber-800' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${alert ? 'text-amber-700' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
  return href ? <Link href={href} className="block hover:shadow-md transition-shadow rounded-xl">{inner}</Link> : inner
}

// 처리해야 할 일과 확인이 필요한 항목을 한곳에 모은다.
// 흩어져 있던 미결 항목(미확정 거래·만기 경과 대출·미연결 별칭 등)이 화면에서 보이게 하는 것이 목적.
export default async function WorkTab({
  pay, payOverpaid,
}: { pay: PurchaseHubListSummary | null; payOverpaid: number }) {
  const admin = createAdminClient()
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const monthFirst = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`

  const [reviewedRes, pendingRes, confirmedRes, salesAliasRes, loansRes] = await Promise.all([
    admin.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'reviewed'),
    admin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('status', 'pending').is('transfer_pair_id', null),
    admin.from('transactions').select('id', { count: 'exact', head: true })
      .eq('status', 'confirmed').gte('confirmed_at', monthFirst),
    admin.from('erp_vendor_aliases').select('id', { count: 'exact', head: true })
      .eq('alias_type', 'customer').is('vendor_id', null),
    admin.from('loans').select('title, bank_name, current_balance, maturity_date, status, product_type'),
  ])

  const reviewed = reviewedRes.count ?? 0
  const pending = pendingRes.count ?? 0
  const confirmedThisMonth = confirmedRes.count ?? 0
  const salesAliasUnlinked = salesAliasRes.count ?? 0

  type LoanLite = {
    title: string; bank_name: string; current_balance: number
    maturity_date: string | null; status: string; product_type?: string
  }
  const loans: LoanLite[] = loansRes.error ? [] : ((loansRes.data ?? []) as LoanLite[])
  // 만기 경과는 일반 대출만 — 한도대출은 만기를 관리하지 않는다
  const overdueLoans = loans.filter(l =>
    (l.product_type ?? 'term') !== 'credit_line' && l.status === 'active' &&
    !!l.maturity_date && l.maturity_date < todayStr)
  const overdueAmount = overdueLoans.reduce((s, l) => s + (l.current_balance ?? 0), 0)

  // 확인 필요 목록 — 조건에 걸리는 것만 표시
  const issues: { kind: string; tone: string; text: string; amount: string; href: string; label: string }[] = []
  if (overdueLoans.length > 0) {
    issues.push({
      kind: '대출', tone: 'bg-red-100 text-red-700',
      text: `만기 경과 ${overdueLoans.length}건 — ${overdueLoans.map(l => l.title).join(' · ')}`,
      amount: won(overdueAmount), href: '/loans', label: '대출 관리',
    })
  }
  if (payOverpaid < 0) {
    issues.push({
      kind: '매입', tone: 'bg-amber-100 text-amber-800',
      text: '매입 세금계산서 미업로드로 과다지급(음수 잔액) 발생 — 계산서를 올리면 해소됩니다',
      amount: won(Math.abs(payOverpaid)), href: '/tax-invoices/classify', label: '세금계산서',
    })
  }
  if (salesAliasUnlinked > 0) {
    issues.push({
      kind: '매출', tone: 'bg-slate-100 text-gray-700',
      text: `매출처 별칭 ${salesAliasUnlinked}건이 거래처에 연결되지 않아 허브 집계에서 빠져 있습니다`,
      amount: '-', href: '/erp-aliases', label: '별칭 관리',
    })
  }
  if (pay && pay.unlinked_aliases > 0) {
    issues.push({
      kind: '매입', tone: 'bg-slate-100 text-gray-700',
      text: `매입처 별칭 ${pay.unlinked_aliases}건이 거래처 미연결 (ERP 품목 ${pay.unlinked_items.toLocaleString('ko-KR')}건)`,
      amount: '-', href: '/purchase-hub', label: '매입처 허브',
    })
  }
  if (reviewed > 0) {
    issues.push({
      kind: '통장', tone: 'bg-slate-100 text-gray-700',
      text: `검토됨 상태 ${reviewed.toLocaleString('ko-KR')}건이 확정 전이라 손익에 반영되지 않았습니다`,
      amount: '-', href: '/bank-classify', label: '통장 분류',
    })
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-700 mt-6 mb-3">처리해야 할 일</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <CountCard label="미확정 거래 (검토됨)" value={`${reviewed.toLocaleString('ko-KR')}건`}
          sub="확정하면 분개가 생성되어 손익에 반영됩니다" href="/bank-classify" alert={reviewed > 0} />
        <CountCard label="미분류 거래" value={`${pending.toLocaleString('ko-KR')}건`}
          sub="계좌간 이체 제외" href="/bank-classify" />
        <CountCard label="이번달 확정" value={`${confirmedThisMonth.toLocaleString('ko-KR')}건`}
          sub={`${monthFirst} 이후`} href="/transactions" />
        <CountCard label="매출처 별칭 미연결" value={`${salesAliasUnlinked.toLocaleString('ko-KR')}건`}
          sub="허브 집계에서 제외됨" href="/erp-aliases" alert={salesAliasUnlinked > 0} />
      </div>

      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-3">확인 필요</h2>
      {issues.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">
          확인이 필요한 항목이 없습니다.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">구분</th>
                <th className="py-2.5 px-3 font-medium">내용</th>
                <th className="py-2.5 px-3 font-medium text-right whitespace-nowrap">규모</th>
                <th className="py-2.5 px-3 font-medium whitespace-nowrap">바로가기</th>
              </tr>
            </thead>
            <tbody className="text-gray-700">
              {issues.map((it, i) => (
                <tr key={i} className="border-b border-gray-100 last:border-0">
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded ${it.tone}`}>{it.kind}</span>
                  </td>
                  <td className="py-2 px-3">{it.text}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${it.amount === '-' ? 'text-gray-400' : 'font-medium'}`}>{it.amount}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <Link href={it.href} className="text-xs text-blue-600 hover:underline">{it.label}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
