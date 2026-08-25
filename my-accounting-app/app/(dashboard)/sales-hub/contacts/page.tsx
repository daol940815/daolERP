'use client'

// 거래처 담당자 관리 — 매출처관리 하위
// 탭: 담당자 목록 / 담당 공백 거래처 / 미확인 담당자명 정리
// 상태·상담직원 칩 필터 + KPI 연동. 상태는 전부 자동 판정(수동 상태 없음).

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { contactLabel } from '@/lib/contact-label'
import CustomerKpiTiles, { matchCategory, OTYPE_META } from '../_components/CustomerKpiTiles'
import type { ContactFlag, KpiCategory, KpiFlags } from '../_components/CustomerKpiTiles'

const won = (n: number) => `${(n ?? 0).toLocaleString('ko-KR')}원`
const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toLowerCase()

type ContactStatus = 'normal' | 'recent_move' | 'no_order_90' | 'no_order_180' | 'unassigned' | 'no_history'

interface ContactRow {
  contact_id: string; name: string; phone: string | null
  vendor_id: string | null; vendor_name: string | null; title: string | null
  is_representative: boolean; vendor_count: number; ended_note: string | null
  staff_names: string[]; total_sales: number; outstanding: number
  last_order_date: string | null; no_order_days: number | null; status: ContactStatus
}
interface GapRow {
  vendor_id: string; vendor_name: string
  last_contact_name: string | null; last_contact_note: string | null
  gap_start: string | null; gap_days: number | null
  prev12_sales: number; after_gap_sales: number; staff_names: string[]; never_assigned: boolean
}
interface UnmatchedRow {
  vendor_id: string; vendor_name: string; raw_name: string
  order_count: number; last_order_date: string
  candidates: { contact_id: string; name: string; vendor_name: string | null; same_vendor: boolean }[]
}
interface Bundle {
  kpi: { total: number; gap_vendors: number; unmatched: number; attention90: number; attention180: number; recent_moves: number }
  contacts: ContactRow[]; gaps: GapRow[]; unmatched: UnmatchedRow[]
  staff_options: string[]; migration105: boolean
}

const STATUS_META: Record<ContactStatus, { text: string; cls: string }> = {
  normal:      { text: '정상',        cls: 'bg-green-50 text-green-700' },
  recent_move: { text: '최근 이동',   cls: 'bg-amber-50 text-amber-700' },
  no_order_90: { text: '미주문',      cls: 'bg-orange-50 text-orange-700' },
  no_order_180:{ text: '미주문',      cls: 'bg-red-50 text-red-600' },
  unassigned:  { text: '소속 없음',   cls: 'bg-red-50 text-red-600' },
  no_history:  { text: '주문 이력 없음', cls: 'bg-gray-100 text-gray-500' },
}

type StatusFilter = 'all' | 'normal' | 'recent_move' | 'no_order_90' | 'no_order_180' | 'unassigned' | 'no_history'
type Tab = 'list' | 'gaps' | 'queue'

export default function ContactManagerPage() {
  const router = useRouter()
  const [bundle, setBundle] = useState<Bundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [staffFilter, setStaffFilter] = useState<string>('all')
  const [staffMore, setStaffMore] = useState(false)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50

  // 후임 지정/신규 등록 인라인 폼 상태
  const [gapForm, setGapForm] = useState<{ vendor_id: string; q: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const showMsg = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 6000) }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/contact-manager')
    const json = await res.json()
    if (res.ok) setBundle(json)
    else showMsg(`조회 실패: ${json.error ?? '알 수 없는 오류'}`)
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, statusFilter, staffFilter, tab])

  const post = async (body: Record<string, unknown>, successMsg: string) => {
    setBusy(true)
    const res = await fetch('/api/contact-manager', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json()
    setBusy(false)
    if (!res.ok) { showMsg(`실패: ${json.error ?? '알 수 없는 오류'}`); return false }
    showMsg(successMsg)
    load()
    return true
  }

  // 고객관리 집계 (108 RPC) — 타일 클릭 = 담당자 목록 필터
  const [kpiFlags, setKpiFlags] = useState<KpiFlags | null>(null)
  const [catFilter, setCatFilter] = useState<KpiCategory | null>(null)
  useEffect(() => {
    fetch('/api/vendor-hub/customer-kpi')
      .then(r => r.json())
      .then(j => { if (j.available) setKpiFlags(j) })
      .catch(() => {})
  }, [])
  useEffect(() => { setPage(1) }, [catFilter])
  const contactFlagMap = useMemo(() => {
    const m = new Map<string, ContactFlag>()
    kpiFlags?.contacts.forEach(f => m.set(`${f.contact_id}|${f.vendor_id}`, f))
    return m
  }, [kpiFlags])

  const filtered = useMemo(() => {
    if (!bundle) return []
    const nq = norm(search)
    return bundle.contacts.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (staffFilter !== 'all' && !c.staff_names.includes(staffFilter)) return false
      if (catFilter) {
        const f = c.vendor_id ? contactFlagMap.get(`${c.contact_id}|${c.vendor_id}`) : null
        if (!f || !matchCategory(f, catFilter)) return false
      }
      if (nq) {
        const hay = norm(`${c.name}${c.vendor_name ?? ''}${c.title ?? ''}${c.phone ?? ''}${c.ended_note ?? ''}`)
        if (!hay.includes(nq)) return false
      }
      return true
    })
  }, [bundle, search, statusFilter, staffFilter, catFilter, contactFlagMap])

  const filterActive = statusFilter !== 'all' || staffFilter !== 'all' || !!search.trim() || !!catFilter
  const kpiOf = useMemo(() => {
    if (!bundle) return null
    if (!filterActive) return bundle.kpi
    let a90 = 0, a180 = 0, moves = 0
    for (const c of filtered) {
      if (c.status === 'no_order_90' || c.status === 'no_order_180') a90 += 1
      if (c.status === 'no_order_180') a180 += 1
      if (c.status === 'recent_move') moves += 1
    }
    return { ...bundle.kpi, total: filtered.length, attention90: a90, attention180: a180, recent_moves: moves }
  }, [bundle, filtered, filterActive])

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1)
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const staffChips = bundle ? bundle.staff_options.slice(0, staffMore ? undefined : 6) : []

  // 후임 지정: 이름으로 기존 담당자 검색 (클라이언트에서 bundle.contacts 활용)
  const gapCandidates = useMemo(() => {
    if (!bundle || !gapForm || !gapForm.q.trim()) return []
    const nq = norm(gapForm.q)
    return bundle.contacts.filter(c => norm(c.name).includes(nq)).slice(0, 6)
  }, [bundle, gapForm])

  const statusChip = (v: StatusFilter, label: string, danger?: boolean) => (
    <button key={v} onClick={() => setStatusFilter(statusFilter === v ? 'all' : v)}
      className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
        statusFilter === v
          ? 'bg-slate-900 text-white border-slate-900'
          : `bg-white border-gray-300 hover:border-slate-500 ${danger ? 'text-red-600' : 'text-gray-600'}`}`}>
      {label}
    </button>
  )

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">거래처 담당자 관리</h1>
          <p className="text-sm mt-1 text-gray-500">
            거래처 담당자(고객사 인물) 중심 관리 — 커넥션·매출·상태는 주문에서 자동 집계
          </p>
        </div>
        <button
          onClick={async () => {
            const name = window.prompt('등록할 담당자 이름 (예: 김수영)')
            if (!name?.trim()) return
            const okd = await post({ action: 'create_contact', name: name.trim() }, `${name.trim()} 등록됨 — 상세에서 소속을 지정하세요.`)
            if (okd) setSearch(name.trim())
          }}
          className="px-3 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-700">
          담당자 등록
        </button>
      </div>

      {msg && <div className="mb-3 mt-2 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg">{msg}</div>}
      {bundle && !bundle.migration105 && (
        <div className="mb-3 mt-2 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          마이그레이션 105(contact_manager)가 아직 실행되지 않았습니다 — 영업일지·담당자명 연결(무시) 기능이 비활성입니다.
          SQL 편집기에서 105_contact_manager.sql을 실행해 주세요.
        </div>
      )}

      {/* 고객관리 집계 — 투트랙 타일 (108 미적용 시 자동 숨김) */}
      <CustomerKpiTiles mode="contact" flags={kpiFlags} filter={catFilter}
        onFilter={c => { setCatFilter(c); if (c) setTab('list') }} />

      {/* KPI — 클릭 시 해당 필터/탭 */}
      {bundle && kpiOf && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 my-4">
          <button onClick={() => { setTab('list'); setStatusFilter('all') }}
            className="border border-gray-200 rounded-lg px-4 py-3 text-left bg-white hover:border-slate-400">
            <p className="text-xs text-gray-400 mb-1">등록 담당자{filterActive && tab === 'list' ? ' (필터)' : ''}</p>
            <p className="text-lg font-bold text-gray-900">{kpiOf.total.toLocaleString()}명</p>
            {filterActive && <p className="text-[11px] text-gray-400">전체 {bundle.kpi.total.toLocaleString()}명</p>}
          </button>
          <button onClick={() => setTab('gaps')}
            className="border border-gray-200 rounded-lg px-4 py-3 text-left bg-white hover:border-slate-400">
            <p className="text-xs text-gray-400 mb-1">담당 공백 거래처</p>
            <p className={`text-lg font-bold ${bundle.kpi.gap_vendors ? 'text-red-600' : 'text-gray-900'}`}>{bundle.kpi.gap_vendors.toLocaleString()}곳</p>
          </button>
          <button onClick={() => setTab('queue')}
            className="border border-gray-200 rounded-lg px-4 py-3 text-left bg-white hover:border-slate-400">
            <p className="text-xs text-gray-400 mb-1">미확인 담당자명</p>
            <p className={`text-lg font-bold ${bundle.kpi.unmatched ? 'text-red-600' : 'text-gray-900'}`}>{bundle.kpi.unmatched.toLocaleString()}건</p>
          </button>
          <button onClick={() => { setTab('list'); setStatusFilter('no_order_90') }}
            className="border border-gray-200 rounded-lg px-4 py-3 text-left bg-white hover:border-slate-400">
            <p className="text-xs text-gray-400 mb-1">미주문 주의</p>
            <p className={`text-lg font-bold ${kpiOf.attention90 ? 'text-orange-600' : 'text-gray-900'}`}>{kpiOf.attention90.toLocaleString()}명</p>
            <p className="text-[11px] text-gray-400">90일 초과 (180일 초과 {kpiOf.attention180}명 포함)</p>
          </button>
          <button onClick={() => { setTab('list'); setStatusFilter('recent_move') }}
            className="border border-gray-200 rounded-lg px-4 py-3 text-left bg-white hover:border-slate-400">
            <p className="text-xs text-gray-400 mb-1">최근 30일 이동·진급</p>
            <p className="text-lg font-bold text-gray-900">{kpiOf.recent_moves.toLocaleString()}건</p>
          </button>
        </div>
      )}

      {/* 탭 */}
      <div className="flex items-center gap-1 mb-3 border-b border-gray-200">
        {([['list', '담당자 목록'], ['gaps', `담당 공백 거래처 ${bundle?.kpi.gap_vendors ?? ''}`], ['queue', `미확인 담당자명 정리 ${bundle?.kpi.unmatched ?? ''}`]] as [Tab, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === v ? 'border-slate-900 text-slate-900 font-medium' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">로딩 중...</div>
      ) : !bundle ? (
        <div className="text-center py-20 text-gray-400 text-sm">데이터를 불러오지 못했습니다.</div>
      ) : tab === 'list' ? (
        <>
          {/* 검색 + 칩 필터 */}
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="이름 · 소속 거래처 · 직함 · 연락처 검색"
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-72 focus:outline-none focus:ring-2 focus:ring-slate-900" />
            {filterActive && (
              <button onClick={() => { setSearch(''); setStatusFilter('all'); setStaffFilter('all') }}
                className="text-xs text-gray-400 hover:text-gray-600">✕ 필터 해제</button>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            <span className="text-xs text-gray-400 w-14">상태</span>
            {statusChip('all', '전체')}
            {statusChip('normal', '정상')}
            {statusChip('recent_move', '최근 이동')}
            {statusChip('no_order_90', '미주문 90일 초과', true)}
            {statusChip('no_order_180', '미주문 180일 초과', true)}
            {statusChip('unassigned', '소속 없음', true)}
            {statusChip('no_history', '주문 이력 없음')}
          </div>
          <div className="flex items-center gap-1.5 mb-4 flex-wrap">
            <span className="text-xs text-gray-400 w-14">상담 직원</span>
            <button onClick={() => setStaffFilter('all')}
              className={`px-2.5 py-1 text-xs rounded-full border ${staffFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'}`}>
              전체
            </button>
            {staffChips.map(n => (
              <button key={n} onClick={() => setStaffFilter(staffFilter === n ? 'all' : n)}
                className={`px-2.5 py-1 text-xs rounded-full border ${staffFilter === n ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-gray-600 border-gray-300 hover:border-slate-500'}`}>
                {n}
              </button>
            ))}
            {bundle.staff_options.length > 6 && (
              <button onClick={() => setStaffMore(m => !m)} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">
                {staffMore ? '접기' : `그 외 ${bundle.staff_options.length - 6}명 ▾`}
              </button>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2.5 px-3 font-medium">담당자</th>
                  <th className="py-2.5 px-3 font-medium">현재 소속 (거래처 · 직함)</th>
                  <th className="py-2.5 px-3 font-medium">연락처</th>
                  <th className="py-2.5 px-3 font-medium text-right">담당 거래처</th>
                  <th className="py-2.5 px-3 font-medium">주 상담 직원</th>
                  <th className="py-2.5 px-3 font-medium text-right">누적 매출</th>
                  <th className="py-2.5 px-3 font-medium text-right">미수</th>
                  <th className="py-2.5 px-3 font-medium">최근 주문</th>
                  <th className="py-2.5 px-3 font-medium">상태</th>
                  {kpiFlags && <th className="py-2.5 px-3 font-medium">고객관리</th>}
                </tr>
              </thead>
              <tbody>
                {pageRows.map(c => (
                  <tr key={c.contact_id}
                    onClick={() => router.push(`/sales-hub/contacts/${c.contact_id}`)}
                    className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer">
                    <td className="py-2 px-3 whitespace-nowrap font-medium text-gray-900">{contactLabel(c.name)}</td>
                    <td className="py-2 px-3 min-w-0 max-w-[280px]">
                      {c.vendor_name ? (
                        <span className="text-gray-800">
                          <span className="truncate">{c.vendor_name}</span>
                          {c.title && <span className="text-gray-500"> · {c.title}</span>}
                          {c.is_representative && (
                            <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] bg-blue-50 text-blue-700">대표</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-red-500">{c.ended_note ? `배정 종료 ${c.ended_note}` : '소속 미지정'}</span>
                      )}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500">{c.phone ?? '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {c.vendor_count}곳
                      {c.vendor_count > 1 && <span className="ml-1 px-1.5 py-0.5 rounded text-[11px] bg-violet-50 text-violet-600">복수</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-600">
                      {c.staff_names.length ? c.staff_names.slice(0, 2).join(' · ') : '-'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{won(c.total_sales)}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${c.outstanding > 0 ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                      {won(c.outstanding)}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500">{c.last_order_date ?? '-'}</td>
                    <td className="py-2 px-3 whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${STATUS_META[c.status].cls}`}>
                        {(c.status === 'no_order_90' || c.status === 'no_order_180') && c.no_order_days != null
                          ? `미주문 ${c.no_order_days}일` : STATUS_META[c.status].text}
                      </span>
                    </td>
                    {kpiFlags && (() => {
                      const f = c.vendor_id ? contactFlagMap.get(`${c.contact_id}|${c.vendor_id}`) : null
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
                  </tr>
                ))}
                {!pageRows.length && (
                  <tr><td colSpan={kpiFlags ? 10 : 9} className="py-14 text-center text-gray-400 text-sm">조건에 맞는 담당자가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm">
            <p className="text-gray-400 text-xs">
              {filtered.length ? `${((page - 1) * PAGE_SIZE + 1).toLocaleString()}–${Math.min(page * PAGE_SIZE, filtered.length).toLocaleString()}` : 0} / {filtered.length.toLocaleString()}명
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(p - 1, 1))} disabled={page <= 1}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30">← 이전</button>
              <span className="px-3 text-gray-500 text-xs">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(p + 1, totalPages))} disabled={page >= totalPages}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-30">다음 →</button>
            </div>
          </div>
        </>
      ) : tab === 'gaps' ? (
        <>
          <p className="text-xs text-gray-400 mb-3">
            담당자 배정이 종료됐는데 후임이 없거나, 최근 12개월 매출이 있는데 담당자가 등록된 적 없는 거래처입니다.
            직전 매출이 크고 공백 후 매출이 0인 곳이 최우선 관리 대상입니다.
          </p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2.5 px-3 font-medium">거래처</th>
                  <th className="py-2.5 px-3 font-medium">마지막 담당자</th>
                  <th className="py-2.5 px-3 font-medium">공백 시작</th>
                  <th className="py-2.5 px-3 font-medium text-right">공백 기간</th>
                  <th className="py-2.5 px-3 font-medium text-right">직전 12개월 매출</th>
                  <th className="py-2.5 px-3 font-medium text-right">공백 후 매출</th>
                  <th className="py-2.5 px-3 font-medium">주 상담 직원</th>
                  <th className="py-2.5 px-3 font-medium text-right">조치</th>
                </tr>
              </thead>
              <tbody>
                {bundle.gaps.slice(0, 200).map(g => [
                  <tr key={g.vendor_id} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-900 max-w-[240px] truncate">{g.vendor_name}</td>
                    <td className="py-2 px-3 text-xs">
                      {g.last_contact_name
                        ? <>{g.last_contact_name} <span className="text-gray-400">({g.last_contact_note})</span></>
                        : <span className="text-gray-400">담당자 등록 이력 없음</span>}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500">{g.gap_start ?? '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      {g.gap_days != null ? <span className="text-red-600 font-medium">{g.gap_days}일</span> : '-'}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{won(g.prev12_sales)}</td>
                    <td className={`py-2 px-3 text-right whitespace-nowrap ${g.after_gap_sales === 0 && g.gap_start ? 'text-red-600 font-medium' : ''}`}>
                      {g.gap_start ? won(g.after_gap_sales) : '-'}
                    </td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-600">{g.staff_names.slice(0, 2).join(' · ') || '-'}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button onClick={() => setGapForm(gapForm?.vendor_id === g.vendor_id ? null : { vendor_id: g.vendor_id, q: '' })}
                        className="px-2 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50">
                        {g.never_assigned ? '담당자 등록' : '후임 지정'}
                      </button>
                    </td>
                  </tr>,
                  gapForm?.vendor_id === g.vendor_id && (
                    <tr key={`${g.vendor_id}-form`} className="bg-slate-50 border-b border-gray-100">
                      <td colSpan={8} className="py-3 px-6">
                        <div className="flex items-center gap-2 flex-wrap">
                          <input autoFocus value={gapForm.q}
                            onChange={e => setGapForm({ ...gapForm, q: e.target.value })}
                            placeholder="담당자 이름 검색 또는 신규 이름 입력"
                            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900" />
                          {gapCandidates.map(c => (
                            <button key={c.contact_id} disabled={busy}
                              onClick={() => post({ action: 'assign', contact_id: c.contact_id, vendor_id: g.vendor_id },
                                `${c.name} → ${g.vendor_name} 배정 완료`).then(okd => okd && setGapForm(null))}
                              className="px-2.5 py-1 text-xs rounded-full border border-green-300 bg-green-50 text-green-700 hover:bg-green-100">
                              {c.name}{c.vendor_name ? ` (현 ${c.vendor_name})` : ' (소속 없음)'} 배정
                            </button>
                          ))}
                          {gapForm.q.trim() && (
                            <button disabled={busy}
                              onClick={() => post({ action: 'create_contact', name: gapForm.q.trim(), vendor_id: g.vendor_id },
                                `${gapForm.q.trim()} 신규 등록 + ${g.vendor_name} 배정 완료`).then(okd => okd && setGapForm(null))}
                              className="px-2.5 py-1 text-xs rounded-full border border-slate-400 bg-white text-slate-700 hover:bg-slate-100">
                              &ldquo;{gapForm.q.trim()}&rdquo; 신규 인물로 등록
                            </button>
                          )}
                          <button onClick={() => setGapForm(null)} className="text-xs text-gray-400 hover:text-gray-600 ml-auto">닫기</button>
                        </div>
                        <p className="text-[11px] text-gray-400 mt-2">기존 인물을 선택하면 그 인물의 이력에 이 거래처 배정이 추가됩니다 (이동이면 상세에서 이동 처리 사용).</p>
                      </td>
                    </tr>
                  ),
                ])}
                {!bundle.gaps.length && (
                  <tr><td colSpan={8} className="py-14 text-center text-gray-400 text-sm">담당 공백 거래처가 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {bundle.gaps.length > 200 && <p className="text-xs text-gray-400 mt-2">상위 200곳만 표시 (매출순)</p>}
        </>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-3">
            주문의 담당자 표기 중 인물과 연결되지 않은 값입니다. 후보를 확인해 연결하거나, 비인명 표기는 무시(공란 처리)하세요.
            원본 주문은 수정되지 않습니다.
          </p>
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                  <th className="py-2.5 px-3 font-medium">주문 표기 (원본)</th>
                  <th className="py-2.5 px-3 font-medium text-right">주문 수</th>
                  <th className="py-2.5 px-3 font-medium">거래처</th>
                  <th className="py-2.5 px-3 font-medium">최근 주문</th>
                  <th className="py-2.5 px-3 font-medium">추천 후보</th>
                  <th className="py-2.5 px-3 font-medium text-right">처리</th>
                </tr>
              </thead>
              <tbody>
                {bundle.unmatched.map(u => (
                  <tr key={`${u.vendor_id}|${u.raw_name}`} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-2 px-3 font-medium text-gray-900 max-w-[220px] truncate">{u.raw_name}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{u.order_count}건</td>
                    <td className="py-2 px-3 text-xs text-gray-500 max-w-[200px] truncate">{u.vendor_name}</td>
                    <td className="py-2 px-3 whitespace-nowrap text-xs text-gray-500">{u.last_order_date}</td>
                    <td className="py-2 px-3">
                      {u.candidates.length ? (
                        <div className="flex flex-wrap gap-1">
                          {u.candidates.map(c => (
                            <button key={c.contact_id} disabled={busy}
                              onClick={() => post({ action: 'link_name', vendor_id: u.vendor_id, raw_name: u.raw_name, contact_id: c.contact_id },
                                `"${u.raw_name}" → ${c.name} 연결 완료`)}
                              className={`px-2 py-0.5 text-[11px] rounded-full border ${
                                c.same_vendor
                                  ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                                  : 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
                              title={c.same_vendor ? '같은 거래처 소속 — 동일 추정' : '다른 거래처 동일 이름 — 동명이인 확인 필요'}>
                              {c.name}{c.vendor_name ? ` (${c.vendor_name})` : ''}{c.same_vendor ? '' : ' — 확인'}
                            </button>
                          ))}
                        </div>
                      ) : <span className="text-xs text-gray-400">후보 없음</span>}
                    </td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <button disabled={busy}
                        onClick={() => {
                          const name = window.prompt('신규 인물 이름 (직함 제외)', u.raw_name.replace(/님$/, '').split(/\s+/)[0])
                          if (!name?.trim()) return
                          const title = window.prompt('직함 (선택)', u.raw_name.replace(/님$/, '').split(/\s+/).slice(1).join(' ') || '') ?? ''
                          post({ action: 'create_contact', name: name.trim(), title: title.trim() || undefined,
                            vendor_id: u.vendor_id, raw_name: u.raw_name },
                            `${name.trim()} 신규 등록 + 연결 완료`)
                        }}
                        className="px-2 py-1 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 mr-1">
                        신규 인물
                      </button>
                      <button disabled={busy}
                        onClick={() => post({ action: 'ignore_name', vendor_id: u.vendor_id, raw_name: u.raw_name },
                          `"${u.raw_name}" 무시 처리 (공란 취급)`)}
                        className="px-2 py-1 text-xs border border-gray-300 text-gray-500 rounded hover:bg-gray-50">
                        무시
                      </button>
                    </td>
                  </tr>
                ))}
                {!bundle.unmatched.length && (
                  <tr><td colSpan={6} className="py-14 text-center text-gray-400 text-sm">미확인 담당자명이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
