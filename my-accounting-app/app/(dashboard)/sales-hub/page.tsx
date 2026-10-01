'use client'

import PeriodPresets from '@/components/ui/PeriodPresets'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { getPeriodRange } from '@/lib/period-presets'
import CustomerKpiTiles, { matchCategory, OTYPE_META } from './_components/CustomerKpiTiles'
import type { KpiCategory, KpiFlags, VendorFlag } from './_components/CustomerKpiTiles'

// 매출처 관리 허브 — 목록(A)
// 기간 매출·수금·미수·담당·상태를 매출처 단위로 요약하고, 행 클릭 시 360° 상세로 드릴다운.

interface Row {
  vendor_id: string
  vendor_name: string
  biz_number: string | null
  is_active: boolean
  alias_names: string[]
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
  const [from, setFrom] = useState(() => getPeriodRange('당년').from)   // 관리·분석 화면 기본 = 당년
  const [to, setTo] = useState(() => getPeriodRange('당년').to)
  const [rows, setRows] = useState<Row[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [staffFilter, setStaffFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [vipOnly, setVipOnly] = useState(false)
  const [outstandingOnly, setOutstandingOnly] = useState(false)
  const [showInactive, setShowInactive] = useState(false)   // 비활성 거래처는 기본 숨김

  // 고객관리 집계 (108 RPC) — 기간 필터와 독립, 기준연도 자동
  const [kpiFlags, setKpiFlags] = useState<KpiFlags | null>(null)
  const [catFilter, setCatFilter] = useState<KpiCategory | null>(null)
  useEffect(() => {
    fetch('/api/vendor-hub/customer-kpi')
      .then(r => r.json())
      .then(j => { if (j.available) setKpiFlags(j) })
      .catch(() => {})
  }, [])
  const vendorFlagMap = useMemo(() => {
    const m = new Map<string, VendorFlag>()
    kpiFlags?.vendors.forEach(f => m.set(f.vendor_id, f))
    return m
  }, [kpiFlags])

  // ?mine=1 = 내 고객 (로그인 직원이 현재 담당인 거래처만). 영업·주문 영역의 진입점.
  const mine = useSearchParams().get('mine') === '1'

  // 신규 매출처 등록 (고객·영업 수정 권한자만 — 노출은 can_edit, 차단은 미들웨어)
  const [canEdit, setCanEdit] = useState(false)
  const [addForm, setAddForm] = useState<{ open: boolean; name: string; biz: string; note: string; busy: boolean; msg: string | null }>(
    { open: false, name: '', biz: '', note: '', busy: false, msg: null })

  const load = useCallback(async (f: string, t: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/vendor-hub?from=${f}&to=${t}${mine ? '&mine=1' : ''}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setRows(json.rows); setSummary(json.summary); setCanEdit(!!json.can_edit)
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally {
      setLoading(false)
    }
  }, [mine])

  useEffect(() => { load(from, to) }, [load, from, to])


  const staffNames = useMemo(() => {
    const s = new Set<string>()
    rows.forEach(r => { if (r.staff_primary) s.add(r.staff_primary) })
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [rows])

  // 검색: 거래처명 + ERP 별칭 표기 + 사업자번호(숫자 3자리 이상), 공백·대소문자 무시
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
    if (vipOnly && r.vip_total <= 0) return false
    if (outstandingOnly && r.outstanding <= 0) return false
    if (!showInactive && r.is_active === false) return false
    if (catFilter) {
      const f = vendorFlagMap.get(r.vendor_id)
      if (!f || !matchCategory(f, catFilter)) return false
    }
    return true
  }), [rows, search, staffFilter, statusFilter, vipOnly, outstandingOnly, showInactive, catFilter, vendorFlagMap])

  const filterActive = !!(search || staffFilter || statusFilter || vipOnly || outstandingOnly || catFilter)

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
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{mine ? '내 고객' : '매출처 관리 (지점)'}</h1>
          <p className="text-sm mt-1 text-gray-500">
            {mine
              ? '내가 현재 담당인 매출처만 봅니다. 행 클릭 시 거래처 360° 상세로 이동합니다.'
              : 'ERP 주문 기준 매출·수금·미수와 담당을 매출처 단위로 봅니다. 행 클릭 시 거래처 360° 상세로 이동합니다.'}
          </p>
        </div>
        {canEdit && !mine && (
          <button onClick={() => setAddForm(f => ({ ...f, open: true, msg: null }))}
            className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">
            매출처 등록
          </button>
        )}
      </div>

      {addForm.open && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setAddForm(f => ({ ...f, open: false }))}>
          <div className="bg-white rounded-xl shadow-2xl p-6 w-96 mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900 mb-1">신규 매출처 등록</h3>
            <p className="text-xs text-gray-400 mb-4">은행 지점은 &apos;은행명 지점명&apos; 형식으로 입력합니다 (예: 하나은행 계동지점).</p>
            {addForm.msg && <p className="text-red-500 text-xs mb-3">{addForm.msg}</p>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">매출처명 <span className="text-red-500">*</span></label>
                <input autoFocus value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="예: 하나은행 계동지점"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">사업자번호 <span className="text-gray-400">(선택)</span></label>
                <input value={addForm.biz} onChange={e => setAddForm(f => ({ ...f, biz: e.target.value }))}
                  placeholder="000-00-00000"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">메모 <span className="text-gray-400">(선택)</span></label>
                <input value={addForm.note} onChange={e => setAddForm(f => ({ ...f, note: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900" />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setAddForm(f => ({ ...f, open: false }))}
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50">취소</button>
              <button disabled={addForm.busy} onClick={async () => {
                if (!addForm.name.trim()) { setAddForm(f => ({ ...f, msg: '매출처명을 입력하세요.' })); return }
                setAddForm(f => ({ ...f, busy: true, msg: null }))
                const res = await fetch('/api/vendor-hub', {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: addForm.name.trim(), biz_number: addForm.biz.trim() || undefined, note: addForm.note.trim() || undefined }),
                })
                const json = await res.json().catch(() => ({}))
                if (!res.ok) { setAddForm(f => ({ ...f, busy: false, msg: json.error ?? '등록 실패' })); return }
                setAddForm({ open: false, name: '', biz: '', note: '', busy: false, msg: null })
                load(from, to)
              }}
                className="flex-1 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700 disabled:opacity-50">
                {addForm.busy ? '등록 중...' : '등록'}
              </button>
            </div>
          </div>
        </div>
      )}

      {mine && !loading && !error && rows.length === 0 && (
        <div className="mt-6 bg-white border border-gray-200 rounded-xl px-6 py-10 text-center">
          <p className="text-base font-semibold text-gray-800">담당 고객 없음</p>
          <p className="text-sm text-gray-500 mt-1">내 이름으로 지정된 담당 거래처가 없습니다. 담당 지정은 매출처 관리의 거래처 상세에서 합니다.</p>
          <div className="flex justify-center gap-2 mt-5">
            <Link href="/sales-hub" className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-700">매출처 관리 (지점)</Link>
            <Link href="/sales-hub/contacts" className="px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50">매출처 관리 (고객)</Link>
          </div>
        </div>
      )}

      {/* 기간 빠른 선택 — 다른 목록 화면(거래내역·법인카드·ERP 주문내역)과 동일하게 필터 바 위 별도 행 */}
      <PeriodPresets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} className="mt-4 mb-2" />

      {/* 필터 — 검색창이 맨 앞 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="매출처명 · ERP 별칭 · 사업자번호 검색"
          className="border border-gray-300 rounded-lg px-3 py-1 text-xs w-72" />
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
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
          <input type="checkbox" checked={vipOnly} onChange={e => setVipOnly(e.target.checked)} /> VIP 매출 있는 곳
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={outstandingOnly} onChange={e => setOutstandingOnly(e.target.checked)} /> 미수 있는 곳만
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1">
          <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> 비활성 포함
        </label>
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

      {/* 고객관리 집계 — 투트랙 타일 (108 미적용 시 자동 숨김) */}
      <CustomerKpiTiles mode="vendor" flags={kpiFlags} filter={catFilter} onFilter={setCatFilter} />

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
                {kpiFlags && <th className="py-2 px-3 text-left font-medium">고객관리</th>}
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
                        <div className="font-semibold text-gray-900">
                          {r.vendor_name}
                          {r.is_active === false && <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-gray-200 text-gray-600 align-middle">비활성</span>}
                        </div>
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
                    {kpiFlags && (() => {
                      const f = vendorFlagMap.get(r.vendor_id)
                      const ot = f ? OTYPE_META[f.otype] : null
                      return (
                        <td className="py-2 px-3 whitespace-nowrap">
                          {ot && <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${ot.cls}`}>{ot.label}</span>}
                          {f?.is_new && <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-100 text-emerald-700">신규</span>}
                          {f?.is_churn && <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">이탈</span>}
                          {!f && <span className="text-gray-300">-</span>}
                        </td>
                      )
                    })()}
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
                <tr><td colSpan={kpiFlags ? 10 : 9} className="text-center py-14 text-gray-400 text-sm">조건에 맞는 매출처가 없습니다.</td></tr>
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
