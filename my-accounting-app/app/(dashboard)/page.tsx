import Link from 'next/link'
import { createAdminClient } from '@/lib/supabase-server'

// 서버 컴포넌트를 매 요청마다 동적으로 렌더링 — 캐싱 방지
// (Supabase 직접 쿼리는 Next.js fetch 캐시를 거치지 않아 static 렌더링으로 굳어버리는 문제 방지)
export const dynamic = 'force-dynamic'

// ── 금액 포맷 ──────────────────────────────────────────────
function fmt(n: number): string {
  return (n < 0 ? '-' : '') + Math.abs(n).toLocaleString('ko-KR') + '원'
}

// ── 전체 요약 카드 ─────────────────────────────────────────
function SummaryCard({
  label, value, sub, icon, color, bg,
}: {
  label: string; value: string; sub: string; icon: string; color: string; bg: string
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-8 h-8 rounded-lg ${bg} ${color} flex items-center justify-center text-sm font-bold`}>
          {icon}
        </span>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-1">{sub}</p>
    </div>
  )
}

// ── 계좌 카드 ──────────────────────────────────────────────
function AccountCard({
  id, name, accountNumber, alias,
  balance, balanceDate,
  monthlyIn, monthlyOut, unclassifiedCount, confirmedCount,
}: {
  id: string
  name: string
  accountNumber: string | null
  alias: string | null
  balance: number | null
  balanceDate: string | null
  monthlyIn: number
  monthlyOut: number
  unclassifiedCount: number
  confirmedCount: number
}) {
  const displayName = alias || name
  const isNegative = (balance ?? 0) < 0

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      {/* 헤더: 계좌명 + 미분류 배지 */}
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate">{displayName}</p>
          {accountNumber && (
            <p className="text-xs text-slate-400 mt-0.5 truncate">{accountNumber}</p>
          )}
        </div>
        {unclassifiedCount > 0 && (
          <span className="shrink-0 px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700 rounded-full whitespace-nowrap">
            미분류 {unclassifiedCount}
          </span>
        )}
      </div>

      {/* 현재 잔액 */}
      <div className="px-5 py-4 border-b border-slate-100">
        <p className="text-xs text-slate-400 mb-1">현재 잔액</p>
        {balance !== null ? (
          <>
            <p className={`text-xl font-bold ${isNegative ? 'text-red-500' : 'text-slate-800'}`}>
              {fmt(balance)}
            </p>
            {balanceDate && (
              <p className="text-xs text-slate-400 mt-0.5">{balanceDate} 기준</p>
            )}
          </>
        ) : (
          <p className="text-sm text-slate-300">-</p>
        )}
      </div>

      {/* 이번달 입금/출금 */}
      <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">이번달 입금</p>
          <p className={`text-sm font-semibold ${monthlyIn > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
            {monthlyIn > 0 ? fmt(monthlyIn) : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">이번달 출금</p>
          <p className={`text-sm font-semibold ${monthlyOut > 0 ? 'text-red-500' : 'text-slate-300'}`}>
            {monthlyOut > 0 ? fmt(monthlyOut) : '-'}
          </p>
        </div>
      </div>

      {/* 푸터: 확정 건수 + 바로가기 */}
      <div className="px-5 py-3 flex items-center justify-between mt-auto">
        <span className="text-xs text-slate-400">이번달 확정 {confirmedCount}건</span>
        <Link
          href={`/transactions?bankAccountId=${id}`}
          className="text-xs font-medium text-blue-600 hover:text-blue-800 transition-colors"
        >
          거래내역 →
        </Link>
      </div>
    </div>
  )
}

// ── 메인 페이지 (서버 컴포넌트) ────────────────────────────
export default async function DashboardPage() {
  const admin = createAdminClient()

  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1
  const monthStart = `${y}-${String(m).padStart(2, '0')}-01`
  const monthEnd   = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`

  const todayStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  // 병렬로 데이터 조회
  const [
    { data: accounts },
    { data: monthlyTx },
    { data: unclassifiedTx },
  ] = await Promise.all([
    admin.from('bank_accounts')
      .select('id, bank_name, account_number, alias')
      .eq('is_active', true)
      .order('bank_name'),

    admin.from('transactions')
      .select('bank_account_id, amount_in, amount_out, status')
      .gte('tx_date', monthStart)
      .lte('tx_date', monthEnd),

    // 미분류 = confirmed_account_id 없고 pending/reviewed 상태인 전체 거래
    admin.from('transactions')
      .select('bank_account_id')
      .is('confirmed_account_id', null)
      .in('status', ['pending', 'reviewed']),
  ])

  // 계좌별 최신 잔액 (병렬 조회)
  const latestBalances = await Promise.all(
    (accounts ?? []).map(async (acc) => {
      const { data } = await admin
        .from('transactions')
        .select('balance, tx_date')
        .eq('bank_account_id', acc.id)
        .not('balance', 'is', null)
        .order('tx_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      return { id: acc.id, balance: data?.balance ?? null, balanceDate: data?.tx_date ?? null }
    })
  )

  const balanceMap = Object.fromEntries(latestBalances.map(b => [b.id, b]))

  // 이번달 계좌별 집계
  const monthlyStats: Record<string, { in: number; out: number; confirmed: number }> = {}
  for (const tx of (monthlyTx ?? [])) {
    const k = tx.bank_account_id ?? '__none__'
    if (!monthlyStats[k]) monthlyStats[k] = { in: 0, out: 0, confirmed: 0 }
    monthlyStats[k].in  += tx.amount_in  ?? 0
    monthlyStats[k].out += tx.amount_out ?? 0
    if (tx.status === 'confirmed') monthlyStats[k].confirmed++
  }

  // 미분류 계좌별 집계
  const unclassifiedMap: Record<string, number> = {}
  for (const tx of (unclassifiedTx ?? [])) {
    const k = tx.bank_account_id ?? '__none__'
    unclassifiedMap[k] = (unclassifiedMap[k] ?? 0) + 1
  }

  // 전체 요약
  const allTx = monthlyTx ?? []
  const totalIn          = allTx.reduce((s, t) => s + (t.amount_in  ?? 0), 0)
  const totalOut         = allTx.reduce((s, t) => s + (t.amount_out ?? 0), 0)
  const totalUnclassified = (unclassifiedTx ?? []).length
  const totalConfirmed   = allTx.filter(t => t.status === 'confirmed').length

  return (
    <div className="max-w-6xl mx-auto">
      {/* 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">대시보드</h1>
        <p className="text-slate-500 mt-0.5 text-sm">{todayStr}</p>
      </div>

      {/* 전체 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          label="이번달 입금"  value={fmt(totalIn)}
          sub="전 계좌 당월 누적 입금" icon="↓" color="text-blue-600" bg="bg-blue-50"
        />
        <SummaryCard
          label="이번달 출금"  value={fmt(totalOut)}
          sub="전 계좌 당월 누적 출금" icon="↑" color="text-red-500" bg="bg-red-50"
        />
        <SummaryCard
          label="미분류 건수"  value={`${totalUnclassified}건`}
          sub="분류 대기 중인 전체 거래" icon="⚠" color="text-amber-600" bg="bg-amber-50"
        />
        <SummaryCard
          label="이번달 확정"  value={`${totalConfirmed}건`}
          sub="이번달 확정 완료된 거래" icon="✓" color="text-green-600" bg="bg-green-50"
        />
      </div>

      {/* 계좌별 현황 */}
      <h2 className="text-sm font-semibold text-slate-700 mb-3">계좌별 현황</h2>

      {(accounts ?? []).length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
          등록된 계좌가 없습니다.{' '}
          <Link href="/upload" className="text-blue-500 hover:underline">
            파일 업로드
          </Link>
          에서 계좌를 추가하세요.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {(accounts ?? []).map(acc => {
            const stats = monthlyStats[acc.id] ?? { in: 0, out: 0, confirmed: 0 }
            const bal   = balanceMap[acc.id]
            return (
              <AccountCard
                key={acc.id}
                id={acc.id}
                name={acc.bank_name}
                accountNumber={acc.account_number ?? null}
                alias={acc.alias ?? null}
                balance={bal?.balance ?? null}
                balanceDate={bal?.balanceDate ?? null}
                monthlyIn={stats.in}
                monthlyOut={stats.out}
                confirmedCount={stats.confirmed}
                unclassifiedCount={unclassifiedMap[acc.id] ?? 0}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
