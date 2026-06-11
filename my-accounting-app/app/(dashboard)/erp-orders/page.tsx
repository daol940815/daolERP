'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ErpOrder, ErpOrderItem } from '@/types/erp'
import { PERIOD_PRESETS, getPeriodRange } from '@/lib/period-presets'

const won = (n: number | null | undefined) => `${(n ?? 0).toLocaleString('ko-KR')}원`

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  collected:   { text: '수금완료',   cls: 'bg-green-50 text-green-700' },
  outstanding: { text: '미수금',     cls: 'bg-red-50 text-red-600' },
  in_progress: { text: '수금진행중', cls: 'bg-amber-50 text-amber-700' },
}

type View = 'all' | 'vip' | 'prepayment'

export default function ErpOrdersPage() {
  const uploadRef = useRef<HTMLInputElement>(null)

  const [orders, setOrders]     = useState<ErpOrder[]>([])
  const [items, setItems]       = useState<ErpOrderItem[]>([])
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [view, setView]         = useState<View>('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [search, setSearch]     = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [msg, setMsg]           = useState<string | null>(null)
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [summary, setSummary]   = useState({ net_sales: 0, outstanding: 0 })

  const PAGE_SIZE = 100

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ view, page: String(page), limit: String(PAGE_SIZE) })
    if (statusFilter !== 'all') p.set('status', statusFilter)
    if (dateFrom) p.set('from', dateFrom)
    if (dateTo)   p.set('to', dateTo)
    if (search.trim()) p.set('q', search.trim())
    const res  = await fetch(`/api/erp-orders?${p}`)
    const json = await res.json()
    if (res.ok) {
      setOrders(json.data ?? [])
      setItems(json.items ?? [])
      setTotal(json.total ?? 0)
      if (json.summary) setSummary(json.summary)
    } else {
      showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    }
    setSelected(new Set())
    setLoading(false)
  }, [view, statusFilter, dateFrom, dateTo, search, page])

  useEffect(() => { load() }, [load])

  // 필터 변경 시 1페이지로
  useEffect(() => { setPage(1) }, [view, statusFilter, dateFrom, dateTo, search])

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    let okOrders = 0, okItems = 0, failed = 0
    for (const file of Array.from(files)) {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/erp-orders/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (res.ok) { okOrders += json.imported_orders ?? 0; okItems += json.imported_items ?? 0 }
      else { failed += 1; showMsg(`업로드 실패 (${file.name}): ${json.error ?? '알 수 없는 오류'}`) }
    }
    setUploading(false)
    if (uploadRef.current) uploadRef.current.value = ''
    if (okOrders) showMsg(`주문 ${okOrders}건 / 품목 ${okItems}건 업로드 완료${failed ? ` (실패 ${failed}파일)` : ''}`)
    load()
  }

  const handleDeduct = async (order: ErpOrder) => {
    if (!order.customer_alias_id) { showMsg('매출처 정보가 없는 주문입니다.'); return }
    const input = window.prompt(
      `[선결제 차감] 주문 ${order.order_no} (${[order.bank_name, order.branch_name].filter(Boolean).join(' ')})\n차감할 금액을 입력하세요. (주문 합계: ${won(order.total_amount)})`,
      String(order.total_amount),
    )
    if (input === null) return
    const amount = Math.round(Number(input.replace(/,/g, '')))
    if (!Number.isFinite(amount) || amount <= 0) { showMsg('금액이 올바르지 않습니다.'); return }
    const res = await fetch('/api/erp-prepayments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        direction: 'customer',
        alias_id: order.customer_alias_id,
        entry_date: new Date().toISOString().slice(0, 10),
        entry_type: 'deduction',
        amount,
        order_id: order.id,
        memo: `주문 ${order.order_no} 선결제 차감`,
      }),
    })
    const json = await res.json()
    if (!res.ok) { showMsg(`차감 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(json.warning ? `차감 완료 (경고: ${json.warning})` : `${won(amount)} 선결제 차감 완료`)
  }

  const handleBulkDelete = async () => {
    if (!selected.size) return
    if (!window.confirm(`선택한 주문 ${selected.size}건과 그 품목을 모두 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.`)) return
    setDeleting(true)
    const res  = await fetch('/api/erp-orders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: Array.from(selected) }),
    })
    const json = await res.json()
    setDeleting(false)
    if (!res.ok) { showMsg(`삭제 실패: ${json.error ?? '알 수 없는 오류'}`); return }
    showMsg(`${json.deleted}건 삭제됨`)
    load()
  }

  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev)
    if (n.has(id)) { n.delete(id) } else { n.add(id) }
    return n
  })
  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev)
    if (n.has(id)) { n.delete(id) } else { n.add(id) }
    return n
  })

  const itemsByOrder = new Map<string, ErpOrderItem[]>()
  for (const it of items) {
    const list = itemsByOrder.get(it.order_id) ?? []
    list.push(it)
    itemsByOrder.set(it.order_id, list)
  }

  const totalPages = Math.max(Math.ceil(total / PAGE_SIZE), 1)

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ERP 주문내역</h1>
          <p className="text-sm mt-1 text-gray-500">ERP에서 다운로드한 주문/품목 데이터 (매출처 수금 · 매입처 정산 기준 데이터)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={deleting}
              className="px-3 py-2 border border-red-300 rounded-lg text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              {deleting ? '삭제 중...' : `선택 ${selected.size}건 삭제`}
            </button>
          )}
          <input
            ref={uploadRef}
            type="file"
            accept=".xls,.xlsx"
            multiple
            className="hidden"
            onChange={e => handleUpload(e.target.files)}
          />
          <button
            onClick={() => uploadRef.current?.click()}
            disabled={uploading}
            className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700 disabled:opacity-40"
          >
            {uploading ? '업로드 중...' : '↑ ERP 파일 업로드'}
          </button>
        </div>
      </div>

      {msg && (
        <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>
      )}

      <p className="text-xs text-gray-400 mb-3 mt-1">
        ERP 주문 다운로드 파일(.xls)을 그대로 업로드하세요. 여러 파일 동시 선택 가능하며, 같은 주문번호는 자동으로 갱신됩니다.
      </p>

      {/* 보기 탭 */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
        {([['all', '전체'], ['vip', 'VIP'], ['prepayment', '선결제']] as [View, string][]).map(([v, label]) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              view === v ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 기간 빠른 선택 */}
      <div className="flex flex-wrap items-center gap-1 mb-2">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p}
            onClick={() => { const r = getPeriodRange(p); setDateFrom(r.from); setDateTo(r.to) }}
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md text-gray-600 hover:bg-slate-100 hover:border-slate-400 transition-colors"
          >
            {p}
          </button>
        ))}
        {(dateFrom || dateTo) && (
          <button onClick={() => { setDateFrom(''); setDateTo('') }} className="px-2.5 py-1 text-xs text-gray-400 hover:text-gray-600">
            ✕ 전체 기간
          </button>
        )}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900">
          <option value="all">전체 상태</option>
          <option value="collected">수금완료</option>
          <option value="outstanding">미수금</option>
          <option value="in_progress">수금진행중</option>
        </select>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="주문번호/은행/지점 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-slate-900"
        />
      </div>

      {/* 요약 카드 (필터 전체 범위 기준) */}
      <div className="flex gap-3 flex-wrap mb-5">
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">주문 수</p>
          <p className="text-lg font-bold text-gray-900">{total.toLocaleString()}건</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">순매출 (취소·VIP·선결제 제외)</p>
          <p className="text-lg font-bold text-gray-900">{won(summary.net_sales)}</p>
        </div>
        <div className="border border-gray-200 rounded-lg px-4 py-3 flex-1 min-w-[150px]">
          <p className="text-xs text-gray-400 mb-1">미수금</p>
          <p className={`text-lg font-bold ${summary.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(summary.outstanding)}</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : orders.length === 0 ? (
        <div className="text-center py-20 text-gray-400 text-sm">
          데이터가 없습니다. ERP 다운로드 파일을 업로드해주세요.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                <th className="py-2.5 px-3 w-8"></th>
                <th className="py-2.5 px-3 font-medium">주문일</th>
                <th className="py-2.5 px-3 font-medium">주문번호</th>
                <th className="py-2.5 px-3 font-medium">매출처 (은행·지점)</th>
                <th className="py-2.5 px-3 font-medium">담당자</th>
                <th className="py-2.5 px-3 font-medium text-right">총금액</th>
                <th className="py-2.5 px-3 font-medium text-right">미수금</th>
                <th className="py-2.5 px-3 font-medium">상태</th>
                <th className="py-2.5 px-3 font-medium text-right">액션</th>
              </tr>
            </thead>
            <tbody>
              {orders.map(o => {
                const oItems = itemsByOrder.get(o.id) ?? []
                const status = STATUS_LABEL[o.collect_status]
                const hasCancel = oItems.some(it => it.is_canceled)
                const hasVip    = oItems.some(it => it.is_vip)
                const hasPre    = oItems.some(it => it.is_prepayment)
                return [
                  <tr key={o.id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3">
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelect(o.id)} />
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-gray-600">{o.order_date}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <button onClick={() => toggleExpand(o.id)} className="text-slate-900 hover:underline font-mono text-xs">
                        {expanded.has(o.id) ? '▾' : '▸'} {o.order_no}
                      </button>
                      <span className="ml-1.5 text-xs text-gray-400">({oItems.length})</span>
                    </td>
                    <td className="py-2 px-3 min-w-0">
                      <p className="truncate max-w-[200px] text-gray-900">
                        {[o.bank_name, o.branch_name].filter(Boolean).join(' ') || '-'}
                      </p>
                    </td>
                    <td className="py-2 px-3 text-gray-500 whitespace-nowrap text-xs">{o.manager_name ?? '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{won(o.total_amount)}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${o.outstanding_amount > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {won(o.outstanding_amount)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {status && <span className={`px-1.5 py-0.5 rounded text-xs ${status.cls}`}>{status.text}</span>}
                      {hasCancel && <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-gray-100 text-gray-500">취소포함</span>}
                      {hasVip    && <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-violet-50 text-violet-600">VIP</span>}
                      {hasPre    && <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-sky-50 text-sky-600">선결제</span>}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDeduct(o)}
                        className="px-2 py-1 text-xs border border-sky-300 text-sky-700 rounded hover:bg-sky-50"
                        title="이 주문 금액을 매출처 선결제 잔액에서 차감 처리"
                      >
                        선결제차감
                      </button>
                    </td>
                  </tr>,
                  expanded.has(o.id) && (
                    <tr key={`${o.id}-items`} className="bg-slate-50 border-b border-gray-100">
                      <td colSpan={9} className="py-2 px-6">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-left text-gray-400">
                              <th className="py-1 pr-3 font-medium">품명</th>
                              <th className="py-1 pr-3 font-medium">매입처</th>
                              <th className="py-1 pr-3 font-medium text-right">판매가</th>
                              <th className="py-1 pr-3 font-medium text-right">수량</th>
                              <th className="py-1 pr-3 font-medium text-right">합계</th>
                              <th className="py-1 pr-3 font-medium text-right">매입액</th>
                              <th className="py-1 pr-3 font-medium">정산월</th>
                              <th className="py-1 font-medium">구분</th>
                            </tr>
                          </thead>
                          <tbody>
                            {oItems.map(it => (
                              <tr key={it.id} className={`border-t border-gray-200 ${it.is_canceled ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
                                <td className="py-1 pr-3 max-w-[260px] truncate">{it.item_name ?? '-'}</td>
                                <td className="py-1 pr-3 max-w-[140px] truncate">{it.purchase_vendor_name ?? '-'}</td>
                                <td className="py-1 pr-3 text-right whitespace-nowrap">{won(it.sale_price)}</td>
                                <td className="py-1 pr-3 text-right">{it.quantity}</td>
                                <td className="py-1 pr-3 text-right whitespace-nowrap">{won(it.line_total)}</td>
                                <td className="py-1 pr-3 text-right whitespace-nowrap">{won(it.purchase_total)}</td>
                                <td className="py-1 pr-3 whitespace-nowrap">{it.settlement_month ?? '-'}</td>
                                <td className="py-1 whitespace-nowrap no-underline">
                                  {it.is_canceled   && <span className="px-1 py-0.5 rounded bg-gray-200 text-gray-500 mr-1">취소</span>}
                                  {it.is_vip        && <span className="px-1 py-0.5 rounded bg-violet-100 text-violet-600 mr-1">VIP</span>}
                                  {it.is_prepayment && <span className="px-1 py-0.5 rounded bg-sky-100 text-sky-600">선결제</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  ),
                ]
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 페이지네이션 */}
      {!loading && total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <p className="text-gray-400 text-xs">
            {((page - 1) * PAGE_SIZE + 1).toLocaleString()}–{Math.min(page * PAGE_SIZE, total).toLocaleString()} / {total.toLocaleString()}건
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(p - 1, 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              ← 이전
            </button>
            <span className="px-3 text-gray-500 text-xs">{page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(p + 1, totalPages))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30"
            >
              다음 →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
