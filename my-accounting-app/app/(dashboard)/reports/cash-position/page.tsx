'use client'

import { useCallback, useEffect, useState } from 'react'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface CashPositionRow {
  bank_account_id: string
  bank_name: string
  account_number: string | null
  alias: string | null
  account_type: 'normal' | 'overdraft'
  overdraft_limit: number | null
  balance: number
  balance_date: string | null
  period_in: number
  period_out: number
  overdraft_used: number
  overdraft_available: number
}

interface FundSummary {
  held_cash: number
  overdraft_used: number
  overdraft_available: number
  net_cash: number
  available_funds: number
}

export default function CashPositionPage() {
  const [rows, setRows]     = useState<CashPositionRow[]>([])
  const [summary, setSummary] = useState<FundSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/reports/cash-position?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) {
      setRows(json.data)
      setSummary(json.summary ?? null)
    } else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const normalRows    = rows.filter(r => r.account_type === 'normal')
  const overdraftRows = rows.filter(r => r.account_type === 'overdraft')

  const totalIn  = rows.reduce((s, r) => s + r.period_in, 0)
  const totalOut = rows.reduce((s, r) => s + r.period_out, 0)
  const normalIn  = normalRows.reduce((s, r) => s + r.period_in, 0)
  const normalOut = normalRows.reduce((s, r) => s + r.period_out, 0)

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">계좌 통합현황</h1>
        <p className="text-sm mt-1 text-gray-500">법인계좌별 최신 잔액과 기간 내 입출금 합계를 한눈에 확인합니다.</p>
        <button onClick={() => { const a = document.createElement('a'); a.href = `/api/reports/cash-position/export?from=${dateFrom}&to=${dateTo}`; a.click() }}
          className="mt-2 px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 whitespace-nowrap inline-block">↓ 엑셀</button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
      </div>

      {/* 전체 자금 요약 */}
      <h2 className="text-sm font-semibold text-gray-700 mb-2">전체 자금 요약</h2>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">보유 현금</p>
          <p className="text-lg font-bold text-gray-900">{won(summary?.held_cash)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">마이너스통장 사용액</p>
          <p className="text-lg font-bold text-rose-600">{won(summary?.overdraft_used)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">마이너스통장 미사용한도</p>
          <p className="text-lg font-bold text-emerald-600">{won(summary?.overdraft_available)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">순현금/순차입 포지션</p>
          <p className={`text-lg font-bold ${(summary?.net_cash ?? 0) < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{won(summary?.net_cash)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3">
          <p className="text-xs text-gray-400 mb-1">가용 자금</p>
          <p className="text-lg font-bold text-blue-600">{won(summary?.available_funds)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : (
        <>
          {/* 일반 입출금 계좌 */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2">일반 입출금 계좌</h2>
          {normalRows.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm mb-6">등록된 일반 계좌가 없습니다.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">은행</th>
                    <th className="py-2.5 px-3 font-medium">계좌번호 / 별칭</th>
                    <th className="py-2.5 px-3 font-medium text-right">기간 입금</th>
                    <th className="py-2.5 px-3 font-medium text-right">기간 출금</th>
                    <th className="py-2.5 px-3 font-medium text-right">최신 잔액</th>
                    <th className="py-2.5 px-3 font-medium text-right">기준일</th>
                  </tr>
                </thead>
                <tbody>
                  {normalRows.map(r => (
                    <tr key={r.bank_account_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-900">{r.bank_name}</td>
                      <td className="py-2 px-3 text-gray-600">
                        <p className="truncate max-w-[220px]">{r.account_number ?? '-'}{r.alias ? ` (${r.alias})` : ''}</p>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-blue-600">{won(r.period_in)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-rose-600">{won(r.period_out)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(r.balance)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-gray-400 text-xs">{r.balance_date ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-medium text-gray-900">
                    <td className="py-2.5 px-3" colSpan={2}>합계</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-blue-700">{won(normalIn)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-rose-700">{won(normalOut)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">{won(summary?.held_cash)}</td>
                    <td className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 마이너스통장 계좌 */}
          <h2 className="text-sm font-semibold text-gray-700 mb-2">마이너스통장 계좌</h2>
          {overdraftRows.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-gray-400 text-sm mb-6">등록된 마이너스통장 계좌가 없습니다.</div>
          ) : (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">은행</th>
                    <th className="py-2.5 px-3 font-medium">계좌번호 / 별칭</th>
                    <th className="py-2.5 px-3 font-medium text-right">한도</th>
                    <th className="py-2.5 px-3 font-medium text-right">현재 잔액</th>
                    <th className="py-2.5 px-3 font-medium text-right">현재 사용액</th>
                    <th className="py-2.5 px-3 font-medium text-right">미사용 한도</th>
                    <th className="py-2.5 px-3 font-medium text-right">기준일</th>
                  </tr>
                </thead>
                <tbody>
                  {overdraftRows.map(r => (
                    <tr key={r.bank_account_id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-3 text-gray-900">{r.bank_name}</td>
                      <td className="py-2 px-3 text-gray-600">
                        <p className="truncate max-w-[220px]">{r.account_number ?? '-'}{r.alias ? ` (${r.alias})` : ''}</p>
                      </td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{won(r.overdraft_limit ? Math.abs(r.overdraft_limit) : 0)}</td>
                      <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.balance < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{won(r.balance)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-rose-600">{won(r.overdraft_used)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-emerald-600">{won(r.overdraft_available)}</td>
                      <td className="py-2 px-3 text-right whitespace-nowrap text-gray-400 text-xs">{r.balance_date ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 font-medium text-gray-900">
                    <td className="py-2.5 px-3" colSpan={2}>합계</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-gray-500">
                      {won(overdraftRows.reduce((s, r) => s + (r.overdraft_limit ? Math.abs(r.overdraft_limit) : 0), 0))}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      {won(overdraftRows.reduce((s, r) => s + r.balance, 0))}
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-rose-700">{won(summary?.overdraft_used)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap text-emerald-700">{won(summary?.overdraft_available)}</td>
                    <td className="py-2.5 px-3"></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* 기간 입출금 합계 (전체) */}
          <div className="flex gap-3 flex-wrap">
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">전체 계좌 기간 입금 합계</p>
              <p className="text-lg font-bold text-blue-600">{won(totalIn)}</p>
            </div>
            <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
              <p className="text-xs text-gray-400 mb-1">전체 계좌 기간 출금 합계</p>
              <p className="text-lg font-bold text-rose-600">{won(totalOut)}</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
