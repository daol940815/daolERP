'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

// 주문 현황 (시안 v2) — KPI(클릭=필터) + 통합 검색 + 칩 필터 + 행내 상품 펼치기.
// 검사 상태(정의 미확정)·배송 컬럼(3단계)은 제외 상태 — 트랙 문서 참고.
// 마진·매입 정보는 manager/admin에게만 표시.

interface Row {
  id: string
  order_no: string | null
  order_date: string
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null
  staff_name: string | null
  total_amount: number
  outstanding_amount: number
  collect_status: string | null
  source: string
  item_count: number
  channel: string | null
  is_prepay: boolean
  has_invoice: boolean
}
interface Kpi {
  count: number; total: number; outstanding: number
  outstanding_cnt: number; in_progress_cnt: number; direct_cnt: number
}
interface Item {
  id: string; line_no: number; parent_line_no: number | null
  is_canceled: boolean; is_prepayment: boolean
  item_name: string | null; order_kind: string | null
  purchase_vendor_name: string | null; quantity: number
  shipping_fee: number; line_total: number; purchase_total: number
}

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const kstToday = () => new Date().toLocaleDateString('sv-SE')
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('sv-SE')
}
const PERIODS = [
  { key: 'today', label: '오늘' },
  { key: '7d', label: '7일' },
  { key: '1m', label: '1개월' },
  { key: '3m', label: '3개월' },
  { key: '6m', label: '6개월' },
  { key: 'custom', label: '직접 지정' },
] as const
type PeriodKey = typeof PERIODS[number]['key']

const COLLECT_BADGE: Record<string, { label: string; cls: string }> = {
  collected:   { label: '수금완료', cls: 'bg-emerald-100 text-emerald-700' },
  in_progress: { label: '진행중',   cls: 'bg-amber-100 text-amber-800' },
  outstanding: { label: '미수금',   cls: 'bg-red-100 text-red-700' },
}

const chip = (on: boolean) =>
  `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
    on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
  }`

export default function OrdersHomePage() {
  const router = useRouter()
  const [rows, setRows] = useState<Row[]>([])
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [role, setRole] = useState('sales')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 필터
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [period, setPeriod] = useState<PeriodKey>('1m')
  const [customFrom, setCustomFrom] = useState(daysAgo(30))
  const [customTo, setCustomTo] = useState(kstToday())
  const [collect, setCollect] = useState('all')
  const [source, setSource] = useState('all')
  const [prepay, setPrepay] = useState(false)
  const [invoice, setInvoice] = useState(false)
  const [mine, setMine] = useState(false)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)

  // 행내 펼치기
  const [expanded, setExpanded] = useState<string | null>(null)
  const [itemsCache, setItemsCache] = useState<Record<string, Item[]>>({})

  const range = useCallback((): { from?: string; to?: string } => {
    switch (period) {
      case 'today': return { from: kstToday() }
      case '7d': return { from: daysAgo(7) }
      case '1m': return { from: daysAgo(30) }
      case '3m': return { from: daysAgo(91) }
      case '6m': return { from: daysAgo(182) }
      case 'custom': return { from: customFrom || undefined, to: customTo || undefined }
    }
  }, [period, customFrom, customTo])

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    const r = range()
    if (r.from) p.set('from', r.from)
    if (r.to) p.set('to', r.to)
    if (collect !== 'all') p.set('collect', collect)
    if (source !== 'all') p.set('source', source)
    if (prepay) p.set('prepay', '1')
    if (invoice) p.set('invoice', '1')
    if (mine) p.set('mine', '1')
    p.set('page', String(page))
    const res = await fetch(`/api/orders-portal?${p}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else {
      setRows(json.rows); setKpi(json.kpi); setRole(json.role ?? 'sales')
      setTotalPages(json.total_pages ?? 1)
      setExpanded(null)
    }
    setLoading(false)
  }, [q, range, collect, source, prepay, invoice, mine, page])
  useEffect(() => { load() }, [load])

  // 필터 변경 시 1페이지로
  useEffect(() => { setPage(1) }, [q, period, customFrom, customTo, collect, source, prepay, invoice, mine])

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return }
    setExpanded(id)
    if (!itemsCache[id]) {
      const res = await fetch(`/api/orders-portal/orders/${id}`)
      const json = await res.json()
      if (res.ok) setItemsCache(prev => ({ ...prev, [id]: json.items }))
    }
  }

  const showCost = role !== 'sales'
  const kpiCard = 'text-left bg-white border rounded-xl px-4 py-3 transition-colors'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">주문 현황</h1>
        <Link href="/orders/new"
          className="ml-auto px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">+ 주문 추가</Link>
      </div>

      {/* KPI — 클릭=필터 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
        <button onClick={() => { setCollect('all'); setSource('all') }}
          className={`${kpiCard} ${collect === 'all' && source === 'all' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">기간 주문</div>
          <div className="text-lg font-extrabold tabular-nums">{kpi ? `${won(kpi.count)}건` : '-'}</div>
        </button>
        <div className={`${kpiCard} border-gray-200`}>
          <div className="text-[11px] text-gray-400">총 금액</div>
          <div className="text-lg font-extrabold tabular-nums">{kpi ? `${won(kpi.total)}원` : '-'}</div>
        </div>
        <button onClick={() => setCollect(collect === 'outstanding' ? 'all' : 'outstanding')}
          className={`${kpiCard} ${collect === 'outstanding' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">미수금 (클릭=미수만)</div>
          <div className="text-lg font-extrabold tabular-nums text-red-600">{kpi ? `${won(kpi.outstanding)}원` : '-'}</div>
          {kpi && <div className="text-[10px] text-gray-400">{kpi.outstanding_cnt}건 미수 · {kpi.in_progress_cnt}건 진행중</div>}
        </button>
        <button onClick={() => setSource(source === 'direct' ? 'all' : 'direct')}
          className={`${kpiCard} ${source === 'direct' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">직접입력 (클릭=직접만)</div>
          <div className="text-lg font-extrabold tabular-nums text-blue-700">{kpi ? `${won(kpi.direct_cnt)}건` : '-'}</div>
        </button>
      </div>

      {/* 필터 바 */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()) }}
            placeholder="통합 검색 — 주문번호 · 주문처 · 담당자 · 상담자 · 다올직원 · 상품명 · 품번 (Enter)"
            className="flex-1 min-w-[280px] border border-gray-300 rounded-lg px-3.5 py-2 text-sm" />
          {q && (
            <button onClick={() => { setQ(''); setQInput('') }}
              className="text-xs text-gray-400 hover:text-gray-600">검색 해제 ✕</button>
          )}
          {PERIODS.map(p => (
            <button key={p.key} onClick={() => setPeriod(p.key)} className={chip(period === p.key)}>{p.label}</button>
          ))}
          {period === 'custom' && (
            <span className="flex items-center gap-1">
              <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs" />
              <span className="text-xs text-gray-400">~</span>
              <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs" />
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap mt-2">
          <span className="text-[11px] text-gray-400 mr-0.5">수금</span>
          {([['all', '전체'], ['collected', '수금완료'], ['in_progress', '진행중'], ['outstanding', '미수금']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setCollect(k)} className={chip(collect === k)}>{l}</button>
          ))}
          <span className="w-2" />
          <span className="text-[11px] text-gray-400 mr-0.5">출처</span>
          {([['all', '전체'], ['direct', '직접입력'], ['upload', '업로드']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setSource(k)} className={chip(source === k)}>{l}</button>
          ))}
          <span className="w-2" />
          <button onClick={() => setPrepay(v => !v)} className={chip(prepay)}>선결제만</button>
          <button onClick={() => setInvoice(v => !v)} className={chip(invoice)}>계산서 발행건만</button>
          <span className="flex-1" />
          <button onClick={() => setMine(v => !v)} className={chip(mine)}>내 주문만</button>
        </div>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[900px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">주문일 / 번호</th>
                <th className="py-2 px-3 text-left font-medium">주문처</th>
                <th className="py-2 px-3 text-left font-medium">담당자 (주문처)</th>
                <th className="py-2 px-3 text-left font-medium">직원 / 상담자</th>
                <th className="py-2 px-3 text-right font-medium">총금액</th>
                <th className="py-2 px-3 text-right font-medium">미수금</th>
                <th className="py-2 px-3 text-left font-medium">수금</th>
                <th className="py-2 px-3 text-left font-medium">출처</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const badge = COLLECT_BADGE[r.collect_status ?? ''] ?? { label: r.collect_status ?? '-', cls: 'bg-gray-100 text-gray-500' }
                const items = itemsCache[r.id]
                return (
                  <Fragment key={r.id}>
                    <tr onClick={() => router.push(`/orders/${r.id}`)}
                      className="border-b border-gray-50 cursor-pointer hover:bg-blue-50/40">
                      <td className="py-2 px-3">
                        <div className="tabular-nums text-xs font-semibold">{r.order_date}</div>
                        <div className="tabular-nums text-[11px] text-gray-400">{r.order_no ?? '-'}</div>
                      </td>
                      <td className="py-2 px-3">
                        <span className="font-semibold">{r.bank_name ?? '(주문처 미상)'}</span>
                        {r.branch_name && <span className="text-gray-400 ml-1">{r.branch_name}</span>}
                        {r.is_prepay && (
                          <span className="ml-1.5 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-600">선결제</span>
                        )}
                        {r.has_invoice && (
                          <span className="ml-1 inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600">계산서</span>
                        )}
                      </td>
                      <td className="py-2 px-3">{r.manager_name ?? '-'}</td>
                      <td className="py-2 px-3">
                        {r.staff_name ?? '-'}
                        {r.channel && r.channel !== r.staff_name && (
                          <span className="text-gray-400"> / {r.channel}</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">{won(r.total_amount)}</td>
                      <td className={`py-2 px-3 text-right tabular-nums ${r.outstanding_amount > 0 ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                        {won(r.outstanding_amount)}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="py-2 px-3">
                        <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${r.source === 'direct' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                          {r.source === 'direct' ? '직접입력' : '업로드'}
                        </span>
                      </td>
                      <td className="py-2 px-3 whitespace-nowrap">
                        {r.item_count > 0 && (
                          <button onClick={e => { e.stopPropagation(); toggleExpand(r.id) }}
                            className="text-xs text-blue-700 hover:underline">
                            상품 {r.item_count} {expanded === r.id ? '▾' : '▸'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === r.id && (
                      <tr className="border-b border-gray-100">
                        <td colSpan={9} className="bg-blue-50/30 px-6 py-2.5">
                          {!items ? <div className="text-xs text-gray-400 py-1">불러오는 중...</div> : (
                            <div className="space-y-0.5">
                              {items.map(it => (
                                <div key={it.id}
                                  className={`grid grid-cols-[1fr_auto_auto_auto] gap-x-6 text-xs items-center ${it.is_canceled ? 'text-gray-300 line-through' : ''}`}>
                                  <span className={it.parent_line_no ? 'pl-5 text-gray-500' : ''}>
                                    {it.parent_line_no && <span className="text-gray-400 mr-1 no-underline">└</span>}
                                    {it.item_name} × {it.quantity}
                                    {it.order_kind && (
                                      <span className="ml-1.5 no-underline inline-block px-1 py-0 rounded text-[10px] bg-gray-100 text-gray-500">{it.order_kind}</span>
                                    )}
                                    {it.is_canceled && <span className="ml-1 text-[10px] text-red-400 no-underline">취소</span>}
                                  </span>
                                  <span className="tabular-nums">판매 {won(it.line_total)}</span>
                                  <span className="tabular-nums text-gray-400">배송비 {won(it.shipping_fee)}</span>
                                  {showCost ? (
                                    <span className={`tabular-nums ${it.line_total - it.purchase_total >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                                      마진 {won(it.line_total - it.purchase_total)}
                                      {it.purchase_vendor_name && <span className="text-gray-400 ml-1.5">{it.purchase_vendor_name}</span>}
                                    </span>
                                  ) : <span />}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {!rows.length && (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400 text-sm">조건에 맞는 주문이 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
        <div className="flex items-center px-4 py-2.5 text-xs text-gray-400 border-t border-gray-100">
          <span>{kpi ? `${won(kpi.count)}건 중 ${rows.length ? (page - 1) * 50 + 1 : 0}-${(page - 1) * 50 + rows.length} 표시` : ''}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">이전</button>
            <span className="tabular-nums">{page} / {totalPages}</span>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}
              className="px-2.5 py-1 border border-gray-200 rounded disabled:opacity-40">다음</button>
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-2">
        행 클릭 = 상세 · 상품 N = 행에서 펼치기 · 기존 ERP 업로드분과 직접 입력분이 함께 보입니다
      </p>
    </div>
  )
}
