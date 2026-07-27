'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useSearchParams } from 'next/navigation'
import { getPeriodRange, DEFAULT_VIEW_FROM } from '@/lib/period-presets'
import { ORDER_DELIVERY_STATUS_LABEL } from '@/lib/erp-delivery-status'
import type { HubDetail } from '@/lib/vendor-hub'

// 매출처 허브 — 거래처 360° 상세(B)
// 목록(A)의 기간이 URL로 넘어와 기본값이 되고, 여기서 바꿔도 목록에는 영향이 없다.

const won = (n: number) => n.toLocaleString('ko-KR')
const eok = (n: number) => Math.abs(n) >= 100000000 ? `${(n / 100000000).toFixed(2)}억` : Math.abs(n) >= 10000 ? `${Math.round(n / 10000).toLocaleString()}만` : won(n)

const STATUS_META: Record<string, { label: string; cls: string }> = {
  vip:         { label: 'VIP',       cls: 'bg-violet-100 text-violet-700' },
  normal:      { label: '정상',      cls: 'bg-green-100 text-green-700' },
  outstanding: { label: '미수',      cls: 'bg-amber-100 text-amber-700' },
  late:        { label: '수금지연',  cls: 'bg-orange-100 text-orange-700' },
  over90:      { label: '90일 초과', cls: 'bg-red-100 text-red-700' },
  dormant:     { label: '휴면 전환', cls: 'bg-gray-100 text-gray-500' },
}
const TL_META: Record<string, { label: string; cls: string }> = {
  invoice: { label: '계산서', cls: 'bg-blue-100 text-blue-700' },
  bank:    { label: '통장',   cls: 'bg-emerald-100 text-emerald-700' },
  card:    { label: '카드',   cls: 'bg-orange-100 text-orange-700' },
  alloc:   { label: '배분',   cls: 'bg-slate-200 text-slate-600' },
}
const TABS = ['개요', '주문 내역', '수금 내역', '계산서', 'VIP 내역', '선결제 내역', '활동 메모'] as const

interface Candidate { id: string; name: string; phone: string | null; history?: { vendor_name: string; title: string | null; started_at: string | null; ended_at: string | null }[] }

export default function SalesHubDetailPage() {
  const params = useParams<{ vendorId: string }>()
  const sp = useSearchParams()
  const vendorId = params.vendorId

  const [from, setFrom] = useState(sp.get('from') ?? DEFAULT_VIEW_FROM)
  const [to, setTo] = useState(sp.get('to') ?? new Date().toISOString().slice(0, 10))
  const [preset, setPreset] = useState('')
  const [data, setData] = useState<HubDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]>('개요')
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  // 담당 입력 상태
  const [staffForm, setStaffForm] = useState<{ open: boolean; name: string; team: string; primary: boolean }>({ open: false, name: '', team: '', primary: false })
  const [employees, setEmployees] = useState<{ id: string; name: string; team: string | null; vendor_count: number }[]>([])
  const [contactForm, setContactForm] = useState<{ open: boolean; name: string; title: string; phone: string; role: string; rep: boolean }>({ open: false, name: '', title: '', phone: '', role: '', rep: false })
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/vendor-hub/${vendorId}?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setData(json); setNote(json.vendor.note ?? '')
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally { setLoading(false) }
  }, [vendorId, from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/vendor-hub/staff').then(r => r.json()).then(j => setEmployees(j.employees ?? [])).catch(() => {})
  }, [])

  const applyPreset = (p: string) => {
    setPreset(p)
    if (p === '전체 기간') { setFrom('2024-01-01'); setTo(new Date().toISOString().slice(0, 10)); return }
    const r = getPeriodRange(p)
    setFrom(r.from); setTo(r.to)
  }

  const post = async (url: string, body: Record<string, unknown>) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, json }
  }

  const assignStaff = async (employeeId?: string) => {
    const body = employeeId
      ? { action: 'assign', vendor_id: vendorId, employee_id: employeeId, is_primary: staffForm.primary }
      : { action: 'assign_new', vendor_id: vendorId, name: staffForm.name, team: staffForm.team, is_primary: staffForm.primary }
    const { ok, json } = await post('/api/vendor-hub/staff', body)
    if (!ok) { flash(json.error ?? '배정 실패'); return }
    flash('담당직원 배정 완료')
    setStaffForm({ open: false, name: '', team: '', primary: false })
    load()
  }

  const submitContact = async (force = false, existingId?: string, endPrevious = false) => {
    const body = existingId
      ? { action: 'assign', vendor_id: vendorId, contact_id: existingId, title: contactForm.title, role_memo: contactForm.role, is_representative: contactForm.rep, end_previous: endPrevious }
      : { action: 'assign_new', vendor_id: vendorId, name: contactForm.name, phone: contactForm.phone, title: contactForm.title, role_memo: contactForm.role, is_representative: contactForm.rep, force }
    const { ok, json } = await post('/api/vendor-hub/contacts', body)
    if (!ok) { flash(json.error ?? '등록 실패'); return }
    if (json.needs_confirm) { setCandidates(json.candidates); return }
    flash('거래처 담당자 등록 완료')
    setContactForm({ open: false, name: '', title: '', phone: '', role: '', rep: false })
    setCandidates(null)
    load()
  }

  const saveNote = async () => {
    const res = await fetch(`/api/vendor-hub/${vendorId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    })
    flash(res.ok ? '메모 저장됨' : '저장 실패')
    if (res.ok) load()
  }

  const agingTotal = useMemo(() => data ? data.aging.b30 + data.aging.b60 + data.aging.b90 + data.aging.over90 : 0, [data])

  // 계산서 딥링크용 tax_type 맵 + 타임라인 이벤트별 원본 화면 링크
  const invTaxType = useMemo(() => new Map((data?.invoices ?? []).map(i => [i.id, i.tax_type ?? 'taxable'])), [data])
  const tlHref = useCallback((e: { kind: string; ref_id: string | null }): string | null => {
    if (e.kind === 'invoice' && e.ref_id) return `/tax-invoices/sales/${invTaxType.get(e.ref_id) ?? 'taxable'}?invoiceId=${e.ref_id}`
    if (e.kind === 'bank') return `/transactions?vendorId=${vendorId}`
    if (e.kind === 'card') return e.ref_id ? `/card-sales?q=${encodeURIComponent(e.ref_id)}` : '/card-sales'
    if (e.kind === 'alloc' && e.ref_id) return null
    return null
  }, [invTaxType, vendorId])

  if (loading && !data) return <div className="text-center py-24 text-gray-400">거래처 데이터를 모으는 중...</div>
  if (error) return <div className="mt-8 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
  if (!data) return null
  const meta = STATUS_META[data.status] ?? STATUS_META.normal

  return (
    <div>
      {msg && <div className="fixed top-4 right-4 z-50 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg shadow">{msg}</div>}

      <div className="text-xs text-gray-400">
        <Link href={`/sales-hub?from=${sp.get('from') ?? from}&to=${sp.get('to') ?? to}`} className="hover:underline">매출처 관리</Link>
        {' > '}<b className="text-gray-700">{data.vendor.name}</b>
      </div>

      {/* 상세 기간 (목록 기간이 기본값, 독립 변경) */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {['당월', '1분기', '2분기', '상반기', '당년', '전체 기간'].map(p => (
          <button key={p} onClick={() => applyPreset(p)}
            className={`px-2.5 py-1 rounded-full text-xs border ${preset === p ? 'bg-slate-900 text-white border-slate-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {p}
          </button>
        ))}
        <input type="date" value={from} onChange={e => { setPreset(''); setFrom(e.target.value) }} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => { setPreset(''); setTo(e.target.value) }} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-[11px] text-gray-400 ml-2">여기서 바꿔도 목록의 기간은 유지됩니다</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{data.vendor.name}</h1>
            <span className={`px-2 py-0.5 rounded text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
          </div>
          <div className="flex gap-1.5 flex-wrap mt-2">
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${data.links.alias_count ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              ERP 별칭 {data.links.alias_count || '미'}연동
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${data.links.card_count ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              카드번호 {data.links.card_count ? `${data.links.card_count}건` : '미연동'}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[11px] border ${data.links.has_opening ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              기초잔액 {data.links.has_opening ? '입력됨' : '미입력'}
            </span>
          </div>
        </div>
        <div className="text-right text-xs text-gray-500">
          {data.vendor.biz_number && <>사업자번호 {data.vendor.biz_number}<br /></>}
          {data.vendor.note && <>최근 메모: &quot;{data.vendor.note.slice(0, 40)}{data.vendor.note.length > 40 ? '…' : ''}&quot;</>}
        </div>
      </div>

      {/* 담당 패널 */}
      <div className="grid lg:grid-cols-2 gap-3 mt-4">
        {/* 자사 담당직원 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-800">자사 담당직원 <span className="text-gray-400 font-normal">· {data.staff.length}명</span></div>
            <button onClick={() => setStaffForm(f => ({ ...f, open: !f.open }))}
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">담당 추가</button>
          </div>
          {data.staff.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <span className="font-semibold text-sm">{s.name}</span>
                {s.is_primary && <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[10px] font-bold">주담당</span>}
                <div className="text-[11px] text-gray-400">{s.team ?? '팀 미지정'} · 배정 {s.started_at ?? '-'}</div>
              </div>
              <div className="text-right text-[11px] text-gray-500">
                담당처 {s.vendor_count}곳
                <div className="mt-0.5 flex gap-1 justify-end">
                  {!s.is_primary && (
                    <button onClick={async () => { await post('/api/vendor-hub/staff', { action: 'set_primary', assignment_id: s.id }); load() }}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] hover:bg-gray-50">주담당으로</button>
                  )}
                  <button onClick={async () => { await post('/api/vendor-hub/staff', { action: 'unassign', assignment_id: s.id }); load() }}
                    className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] text-red-500 hover:bg-red-50">해제</button>
                </div>
              </div>
            </div>
          ))}
          {!data.staff.length && <div className="text-xs text-gray-400 py-3">배정된 담당직원이 없습니다.</div>}
          {data.staff_suggest.length > 0 && (
            <div className="mt-2 px-3 py-2 bg-amber-50 rounded-lg text-[11px] text-amber-800">
              ERP 주문 담당 추천: {data.staff_suggest.map(s => (
                <button key={s.name}
                  onClick={async () => {
                    const body = s.employee_id
                      ? { action: 'assign', vendor_id: vendorId, employee_id: s.employee_id, is_primary: data.staff.length === 0 }
                      : { action: 'assign_new', vendor_id: vendorId, name: s.name, is_primary: data.staff.length === 0 }
                    const { ok, json } = await post('/api/vendor-hub/staff', body)
                    flash(ok ? `${s.name} 배정 완료` : (json.error ?? '실패')); if (ok) load()
                  }}
                  className="underline font-semibold mr-2">{s.name} (주문 {s.order_count}건)</button>
              ))}
            </div>
          )}
          {staffForm.open && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
              <div className="flex gap-2 flex-wrap">
                <select onChange={e => { if (e.target.value) assignStaff(e.target.value) }} defaultValue=""
                  className="border border-gray-300 rounded px-2 py-1 text-xs">
                  <option value="">기존 직원 선택...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.team ?? '-'} · 담당 {e.vendor_count})</option>)}
                </select>
                <span className="text-xs text-gray-400 self-center">또는 신규:</span>
                <input value={staffForm.name} onChange={e => setStaffForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="이름" className="border border-gray-300 rounded px-2 py-1 text-xs w-24" />
                <input value={staffForm.team} onChange={e => setStaffForm(f => ({ ...f, team: e.target.value }))}
                  placeholder="팀 (선택)" className="border border-gray-300 rounded px-2 py-1 text-xs w-24" />
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={staffForm.primary} onChange={e => setStaffForm(f => ({ ...f, primary: e.target.checked }))} /> 주담당
                </label>
                <button onClick={() => staffForm.name.trim() && assignStaff()}
                  className="px-2.5 py-1 bg-slate-900 text-white rounded text-xs">등록·배정</button>
              </div>
            </div>
          )}
        </div>

        {/* 거래처 담당자 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-800">
              거래처 담당자 <span className="text-gray-400 font-normal">
                · 활성 {data.contacts.filter(c => !c.ended_at).length}명 · 이전 {data.contacts.filter(c => c.ended_at).length}명
              </span>
            </div>
            <button onClick={() => setContactForm(f => ({ ...f, open: !f.open }))}
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">담당자 추가</button>
          </div>
          {data.contacts.map(c => (
            <div key={c.assignment_id} className={`flex items-start justify-between py-2 border-b border-gray-50 last:border-0 ${c.ended_at ? 'opacity-50' : ''}`}>
              <div>
                <span className="font-semibold text-sm">{c.name}{c.title ? ` ${c.title}` : ''}</span>
                {c.is_representative && <span className="ml-1.5 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[10px] font-bold">대표</span>}
                <div className="text-[11px] text-gray-400">
                  {[c.role_memo, c.phone, c.email].filter(Boolean).join(' · ') || '연락처 미입력'}
                </div>
              </div>
              <div className="text-right text-[11px] text-gray-500 whitespace-nowrap">
                {c.ended_at ? `종료 ${c.ended_at}` : `배정 ${c.started_at ?? '-'}`}
                {!c.ended_at && (
                  <div className="mt-0.5 flex gap-1 justify-end">
                    {!c.is_representative && (
                      <button onClick={async () => { await post('/api/vendor-hub/contacts', { action: 'set_representative', assignment_id: c.assignment_id }); load() }}
                        className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] hover:bg-gray-50">대표로</button>
                    )}
                    <button onClick={async () => { await post('/api/vendor-hub/contacts', { action: 'end_assignment', assignment_id: c.assignment_id }); load() }}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[10px] text-red-500 hover:bg-red-50">종료</button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {!data.contacts.length && <div className="text-xs text-gray-400 py-3">등록된 거래처 담당자가 없습니다.</div>}
          {contactForm.open && (
            <div className="mt-3 p-3 bg-gray-50 rounded-lg space-y-2">
              <div className="flex gap-2 flex-wrap">
                <input value={contactForm.name} onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="성함" className="border border-gray-300 rounded px-2 py-1 text-xs w-24" />
                <input value={contactForm.title} onChange={e => setContactForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="직함" className="border border-gray-300 rounded px-2 py-1 text-xs w-20" />
                <input value={contactForm.phone} onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="휴대폰 (선택)" className="border border-gray-300 rounded px-2 py-1 text-xs w-32" />
                <input value={contactForm.role} onChange={e => setContactForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="역할 메모 (선택)" className="border border-gray-300 rounded px-2 py-1 text-xs w-32" />
                <label className="text-xs flex items-center gap-1">
                  <input type="checkbox" checked={contactForm.rep} onChange={e => setContactForm(f => ({ ...f, rep: e.target.checked }))} /> 대표
                </label>
                <button onClick={() => contactForm.name.trim() && submitContact()}
                  className="px-2.5 py-1 bg-slate-900 text-white rounded text-xs">등록·배정</button>
              </div>
              {candidates && (
                <div className="px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs">
                  <div className="font-semibold text-amber-800 mb-1">같은 인물일 수 있는 기존 담당자가 있습니다 — 확인해주세요.</div>
                  {candidates.map(c => (
                    <div key={c.id} className="flex items-center justify-between py-1 border-b border-gray-50 last:border-0">
                      <span>{c.name} {c.phone ?? '(번호 없음)'}
                        {c.history?.length ? <span className="text-gray-400"> — {c.history.map(h => `${h.vendor_name} ${h.title ?? ''}`).join(' → ')}</span> : null}
                      </span>
                      <span className="flex gap-1">
                        <button onClick={() => submitContact(false, c.id, true)}
                          className="px-1.5 py-0.5 border rounded text-[10px] hover:bg-gray-50">같은 인물 (이동 처리)</button>
                        <button onClick={() => submitContact(false, c.id, false)}
                          className="px-1.5 py-0.5 border rounded text-[10px] hover:bg-gray-50">같은 인물 (겸직)</button>
                      </span>
                    </div>
                  ))}
                  <button onClick={() => submitContact(true)}
                    className="mt-1.5 px-2 py-0.5 border rounded text-[10px] hover:bg-gray-50">아니요, 새 인물로 등록</button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* KPI 6 — 기간/누적 */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 mt-4">
        {[
          { tag: '기간', label: '매출', value: eok(data.kpi.net), sub: `주문 ${data.orders.length}건`, cls: '' },
          { tag: '기간', label: '수금액', value: eok(data.kpi.collected), sub: `계산서매칭 ${eok(data.kpi.paid_invoice)} · 카드 ${eok(data.kpi.paid_card)}`, cls: '' },
          { tag: '기간', label: '미수 잔액', value: eok(data.kpi.outstanding), sub: 'ERP 미수금 기준', cls: data.kpi.outstanding > 0 ? 'text-red-600' : '' },
          { tag: '누적', label: '평균 수금일', value: data.kpi.avg_collect_days != null ? `${data.kpi.avg_collect_days}일` : '-', sub: '계산서 발행→입금 (금액 가중)', cls: '' },
          { tag: '누적', label: 'VIP 매출', value: eok(data.kpi.vip_total), sub: "'VIP' 상품 누적 매출", cls: '' },
          { tag: '누적', label: '선결제 잔액', value: eok(data.kpi.prepay_balance), sub: `입금 ${eok(data.kpi.prepay_deposit)} · 사용 ${eok(data.kpi.prepay_deduction)}`, cls: '' },
        ].map((k, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl px-3.5 py-3">
            <div className="text-[11px] text-gray-500">
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold mr-1 ${k.tag === '기간' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{k.tag}</span>
              {k.label}
            </div>
            <div className={`text-lg font-bold mt-0.5 tabular-nums ${k.cls}`}>{k.value}</div>
            <div className="text-[10px] text-gray-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 미수 Aging */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-gray-800">미수 Aging <span className="font-normal text-gray-400 text-xs">(전체 기간, 주문일 기준)</span></div>
          {data.aging.opening > 0 && <div className="text-[11px] text-gray-500">기초이월 잔여 {eok(data.aging.opening)} 별도</div>}
        </div>
        {agingTotal > 0 ? (
          <>
            <div className="flex h-6 rounded-md overflow-hidden mt-2">
              {[
                { v: data.aging.b30, c: '#9ec5f4', t: '#0d366b' },
                { v: data.aging.b60, c: '#5598e7', t: '#fff' },
                { v: data.aging.b90, c: '#256abf', t: '#fff' },
                { v: data.aging.over90, c: '#104281', t: '#fff' },
              ].map((b, i) => b.v > 0 && (
                <div key={i} style={{ flex: b.v, background: b.c, color: b.t }}
                  className="flex items-center justify-center text-[10px] font-semibold border-r-2 border-white last:border-0">
                  {['~30일', '31~60일', '61~90일', '90일+'][i]} {eok(b.v)}
                </div>
              ))}
            </div>
          </>
        ) : <div className="text-xs text-gray-400 mt-2">미수 잔액이 없습니다.</div>}
      </div>

      {/* 탭 */}
      <div className="flex gap-0.5 border-b border-gray-200 mt-5">
        {TABS.map(t => {
          const count = t === '주문 내역' ? data.orders.length
            : t === '수금 내역' ? data.timeline.filter(e => e.kind !== 'invoice').length
            : t === '계산서' ? data.invoices.length
            : t === 'VIP 내역' ? data.vip_items.length
            : t === '선결제 내역' ? data.prepay_ledger.length + data.prepay_items.length
            : null
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3.5 py-2 text-sm border-b-2 -mb-px ${tab === t ? 'border-slate-900 text-gray-900 font-bold' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
              {t}{count != null ? ` ${count}` : ''}
            </button>
          )
        })}
      </div>

      {/* 탭 내용 */}
      <div className="mt-4">
        {(tab === '개요' || tab === '주문 내역') && (
          <div className={tab === '개요' ? 'grid xl:grid-cols-5 gap-3' : ''}>
            <div className={`bg-white border border-gray-200 rounded-xl overflow-x-auto ${tab === '개요' ? 'xl:col-span-3' : ''}`}>
              <div className="px-4 pt-3 text-sm font-bold text-gray-800">ERP 주문 내역{tab === '개요' ? ' (최근)' : ''}</div>
              <div className="px-4 pb-1 text-[11px] text-gray-400">주문번호 → 배송 → 계산서 → 수금 → 미수까지 한 줄</div>
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">주문번호</th>
                    <th className="py-2 px-3 text-left font-medium">주문일</th>
                    <th className="py-2 px-3 text-left font-medium">품목 요약</th>
                    <th className="py-2 px-3 text-right font-medium">순매출</th>
                    <th className="py-2 px-3 text-left font-medium">배송현황</th>
                    <th className="py-2 px-3 text-left font-medium">계산서</th>
                    <th className="py-2 px-3 text-left font-medium">수금</th>
                    <th className="py-2 px-3 text-right font-medium">미수</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === '개요' ? data.orders.slice(0, 8) : data.orders).map(o => {
                    const dv = o.delivery ? ORDER_DELIVERY_STATUS_LABEL[o.delivery] : null
                    const invBadge = o.invoice_linked >= o.net && o.net > 0
                      ? { t: '연결', c: 'bg-green-100 text-green-700' }
                      : o.invoice_linked > 0 ? { t: '일부', c: 'bg-amber-100 text-amber-700' }
                      : { t: '미발행', c: 'bg-orange-100 text-orange-700' }
                    const payBadge = o.outstanding === 0
                      ? { t: '완료', c: 'bg-green-100 text-green-700' }
                      : o.paid_alloc > 0 || o.outstanding < o.net ? { t: '일부', c: 'bg-amber-100 text-amber-700' }
                      : { t: '미수', c: 'bg-red-100 text-red-700' }
                    return (
                      <tr key={o.id} className="border-b border-gray-50">
                        <td className="py-1.5 px-3 text-xs tabular-nums">
                          {o.order_no
                            ? <Link href={`/erp-orders?q=${encodeURIComponent(o.order_no)}`} className="text-blue-600 hover:underline" title="ERP 주문내역에서 열기">{o.order_no}</Link>
                            : <span className="text-gray-500">-</span>}
                        </td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">{o.order_date}</td>
                        <td className="py-1.5 px-3">{o.item_summary}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{won(o.net)}</td>
                        <td className="py-1.5 px-3">
                          {dv ? <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${dv.cls}`}>{dv.text}</span> : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="py-1.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${invBadge.c}`}>{invBadge.t}</span></td>
                        <td className="py-1.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${payBadge.c}`}>{payBadge.t}</span></td>
                        <td className={`py-1.5 px-3 text-right tabular-nums ${o.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(o.outstanding)}</td>
                      </tr>
                    )
                  })}
                  {!data.orders.length && <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">기간 내 주문이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            {tab === '개요' && (
              <div className="bg-white border border-gray-200 rounded-xl xl:col-span-2">
                <div className="px-4 pt-3 text-sm font-bold text-gray-800">수금 타임라인</div>
                <div className="px-4 pb-1 text-[11px] text-gray-400">계산서·통장·카드 통합 (최근)</div>
                <ul className="px-4 pb-3">
                  {data.timeline.slice(0, 12).map((e, i) => {
                    const href = tlHref(e)
                    return (
                      <li key={i} className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold w-12 text-center ${TL_META[e.kind].cls}`}>{TL_META[e.kind].label}</span>
                        <span className="text-xs text-gray-400 tabular-nums w-20">{e.date}</span>
                        {href
                          ? <Link href={href} className="flex-1 truncate text-blue-700 hover:underline" title="원본 화면에서 열기">{e.label}</Link>
                          : <span className="flex-1 truncate">{e.label}</span>}
                        <span className="font-semibold tabular-nums">{won(e.amount)}</span>
                      </li>
                    )
                  })}
                  {!data.timeline.length && <li className="text-xs text-gray-400 py-4">수금·발행 이력이 없습니다.</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === '수금 내역' && (
          <div className="bg-white border border-gray-200 rounded-xl">
            <ul className="px-4 py-2">
              {data.timeline.map((e, i) => {
                const href = tlHref(e)
                return (
                  <li key={i} className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold w-12 text-center ${TL_META[e.kind].cls}`}>{TL_META[e.kind].label}</span>
                    <span className="text-xs text-gray-400 tabular-nums w-20">{e.date}</span>
                    {href
                      ? <Link href={href} className="flex-1 truncate text-blue-700 hover:underline" title="원본 화면에서 열기">{e.label}</Link>
                      : <span className="flex-1 truncate">{e.label}</span>}
                    <span className="font-semibold tabular-nums">{won(e.amount)}</span>
                  </li>
                )
              })}
              {!data.timeline.length && <li className="text-xs text-gray-400 py-6">이력이 없습니다.</li>}
            </ul>
          </div>
        )}

        {tab === '계산서' && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium">발행일</th>
                  <th className="py-2 px-3 text-right font-medium">공급대가</th>
                  <th className="py-2 px-3 text-left font-medium">수금 상태</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map(inv => (
                  <tr key={inv.id} className="border-b border-gray-50">
                    <td className="py-1.5 px-3 tabular-nums">
                      <Link href={`/tax-invoices/sales/${inv.tax_type ?? 'taxable'}?invoiceId=${inv.id}`}
                        className="text-blue-600 hover:underline" title="계산서 화면에서 열기">{inv.issue_date}</Link>
                    </td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{won(inv.total_amount)}</td>
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${inv.payment_status === 'matched' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {inv.payment_status === 'matched' ? '수금 매칭됨' : '미매칭'}
                      </span>
                    </td>
                  </tr>
                ))}
                {!data.invoices.length && <tr><td colSpan={3} className="text-center py-10 text-gray-400 text-sm">발행된 매출 계산서가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )}

        {(tab === 'VIP 내역' || tab === '선결제 내역') && (
          <div className="space-y-3">
            {tab === '선결제 내역' && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <div className="text-sm font-bold text-gray-800 mb-1">선결제 원장 <span className="font-normal text-gray-400 text-xs">입금 {eok(data.kpi.prepay_deposit)} · 사용 {eok(data.kpi.prepay_deduction)} · 잔액 {eok(data.kpi.prepay_balance)}</span></div>
                <ul>
                  {data.prepay_ledger.map((e, i) => (
                    <li key={i} className="flex items-baseline gap-2 py-1 border-b border-gray-50 last:border-0 text-sm">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${e.entry_type === 'deposit' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                        {e.entry_type === 'deposit' ? '입금' : '사용'}
                      </span>
                      <span className="text-xs text-gray-400 tabular-nums w-20">{e.entry_date}</span>
                      <span className="flex-1 truncate text-xs text-gray-600">{e.memo ?? ''}</span>
                      <span className="font-semibold tabular-nums">{won(e.amount)}</span>
                    </li>
                  ))}
                  {!data.prepay_ledger.length && <li className="text-xs text-gray-400 py-3">선결제 입출 원장이 없습니다.</li>}
                </ul>
              </div>
            )}
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <div className="px-4 pt-3 pb-1 text-sm font-bold text-gray-800">{tab === 'VIP 내역' ? "'VIP' 상품 주문 품목" : '선결제 처리 품목'}</div>
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">주문번호</th>
                    <th className="py-2 px-3 text-left font-medium">주문일</th>
                    <th className="py-2 px-3 text-left font-medium">품목</th>
                    <th className="py-2 px-3 text-right font-medium">수량</th>
                    <th className="py-2 px-3 text-right font-medium">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === 'VIP 내역' ? data.vip_items : data.prepay_items).map((it, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${it.is_canceled ? 'opacity-40 line-through' : ''}`}>
                      <td className="py-1.5 px-3 text-xs text-gray-500 tabular-nums">{it.order_no ?? '-'}</td>
                      <td className="py-1.5 px-3 tabular-nums text-xs">{it.order_date ?? '-'}</td>
                      <td className="py-1.5 px-3">{it.item_name ?? '-'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(it.line_total)}</td>
                    </tr>
                  ))}
                  {!(tab === 'VIP 내역' ? data.vip_items : data.prepay_items).length && (
                    <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">해당 품목이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === '활동 메모' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-2xl">
            <div className="text-sm font-bold text-gray-800 mb-2">활동 메모</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={6}
              placeholder="수금 협의, 방문 기록 등 이 거래처 관련 메모"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <div className="flex justify-end mt-2">
              <button onClick={saveNote} className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">저장</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
