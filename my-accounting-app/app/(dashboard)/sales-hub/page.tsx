'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getPeriodRange, DEFAULT_VIEW_FROM } from '@/lib/period-presets'

// 매출처 관리 허브 — 목록(A)
// 기간 매출·수금·미수·담당·상태를 매출처 단위로 요약하고, 행 클릭 시 360° 상세로 드릴다운.

interface Row {
  vendor_id: string
  vendor_name: string
  alias_count: number
  card_count: number
  staff_primary: string | null
  staff_extra: number
  contact_rep: string | null
  contact_extra: number
  order_count: number
  net: number
  collected: number
  outstanding: number
  over90: number
  vip_total: number
  last_order_date: string | null
  status: string
}
interface Summary {
  active_vendors: number
  net_total: number
  collected_total: number
  outstanding_total: number
  over90_total: number
  collect_ratio: number
}

const won = (n: number) => n.toLocaleString('ko-KR')
const eok = (n: number) => n >= 100000000 ? `${(n / 100000000).toFixed(2)}억` : n >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : won(n)

const STATUS_META: Record<string, { label: string; cls: string }> = {
  normal:      { label: '정상',     cls: 'bg-green-100 text-green-700' },
  outstanding: { label: '미수',     cls: 'bg-amber-100 text-amber-700' },
  late:        { label: '수금지연', cls: 'bg-orange-100 text-orange-700' },
  over90:      { label: '미수 90일 초과', cls: 'bg-red-100 text-red-700' },
  dormant:     { label: '휴면 전환', cls: 'bg-gray-100 text-gray-500' },
}

export default function SalesHubPage() {
  const [from, setFrom] = useState(DEFAULT_VIEW_FROM)
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [preset, setPreset] = useState<string>('당년')
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [vipOnly, setVipOnly] = useState(false)
  const [outstandingOnly, setOutstandingOnly] = useState(false)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/vendor-hub?from=${f}&to=${t}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setRows(json.rows); setSummary(json.summary)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(from, to) }, [load, from, to])

  const applyPreset = (p: string) => {
    setPreset(p)
    if (p === '전체 기간') { setFrom('2024-01-01'); setTo(new Date().toISOString().slice(0, 10)); return }
    const r = getPeriodRange(p)
    setFrom(r.from); setTo(r.to)
  }

  const staffNames = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => { if (r.staff_primary) s.add(r.staff_primary) })
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])

  const visible = useMemo(() => rows.filter(r => {
    if (search && !r.vendor_name.toLowerCase().includes(search.toLowerCase())) return false
    if (staffFilter && r.staff_primary !== staffFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (vipOnly && r.vip_total <= 0) return false
    if (outstandingOnly && r.outstanding <= 0) return false
    return true
  }), [rows, search, staffFilter, statusFilter, vipOnly, outstandingOnly])

  const filterActive = !!(search || staffFilter || statusFilter || vipOnly || outstandingOnly)

  // KPI는 화면에 보이는(필터 적용된) 매출처 기준으로 집계
  const kpi = useMemo(() => {
    const active = visible.filter(r => r.order_count > 0)
    const net = active.reduce((s, r) => s + r.net, 0)
    const out = active.reduce((s, r) => s + r.outstanding, 0)
    return {
      active_vendors: active.length,
      net_total: net,
      collected_total: net - out,
      outstanding_total: out,
      over90_total: active.reduce((s, r) => s + r.over90, 0),
      collect_ratio: net > 0 ? (net - out) / net : 1,
    }
  }, [visible])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">매출처 관리</h1>
      <p className="text-sm mt-1 text-gray-500">
        ERP 주문 기준 매출·수금·미수와 담당을 매출처 단위로 봅니다. 행 클릭 시 거래처 360° 상세로 이동합니다.
      </p>

      {/* 기간 + 필터 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-4">
        {['당월', '1분기', '2분기', '상반기', '당년', '전체 기간'].map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className={`px-2.5 py-1 rounded-full text-xs border ${preset === p ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p}
          </button>
        ))}
        <input type="date" value={from} onChange={e => { setPreset(''); setFrom(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => { setPreset(''); setTo(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="w-3" />
        <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs">
          <option value="">담당직원: 전체</option>
          {staffNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs">
          <option value="">상태: 전체</option>
          {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={vipOnly} onChange={e => setVipOnly(e.target.checked)} /> VIP 매출 있는 곳
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={outstandingOnly} onChange={e => setOutstandingOnly(e.target.checked)} /> 미수 있는 곳만
        </label>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처명 검색"
          className="border border-gray-300 rounded-lg px-3 py-1 text-xs flex-1 min-w-[160px]" />
      </div>

      {/* KPI — 필터 적용된 목록 기준으로 집계 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">활성 매출처{filterActive && <span className="ml-1 text-blue-600 font-semibold">(필터 적용)</span>}</div>
            <div className="text-xl font-bold mt-0.5">{kpi.active_vendors.toLocaleString()}곳</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${summary.active_vendors.toLocaleString()}곳 중` : '기간 내 주문 발생 기준'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">기간 매출 (ERP 순매출)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{eok(kpi.net_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${eok(summary.net_total)} 중` : '취소·VIP·선결제 품목 제외'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">수금율 (ERP 기준)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{(kpi.collect_ratio * 100).toFixed(1)}%</div>
            <div className="text-[11px] text-gray-400 mt-0.5">수금 {eok(kpi.collected_total)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">미수 잔액</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums text-red-600">{eok(kpi.outstanding_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">90일 초과 {eok(kpi.over90_total)} 포함</div>
          </div>
        </div>
      )}

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-4 overflow-x-auto">
        {loading ? (
          <div className="text-center py-20 text-gray-400">집계 중...</div>
        ) : (
          <table className="w-full text-sm min-w-[980px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">매출처</th>
                <th className="py-2 px-3 text-left font-medium">담당직원</th>
                <th className="py-2 px-3 text-left font-medium">거래처 담당자</th>
                <th className="py-2 px-3 text-right font-medium">기간 매출</th>
                <th className="py-2 px-3 text-right font-medium">수금액</th>
                <th className="py-2 px-3 text-left font-medium w-32">수금율</th>
                <th className="py-2 px-3 text-right font-medium">미수잔액</th>
                <th className="py-2 px-3 text-left font-medium">최근 주문</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map(r => {
                const ratio = r.net > 0 ? r.collected / r.net : 1
                const meta = STATUS_META[r.status] ?? STATUS_META.normal
                return (
                  <tr key={r.vendor_id} className="border-b border-gray-50 hover:bg-blue-50/40">
                    <td className="py-2 px-3">
                      <Link href={`/sales-hub/${r.vendor_id}?from=${from}&to=${to}`} className="block">
                        <div className="font-semibold text-gray-900">{r.vendor_name}</div>
                        <div className="text-[11px] text-gray-400">
                          별칭 {r.alias_count} · 카드 {r.card_count || '-'}{r.vip_total > 0 ? ` · VIP 누적 ${eok(r.vip_total)}` : ''}
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.staff_primary ?? <span className="text-gray-300">-</span>}
                      {r.staff_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.staff_extra}</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.contact_rep ?? <span className="text-gray-300">-</span>}
                      {r.contact_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.contact_extra}</span>}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.net)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.collected)}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                        </div>
                        <span className="tabular-nums text-xs">{(ratio * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.outstanding > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {won(r.outstanding)}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-gray-500 text-xs">{r.last_order_date ?? '-'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                    </td>
                  </tr>
                )
              })}
              {!visible.length && (
                <tr><td colSpan={9} className="text-center py-14 text-gray-400 text-sm">조건에 맞는 매출처가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {visible.length > 300 ? `상위 300곳만 표시 중 (전체 ${visible.length.toLocaleString()}곳 — 검색·필터로 좁혀주세요) · ` : `${visible.length.toLocaleString()}곳 · `}
        매출·미수는 ERP 원본(주문·미수금) 기준 · 휴면 = 최근 6개월 주문 없음
      </p>
    </div>
  )
}
