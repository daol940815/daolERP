'use client'

import PeriodPresets from '@/components/ui/PeriodPresets'
import { PageHeader, FilterRow, KpiGrid, KpiCard, Chip, fieldBox } from '@/components/ui/kit'
import { Fragment, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import PoDetail from '../po-detail'
import { getPeriodRange } from '@/lib/period-presets'

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

export default function PurchaseHistoryPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [kpi, setKpi] = useState<Kpi | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [from, setFrom] = useState(() => getPeriodRange('당월').from)   // 원본·작업 목록 기본 = 당월
  const [to, setTo] = useState(() => getPeriodRange('당월').to)
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
      return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-500">취소됨</span>
    if (r.sent_at)
      return (
        <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-700">
          {r.send_method === 'email' ? '메일 발송' : '수동 발송'}
        </span>
      )
    return <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">미발송</span>
  }


  return (
    <div>
      <PageHeader title="발주서" desc="작성은 주문 상세의 발주 섹션에서 합니다. 줄을 누르면 발송 페이지(다운로드 · 첨부 · 메일 발송)로 갑니다." />

      {/* 화면 순서(UI 통일 기준): 제목 줄 → 기간 → 요약 카드 → 검색 · 칩 → 표 */}
      <FilterRow>
        <PeriodPresets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        <span className="w-1.5" />
        <span className="text-xs font-bold text-slate-700">발주일</span>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={fieldBox({ size: 'sm', noWidth: true, extra: 'tabular-nums' })} />
        <span className="text-xs text-slate-600">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className={fieldBox({ size: 'sm', noWidth: true, extra: 'tabular-nums' })} />
      </FilterRow>

      {/* KPI — 클릭=필터 */}
      <KpiGrid cols={4}>
        <KpiCard label="기간 발주" value={kpi ? `${won(kpi.count)}건` : '-'} sub={kpi ? `유효 발주 합계 ${won(kpi.total)}원` : undefined}
          active={status === 'all'} onClick={() => setStatus('all')} />
        <KpiCard label="미발송 (클릭=필터)" tone="amber" value={kpi ? `${won(kpi.unsent_cnt)}건` : '-'}
          active={status === 'unsent'} onClick={() => setStatus(status === 'unsent' ? 'all' : 'unsent')} />
        <KpiCard label="발송 완료" tone="green" value={kpi ? `${won(kpi.sent_cnt)}건` : '-'}
          active={status === 'sent'} onClick={() => setStatus(status === 'sent' ? 'all' : 'sent')} />
        <KpiCard label="취소" tone="gray" value={kpi ? `${won(kpi.canceled_cnt)}건` : '-'}
          active={status === 'canceled'} onClick={() => setStatus(status === 'canceled' ? 'all' : 'canceled')} />
      </KpiGrid>

      <div className="bg-white border border-slate-300 rounded-xl p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {([['all', '전체'], ['unsent', '미발송'], ['sent', '발송완료'], ['canceled', '취소']] as const).map(([k, l]) => (
            <Chip key={k} on={status === k} onClick={() => setStatus(k)}>{l}</Chip>
          ))}
          <input value={qInput} onChange={e => setQInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') setQ(qInput.trim()) }}
            placeholder="매입처·발주번호·주문번호·주문처 검색 Enter"
            className={fieldBox({ noWidth: true, extra: 'flex-1 min-w-[240px] ml-auto' })} />
          {q && (
            <button onClick={() => { setQ(''); setQInput('') }}
              className="text-xs text-slate-500 hover:text-slate-700">검색 해제</button>
          )}
        </div>
      </div>

      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-slate-300 rounded-xl mt-3 overflow-x-auto">
        {loading ? <div className="text-center py-16 text-slate-500">로딩 중...</div> : (
          <table className="w-full text-sm min-w-[960px]">
            <thead>
              <tr className="bg-slate-50 text-slate-600 text-xs border-b border-slate-300">
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
                <tr className={`border-b border-slate-200 ${r.status === 'canceled' ? 'text-slate-500' : ''}`}>
                  <td className="py-2 px-3">
                    {/* 발주일·번호 클릭 = 발송 페이지 (작성 확인·첨부·메일·발송 이력) */}
                    <Link href={`/orders/purchase/${r.id}`} className="block hover:opacity-70"
                      title="발송 페이지로 이동">
                      <div className="tabular-nums text-xs font-semibold text-blue-700">{r.po_date}</div>
                      <div className="tabular-nums text-xs text-slate-500">{r.po_no}</div>
                    </Link>
                  </td>
                  <td className="py-2 px-3 font-medium">
                    {r.vendor_name}
                    {r.uses_custom_po && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-xs font-medium bg-violet-50 text-violet-600"
                        title="자체 발주서 양식을 쓰는 매입처">자체 양식</span>
                    )}
                    {r.po_use_sale_price && (
                      <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-xs font-medium bg-blue-50 text-blue-600"
                        title="발주서 금액이 판매가로 기재되는 매입처">판매가</span>
                    )}
                  </td>
                  <td className="py-2 px-3">
                    <Link href={`/orders/${r.order_id}`} className="text-blue-700 hover:underline tabular-nums text-xs">
                      {r.order_no ?? '(주문으로 이동)'}
                    </Link>
                    <div className="text-xs text-slate-500">{r.customer ?? '-'}{r.staff_name ? ` · ${r.staff_name}` : ''}</div>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums">{won(r.total_amount)}</td>
                  <td className="py-2 px-3">
                    {sendBadge(r)}
                    {r.sent_at && (
                      <div className="text-xs text-slate-500 tabular-nums mt-0.5">
                        {r.sent_at.slice(0, 16).replace('T', ' ')}{r.sender_name ? ` · ${r.sender_name}` : ''}
                      </div>
                    )}
                    {r.status === 'active' && !r.sent_at && r.send_error && (
                      <div className="text-xs text-red-500 mt-0.5">실패: {r.send_error}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-slate-600">{r.email_to ?? '-'}</td>
                  <td className="py-2 px-3 text-xs text-slate-600">{r.payment_term ?? '-'}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">
                    <button onClick={() => setOpenPo(v => v === r.id ? null : r.id)}
                      className="px-2.5 py-1 border border-slate-400 rounded text-xs text-slate-700 hover:border-slate-400 mr-1.5">
                      {openPo === r.id ? '접기' : '내용'}
                    </button>
                    <a href={`/api/orders-portal/purchase-orders/${r.id}?excel=1`}
                      className="px-2.5 py-1 border border-slate-400 rounded text-xs text-slate-700 hover:border-slate-400">엑셀</a>
                  </td>
                </tr>
                {openPo === r.id && (
                  <tr className="border-b border-slate-200">
                    <td colSpan={8} className="bg-slate-50/40 px-4 py-3"><PoDetail poId={r.id} /></td>
                  </tr>
                )}
                </Fragment>
              ))}
              {!rows.length && (
                <tr><td colSpan={8} className="text-center py-12 text-slate-500 text-sm">조건에 맞는 발주서가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-slate-500 mt-2">
        발주일·번호 클릭 = 발송 페이지 (다운로드·첨부·메일 작성·발송 이력·취소) · 주문번호 클릭 = 주문 상세
      </p>
    </div>
  )
}
