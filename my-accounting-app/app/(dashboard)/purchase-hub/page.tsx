'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getPeriodRange, DEFAULT_VIEW_FROM } from '@/lib/period-presets'

// 매입처 관리 허브 — 목록(A)
// 기간 매입(계산서)·지급·미지급 잔액·담당·상태를 매입처 단위로 요약하고,
// 행 클릭 시 매입처 360° 상세로 드릴다운. (매출처 허브의 매입 미러)

interface Row {
  vendor_id: string
  vendor_name: string
  biz_number: string | null
  email: string | null
  alias_names: string[]
  alias_count: number
  staff_primary: string | null
  staff_extra: number
  contact_rep: string | null
  contact_extra: number
  invoice_count: number
  invoice_total: number
  erp_amount: number
  paid_amount: number
  outstanding: number
  over90: number
  opening_remain: number
  last_purchase_date: string | null
  status: string
}
interface Summary {
  active_vendors: number
  invoice_total: number
  paid_total: number
  outstanding_total: number
  over90_total: number
  pay_ratio: number
  unlinked_items: number
  unlinked_aliases: number
}

const won = (n: number) => n.toLocaleString('ko-KR')
const eok = (n: number) => Math.abs(n) >= 100000000 ? `${(n / 100000000).toFixed(2)}억` : Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : won(n)

const STATUS_META: Record<string, { label: string; cls: string }> = {
  normal:   { label: '정상',            cls: 'bg-green-100 text-green-700' },
  unpaid:   { label: '미지급',          cls: 'bg-amber-100 text-amber-700' },
  over90:   { label: '미지급 90일 초과', cls: 'bg-red-100 text-red-700' },
  overpaid: { label: '과다지급',        cls: 'bg-violet-100 text-violet-700' },
  dormant:  { label: '휴면 전환',       cls: 'bg-gray-100 text-gray-500' },
}

export default function PurchaseHubPage() {
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
  const [erpOnly, setErpOnly] = useState(false)
  const [outstandingOnly, setOutstandingOnly] = useState(false)

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/purchase-hub?from=${f}&to=${t}`)
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

  // 검색: 매입처명 + ERP 별칭 표기 + 사업자번호(숫자 3자리 이상), 공백·대소문자 무시
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '')
  const visible = useMemo(() => rows.filter(r => {
    if (search) {
      const q = norm(search)
      const digits = search.replace(/\D/g, '')
      const hit = norm(r.vendor_name).includes(q)
        || r.alias_names.some(a => norm(a).includes(q))
        || (digits.length >= 3 && (r.biz_number ?? '').replace(/\D/g, '').includes(digits))
      if (!hit) return false
    }
    if (staffFilter && r.staff_primary !== staffFilter) return false
    if (statusFilter && r.status !== statusFilter) return false
    if (erpOnly && r.erp_amount <= 0) return false
    if (outstandingOnly && r.outstanding <= 0) return false
    return true
  }), [rows, search, staffFilter, statusFilter, erpOnly, outstandingOnly])

  const filterActive = !!(search || staffFilter || statusFilter || erpOnly || outstandingOnly)

  // KPI는 화면에 보이는(필터 적용된) 매입처 기준으로 집계
  const kpi = useMemo(() => {
    const active = visible.filter(r => r.invoice_count > 0 || r.erp_amount > 0)
    const inv = active.reduce((s, r) => s + r.invoice_total, 0)
    const paid = active.reduce((s, r) => s + r.paid_amount, 0)
    return {
      active_vendors: active.length,
      invoice_total: inv,
      paid_total: paid,
      outstanding_total: visible.reduce((s, r) => s + Math.max(0, r.outstanding), 0),
      over90_total: visible.reduce((s, r) => s + r.over90, 0),
      pay_ratio: inv > 0 ? Math.min(1, paid / inv) : 1,
    }
  }, [visible])

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">매입처 관리</h1>
      <p className="text-sm mt-1 text-gray-500">
        매입 계산서·지급·미지급 잔액과 담당을 매입처 단위로 봅니다. 행 클릭 시 매입처 360° 상세로 이동합니다.
      </p>

      {/* 기간 빠른 선택 — 다른 목록 화면(거래내역·법인카드·ERP 주문내역)과 동일하게 필터 바 위 별도 행 */}
      <div className="flex items-center gap-1.5 flex-wrap mt-4 mb-2">
        {['당월', '1분기', '2분기', '상반기', '당년', '전체 기간'].map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className={`px-2.5 py-1 rounded-full text-xs border ${preset === p ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p}
          </button>
        ))}
      </div>

      {/* 필터 — 검색창이 맨 앞 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매입처명 · ERP 별칭 · 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-1 text-xs w-72" />
        <input type="date" value={from} onChange={e => { setPreset(''); setFrom(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => { setPreset(''); setTo(e.target.value) }}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
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
          <input type="checkbox" checked={erpOnly} onChange={e => setErpOnly(e.target.checked)} /> ERP 발주 있는 곳
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={outstandingOnly} onChange={e => setOutstandingOnly(e.target.checked)} /> 미지급 있는 곳만
        </label>
      </div>

      {/* KPI — 필터 적용된 목록 기준으로 집계 */}
      {summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">활성 매입처{filterActive && <span className="ml-1 text-blue-600 font-semibold">(필터 적용)</span>}</div>
            <div className="text-xl font-bold mt-0.5">{kpi.active_vendors.toLocaleString()}곳</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${summary.active_vendors.toLocaleString()}곳 중` : '기간 내 계산서·ERP 발주 발생 기준'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">기간 매입 (계산서 총액)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{eok(kpi.invoice_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">
              {filterActive ? `전체 ${eok(summary.invoice_total)} 중` : '부가세 포함, 발행일 기준'}
            </div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">지급율 (기간)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums">{(kpi.pay_ratio * 100).toFixed(1)}%</div>
            <div className="text-[11px] text-gray-400 mt-0.5">지급 {eok(kpi.paid_total)}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <div className="text-xs text-gray-500">미지급 잔액 (누적)</div>
            <div className="text-xl font-bold mt-0.5 tabular-nums text-red-600">{eok(kpi.outstanding_total)}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">90일 초과 {eok(kpi.over90_total)} 포함</div>
          </div>
        </div>
      )}

      {/* 미연결 큐 알림 — 별칭·거래처 연결이 빠진 원본은 집계에서 빠진다 */}
      {summary && (summary.unlinked_items > 0 || summary.unlinked_aliases > 0) && (
        <div className="mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          ERP 품목 중 매입처 표기만 있고 별칭 미연결 {summary.unlinked_items.toLocaleString()}건
          {summary.unlinked_aliases > 0 && <> · 거래처 미연결 매입 별칭 {summary.unlinked_aliases.toLocaleString()}개</>}
          {' — 이 분량은 매입처 집계에서 빠져 있습니다. '}
          <Link href="/erp-aliases?type=purchase" className="underline font-semibold">매입처 연결 키워드에서 연결</Link>
        </div>
      )}

      {error && <div className="mt-4 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* 목록 */}
      <div className="bg-white border border-gray-200 rounded-xl mt-4 overflow-x-auto">
        {loading ? (
          <div className="text-center py-20 text-gray-400">집계 중...</div>
        ) : (
          <table className="w-full text-sm min-w-[1180px]">
            <thead>
              <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                <th className="py-2 px-3 text-left font-medium">매입처</th>
                <th className="py-2 px-3 text-left font-medium">발주 이메일</th>
                <th className="py-2 px-3 text-left font-medium">담당직원</th>
                <th className="py-2 px-3 text-left font-medium">거래처 담당자</th>
                <th className="py-2 px-3 text-right font-medium">기간 매입</th>
                <th className="py-2 px-3 text-right font-medium">지급액</th>
                <th className="py-2 px-3 text-left font-medium w-32">지급율</th>
                <th className="py-2 px-3 text-right font-medium">ERP 발주</th>
                <th className="py-2 px-3 text-right font-medium">미지급 잔액</th>
                <th className="py-2 px-3 text-left font-medium">최근 매입</th>
                <th className="py-2 px-3 text-left font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 300).map(r => {
                const ratio = r.invoice_total > 0 ? Math.min(1, r.paid_amount / r.invoice_total) : 1
                const meta = STATUS_META[r.status] ?? STATUS_META.normal
                return (
                  <tr key={r.vendor_id} className="border-b border-gray-50 hover:bg-blue-50/40">
                    <td className="py-2 px-3">
                      <Link href={`/purchase-hub/${r.vendor_id}?from=${from}&to=${to}`} className="block">
                        <div className="font-semibold text-gray-900">{r.vendor_name}</div>
                        <div className="text-[11px] text-gray-400">
                          별칭 {r.alias_count || '-'}{r.opening_remain > 0 ? ` · 기초이월 ${eok(r.opening_remain)}` : ''}
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 px-3">
                      {r.email
                        ? <a href={`mailto:${r.email}`} title={r.email}
                            className="text-blue-600 hover:underline text-xs block max-w-[180px] truncate">{r.email}</a>
                        : <span className="text-orange-600 text-[11px]">미입력</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.staff_primary ?? <span className="text-gray-300">-</span>}
                      {r.staff_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.staff_extra}</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      {r.contact_rep ?? <span className="text-gray-300">-</span>}
                      {r.contact_extra > 0 && <span className="ml-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full text-[10px] font-bold">+{r.contact_extra}</span>}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.invoice_total)}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{won(r.paid_amount)}</td>
                    <td className="py-2 px-3">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                        </div>
                        <span className="tabular-nums text-xs">{(ratio * 100).toFixed(0)}%</span>
                      </div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-gray-500">{r.erp_amount > 0 ? won(r.erp_amount) : <span className="text-gray-300">-</span>}</td>
                    <td className={`py-2 px-3 text-right tabular-nums ${r.outstanding > 0 ? 'text-red-600 font-medium' : r.outstanding < 0 ? 'text-violet-600 font-medium' : 'text-gray-400'}`}>
                      {won(r.outstanding)}
                    </td>
                    <td className="py-2 px-3 tabular-nums text-gray-500 text-xs">{r.last_purchase_date ?? '-'}</td>
                    <td className="py-2 px-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                    </td>
                  </tr>
                )
              })}
              {!visible.length && (
                <tr><td colSpan={11} className="text-center py-14 text-gray-400 text-sm">조건에 맞는 매입처가 없습니다.</td></tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-400 mt-2">
        {visible.length > 300 ? `상위 300곳만 표시 중 (전체 ${visible.length.toLocaleString()}곳 — 검색·필터로 좁혀주세요) · ` : `${visible.length.toLocaleString()}곳 · `}
        매입·미지급은 매입 계산서·출금 매칭 원본 기준 (음수 잔액 = 과다지급) · 휴면 = 최근 6개월 매입 없음
      </p>
    </div>
  )
}
