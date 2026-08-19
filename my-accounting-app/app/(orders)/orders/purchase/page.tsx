'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PoDetail from '../po-detail'

// 발주서 이력 (3단계, 시안 v3) — manager/admin 전용.
// 발주서 작성·발송은 주문 상세의 발주 섹션에서, 여기서는 전체 이력 조회·엑셀 재다운로드.
// 대금결제는 기존 매입처 정산 축 — 결제방식(선입금/월정산)만 함께 표시한다.

interface Row {
  id: string
  po_no: string
  order_id: string
  vendor_name: string
  total_amount: number
  email_to: string | null
  send_method: string | null
  sent_at: string | null
  send_error: string | null
  status: string
  po_date: string
  order_no: string | null
  customer: string | null
  staff_name: string | null
  sender_name: string | null
  payment_term: string | null
  uses_custom_po?: boolean
  po_use_sale_price?: boolean
}
interface Kpi { count: number; total: number; unsent_cnt: number; sent_cnt: number; canceled_cnt: number }

const won = (n: number) => (n ?? 0).toLocaleString('ko-KR')
const kstToday = () => new Date().toLocaleDateString('sv-SE')
const daysAgo = (n: number) => {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toLocaleDateString('sv-SE')
}
const chip = (on: boolean) =>
  `px-3 py-1 rounded-full text-xs border whitespace-nowrap ${
    on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'
  }`

export default function PurchaseHistoryPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(kstToday())
  const [status, setStatus] = useState('all')
  const [qInput, setQInput] = useState('')
  const [q, setQ] = useState('')
  const [openPo, setOpenPo] = useState<string | null>(null)   // 내용 펼친 발주서

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    if (status !== 'all') p.set('status', status)
    if (q) p.set('q', q)
    const res = await fetch(`/api/orders-portal/purchase-orders?${p}`)
    const json = await res.json()
    if (!res.ok) setError(json.error ?? '조회 실패')
    else { setRows(json.rows ?? []); setKpi(json.kpi ?? null) }
    setLoading(false)
  }, [from, to, status, q])
  useEffect(() => { load() }, [load])

  const sendBadge = (r: Row) => {
    if (r.status === 'canceled')
      return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-400">취소됨</span>
    if (r.sent_at)
      return (
        <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-emerald-100 text-emerald-700">
          {r.send_method === 'email' ? '메일 발송' : '수동 발송'}
        </span>
      )
    return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium bg-amber-100 text-amber-800">미발송</span>
  }

  const kpiCard = 'text-left bg-white border rounded-xl px-4 py-3 transition-colors'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">발주서</h1>
        <span className="text-xs text-gray-400">작성·발송은 주문 상세의 발주 섹션에서 · 여기서는 이력 조회</span>
      </div>

      {/* KPI — 클릭=필터 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mt-4">
        <button onClick={() => setStatus('all')}
          className={`${kpiCard} ${status === 'all' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">기간 발주</div>
          <div className="text-lg font-extrabold tabular-nums">{kpi ? `${won(kpi.count)}건` : '-'}</div>
          {kpi && <div className="text-[10px] text-gray-400">유효 발주 합계 {won(kpi.total)}원</div>}
        </button>
        <button onClick={() => setStatus(status === 'unsent' ? 'all' : 'unsent')}
          className={`${kpiCard} ${status === 'unsent' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">미발송 (클릭=필터)</div>
          <div className="text-lg font-extrabold tabular-nums text-amber-600">{kpi ? `${won(kpi.unsent_cnt)}건` : '-'}</div>
        </button>
        <button onClick={() => setStatus(status === 'sent' ? 'all' : 'sent')}
          className={`${kpiCard} ${status === 'sent' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">발송 완료</div>
          <div className="text-lg font-extrabold tabular-nums text-emerald-700">{kpi ? `${won(kpi.sent_cnt)}건` : '-'}</div>
        </button>
        <button onClick={() => setStatus(status === 'canceled' ? 'all' : 'canceled')}
          className={`${kpiCard} ${status === 'canceled' ? 'border-slate-800' : 'border-gray-200'}`}>
          <div className="text-[11px] text-gray-400">취소</div>
          <div className="text-lg font-extrabold tabular-nums text-gray-500">{kpi ? `${won(kpi.canceled_cnt)}건` : '-'}</div>
        </button>
      </div>

      {/* 필터 */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 mt-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400">발주일</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm tabular-nums" />
          <span className="text-xs text-gray-400">~</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm tabular-nums" />
          <span className="w-1.5" />
          {([['all', '전체'], ['unsent', '미발송'], ['sent', '발송완료'], ['canceled', '취소']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={chip(status === k)}>{l}</button>
          ))}
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()) }}
            placeholder="매입처·발주번호·주문번호·주문처 검색 Enter"
            className="flex-1 min-w-[240px] border border-gray-300 rounded-lg px-3.5 py-1.5 text-sm ml-auto" />
          {q && (
            <button onClick={() => { setQ(''); setQInput('') }}
              className="text-xs text-gray-400 hover:text-gray-600">검색 해제</button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-gray-400">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">발주일 / 번호</th>
                <th className="py-2 px-3 text-left font-medium">매입처</th>
                <th className="py-2 px-3 text-left font-medium">주문번호 / 주문처</th>
                <th className="py-2 px-3 text-right font-medium">매입 합계</th>
                <th className="py-2 px-3 text-left font-medium">발송</th>
                <th className="py-2 px-3 text-left font-medium">받는 이메일</th>
                <th className="py-2 px-3 text-left font-medium">대금결제</th>
                <th className="py-2 px-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <Fragment key={r.id}>
                <tr className={`border-b border-gray-50 ${r.status === 'canceled' ? 'text-gray-400' : ''}`}>
                  <td className="py-2 px-3">
                    <button type="button" onClick={() => setOpenPo(v => v === r.id ? null : r.id)}
                      title="발주서 내용 펼치기/접기" className="text-left hover:opacity-70">
                      <div className="tabular-nums text-xs font-semibold">
                        <span className="text-gray-400 mr-1">{openPo === r.id ? '▾' : '▸'}</span>{r.po_date}
                      </div>
                      <div className="tabular-nums text-[11px] text-gray-400 pl-3.5">{r.po_no}</div>
                    </button>
                  </td>
                  <td className="py-2 px-3 font-medium">
                    {r.vendor_name}
                    {r.uses_custom_po && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-600"
                        title="자체 발주서 양식을 쓰는 매입처">자체 양식</span>
                    )}
                    {r.po_use_sale_price && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600"
                        title="발주서 금액이 판매가로 기재되는 매입처">판매가</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <Link href={`/orders/${r.order_id}`} className="text-blue-700 hover:underline tabular-nums text-xs">
                      {r.order_no ?? '(주문으로 이동)'}
                    </Link>
                    <div className="text-[11px] text-gray-400">{r.customer ?? '-'}{r.staff_name ? ` · ${r.staff_name}` : ''}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{won(r.total_amount)}</td>
                  <td className="py-2 px-3">
                    {sendBadge(r)}
                    {r.sent_at && (
                      <div className="text-[10px] text-gray-400 tabular-nums mt-0.5">
                        {r.sent_at.slice(0, 16).replace('T', ' ')}{r.sender_name ? ` · ${r.sender_name}` : ''}
                      </div>
                    )}
                    {r.status === 'active' && !r.sent_at && r.send_error && (
                      <div className="text-[10px] text-red-500 mt-0.5">실패: {r.send_error}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.email_to ?? '-'}</td>
                  <td className="py-2 px-3 text-xs text-gray-500">{r.payment_term ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpenPo(v => v === r.id ? null : r.id)}
                      className="px-2.5 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:border-gray-400 mr-1.5">
                      {openPo === r.id ? '접기' : '내용'}
                    </button>
                    <a href={`/api/orders-portal/purchase-orders/${r.id}?excel=1`}
                      className="px-2.5 py-1 border border-gray-300 rounded text-xs text-gray-600 hover:border-gray-400">엑셀</a>
                  </td>
                </tr>
                {openPo === r.id && (
                  <tr className="border-b border-gray-50">
                    <td colSpan={8} className="bg-slate-50/40 px-4 py-3"><PoDetail poId={r.id} /></td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400 text-sm">조건에 맞는 발주서가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        주문번호 클릭 = 해당 주문 상세(발주 섹션) · 발주 취소·재발송도 주문 상세에서 처리합니다
      </p>
    </div>
  )
}
