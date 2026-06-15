import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { createAdminClient } from '@/lib/supabase-server'
import OrphanedAccountsSection, { type OrphanedGroup } from './_components/OrphanedAccountsSection'

// force-dynamic: 정적 렌더링 방지 (빌드 시 캐싱 금지)
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

// ── 마이너스통장 계좌 카드 ──────────────────────────────────
function OverdraftAccountCard({
  id, name, accountNumber, alias,
  balance, balanceDate, overdraftLimit,
  monthlyIn, monthlyOut, unclassifiedCount, confirmedCount, periodLabel,
}: {
  id: string
  name: string
  accountNumber: string | null
  alias: string | null
  balance: number | null
  balanceDate: string | null
  overdraftLimit: number | null
  monthlyIn: number
  monthlyOut: number
  unclassifiedCount: number
  confirmedCount: number
  periodLabel: string
}) {
  const displayName = alias || name
  const limitAbs = overdraftLimit != null ? Math.abs(overdraftLimit) : 0
  const used = Math.max(-(balance ?? 0), 0)
  const available = Math.max(limitAbs - used, 0)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col">
      <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-800 text-sm truncate flex items-center gap-1.5">
            {displayName}
            <span className="shrink-0 px-1.5 py-0.5 text-[10px] leading-none rounded bg-amber-100 text-amber-700">마이너스통장</span>
          </p>
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

      {/* 한도/현재잔액/사용액/미사용한도 */}
      <div className="px-5 py-4 border-b border-slate-100 grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-slate-400 mb-1">한도</p>
          <p className="text-sm font-semibold text-slate-700">{fmt(limitAbs)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">현재 잔액</p>
          {balance !== null ? (
            <>
              <p className={`text-sm font-semibold ${balance < 0 ? 'text-red-500' : 'text-slate-800'}`}>{fmt(balance)}</p>
              {balanceDate && <p className="text-xs text-slate-400 mt-0.5">{balanceDate} 기준</p>}
            </>
          ) : <p className="text-sm text-slate-300">-</p>}
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">현재 사용액</p>
          <p className="text-sm font-semibold text-red-500">{fmt(used)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">미사용 한도</p>
          <p className="text-sm font-semibold text-emerald-600">{fmt(available)}</p>
        </div>
      </div>

      {/* 기간 입금/출금 */}
      <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">입금 ({periodLabel})</p>
          <p className={`text-sm font-semibold ${monthlyIn > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
            {monthlyIn > 0 ? fmt(monthlyIn) : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">출금 ({periodLabel})</p>
          <p className={`text-sm font-semibold ${monthlyOut > 0 ? 'text-red-500' : 'text-slate-300'}`}>
            {monthlyOut > 0 ? fmt(monthlyOut) : '-'}
          </p>
        </div>
      </div>

      {/* 푸터: 확정 건수 + 바로가기 */}
      <div className="px-5 py-3 flex items-center justify-between mt-auto">
        <span className="text-xs text-slate-400">{periodLabel} 확정 {confirmedCount}건</span>
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

// ── 계좌 카드 ──────────────────────────────────────────────
function AccountCard({
  id, name, accountNumber, alias,
  balance, balanceDate,
  monthlyIn, monthlyOut, unclassifiedCount, confirmedCount, periodLabel,
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
  periodLabel: string
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

      {/* 기간 입금/출금 */}
      <div className="px-5 py-3 grid grid-cols-2 gap-3 border-b border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-0.5">입금 ({periodLabel})</p>
          <p className={`text-sm font-semibold ${monthlyIn > 0 ? 'text-blue-600' : 'text-slate-300'}`}>
            {monthlyIn > 0 ? fmt(monthlyIn) : '-'}
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-0.5">출금 ({periodLabel})</p>
          <p className={`text-sm font-semibold ${monthlyOut > 0 ? 'text-red-500' : 'text-slate-300'}`}>
            {monthlyOut > 0 ? fmt(monthlyOut) : '-'}
          </p>
        </div>
      </div>

      {/* 푸터: 확정 건수 + 바로가기 */}
      <div className="px-5 py-3 flex items-center justify-between mt-auto">
        <span className="text-xs text-slate-400">{periodLabel} 확정 {confirmedCount}건</span>
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
  // noStore(): 이 컴포넌트의 fetch 캐시를 완전히 비활성화 (force-dynamic의 보조 수단)
  noStore()

  const admin = createAdminClient()

  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth() + 1

  const monthOf = (yr: number, mo: number) => ({
    start: `${yr}-${String(mo).padStart(2, '0')}-01`,
    end:   `${yr}-${String(mo).padStart(2, '0')}-${new Date(yr, mo, 0).getDate()}`,
    label: `${yr}년 ${mo}월`,
  })
  const cur  = monthOf(y, m)
  const prev = m === 1 ? monthOf(y - 1, 12) : monthOf(y, m - 1)

  const todayStr = now.toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  })

  // 계좌·미분류·당월 거래·미연결 거래 병렬 조회
  const [
    { data: accounts },
    { data: curMonthTx },
    { data: unclassifiedTx },
    { data: orphanedRaw },
  ] = await Promise.all([
    admin.from('bank_accounts')
      .select('id, bank_name, account_number, alias, account_type, overdraft_limit')
      .eq('is_active', true)
      .order('bank_name'),

    admin.from('transactions')
      .select('bank_account_id, amount_in, amount_out, status')
      .gte('tx_date', cur.start)
      .lte('tx_date', cur.end),

    // 미확정 = confirmed_account_id 없고 pending/reviewed 상태인 전체 거래 (status도 포함)
    admin.from('transactions')
      .select('bank_account_id, status')
      .is('confirmed_account_id', null)
      .in('status', ['pending', 'reviewed']),

    // bank_account_id 없지만 account_alias(은행명)가 있는 미연결 거래
    admin.from('transactions')
      .select('account_alias, amount_in, amount_out')
      .is('bank_account_id', null)
      .not('account_alias', 'is', null)
      .limit(5000),
  ])

  // 미연결 거래를 account_alias 기준으로 그룹핑
  const orphanedMap: Record<string, OrphanedGroup> = {}
  for (const tx of (orphanedRaw ?? [])) {
    const alias = tx.account_alias as string
    if (!orphanedMap[alias]) orphanedMap[alias] = { alias, count: 0, totalIn: 0, totalOut: 0 }
    orphanedMap[alias].count++
    orphanedMap[alias].totalIn  += (tx.amount_in  as number) ?? 0
    orphanedMap[alias].totalOut += (tx.amount_out as number) ?? 0
  }
  const orphanedGroups: OrphanedGroup[] = Object.values(orphanedMap)
    .sort((a, b) => b.count - a.count)

  // 당월 거래가 없으면 전월로 자동 전환 (업로드된 데이터가 전월인 경우 대응)
  let monthlyTx = curMonthTx ?? []
  let periodLabel = cur.label
  if (!monthlyTx.length) {
    const { data: prevData } = await admin.from('transactions')
      .select('bank_account_id, amount_in, amount_out, status')
      .gte('tx_date', prev.start)
      .lte('tx_date', prev.end)
    if (prevData?.length) {
      monthlyTx = prevData
      periodLabel = `${prev.label} (전월)`
    }
  }

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
  const totalIn           = allTx.reduce((s, t) => s + (t.amount_in  ?? 0), 0)
  const totalOut          = allTx.reduce((s, t) => s + (t.amount_out ?? 0), 0)
  const unclassifiedList  = unclassifiedTx ?? []
  const totalUnclassified = unclassifiedList.length
  const totalPending      = unclassifiedList.filter(t => t.status === 'pending').length
  const totalReviewed     = unclassifiedList.filter(t => t.status === 'reviewed').length
  const totalConfirmed    = allTx.filter(t => t.status === 'confirmed').length

  // 일반계좌 / 마이너스통장 계좌 분리 + 자금 요약 (5개 지표)
  const normalAccounts    = (accounts ?? []).filter(a => a.account_type !== 'overdraft')
  const overdraftAccounts = (accounts ?? []).filter(a => a.account_type === 'overdraft')

  const heldCash = normalAccounts.reduce((s, a) => s + (balanceMap[a.id]?.balance ?? 0), 0)
  const overdraftUsedTotal = overdraftAccounts.reduce(
    (s, a) => s + Math.max(-(balanceMap[a.id]?.balance ?? 0), 0), 0)
  const overdraftAvailableTotal = overdraftAccounts.reduce((s, a) => {
    const used = Math.max(-(balanceMap[a.id]?.balance ?? 0), 0)
    const limitAbs = a.overdraft_limit != null ? Math.abs(a.overdraft_limit) : 0
    return s + Math.max(limitAbs - used, 0)
  }, 0)
  const overdraftBalanceSum = overdraftAccounts.reduce((s, a) => s + (balanceMap[a.id]?.balance ?? 0), 0)
  const netCash = heldCash + overdraftBalanceSum
  const availableFunds = heldCash + overdraftAvailableTotal

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
          label={`${periodLabel} 입금`}  value={fmt(totalIn)}
          sub="전 계좌 누적 입금" icon="↓" color="text-blue-600" bg="bg-blue-50"
        />
        <SummaryCard
          label={`${periodLabel} 출금`}  value={fmt(totalOut)}
          sub="전 계좌 누적 출금" icon="↑" color="text-red-500" bg="bg-red-50"
        />
        <SummaryCard
          label="미확정 건수"  value={`${totalUnclassified}건`}
          sub={`미검토 ${totalPending}건 · 검토중 ${totalReviewed}건`} icon="⚠" color="text-amber-600" bg="bg-amber-50"
        />
        <SummaryCard
          label="이번달 확정"  value={`${totalConfirmed}건`}
          sub="이번달 확정 완료된 거래" icon="✓" color="text-green-600" bg="bg-green-50"
        />
      </div>

      {/* 전체 자금 요약 */}
      {(accounts ?? []).length > 0 && (
        <>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">전체 자금 요약</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
            <Link href="/reports/cash-position" className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <p className="text-xs text-slate-400 mb-1">보유 현금</p>
              <p className="text-lg font-bold text-slate-900">{fmt(heldCash)}</p>
            </Link>
            <Link href="/reports/cash-position" className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <p className="text-xs text-slate-400 mb-1">마이너스통장 사용액</p>
              <p className="text-lg font-bold text-red-500">{fmt(overdraftUsedTotal)}</p>
            </Link>
            <Link href="/reports/cash-position" className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <p className="text-xs text-slate-400 mb-1">마이너스통장 미사용한도</p>
              <p className="text-lg font-bold text-emerald-600">{fmt(overdraftAvailableTotal)}</p>
            </Link>
            <Link href="/reports/cash-position" className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <p className="text-xs text-slate-400 mb-1">순현금/순차입 포지션</p>
              <p className={`text-lg font-bold ${netCash < 0 ? 'text-red-500' : 'text-slate-900'}`}>{fmt(netCash)}</p>
            </Link>
            <Link href="/reports/cash-position" className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow">
              <p className="text-xs text-slate-400 mb-1">가용 자금</p>
              <p className="text-lg font-bold text-blue-600">{fmt(availableFunds)}</p>
            </Link>
          </div>
        </>
      )}

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
        <>
          {/* 일반 입출금 계좌 */}
          <h3 className="text-xs font-medium text-slate-400 mb-2">일반 입출금 계좌</h3>
          {normalAccounts.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-6 text-center text-slate-400 text-sm mb-6">등록된 일반 계좌가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
              {normalAccounts.map(acc => {
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
                    periodLabel={periodLabel}
                  />
                )
              })}
            </div>
          )}

          {/* 마이너스통장 계좌 */}
          {overdraftAccounts.length > 0 && (
            <>
              <h3 className="text-xs font-medium text-slate-400 mb-2">마이너스통장 계좌</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
                {overdraftAccounts.map(acc => {
                  const stats = monthlyStats[acc.id] ?? { in: 0, out: 0, confirmed: 0 }
                  const bal   = balanceMap[acc.id]
                  return (
                    <OverdraftAccountCard
                      key={acc.id}
                      id={acc.id}
                      name={acc.bank_name}
                      accountNumber={acc.account_number ?? null}
                      alias={acc.alias ?? null}
                      balance={bal?.balance ?? null}
                      balanceDate={bal?.balanceDate ?? null}
                      overdraftLimit={acc.overdraft_limit ?? null}
                      monthlyIn={stats.in}
                      monthlyOut={stats.out}
                      confirmedCount={stats.confirmed}
                      unclassifiedCount={unclassifiedMap[acc.id] ?? 0}
                      periodLabel={periodLabel}
                    />
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* 미연결 계좌 (bank_account_id 없는 거래 그룹) */}
      <OrphanedAccountsSection groups={orphanedGroups} />
    </div>
  )
}
