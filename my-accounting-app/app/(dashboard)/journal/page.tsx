'use client'

import { useCallback, useEffect, useState } from 'react'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface Line {
  side: 'debit' | 'credit'
  amount: number
  note: string | null
  accounts: { code: string | null; name: string } | null
  vendors: { name: string } | null
}
interface Entry {
  id: string
  entry_no: string
  entry_date: string
  description: string | null
  source_type: string
  entry_type: string
  journal_lines: Line[]
}

const SOURCE: Record<string, { label: string; cls: string }> = {
  bank:        { label: '은행',       cls: 'bg-blue-100 text-blue-700' },
  card:        { label: '법인카드',   cls: 'bg-purple-100 text-purple-700' },
  tax_invoice: { label: '세금계산서', cls: 'bg-green-100 text-green-700' },
  manual:      { label: '수동',       cls: 'bg-gray-100 text-gray-600' },
}

export default function JournalPage() {
  const [entries, setEntries] = useState<Entry[]>([])
  const [summary, setSummary] = useState({ count: 0, total_amount: 0 })
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)

  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)
  const [sourceType, setSourceType] = useState('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo) p.set('to', dateTo)
    if (sourceType !== 'all') p.set('sourceType', sourceType)
    if (search.trim()) p.set('q', search.trim())
    const res = await fetch(`/api/journal?${p}`)
    const json = await res.json()
    if (Array.isArray(json.data)) { setEntries(json.data); setSummary(json.summary) }
    else { setMsg(`조회 실패: ${json.error ?? '오류'}`); setTimeout(() => setMsg(null), 4000); setEntries([]) }
    setLoading(false)
  }, [dateFrom, dateTo, sourceType, search])

  useEffect(() => { load() }, [load])

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">분개장</h1>
      <p className="text-sm mt-1 text-gray-500">거래 확정 시 자동 생성된 분개(복식부기)를 일자순으로 확인합니다.</p>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2 mt-3">
        {PERIOD_PRESETS.map(p => (
          <button key={p} onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors">
            {p}
          </button>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <select value={sourceType} onChange={e => setSourceType(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm">
          <option value="all">전체 출처</option>
          <option value="bank">은행</option>
          <option value="card">법인카드</option>
          <option value="tax_invoice">세금계산서</option>
          <option value="manual">수동</option>
        </select>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="전표번호·적요 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52" />
      </div>

      {/* 요약 */}
      <div className="flex gap-3 flex-wrap mb-4">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">전표 수</p>
          <p className="text-lg font-bold text-gray-900">{summary.count.toLocaleString()}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[160px]">
          <p className="text-xs text-gray-400 mb-1">분개 금액 합계(차변)</p>
          <p className="text-lg font-bold text-gray-900">{won(summary.total_amount)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">표시할 분개가 없습니다. (거래를 확정하면 자동 생성됩니다)</div>
      ) : (
        <div className="space-y-2">
          {entries.map(e => {
            const src = SOURCE[e.source_type] ?? { label: e.source_type, cls: 'bg-gray-100 text-gray-500' }
            return (
              <div key={e.id} className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border-b border-gray-100 text-sm">
                  <span className="text-gray-500 whitespace-nowrap">{e.entry_date}</span>
                  <span className="font-mono text-xs text-gray-400">{e.entry_no}</span>
                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${src.cls}`}>{src.label}</span>
                  <span className="text-gray-900 truncate flex-1">{e.description ?? ''}</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {[...e.journal_lines].sort((a, b) => (a.side === 'debit' ? -1 : 1) - (b.side === 'debit' ? -1 : 1)).map((l, i) => (
                      <tr key={i} className="border-b border-gray-50 last:border-0">
                        <td className="py-1.5 px-3 w-16">
                          {l.side === 'debit'
                            ? <span className="text-blue-600 font-medium text-xs">차변</span>
                            : <span className="text-red-600 font-medium text-xs">대변</span>}
                        </td>
                        <td className="py-1.5 px-2">
                          <span className="text-gray-400 text-xs mr-1">{l.accounts?.code ?? ''}</span>
                          {l.accounts?.name ?? '(계정)'}
                          {l.vendors?.name ? <span className="text-gray-400"> · {l.vendors.name}</span> : null}
                        </td>
                        <td className={`py-1.5 px-3 text-right whitespace-nowrap ${l.side === 'debit' ? 'text-blue-700' : 'text-gray-400'}`}>
                          {l.side === 'debit' ? won(l.amount) : ''}
                        </td>
                        <td className={`py-1.5 px-3 text-right whitespace-nowrap ${l.side === 'credit' ? 'text-red-700' : 'text-gray-400'}`}>
                          {l.side === 'credit' ? won(l.amount) : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
