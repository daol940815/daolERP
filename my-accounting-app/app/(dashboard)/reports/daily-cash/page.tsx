'use client'

import { useCallback, useEffect, useState } from 'react'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface DailyCashRow {
  date: string
  opening_balance: number
  deposit: number
  withdrawal: number
  closing_balance: number
  held_cash: number
  overdraft_used: number
  net_cash: number
}

interface BankAccount {
  id: string
  bank_name: string
  alias: string | null
}

export default function DailyCashPage() {
  const [rows, setRows]     = useState<DailyCashRow[]>([])
  const [accounts, setAccounts] = useState<BankAccount[]>([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [msg, setMsg] = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    p.set('from', dateFrom)
    p.set('to', dateTo)
    if (bankAccountId) p.set('bankAccountId', bankAccountId)
    const res  = await fetch(`/api/reports/daily-cash?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) setRows(json.data)
    else { showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`); setRows([]) }
    setLoading(false)
  }, [dateFrom, dateTo, bankAccountId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    fetch('/api/bank-accounts')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d.data)) setAccounts(d.data) })
      .catch(() => null)
  }, [])

  const totalIn  = rows.reduce((s, r) => s + r.deposit, 0)
  const totalOut = rows.reduce((s, r) => s + r.withdrawal, 0)
  const last = rows.length ? rows[rows.length - 1] : null
  const lastHeldCash = last?.held_cash ?? 0
  const lastOverdraftUsed = last?.overdraft_used ?? 0
  const lastNetCash = last?.net_cash ?? 0

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">자금일보</h1>
        <p className="text-sm mt-1 text-gray-500">일별 전일잔액·입금·출금·당일잔액 흐름을 확인합니다. (조회 기간 최대 1년)</p>
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
        <select
          value={bankAccountId}
          onChange={e => setBankAccountId(e.target.value)}
          className={`border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900 ${bankAccountId ? 'border-blue-400 text-blue-700 bg-blue-50' : 'border-gray-300 text-gray-700'}`}
        >
          <option value="">전체 계좌 합산</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.bank_name}{a.alias ? ` (${a.alias})` : ''}</option>)}
        </select>
      </div>

      {/* 요약 카드 */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">기간 입금 합계</p>
          <p className="text-lg font-bold text-blue-600">{won(totalIn)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">기간 출금 합계</p>
          <p className="text-lg font-bold text-rose-600">{won(totalOut)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">기말 보유현금</p>
          <p className="text-lg font-bold text-gray-900">{won(lastHeldCash)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">기말 마이너스통장 사용액</p>
          <p className="text-lg font-bold text-rose-600">{won(lastOverdraftUsed)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">기말 순현금 ({dateTo})</p>
          <p className={`text-lg font-bold ${lastNetCash < 0 ? 'text-rose-600' : 'text-gray-900'}`}>{won(lastNetCash)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 데이터가 없습니다.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto max-h-[70vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 font-medium">일자</th>
                <th className="py-2.5 px-3 font-medium text-right">전일잔액</th>
                <th className="py-2.5 px-3 font-medium text-right">입금</th>
                <th className="py-2.5 px-3 font-medium text-right">출금</th>
                <th className="py-2.5 px-3 font-medium text-right">보유현금</th>
                <th className="py-2.5 px-3 font-medium text-right">마이너스통장 사용액</th>
                <th className="py-2.5 px-3 font-medium text-right">순현금</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.date} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="py-2 px-3 whitespace-nowrap text-gray-600">{r.date}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-gray-500">{won(r.opening_balance)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${r.deposit > 0 ? 'text-blue-600' : 'text-gray-300'}`}>{won(r.deposit)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${r.withdrawal > 0 ? 'text-rose-600' : 'text-gray-300'}`}>{won(r.withdrawal)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{won(r.held_cash)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${r.overdraft_used > 0 ? 'text-rose-600' : 'text-gray-300'}`}>{won(r.overdraft_used)}</td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap font-medium ${r.net_cash < 0 ? 'text-rose-600' : ''}`}>{won(r.net_cash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
