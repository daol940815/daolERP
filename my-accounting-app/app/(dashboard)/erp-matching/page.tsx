'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

interface Candidate {
  id: string
  order_no: string
  order_date: string
  customer_name: string
  collect_status: string
  net_amount: number
  allocated: number
  remaining: number
}

interface PendingDeposit {
  id: string
  source_type: 'bank' | 'card'
  tx_date: string
  tx_time?: string | null
  counterparty_name: string | null
  description: string | null
  vendor_name: string
  amount: number
  allocated: number
  remaining: number
  candidates: Candidate[]
}

interface MatchedRow {
  id: string
  order_id: string
  source_type: 'bank' | 'card'
  amount: number
  paid_date: string
  matched_by: 'auto' | 'manual'
  order_no: string
  customer_name: string
  counterparty_name: string | null
}

type Tab = 'pending' | 'matched'

export default function ErpMatchingPage() {
  const [tab, setTab]           = useState<Tab>('pending')
  const [pending, setPending]   = useState<PendingDeposit[]>([])
  const [matched, setMatched]   = useState<MatchedRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [working, setWorking]   = useState(false)
  const [dateFrom, setDateFrom] = useState(() => getPeriodRange('이번 달').from)
  const [dateTo, setDateTo]     = useState(() => getPeriodRange('이번 달').to)
  const [days, setDays]         = useState(7)
  const [search, setSearch]     = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  // 펼친 입금의 주문별 배분 입력값
  const [alloc, setAlloc]       = useState<Record<string, string>>({})
  const [msg, setMsg]           = useState<string | null>(null)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams()
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    const res  = await fetch(`/api/erp-matching?${p}`)
    const json = await res.json()
    if (res.ok) {
      setPending(json.pending ?? [])
      setMatched(json.matched ?? [])
    } else {
      showMsg(json.error ?? '조회 실패')
      setPending([]); setMatched([])
    }
    setExpandedId(null)
    setAlloc({})
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { load() }, [load])

  const handleRun = async () => {
    setWorking(true)
    const res  = await fetch('/api/erp-matching/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: dateFrom || undefined, to: dateTo || undefined, days }),
    })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(json.error ?? '자동 매칭 실패'); return }
    showMsg(`자동 매칭 ${json.matched}건 (${won(json.amount)}) 확정 — 검토대기 ${json.pending}건 남음`)
    load()
  }

  const toggleExpand = (d: PendingDeposit) => {
    if (expandedId === d.id) { setExpandedId(null); setAlloc({}); return }
    setExpandedId(d.id)
    // 잔액이 정확히 일치하는 후보가 하나면 미리 채워준다
    const exact = d.candidates.filter(c => c.remaining === d.remaining)
    setAlloc(exact.length === 1 ? { [exact[0].id]: String(d.remaining) } : {})
  }

  const handleAllocate = async (d: PendingDeposit) => {
    const allocations = Object.entries(alloc)
      .map(([order_id, v]) => ({ order_id, amount: Math.round(Number(String(v).replace(/,/g, ''))) }))
      .filter(a => Number.isFinite(a.amount) && a.amount > 0)
    if (!allocations.length) { showMsg('배분할 금액을 입력하세요.'); return }
    const sum = allocations.reduce((s, a) => s + a.amount, 0)
    if (sum > d.remaining) { showMsg(`배분 합계(${won(sum)})가 입금 잔액(${won(d.remaining)})을 초과합니다.`); return }
    setWorking(true)
    const res  = await fetch('/api/erp-matching', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_type: d.source_type, source_id: d.id, allocations }),
    })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(json.error ?? '배분 실패'); return }
    showMsg(`${allocations.length}건 배분 완료 (${won(sum)})`)
    load()
  }

  const handleUnmatch = async (m: MatchedRow) => {
    if (!window.confirm(`주문 ${m.order_no}의 매칭(${won(m.amount)}, ${m.paid_date})을 해제할까요?`)) return
    setWorking(true)
    const res  = await fetch(`/api/erp-matching?id=${m.id}`, { method: 'DELETE' })
    const json = await res.json()
    setWorking(false)
    if (!res.ok) { showMsg(json.error ?? '해제 실패'); return }
    showMsg('매칭 해제 완료')
    load()
  }

  const q = search.trim()
  const filteredPending = pending.filter(d =>
    !q || d.vendor_name.includes(q) || (d.counterparty_name ?? '').includes(q) || (d.description ?? '').includes(q))
  const filteredMatched = matched.filter(m =>
    !q || m.order_no.includes(q) || m.customer_name.includes(q) || (m.counterparty_name ?? '').includes(q))

  const pendingTotal = filteredPending.reduce((s, d) => s + d.remaining, 0)
  const matchedTotal = filteredMatched.reduce((s, m) => s + m.amount, 0)

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">수금 매칭</h1>
          <p className="text-sm mt-1 text-gray-500">
            은행 입금과 카드결제(매출처에 카드번호 등록 시)를 ERP 주문에 매칭합니다. 고신뢰 건(같은 거래처·금액 일치·날짜 근접·1:1)은 자동 확정되고,
            합산입금 등 모호한 건만 검토대기에서 수동 배분합니다.
            매칭 결과는 ERP 주문내역의 미수금 및 수금현황에서 자동으로 차감되어 표시됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-600"
            title="입금일과 주문일 차이 허용 범위"
          >
            {[3, 7, 15, 30, 60].map(d => <option key={d} value={d}>±{d}일</option>)}
          </select>
          <button
            onClick={handleRun}
            disabled={loading || working}
            className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40"
          >
            {working ? '처리 중...' : '자동 매칭 실행'}
          </button>
        </div>
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
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="거래처·입금자·주문번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* 탭 */}
      <div className="flex items-center gap-1 mb-4 border-b border-gray-200">
        {([
          ['pending', `검토대기 ${filteredPending.length}건 (${won(pendingTotal)})`],
          ['matched', `매칭완료 ${filteredMatched.length}건 (${won(matchedTotal)})`],
        ] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : tab === 'pending' ? (
        filteredPending.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">
            미배분 입금이 없습니다. 거래처가 연결된 입금만 대상이 되므로,
            거래내역 화면에서 거래처 자동매칭을 먼저 실행해주세요.
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2.5 px-3 font-medium">구분</th>
                  <th className="py-2.5 px-3 font-medium">입금일</th>
                  <th className="py-2.5 px-3 font-medium">거래처</th>
                  <th className="py-2.5 px-3 font-medium">입금자/적요</th>
                  <th className="py-2.5 px-3 font-medium text-right">입금액</th>
                  <th className="py-2.5 px-3 font-medium text-right">미배분</th>
                  <th className="py-2.5 px-3 font-medium text-right">후보 주문</th>
                  <th className="py-2.5 px-3 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredPending.map(d => {
                  const expanded = expandedId === d.id
                  const allocSum = Object.values(alloc)
                    .map(v => Math.round(Number(String(v).replace(/,/g, ''))))
                    .filter(n => Number.isFinite(n) && n > 0)
                    .reduce((s, n) => s + n, 0)
                  return (
                    <Fragment key={d.id}>
                      <tr className={`border-b border-gray-100 ${expanded ? 'bg-slate-50' : 'hover:bg-gray-50'}`}>
                        <td className="py-2 px-3">
                          <span className={`px-1.5 py-0.5 text-[11px] rounded ${
                            d.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                          }`}>
                            {d.source_type === 'card' ? '카드' : '계좌'}
                          </span>
                        </td>
                        <td className="py-2 px-3 whitespace-nowrap text-gray-600">{d.tx_date}{d.tx_time ? ` ${d.tx_time.slice(0, 8)}` : ''}</td>
                        <td className="py-2 px-3"><p className="truncate max-w-[160px]">{d.vendor_name}</p></td>
                        <td className="py-2 px-3">
                          <p className="truncate max-w-[200px] text-gray-600">{d.counterparty_name || d.description || '-'}</p>
                        </td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">{won(d.amount)}</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap font-medium text-red-600">{won(d.remaining)}</td>
                        <td className="py-2 px-3 text-right text-gray-500">{d.candidates.length}건</td>
                        <td className="py-2 px-3 text-right whitespace-nowrap">
                          <button
                            onClick={() => toggleExpand(d)}
                            disabled={working || d.candidates.length === 0}
                            className={`px-2 py-1 text-xs border rounded disabled:opacity-40 ${
                              expanded ? 'border-slate-400 bg-slate-100 text-slate-700' : 'border-blue-300 text-blue-700 hover:bg-blue-50'
                            }`}
                          >
                            {d.candidates.length === 0 ? '후보 없음' : expanded ? '▲ 닫기' : '배분하기'}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b border-gray-200 bg-slate-50">
                          <td colSpan={8} className="px-5 py-3">
                            <table className="w-full text-xs mb-3">
                              <thead>
                                <tr className="text-left text-gray-400">
                                  <th className="py-1 pr-3 font-medium">주문번호</th>
                                  <th className="py-1 pr-3 font-medium">주문일</th>
                                  <th className="py-1 pr-3 font-medium">매출처</th>
                                  <th className="py-1 pr-3 font-medium text-right">순매출</th>
                                  <th className="py-1 pr-3 font-medium text-right">기배분</th>
                                  <th className="py-1 pr-3 font-medium text-right">잔액</th>
                                  <th className="py-1 font-medium text-right">배분 금액</th>
                                </tr>
                              </thead>
                              <tbody>
                                {d.candidates.map(c => (
                                  <tr key={c.id} className="border-t border-gray-200 text-gray-700">
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.order_no}</td>
                                    <td className="py-1.5 pr-3 whitespace-nowrap">{c.order_date}</td>
                                    <td className="py-1.5 pr-3 max-w-[180px] truncate">{c.customer_name}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap">{won(c.net_amount)}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap text-gray-400">{won(c.allocated)}</td>
                                    <td className="py-1.5 pr-3 text-right whitespace-nowrap font-medium">{won(c.remaining)}</td>
                                    <td className="py-1.5 text-right">
                                      <input
                                        value={alloc[c.id] ?? ''}
                                        onChange={e => setAlloc(prev => ({ ...prev, [c.id]: e.target.value }))}
                                        placeholder="0"
                                        className="border border-gray-300 rounded px-2 py-1 text-xs w-28 text-right focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
                                      />
                                      <button
                                        onClick={() => setAlloc(prev => ({ ...prev, [c.id]: String(Math.min(c.remaining, d.remaining)) }))}
                                        className="ml-1 px-1.5 py-1 text-[11px] border border-gray-300 rounded text-gray-500 hover:bg-gray-100"
                                        title="주문 잔액(또는 입금 잔액)만큼 채우기"
                                      >채움</button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => handleAllocate(d)}
                                disabled={working || allocSum <= 0}
                                className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-xs hover:bg-slate-700 disabled:opacity-40"
                              >
                                {working ? '저장 중...' : `배분 저장 (${won(allocSum)})`}
                              </button>
                              <span className={`text-xs ${allocSum > d.remaining ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                                입금 잔액 {won(d.remaining)} 중 {won(allocSum)} 배분
                                {allocSum > d.remaining && ' — 잔액 초과!'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      ) : (
        filteredMatched.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-sm">기간 내 매칭된 건이 없습니다. 자동 매칭을 실행해보세요.</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2.5 px-3 font-medium">결제일</th>
                  <th className="py-2.5 px-3 font-medium">주문번호</th>
                  <th className="py-2.5 px-3 font-medium">매출처</th>
                  <th className="py-2.5 px-3 font-medium">입금자/카드번호</th>
                  <th className="py-2.5 px-3 font-medium text-right">매칭 금액</th>
                  <th className="py-2.5 px-3 font-medium">구분</th>
                  <th className="py-2.5 px-3 font-medium text-right">액션</th>
                </tr>
              </thead>
              <tbody>
                {filteredMatched.map(m => (
                  <tr key={m.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{m.paid_date}</td>
                    <td className="py-2 px-3 whitespace-nowrap">{m.order_no}</td>
                    <td className="py-2 px-3"><p className="truncate max-w-[180px]">{m.customer_name}</p></td>
                    <td className="py-2 px-3"><p className="truncate max-w-[140px] text-gray-600">{m.counterparty_name ?? '-'}</p></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap font-medium">{won(m.amount)}</td>
                    <td className="py-2 px-3">
                      <span className={`mr-1 px-1.5 py-0.5 text-[11px] rounded ${
                        m.source_type === 'card' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {m.source_type === 'card' ? '카드' : '계좌'}
                      </span>
                      <span className={`px-1.5 py-0.5 text-[11px] rounded ${
                        m.matched_by === 'auto' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'
                      }`}>
                        {m.matched_by === 'auto' ? '자동' : '수동'}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => handleUnmatch(m)}
                        disabled={working}
                        className="px-2 py-1 text-xs border border-red-200 text-red-600 rounded hover:bg-red-50 disabled:opacity-40"
                      >
                        해제
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  )
}
