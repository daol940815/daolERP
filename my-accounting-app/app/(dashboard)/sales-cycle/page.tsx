'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import CollectionModal from './collection-modal'
import InvoiceLinkModal from './invoice-link-modal'

// 매출 사이클 파이프라인 — 매출처별 "ERP 주문 → 계산서 발행 → 수금 배분 → 미수 잔액".
// 매입 사이클과 같은 원칙: 상태는 저장하지 않고 조회 시 계산, 확정은 사용자.

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
const eok = (n: number) => n >= 100_000_000 ? `${(n / 100_000_000).toFixed(1)}억` : won(n)

// ERP 주문 데이터 시작 월 — [전체 기간] 버튼이 여기까지 되돌린다
const DATA_START = '2025-01'
// 기본 조회는 2026년부터 (2025년 미수는 [전체 기간]으로 조회)
const DEFAULT_FROM_MONTH = '2026-01'
const monthStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

interface Row {
  vendor_id: string
  vendor_name: string
  order_count: number
  order_net: number
  allocated: number
  remaining: number
  invoice_linked: number
  invoice_count: number
  invoice_total: number
  status: 'done' | 'partial' | 'none' | 'no_order'
  no_invoice: boolean
}
interface Summary {
  vendors: number
  order_total: number
  allocated_total: number
  remaining_total: number
  collect_ratio: number
  match_count: number
  invoice_linked_total: number
  invoice_link_ratio: number
  invoice_link_ready: boolean
}

const STATUS_META: Record<Row['status'], { label: string; cls: string }> = {
  done:     { label: '수금완료', cls: 'bg-green-100 text-green-700' },
  partial:  { label: '부분수금', cls: 'bg-amber-100 text-amber-700' },
  none:     { label: '미수금',   cls: 'bg-red-100 text-red-700' },
  no_order: { label: '주문없음', cls: 'bg-gray-100 text-gray-500' },
}

export default function SalesCyclePage() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [filter, setFilter] = useState<'all' | 'none' | 'partial' | 'done' | 'no_invoice'>('all')
  const [search, setSearch] = useState('')
  const [monthFrom, setMonthFrom] = useState(DEFAULT_FROM_MONTH)
  const [monthTo, setMonthTo] = useState(() => monthStr(new Date()))
  const [modal, setModal] = useState<{ id: string; name: string } | null>(null)
  const [invModal, setInvModal] = useState<{ id: string; name: string } | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 5000) }

  const load = useCallback(async () => {
    setRows(null)
    const p = new URLSearchParams()
    if (monthFrom) p.set('from', monthFrom)
    if (monthTo) p.set('to', monthTo)
    const res = await fetch(`/api/sales-cycle/pipeline?${p}`, { cache: 'no-store' })
    const json = await res.json()
    if (!res.ok) { showMsg(`조회 실패: ${json.error ?? '오류'}`); setRows([]); return }
    setRows(json.rows ?? [])
    setSummary(json.summary ?? null)
  }, [monthFrom, monthTo])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter(r => {
      if (search.trim() && !r.vendor_name.includes(search.trim())) return false
      if (filter === 'no_invoice') return r.no_invoice
      if (filter !== 'all') return r.status === filter
      return true
    })
  }, [rows, filter, search])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-1">
        <h1 className="text-2xl font-bold text-gray-900">매출 사이클 (수금 관리)</h1>
        <p className="text-sm mt-1 text-gray-500">
          매출처별로 ERP 주문 → 계산서 발행 → 수금(통장+카드) 배분 → 미수 잔액을 대사합니다.
          수금후보는 금액이 정확히 맞는 조합만 제시하고, 확정은 사용자가 합니다.
        </p>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}

      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 my-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">ERP 주문 총액(순매출)</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{eok(summary.order_total)}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">계산서 연결률</p>
            {summary.invoice_link_ready ? (
              <>
                <p className="text-lg font-bold text-gray-900 mt-1">{Math.round(summary.invoice_link_ratio * 100)}%</p>
                <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-emerald-600" style={{ width: `${Math.round(summary.invoice_link_ratio * 100)}%` }} />
                </div>
              </>
            ) : (
              <p className="text-xs text-amber-600 mt-1.5">067 마이그레이션 적용 필요</p>
            )}
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">수금 대사율</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{Math.round(summary.collect_ratio * 100)}%</p>
            <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
              <div className="h-full bg-indigo-600" style={{ width: `${Math.round(summary.collect_ratio * 100)}%` }} />
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">미수 잔액</p>
            <p className="text-lg font-bold text-red-600 mt-1">{eok(summary.remaining_total)}</p>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">수금 대사 기록</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{summary.match_count.toLocaleString()}건</p>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <input type="month" value={monthFrom} min={DATA_START} onChange={e => setMonthFrom(e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <span className="text-gray-400 text-sm">~</span>
        <input type="month" value={monthTo} onChange={e => setMonthTo(e.target.value)}
          className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm" />
        <button onClick={() => { setMonthFrom(DATA_START); setMonthTo(monthStr(new Date())) }}
          className="px-2.5 py-1.5 rounded-lg text-xs border border-gray-300 text-gray-600 hover:bg-gray-50"
          title="전체 기간 (주문일 기준 — 기간을 좁히면 그 기간의 주문·계산서만 집계됩니다)">
          전체 기간
        </button>
        <span className="w-px h-5 bg-gray-200 mx-1" />
        {([['all', '전체'], ['none', '미수금'], ['partial', '부분수금'], ['done', '수금완료'], ['no_invoice', '계산서 미발행']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${filter === k ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {label}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처 검색"
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-52 ml-auto" />
      </div>

      {rows === null ? (
        <p className="text-gray-400 text-sm py-14 text-center">불러오는 중...</p>
      ) : filtered.length === 0 ? (
        <p className="text-gray-400 text-sm py-14 text-center">조건에 맞는 매출처가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl bg-white">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">매출처</th>
                <th className="px-3 py-2 text-right">주문</th>
                <th className="px-3 py-2 text-right">주문금액(순)</th>
                <th className="px-3 py-2 text-right">계산서 연결</th>
                <th className="px-3 py-2 text-right">수금 배분</th>
                <th className="px-3 py-2 text-right">미수 잔액</th>
                <th className="px-3 py-2 text-center">상태</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.slice(0, 300).map(r => (
                <tr key={r.vendor_id} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-900">
                    <Link href={`/vendors/${r.vendor_id}`} className="hover:underline">{r.vendor_name}</Link>
                    {r.no_invoice && <span className="ml-1.5 px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700 text-[11px]">계산서 미발행</span>}
                  </td>
                  <td className="px-3 py-2 text-right">{r.order_count.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{won(r.order_net)}</td>
                  <td className="px-3 py-2 text-right">
                    <p className={`tabular-nums ${r.invoice_linked > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{won(r.invoice_linked)}</p>
                    <p className="text-[11px] text-gray-400">
                      발행 {r.invoice_count ? `${r.invoice_count}건` : '-'}
                      {r.order_net > 0 && ` · ${Math.round(r.invoice_linked / r.order_net * 100)}%`}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{won(r.allocated)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.remaining > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>{won(r.remaining)}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_META[r.status].cls}`}>{STATUS_META[r.status].label}</span>
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {r.order_net > r.invoice_linked && (
                      <button onClick={() => setInvModal({ id: r.vendor_id, name: r.vendor_name })}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium border border-indigo-300 text-indigo-700 hover:bg-indigo-50 mr-1">
                        계산서연결
                      </button>
                    )}
                    {r.remaining > 0 && (
                      <button onClick={() => setModal({ id: r.vendor_id, name: r.vendor_name })}
                        className="px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-900 text-white hover:bg-slate-700">
                        수금후보
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 300 && (
            <p className="text-xs text-gray-400 px-3 py-2">상위 300곳만 표시 — 검색으로 좁혀주세요.</p>
          )}
        </div>
      )}

      {modal && (
        <CollectionModal
          vendorId={modal.id}
          vendorName={modal.name}
          from={monthFrom ? `${monthFrom}-01` : undefined}
          onClose={() => setModal(null)}
          onApplied={() => { showMsg(`${modal.name} 수금 확정 완료`); load() }}
        />
      )}

      {invModal && (
        <InvoiceLinkModal
          vendorId={invModal.id}
          vendorName={invModal.name}
          from={monthFrom ? `${monthFrom}-01` : undefined}
          onClose={() => setInvModal(null)}
          onApplied={() => { showMsg(`${invModal.name} 계산서 연결 완료`); load() }}
        />
      )}
    </div>
  )
}
