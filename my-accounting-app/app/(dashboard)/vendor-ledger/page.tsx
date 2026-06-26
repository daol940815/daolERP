'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getPeriodRange, PERIOD_PRESETS } from '@/lib/period-presets'

const won = (n: number | null | undefined) => (n ?? 0).toLocaleString('ko-KR')

interface Balance {
  vendor_id: string
  vendor_name: string
  opening: number
  period_debit: number
  period_credit: number
  closing: number
  period_count: number
}
interface DetailRow {
  entry_date: string
  entry_no: string
  description: string | null
  account_code: string | null
  account_name: string | null
  debit: number
  credit: number
  balance: number
  note: string | null
}
interface Detail {
  vendor: { id: string; name: string }
  opening: number
  rows: DetailRow[]
  total_debit: number
  total_credit: number
  closing: number
}

export default function VendorLedgerPage() {
  const [tab, setTab] = useState<'balance' | 'detail'>('balance')
  const [balances, setBalances] = useState<Balance[]>([])
  const [detail, setDetail] = useState<Detail | null>(null)
  const [vendorId, setVendorId] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('당월').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('당월').to)

  const loadBalances = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ from: dateFrom, to: dateTo })
    const res = await fetch(`/api/ledger/vendor?${p}`)
    const json = await res.json()
    if (Array.isArray(json.balances)) setBalances(json.balances)
    else { setBalances([]); setMsg(`조회 실패: ${json.error ?? '오류'}`); setTimeout(() => setMsg(null), 4000) }
    setLoading(false)
  }, [dateFrom, dateTo])

  const loadDetail = useCallback(async (vid: string) => {
    setLoading(true)
    const p = new URLSearchParams({ vendorId: vid, from: dateFrom, to: dateTo })
    const res = await fetch(`/api/ledger/vendor?${p}`)
    const json = await res.json()
    if (res.ok && json.vendor) setDetail(json)
    else { setDetail(null); setMsg(`조회 실패: ${json.error ?? '오류'}`); setTimeout(() => setMsg(null), 4000) }
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => {
    if (tab === 'balance') loadBalances()
    else if (vendorId) loadDetail(vendorId)
  }, [tab, vendorId, loadBalances, loadDetail])

  const openDetail = (vid: string) => { setVendorId(vid); setTab('detail') }

  const filtered = useMemo(
    () => balances.filter(b => !search.trim() || b.vendor_name.includes(search.trim())),
    [balances, search],
  )
  const totals = useMemo(() => filtered.reduce(
    (a, b) => ({ opening: a.opening + b.opening, debit: a.debit + b.period_debit, credit: a.credit + b.period_credit, closing: a.closing + b.closing }),
    { opening: 0, debit: 0, credit: 0, closing: 0 },
  ), [filtered])

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900">거래처별 원장</h1>
      <p className="text-sm mt-1 text-gray-500">분개장을 원천으로 거래처별 채권·채무 잔액과 거래내역을 확인합니다. (양수=미수/채권, 음수=미지급/채무)</p>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {/* 탭 */}
      <div className="flex gap-1 mt-3 mb-3 border-b border-gray-200">
        {([['balance', '잔액'], ['detail', '내용']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === k ? 'border-slate-800 text-slate-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {PERIOD_PRESETS.map(p => (
          <button key={p} onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors">
            {p}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm" />
        {tab === 'balance' && (
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="거래처명 검색"
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52" />
        )}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : tab === 'balance' ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">거래처</th>
                <th className="py-2 px-3 text-right font-medium w-32">전월이월</th>
                <th className="py-2 px-3 text-right font-medium w-28">차변</th>
                <th className="py-2 px-3 text-right font-medium w-28">대변</th>
                <th className="py-2 px-3 text-right font-medium w-32">잔액</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={5} className="text-center py-12 text-gray-400 text-sm">표시할 거래처가 없습니다.</td></tr>
              ) : filtered.map(b => (
                <tr key={b.vendor_id} onClick={() => openDetail(b.vendor_id)}
                  className="border-b border-gray-50 hover:bg-slate-50 cursor-pointer">
                  <td className="py-2 px-3 text-gray-800">{b.vendor_name}</td>
                  <td className="py-2 px-3 text-right text-gray-500">{won(b.opening)}</td>
                  <td className="py-2 px-3 text-right text-blue-700">{b.period_debit ? won(b.period_debit) : ''}</td>
                  <td className="py-2 px-3 text-right text-red-700">{b.period_credit ? won(b.period_credit) : ''}</td>
                  <td className={`py-2 px-3 text-right font-medium ${b.closing < 0 ? 'text-red-600' : 'text-gray-900'}`}>{won(b.closing)}</td>
                </tr>
              ))}
              {filtered.length > 0 && (
                <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-gray-800">
                  <td className="py-2 px-3">합계 ({filtered.length.toLocaleString()}개 거래처)</td>
                  <td className="py-2 px-3 text-right">{won(totals.opening)}</td>
                  <td className="py-2 px-3 text-right text-blue-700">{won(totals.debit)}</td>
                  <td className="py-2 px-3 text-right text-red-700">{won(totals.credit)}</td>
                  <td className={`py-2 px-3 text-right ${totals.closing < 0 ? 'text-red-600' : ''}`}>{won(totals.closing)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 px-3 py-2 bg-gray-50/50">거래처 행을 클릭하면 상세 내역(내용 탭)으로 이동합니다.</p>
        </div>
      ) : (
        /* 내용 탭 */
        <div>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <select value={vendorId} onChange={e => setVendorId(e.target.value)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm min-w-[220px]">
              <option value="">거래처 선택…</option>
              {balances.map(b => <option key={b.vendor_id} value={b.vendor_id}>{b.vendor_name}</option>)}
            </select>
            {detail && (
              <div className="flex gap-3 flex-wrap text-sm">
                <span className="text-gray-400">전월이월 <b className="text-gray-700">{won(detail.opening)}</b></span>
                <span className="text-gray-400">기말잔액 <b className={detail.closing < 0 ? 'text-red-600' : 'text-gray-900'}>{won(detail.closing)}</b></span>
              </div>
            )}
          </div>

          {!vendorId ? (
            <div className="text-center py-20 text-gray-400 text-sm">거래처를 선택하면 상세 원장이 표시됩니다.</div>
          ) : !detail ? (
            <div className="text-center py-20 text-gray-400 text-sm">데이터가 없습니다.</div>
          ) : (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium w-24">일자</th>
                    <th className="py-2 px-2 text-left font-medium">적요</th>
                    <th className="py-2 px-2 text-left font-medium">계정과목</th>
                    <th className="py-2 px-3 text-right font-medium w-28">차변</th>
                    <th className="py-2 px-3 text-right font-medium w-28">대변</th>
                    <th className="py-2 px-3 text-right font-medium w-32">잔액</th>
                    <th className="py-2 px-3 text-left font-medium w-32">전표번호</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="bg-amber-50/60 border-b border-gray-100 text-gray-600">
                    <td className="py-1.5 px-3" colSpan={3}>[전월이월]</td>
                    <td className="py-1.5 px-3 text-right text-gray-300">-</td>
                    <td className="py-1.5 px-3 text-right text-gray-300">-</td>
                    <td className="py-1.5 px-3 text-right font-medium">{won(detail.opening)}</td>
                    <td></td>
                  </tr>
                  {detail.rows.length === 0 ? (
                    <tr><td colSpan={7} className="text-center py-10 text-gray-400 text-sm">해당 기간 거래가 없습니다.</td></tr>
                  ) : detail.rows.map((r, i) => (
                    <tr key={i} className="border-b border-gray-50 hover:bg-slate-50/60">
                      <td className="py-1.5 px-3 whitespace-nowrap text-gray-600">{r.entry_date}</td>
                      <td className="py-1.5 px-2 text-gray-800">{r.description ?? ''}</td>
                      <td className="py-1.5 px-2 text-gray-500">
                        <span className="text-gray-400 text-xs mr-1">{r.account_code ?? ''}</span>{r.account_name ?? ''}
                      </td>
                      <td className="py-1.5 px-3 text-right text-blue-700 whitespace-nowrap">{r.debit ? won(r.debit) : ''}</td>
                      <td className="py-1.5 px-3 text-right text-red-700 whitespace-nowrap">{r.credit ? won(r.credit) : ''}</td>
                      <td className={`py-1.5 px-3 text-right whitespace-nowrap ${r.balance < 0 ? 'text-red-600' : 'text-gray-800'}`}>{won(r.balance)}</td>
                      <td className="py-1.5 px-3 font-mono text-xs text-gray-400">{r.entry_no}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-100 border-t-2 border-slate-300 font-semibold text-gray-800">
                    <td className="py-2 px-3" colSpan={3}>[누계]</td>
                    <td className="py-2 px-3 text-right text-blue-700">{won(detail.total_debit)}</td>
                    <td className="py-2 px-3 text-right text-red-700">{won(detail.total_credit)}</td>
                    <td className={`py-2 px-3 text-right ${detail.closing < 0 ? 'text-red-600' : ''}`}>{won(detail.closing)}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
