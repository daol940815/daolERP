'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

const won = (n: number) => n.toLocaleString('ko-KR')
const eok = (n: number) => `${(n / 1e8).toFixed(2)}억`

export interface ReportLoan {
  id: string
  seq: number | null
  title: string
  bank_name: string
  current_balance: number
  interest_rate: number | null
  monthly_interest: number
  maturity_date: string | null
  status: 'active' | 'unused' | 'closed'
  product_type?: 'term' | 'credit_line'
  usage?: { limit: number; used: number; available: number }
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const addYears = (n: number) => {
  const d = new Date()
  d.setFullYear(d.getFullYear() + n)
  return d.toISOString().slice(0, 10)
}
const daysUntil = (d: string) =>
  Math.round((new Date(d).getTime() - new Date(todayStr()).getTime()) / 86400000)

// 대출별 현재 익스포저: 일반 대출은 잔액, 한도대출은 사용액(갚아야 할 금액)
const exposure = (l: ReportLoan) =>
  l.product_type === 'credit_line' ? (l.usage?.used ?? 0) : l.current_balance

// 마이너스 통장 이자 = 사용액 x 연이율 / 365 x 일수 (일할 후취)
const daysInThisMonth = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}
// 대출별 월 이자: 일반 대출은 마스터에 입력된 값, 한도대출은 사용액 기준 계산값
const monthlyInterestOf = (l: ReportLoan) => {
  if (l.product_type !== 'credit_line') return l.monthly_interest
  const used = l.usage?.used ?? 0
  if (!used || l.interest_rate == null) return 0
  return Math.round((used * (l.interest_rate / 100) / 365) * daysInThisMonth())
}

export default function AnnualReport({ loans }: { loans: ReportLoan[] }) {
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [actual, setActual] = useState<{ months: string[]; interest_expense: number[]; journal_ok: boolean } | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/loans/report?year=${year}`)
    const json = await res.json()
    setActual(res.ok ? json : null)
    setLoading(false)
  }, [year])
  useEffect(() => { load() }, [load])

  const live = useMemo(() => loans.filter(l => l.status !== 'closed'), [loans])

  // ── 지표 ────────────────────────────────────────────
  const termBalance = live.filter(l => l.product_type !== 'credit_line' && l.status === 'active')
    .reduce((s, l) => s + l.current_balance, 0)
  const creditUsed  = live.filter(l => l.product_type === 'credit_line').reduce((s, l) => s + (l.usage?.used ?? 0), 0)
  const creditLimit = live.filter(l => l.product_type === 'credit_line').reduce((s, l) => s + (l.usage?.limit ?? 0), 0)
  const totalDebt   = termBalance + creditUsed

  // 가중평균 조달금리 = Σ(익스포저 x 이율) / Σ익스포저
  const rated = live.filter(l => l.interest_rate != null && exposure(l) > 0)
  const weightedRate = rated.length
    ? rated.reduce((s, l) => s + exposure(l) * (l.interest_rate as number), 0) /
      rated.reduce((s, l) => s + exposure(l), 0)
    : 0

  // 계획 월 이자 = 일반 대출(마스터 입력) + 한도대출(사용액 기준 일할 계산)
  const planTerm = live.filter(l => l.product_type !== 'credit_line' && l.status === 'active')
    .reduce((s, l) => s + l.monthly_interest, 0)
  const planLine = live.filter(l => l.product_type === 'credit_line')
    .reduce((s, l) => s + monthlyInterestOf(l), 0)
  const planMonthly = planTerm + planLine
  const planYear = planMonthly * 12
  const actualYear = (actual?.interest_expense ?? []).reduce((s, v) => s + v, 0)

  // ── 만기 스케줄 ──────────────────────────────────────
  const t0 = todayStr(), y1 = addYears(1), y2 = addYears(2), y3 = addYears(3)
  const bucketOf = (md: string) =>
    md < t0 ? 'overdue' : md <= y1 ? 'y1' : md <= y2 ? 'y2' : md <= y3 ? 'y3' : 'over'
  const buckets: Record<string, { count: number; amount: number }> = {
    overdue: { count: 0, amount: 0 }, y1: { count: 0, amount: 0 },
    y2: { count: 0, amount: 0 }, y3: { count: 0, amount: 0 }, over: { count: 0, amount: 0 },
  }
  const maturityRows = live.filter(l => !!l.maturity_date)
    .sort((a, b) => (a.maturity_date ?? '').localeCompare(b.maturity_date ?? ''))
  for (const l of maturityRows) {
    const b = buckets[bucketOf(l.maturity_date as string)]
    b.count += 1
    b.amount += exposure(l)
  }

  // ── 은행별 구성 ──────────────────────────────────────
  const byBank = new Map<string, { amount: number; count: number }>()
  for (const l of live) {
    const cur = byBank.get(l.bank_name) ?? { amount: 0, count: 0 }
    cur.amount += exposure(l); cur.count += 1
    byBank.set(l.bank_name, cur)
  }
  const bankRows = Array.from(byBank.entries())
    .map(([bank, v]) => ({ bank, ...v, share: totalDebt > 0 ? (v.amount / totalDebt) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount)
  const topShare = bankRows[0]?.share ?? 0

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2]
  const card = 'bg-white border border-gray-200 rounded-xl p-4'
  const th = 'py-2.5 px-3 font-medium whitespace-nowrap'

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mt-4">
        <p className="text-sm text-gray-500">
          차입금 규모·금융비용·만기 도래를 연 단위로 봅니다. 계획은 대출 마스터의 계약 조건,
          실적은 확정된 이자비용 분개에서 집계합니다.
        </p>
        <select value={year} onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          {years.map(y => <option key={y} value={y}>{y}년</option>)}
        </select>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        <div className={card}>
          <div className="text-xs text-gray-400">총 차입 익스포저</div>
          <div className="text-xl font-bold mt-1">{eok(totalDebt)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">일반 {eok(termBalance)} · 한도 사용 {eok(creditUsed)}</div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-400">연간 이자비용</div>
          <div className="text-xl font-bold mt-1">{eok(actualYear > 0 ? actualYear : planYear)}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {actualYear > 0 ? `실적 기준 · 계획 ${eok(planYear)}` : `계획 기준 · 실적 집계 대기`}
          </div>
        </div>
        <div className={card}>
          <div className="text-xs text-gray-400">가중평균 조달금리</div>
          <div className="text-xl font-bold mt-1">{weightedRate.toFixed(2)}%</div>
          <div className="text-[11px] text-gray-400 mt-0.5">익스포저 가중 · {rated.length}건</div>
        </div>
        <div className={`${card} ${buckets.overdue.amount + buckets.y1.amount > 0 ? 'bg-amber-50 border-amber-300' : ''}`}>
          <div className="text-xs text-amber-700">1년 이내 만기</div>
          <div className="text-xl font-bold mt-1 text-amber-800">{eok(buckets.overdue.amount + buckets.y1.amount)}</div>
          <div className="text-[11px] text-amber-700 mt-0.5">
            {buckets.overdue.count + buckets.y1.count}건
            {buckets.overdue.count > 0 && ` · 만기 경과 ${buckets.overdue.count}건`}
          </div>
        </div>
      </div>

      {/* 만기 도래 스케줄 */}
      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-2">만기 도래 스케줄</h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([
          ['overdue', '만기 경과', 'text-red-700', 'bg-red-50 border-red-300'],
          ['y1', '1년 이내', 'text-amber-800', 'bg-amber-50 border-amber-300'],
          ['y2', '1~2년', 'text-gray-900', ''],
          ['y3', '2~3년', 'text-gray-900', ''],
          ['over', '3년 초과', 'text-gray-900', ''],
        ] as const).map(([k, label, txt, cls]) => (
          <div key={k} className={`bg-white border border-gray-200 rounded-xl p-4 ${buckets[k].count > 0 ? cls : ''}`}>
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`text-lg font-bold mt-1 ${buckets[k].count > 0 ? txt : 'text-gray-300'}`}>{eok(buckets[k].amount)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{buckets[k].count}건</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-3">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
              <th className={th}>만기일</th>
              <th className={th}>D-day</th>
              <th className={th}>대출명</th>
              <th className={th}>은행</th>
              <th className={`${th} text-right`}>만기 익스포저</th>
              <th className={`${th} text-right`}>이율</th>
              <th className={`${th} text-center`}>종류</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            {maturityRows.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-400 text-sm">만기일이 입력된 대출이 없습니다.</td></tr>
            ) : maturityRows.map(l => {
              const d = daysUntil(l.maturity_date as string)
              const overdue = d < 0
              const soon = d >= 0 && d <= 90
              return (
                <tr key={l.id} className={`border-b border-gray-100 ${overdue ? 'bg-red-50/50' : ''}`}>
                  <td className={`py-2 px-3 whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : ''}`}>{l.maturity_date}</td>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={`inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded ${
                      overdue ? 'bg-red-100 text-red-700' : soon ? 'bg-amber-100 text-amber-800' : 'text-gray-400'}`}>
                      {overdue ? '경과' : `D-${d}`}
                    </span>
                  </td>
                  <td className="py-2 px-3">{l.title}</td>
                  <td className="py-2 px-3 whitespace-nowrap">{l.bank_name}</td>
                  <td className="py-2 px-3 text-right font-medium whitespace-nowrap">{won(exposure(l))}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{l.interest_rate != null ? `${l.interest_rate}%` : '-'}</td>
                  <td className="py-2 px-3 text-center whitespace-nowrap">
                    <span className="inline-block whitespace-nowrap text-[11px] px-1.5 py-0.5 rounded bg-slate-100">
                      {l.product_type === 'credit_line' ? '한도' : '일반'}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 mt-1.5">
        만기 90일 이내는 노란색, 경과 건은 붉은색으로 표시합니다. 한도대출의 만기 익스포저는 현재 사용액입니다.
      </p>

      {/* 금융비용 계획 대비 실적 */}
      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-2">월별 금융비용 — 계획 대비 실적 ({year}년)</h2>
      {loading ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-400 text-sm">로딩 중...</div>
      ) : (
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
              <th className={th}>구분</th>
              {Array.from({ length: 12 }, (_, i) => (
                <th key={i} className={`${th} text-right`}>{i + 1}월</th>
              ))}
              <th className={`${th} text-right border-l border-gray-200`}>누계</th>
            </tr>
          </thead>
          <tbody className="text-gray-700">
            <tr className="border-b border-gray-100">
              <td className="py-2 px-3 text-gray-500 whitespace-nowrap" title={`일반 ${won(planTerm)} + 한도대출 ${won(planLine)}`}>
                계획 (계약 조건)
              </td>
              {Array.from({ length: 12 }, (_, i) => (
                <td key={i} className="py-2 px-3 text-right whitespace-nowrap">{won(planMonthly)}</td>
              ))}
              <td className="py-2 px-3 text-right font-medium whitespace-nowrap border-l border-gray-200">{won(planYear)}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="py-2 px-3 text-gray-500 whitespace-nowrap">실적 (이자비용 분개)</td>
              {(actual?.interest_expense ?? Array(12).fill(0)).map((v, i) => (
                <td key={i} className={`py-2 px-3 text-right whitespace-nowrap ${v ? '' : 'text-gray-300'}`}>{v ? won(v) : '-'}</td>
              ))}
              <td className={`py-2 px-3 text-right font-medium whitespace-nowrap border-l border-gray-200 ${actualYear ? '' : 'text-gray-300'}`}>
                {actualYear ? won(actualYear) : '-'}
              </td>
            </tr>
            <tr className="bg-slate-50 font-medium">
              <td className="py-2 px-3 whitespace-nowrap">차이</td>
              {(actual?.interest_expense ?? Array(12).fill(0)).map((v, i) => {
                const diff = v - planMonthly
                return (
                  <td key={i} className={`py-2 px-3 text-right whitespace-nowrap ${
                    !v ? 'text-gray-300' : diff > 0 ? 'text-rose-600' : 'text-blue-600'}`}>
                    {v ? won(diff) : '-'}
                  </td>
                )
              })}
              <td className={`py-2 px-3 text-right whitespace-nowrap border-l border-gray-200 ${
                !actualYear ? 'text-gray-300' : actualYear - planYear > 0 ? 'text-rose-600' : 'text-blue-600'}`}>
                {actualYear ? won(actualYear - planYear) : '-'}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      )}
      <p className="text-xs text-gray-400 mt-1.5">
        계획 = 일반 대출 월 이자({won(planTerm)}원) + 한도대출 예상 이자({won(planLine)}원, 사용액 × 연이율 ÷ 365 × 당월 일수)를
        12개월에 그대로 적용한 단순 계산입니다(중도 상환·금리 변동·사용액 변동 미반영).
        {actualYear === 0 && ' 실적은 확정된 이자비용(5301) 분개에서 집계하며, 대출 원리금 거래의 원금·이자 분리가 끝나면 채워집니다.'}
      </p>

      {/* 은행별 구성 */}
      <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-2">은행별 차입 구성 (편중도)</h2>
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        {bankRows.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-4">표시할 차입금이 없습니다.</div>
        ) : (
          <div className="space-y-3">
            {bankRows.map(r => (
              <div key={r.bank}>
                <div className="flex justify-between text-sm mb-1">
                  <span>{r.bank} <span className="text-gray-400 text-xs">{r.count}건</span></span>
                  <span className="font-medium">{eok(r.amount)} <span className="text-gray-400 text-xs font-normal">{r.share.toFixed(1)}%</span></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${r.share >= 80 ? 'bg-rose-500' : 'bg-slate-700'}`} style={{ width: `${r.share}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
        {topShare >= 80 && (
          <div className="mt-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            {bankRows[0].bank} 편중도 {topShare.toFixed(1)}% — 한 은행에 차입이 집중되어 있어 만기 연장 협의 시 협상력이 제한될 수 있습니다.
          </div>
        )}
      </div>

      {/* 한도 여력 */}
      {creditLimit > 0 && (
        <>
          <h2 className="text-sm font-semibold text-gray-700 mt-8 mb-2">한도대출 여력</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className={card}>
              <div className="text-xs text-gray-400">약정한도</div>
              <div className="text-lg font-bold mt-1">{eok(creditLimit)}</div>
            </div>
            <div className={card}>
              <div className="text-xs text-gray-400">사용액</div>
              <div className={`text-lg font-bold mt-1 ${creditUsed > 0 ? 'text-rose-600' : ''}`}>{eok(creditUsed)}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">
                사용률 {creditLimit > 0 ? ((creditUsed / creditLimit) * 100).toFixed(1) : '0.0'}%
              </div>
            </div>
            <div className={card}>
              <div className="text-xs text-gray-400">미사용 한도 (여신 여력)</div>
              <div className="text-lg font-bold mt-1 text-blue-600">{eok(Math.max(creditLimit - creditUsed, 0))}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">예상 월이자 {won(planLine)}원</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
