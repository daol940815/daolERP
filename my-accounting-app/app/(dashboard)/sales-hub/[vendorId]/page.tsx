'use client'

import PeriodPresets from '@/components/ui/PeriodPresets'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { getPeriodRange } from '@/lib/period-presets'
import { ORDER_DELIVERY_STATUS_LABEL } from '@/lib/erp-delivery-status'
import type { HubDetail } from '@/lib/vendor-hub'
import { contactLabel, honorify } from '@/lib/contact-label'
import type { BillingDetail, BillingRef } from '@/lib/billing'
import InvoiceLinkModal from '../../sales-cycle/invoice-link-modal'

// 매출처 허브 — 거래처 360° 상세(B)
// 목록(A)의 기간이 URL로 넘어와 기본값이 되고, 여기서 바꿔도 목록에는 영향이 없다.

const won = (n: number) => n.toLocaleString('ko-KR')
// 카드 금액은 1,000,000원 형식 그대로 — 억·만 축약은 정확한 금액 확인이 어려워 폐기 (2026-11-11 사용자 요청, 매입처와 동일)
const eok = (n: number) => `${won(n)}원`

const STATUS_META: Record<string, { label: string; cls: string }> = {
  normal:      { label: '정상',      cls: 'bg-green-100 text-green-700' },
  outstanding: { label: '미수',      cls: 'bg-amber-100 text-amber-700' },
  late:        { label: '수금지연',  cls: 'bg-orange-100 text-orange-700' },
  over90:      { label: '미수 90일 초과', cls: 'bg-red-100 text-red-700' },
  dormant:     { label: '휴면 전환', cls: 'bg-gray-100 text-gray-500' },
  no_orders:   { label: '주문 없음', cls: 'bg-slate-100 text-slate-500' },
}
const TL_META: Record<string, { label: string; cls: string }> = {
  invoice: { label: '계산서', cls: 'bg-blue-100 text-blue-700' },
  bank:    { label: '통장',   cls: 'bg-emerald-100 text-emerald-700' },
  card:    { label: '카드',   cls: 'bg-orange-100 text-orange-700' },
  alloc:   { label: '배분',   cls: 'bg-slate-200 text-slate-600' },
}
const TABS = ['개요', '주문 내역', '수금 내역', '계산서', '소속 부서', 'VIP 내역', '선결제 내역', '활동 메모'] as const

interface Candidate { id: string; name: string; phone: string | null; history?: { vendor_name: string; title: string | null; started_at: string | null; ended_at: string | null }[] }

export default function SalesHubDetailPage() {
  const params = useParams<{ vendorId: string }>()
  const sp = useSearchParams()
  const vendorId = params.vendorId

  const [from, setFrom] = useState(sp.get('from') ?? getPeriodRange('당년').from)   // 관리·분석 기본 = 당년
  const [to, setTo] = useState(sp.get('to') ?? getPeriodRange('당년').to)
  const [data, setData] = useState<HubDetail | null>(null)
  // 과거 매출 스냅샷 (고객관리문서 기준, 111) — ERP 주문 삭제 전 매출의 참고 지표 (드릴다운 불가)
  interface DocSalesRow {
    manager_name: string | null; daol_staff: string | null; total_sales: number
    season: Record<string, number>; monthly: Record<string, number>
    first_order_date: string | null; last_order_date: string | null
    order_type: string | null; source: string
  }
  const [docSales, setDocSales] = useState<DocSalesRow[]>([])
  // 청구처(계산서 발행처, 114) — 부서면 가리키는 법인, 법인이면 소속 부서 · 계산서별 연결 부서
  const [billing, setBilling] = useState<BillingDetail | null>(null)
  // 개인 고객 전용 매출처(115) — 고객 정보 + 같은 인물의 다른 거래처
  const [individual, setIndividual] = useState<{
    contact_id: string; name: string; code: string | null; phone: string | null
    others: { vendor_id: string; vendor_name: string; title: string | null }[]
  } | null>(null)
  // 같은 이름(법인격 · 공백 무시) 매출처 — 중복이면 주문이 한쪽 상세에만 보인다 (2026-11-12)
  const [sameName, setSameName] = useState<{ id: string; name: string; is_active: boolean; order_count: number }[]>([])
  const [linkOpen, setLinkOpen] = useState(false)
  const [billingForm, setBillingForm] = useState<{ open: boolean; q: string; options: BillingRef[]; busy: boolean }>({ open: false, q: '', options: [], busy: false })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]>('개요')
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  // 담당 입력 상태
  const [staffForm, setStaffForm] = useState<{ open: boolean; name: string; team: string; primary: boolean }>({ open: false, name: '', team: '', primary: false })
  const [employees, setEmployees] = useState<{ id: string; name: string; team: string | null; vendor_count: number }[]>([])
  // 거래처 담당자 줄 수정 — 직함 · 역할 메모(배정) + 핸드폰 · 유선 · 이메일(인물) (2026-11-13)
  const [rowEdit, setRowEdit] = useState<{ id: string; title: string; role_memo: string; phone: string; tel: string; email: string; busy: boolean } | null>(null)
  const [contactForm, setContactForm] = useState<{ open: boolean; name: string; title: string; phone: string; role: string; rep: boolean; staff: string }>({ open: false, name: '', title: '', phone: '', role: '', rep: false, staff: '' })
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [note, setNote] = useState('')

  // 기본정보 편집 (고객·영업 수정 권한자만 — 노출은 can_edit, 차단은 미들웨어)
  const router = useRouter()
  const [canEdit, setCanEdit] = useState(false)
  const [infoForm, setInfoForm] = useState<{ open: boolean; name: string; biz: string; busy: boolean }>({ open: false, name: '', biz: '', busy: false })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/vendor-hub/${vendorId}?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setData(json); setNote(json.vendor.note ?? ''); setCanEdit(!!json.can_edit)
      setDocSales(Array.isArray(json.doc_sales) ? json.doc_sales : [])
      setBilling(json.billing_detail ?? null)
      setIndividual(json.individual ?? null)
      setSameName(Array.isArray(json.same_name) ? json.same_name : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : '조회 실패')
    } finally { setLoading(false) }
  }, [vendorId, from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    fetch('/api/vendor-hub/staff').then(r => r.json()).then(j => setEmployees(j.employees ?? [])).catch(() => {})
  }, [])


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
      ? { action: 'assign', vendor_id: vendorId, contact_id: existingId, title: contactForm.title, role_memo: contactForm.role, is_representative: contactForm.rep, end_previous: endPrevious, staff_employee_id: contactForm.staff || undefined }
      : { action: 'assign_new', vendor_id: vendorId, name: contactForm.name, phone: contactForm.phone, title: contactForm.title, role_memo: contactForm.role, is_representative: contactForm.rep, force, staff_employee_id: contactForm.staff || undefined }
    const { ok, json } = await post('/api/vendor-hub/contacts', body)
    if (!ok) { flash(json.error ?? '등록 실패'); return }
    if (json.needs_confirm) { setCandidates(json.candidates); return }
    flash('거래처 담당자 등록 완료')
    setContactForm({ open: false, name: '', title: '', phone: '', role: '', rep: false, staff: '' })
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

  // 개인주문 거래처('개인') — 고객명(담당자 칸)이 곧 지점명 역할이므로 고객별로 분해해 보여준다
  const isPersonal = useMemo(() => (data?.vendor.name ?? '').replace(/\s+/g, '') === '개인', [data])
  const [custFilter, setCustFilter] = useState<string | null>(null)
  const custGroups = useMemo(() => {
    if (!data || !isPersonal) return []
    const m = new Map<string, { count: number; net: number; outstanding: number; last: string }>()
    for (const o of data.orders) {
      const key = (o.manager_name ?? '').trim()
      let g = m.get(key)
      if (!g) { g = { count: 0, net: 0, outstanding: 0, last: o.order_date }; m.set(key, g) }
      g.count++; g.net += o.net; g.outstanding += o.outstanding
      if (o.order_date > g.last) g.last = o.order_date
    }
    return Array.from(m.entries())
      .map(([name, g]) => ({ name, ...g }))
      .sort((a, b) => b.net - a.net || b.count - a.count)
  }, [data, isPersonal])
  const shownOrders = useMemo(() => {
    if (!data) return []
    if (custFilter == null) return data.orders
    return data.orders.filter(o => (o.manager_name ?? '').trim() === custFilter)
  }, [data, custFilter])
  useEffect(() => { if (tab !== '주문 내역') setCustFilter(null) }, [tab])  // 필터는 주문 내역 탭에서만

  // 계산서 딥링크용 tax_type 맵 + 타임라인 이벤트별 원본 화면 링크
  const invTaxType = useMemo(() => new Map((data?.invoices ?? []).map(i => [i.id, i.tax_type ?? 'taxable'])), [data])
  const tlHref = useCallback((e: { kind: string; ref_id: string | null }): string | null => {
    if (e.kind === 'invoice' && e.ref_id) return `/tax-invoices?dir=sales&tax=${invTaxType.get(e.ref_id) ?? 'taxable'}&invoiceId=${e.ref_id}`
    if (e.kind === 'bank') return `/transactions?vendorId=${vendorId}`
    if (e.kind === 'card') return e.ref_id ? `/cards?q=${encodeURIComponent(e.ref_id)}` : '/cards'
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
      <PeriodPresets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} className="mb-2" />
      <div className="flex items-center gap-1.5 flex-wrap">
        <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-gray-400 text-xs">~</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-300 rounded px-2 py-1 text-xs" />
        <span className="text-[0.6875rem] text-gray-400 ml-2">여기서 바꿔도 목록의 기간은 유지됩니다</span>
      </div>

      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4 flex-wrap mt-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-gray-900">{data.vendor.name}</h1>
            {individual && <span className="px-2 py-0.5 rounded text-[0.6875rem] font-semibold bg-violet-100 text-violet-700">개인 고객</span>}
            <span className={`px-2 py-0.5 rounded text-[0.6875rem] font-semibold ${meta.cls}`}>{meta.label}</span>
            {!data.vendor.is_active && (
              <span className="px-2 py-0.5 rounded text-[0.6875rem] font-semibold bg-gray-200 text-gray-600">비활성</span>
            )}
            {canEdit && (
              <span className="flex items-center gap-1 ml-1">
                <button onClick={() => setInfoForm({ open: !infoForm.open, name: data.vendor.name, biz: data.vendor.biz_number ?? '', busy: false })}
                  className="px-2 py-0.5 border border-gray-300 rounded text-[0.6875rem] text-gray-600 hover:bg-gray-50">정보 수정</button>
                {data.vendor.is_active ? (
                  <button onClick={async () => {
                    if (!confirm(`'${data.vendor.name}' 매출처를 삭제할까요?\n연결된 데이터가 있으면 삭제 대신 비활성 처리를 안내합니다.`)) return
                    const res = await fetch(`/api/vendor-hub/${vendorId}`, { method: 'DELETE' })
                    const json = await res.json()
                    if (res.ok) { flash('삭제되었습니다.'); router.push('/sales-hub'); return }
                    if (res.status === 409) {
                      const summary = Object.entries(json.linked ?? {}).map(([k, v]) => `${k} ${v}건`).join(' · ')
                      if (confirm(`연결된 데이터가 있어 삭제할 수 없습니다 (${summary}).\n대신 비활성 처리할까요? 이력·회계 연결은 보존됩니다.`)) {
                        const r2 = await fetch(`/api/vendor-hub/${vendorId}`, {
                          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ is_active: false }),
                        })
                        flash(r2.ok ? '비활성 처리되었습니다.' : '비활성 처리 실패'); if (r2.ok) load()
                      }
                    } else flash(json.error ?? '삭제 실패')
                  }}
                    className="px-2 py-0.5 border border-red-200 text-red-600 rounded text-[0.6875rem] hover:bg-red-50">삭제</button>
                ) : (
                  <button onClick={async () => {
                    const r = await fetch(`/api/vendor-hub/${vendorId}`, {
                      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ is_active: true }),
                    })
                    flash(r.ok ? '재활성되었습니다.' : '실패'); if (r.ok) load()
                  }}
                    className="px-2 py-0.5 border border-emerald-200 text-emerald-700 rounded text-[0.6875rem] hover:bg-emerald-50">재활성</button>
                )}
              </span>
            )}
          </div>
          {individual && (
            <div className="mt-1 text-xs text-gray-500">
              고객 <Link href={`/sales-hub/contacts/${individual.contact_id}`} className="font-semibold text-gray-800 hover:underline">{individual.name}</Link>
              {individual.code && <span className="ml-1 font-mono text-[0.6875rem] text-gray-400">{individual.code}</span>}
              {individual.phone && <span className="ml-2">{individual.phone}</span>}
              <span className="ml-2 text-gray-400">· 업체 &lsquo;개인&rsquo; 주문이 고객별로 자동으로 모이는 매출처입니다(지점 없음)</span>
            </div>
          )}
          {individual && individual.others.length > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 flex-wrap bg-violet-50 border border-violet-200 rounded-lg px-3 py-1.5">
              <span className="text-[0.6875rem] font-bold text-violet-700">같은 고객의 다른 거래</span>
              {individual.others.map(o => (
                <Link key={o.vendor_id} href={`/sales-hub/${o.vendor_id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                  {o.vendor_name}{o.title && <span className="ml-1 text-[0.6875rem] font-normal text-gray-500">{o.title}</span>}
                </Link>
              ))}
              <span className="text-[0.6875rem] text-gray-500">그쪽 주문은 그 매출처에 집계됩니다</span>
            </div>
          )}
          {sameName.length > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 flex-wrap bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
              <span className="text-[0.6875rem] font-bold text-amber-700">같은 이름 매출처</span>
              {sameName.map(o => (
                <Link key={o.id} href={`/sales-hub/${o.id}`} className="text-sm font-semibold text-gray-900 hover:underline">
                  {o.name}
                  <span className="ml-1 text-[0.6875rem] font-normal text-gray-500">{o.is_active ? '' : '비활성 · '}주문 {o.order_count}건</span>
                </Link>
              ))}
              <span className="text-[0.6875rem] text-gray-500">그쪽 주문은 그 매출처에만 보입니다 — 같은 곳이면</span>
              <Link href="/vendor-dedup" className="text-[0.6875rem] text-amber-700 underline">거래처 중복 정리에서 병합</Link>
            </div>
          )}
          {billing?.available && billing.billing && (
            <div className="mt-2 inline-flex items-center gap-2 flex-wrap bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
              <span className="text-[0.6875rem] font-bold text-blue-700">청구처</span>
              <Link href={`/sales-hub/${billing.billing.id}`} className="text-sm font-bold text-gray-900 hover:underline">{billing.billing.name}</Link>
              <span className="text-[0.6875rem] text-gray-500">{billing.billing.biz_number ?? ''} · 이 매출처 주문의 계산서는 청구처 법인으로 발행됩니다</span>
              {canEdit && <button onClick={() => setBillingForm(f => ({ ...f, open: !f.open }))}
                className="px-2 py-0.5 border border-gray-300 bg-white rounded text-[0.6875rem] text-gray-600 hover:bg-gray-50">변경</button>}
            </div>
          )}
          {billing?.available && !billing.billing && billing.children.length > 0 && (
            <div className="mt-2 inline-flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
              <span className="text-[0.6875rem] font-bold text-blue-700">청구처 · 소속 {billing.children.length}곳</span>
              <span className="text-[0.6875rem] text-gray-500">주문은 소속 부서가 하고, 계산서 · 입금은 여기로 들어옵니다</span>
              <button onClick={() => setTab('소속 부서')} className="text-[0.6875rem] text-blue-700 underline">소속 부서 보기</button>
            </div>
          )}
          {billing?.available && !billing.billing && !billing.children.length && canEdit && !billingForm.open && (
            <button onClick={() => setBillingForm(f => ({ ...f, open: true }))}
              className="mt-1 text-[0.6875rem] text-gray-400 hover:text-gray-600 underline">계산서가 다른 법인(본점 등)으로 발행되나요? 청구처 지정</button>
          )}
          {billingForm.open && (
            <div className="mt-2 border border-blue-200 bg-blue-50/40 rounded-lg px-3 py-2 max-w-xl">
              <div className="flex items-center gap-2">
                <input autoFocus value={billingForm.q} placeholder="청구처 법인 검색 (예: 주식회사 하나은행)"
                  onChange={async e => {
                    const q = e.target.value
                    setBillingForm(f => ({ ...f, q }))
                    if (q.trim().length < 2) { setBillingForm(f => ({ ...f, options: [] })); return }
                    const r = await fetch(`/api/vendor-hub/billing?entities=1&q=${encodeURIComponent(q.trim())}`).then(x => x.json()).catch(() => null)
                    setBillingForm(f => (f.q === q ? { ...f, options: ((r?.entities ?? []) as BillingRef[]).filter(o => o.id !== vendorId) } : f))
                  }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm flex-1" />
                {billing?.billing && (
                  <button disabled={billingForm.busy} onClick={async () => {
                    setBillingForm(f => ({ ...f, busy: true }))
                    const res = await fetch('/api/vendor-hub/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'clear', vendor_ids: [vendorId] }) })
                    const j = await res.json().catch(() => ({}))
                    setBillingForm({ open: false, q: '', options: [], busy: false })
                    flash(res.ok ? '청구처를 해제했습니다 — 이 매출처가 직접 계산서를 받습니다.' : (j.error ?? '해제 실패')); if (res.ok) load()
                  }} className="px-2 py-1 border border-gray-300 bg-white rounded text-xs text-gray-600">해제(자체 발행)</button>
                )}
                <button onClick={() => setBillingForm({ open: false, q: '', options: [], busy: false })} className="text-xs text-gray-500">닫기</button>
              </div>
              {billingForm.options.length > 0 && (
                <ul className="mt-1.5 bg-white border border-gray-200 rounded max-h-48 overflow-y-auto">
                  {billingForm.options.map(o => (
                    <li key={o.id}>
                      <button disabled={billingForm.busy} onClick={async () => {
                        setBillingForm(f => ({ ...f, busy: true }))
                        const res = await fetch('/api/vendor-hub/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'set', vendor_ids: [vendorId], billing_vendor_id: o.id }) })
                        const j = await res.json().catch(() => ({}))
                        setBillingForm({ open: false, q: '', options: [], busy: false })
                        flash(res.ok ? `청구처를 ${o.name}(으)로 지정했습니다.` : (j.error ?? '지정 실패')); if (res.ok) load()
                      }} className="w-full text-left px-3 py-1.5 text-sm hover:bg-blue-50">
                        {o.name} <span className="text-[0.6875rem] text-gray-400">{o.biz_number ?? ''}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-[0.6875rem] text-gray-400 mt-1">사업자번호가 있는 거래처만 청구처가 될 수 있습니다. 부서는 매출처로 그대로 남고, 계산서 연결 · 미수금 대사만 청구처 기준으로 묶입니다.</p>
            </div>
          )}
          {infoForm.open && (
            <div className="mt-2 flex items-center gap-2 flex-wrap border border-blue-200 bg-blue-50/40 rounded-lg px-3 py-2">
              <input value={infoForm.name} onChange={e => setInfoForm(f => ({ ...f, name: e.target.value }))}
                placeholder="매출처명" className="border border-gray-300 rounded px-2 py-1 text-sm w-64" />
              <input value={infoForm.biz} onChange={e => setInfoForm(f => ({ ...f, biz: e.target.value }))}
                placeholder="사업자번호 (선택)" className="border border-gray-300 rounded px-2 py-1 text-sm w-40" />
              <button disabled={infoForm.busy} onClick={async () => {
                if (!infoForm.name.trim()) { flash('매출처명을 입력하세요.'); return }
                setInfoForm(f => ({ ...f, busy: true }))
                const res = await fetch(`/api/vendor-hub/${vendorId}`, {
                  method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: infoForm.name.trim(), biz_number: infoForm.biz.trim() || null }),
                })
                const json = await res.json().catch(() => ({}))
                setInfoForm(f => ({ ...f, busy: false }))
                if (res.ok) { setInfoForm(f => ({ ...f, open: false })); flash('저장되었습니다. 이름 변경 시 옛 이름은 별칭으로 보존됩니다.'); load() }
                else flash(json.error ?? '저장 실패')
              }}
                className="px-3 py-1 bg-slate-900 text-white rounded text-xs font-medium disabled:opacity-50">저장</button>
              <button onClick={() => setInfoForm(f => ({ ...f, open: false }))}
                className="px-3 py-1 border border-gray-300 rounded text-xs text-gray-600">취소</button>
            </div>
          )}
          <div className="flex gap-1.5 flex-wrap mt-2">
            <Link href={`/erp-aliases?type=customer&q=${encodeURIComponent(data.vendor.name)}`}
              title="매출처 연결 키워드에서 별칭 관리"
              className={`px-2 py-0.5 rounded-full text-[0.6875rem] border hover:underline ${data.links.alias_count ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              ERP 별칭 {data.links.alias_count || '미'}연동
            </Link>
            <Link href={data.links.card_count ? `/cards?q=${encodeURIComponent(data.vendor.name)}` : '/card-sales/customer-links'}
              title={data.links.card_count ? '이 거래처의 카드매출 내역 보기' : '카드번호 연결 도구로 이동'}
              className={`px-2 py-0.5 rounded-full text-[0.6875rem] border hover:underline ${data.links.card_count ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              카드번호 {data.links.card_count ? `${data.links.card_count}건` : '미연동'}
            </Link>
            <Link href={`/opening-balances?tab=vendor&q=${encodeURIComponent(data.vendor.name)}`}
              title="기초잔액 입력 화면으로 이동"
              className={`px-2 py-0.5 rounded-full text-[0.6875rem] border hover:underline ${data.links.has_opening ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              기초잔액 {data.links.has_opening ? '입력됨' : '미입력'}
            </Link>
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
            {canEdit && <button onClick={() => setStaffForm(f => ({ ...f, open: !f.open }))}
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">담당 추가</button>}
          </div>
          {data.staff.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
              <div>
                <span className="font-semibold text-sm">{s.name}</span>
                {s.is_primary && <span className="ml-1.5 px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full text-[0.625rem] font-bold">주담당</span>}
                <div className="text-[0.6875rem] text-gray-400">{s.team ?? '팀 미지정'} · 배정 {s.started_at ?? '-'}</div>
              </div>
              <div className="text-right text-[0.6875rem] text-gray-500">
                담당처 {s.vendor_count}곳
                {canEdit && <div className="mt-0.5 flex gap-1 justify-end">
                  {!s.is_primary && (
                    <button onClick={async () => { await post('/api/vendor-hub/staff', { action: 'set_primary', assignment_id: s.id }); load() }}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[0.625rem] hover:bg-gray-50">주담당으로</button>
                  )}
                  <button onClick={async () => { await post('/api/vendor-hub/staff', { action: 'unassign', assignment_id: s.id }); load() }}
                    className="px-1.5 py-0.5 border border-gray-200 rounded text-[0.625rem] text-red-500 hover:bg-red-50">해제</button>
                </div>}
              </div>
            </div>
          ))}
          {!data.staff.length && <div className="text-xs text-gray-400 py-3">배정된 담당직원이 없습니다.</div>}
          {data.staff_suggest.length > 0 && (
            <div className="mt-2 px-3 py-2 bg-amber-50 rounded-lg text-[0.6875rem] text-amber-800">
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
            {canEdit && <button onClick={() => setContactForm(f => ({ ...f, open: !f.open }))}
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">담당자 추가</button>}
          </div>
          {data.contacts.map(c => (
            <div key={c.assignment_id} className={`flex items-start justify-between py-2 border-b border-gray-50 last:border-0 ${c.ended_at ? 'opacity-50' : ''}`}>
              <div>
                <Link href={`/sales-hub/contacts/${c.contact_id}`}
                  className="font-semibold text-sm text-blue-700 hover:underline" title="담당자 상세로 이동">
                  {contactLabel(c.name, c.title)}
                </Link>
                {c.is_representative && <span className="ml-1.5 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[0.625rem] font-bold">대표</span>}
                <div className="text-[0.6875rem] text-gray-400">
                  {[c.role_memo, c.phone, c.tel, c.email].filter(Boolean).join(' · ') || '연락처 미입력'}
                </div>
                {rowEdit?.id === c.assignment_id && (
                  <div className="mt-1.5 p-2 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="grid grid-cols-2 gap-1.5">
                      {([['title', '직함'], ['role_memo', '역할 메모'], ['phone', '핸드폰'], ['tel', '유선'], ['email', '이메일']] as const).map(([k, l]) => (
                        <label key={k} className={`text-[0.625rem] text-gray-500 ${k === 'email' ? 'col-span-2' : ''}`}>{l}
                          <input value={rowEdit[k]} onChange={e => setRowEdit(r => r && ({ ...r, [k]: e.target.value }))}
                            placeholder={k === 'title' ? '예: 부장 (님 제외)' : ''}
                            className="mt-0.5 w-full border border-gray-300 rounded px-1.5 py-1 text-xs text-gray-900" />
                        </label>
                      ))}
                    </div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className="text-[0.625rem] text-gray-400">이름 수정 · 인물 병합은 담당자 상세에서</span>
                      <button onClick={() => setRowEdit(null)} className="ml-auto px-2 py-0.5 border border-gray-300 rounded text-[0.6875rem] text-gray-600">취소</button>
                      <button disabled={rowEdit.busy} onClick={async () => {
                        setRowEdit(r => r && ({ ...r, busy: true }))
                        const { ok, json } = await post('/api/vendor-hub/contacts', {
                          action: 'update_assignment', assignment_id: rowEdit.id,
                          title: rowEdit.title, role_memo: rowEdit.role_memo, phone: rowEdit.phone, tel: rowEdit.tel, email: rowEdit.email,
                        })
                        if (!ok) { flash(json.error ?? '수정 실패'); setRowEdit(r => r && ({ ...r, busy: false })); return }
                        flash('담당자 정보를 수정했습니다.'); setRowEdit(null); load()
                      }} className="px-2 py-0.5 bg-slate-900 text-white rounded text-[0.6875rem] disabled:opacity-50">저장</button>
                    </div>
                  </div>
                )}
                {/* 다올 담당 (112) — 은행 · 지점 · 고객 단위, 주문 상담자의 원천 */}
                {!c.ended_at && (
                  <div className="text-[0.6875rem] mt-0.5 flex items-center gap-1">
                    <span className="text-gray-400">다올 담당</span>
                    {canEdit ? (
                      <select value={c.staff_employee_id ?? ''}
                        onChange={async e => {
                          if (!e.target.value) return
                          const { ok, json } = await post('/api/vendor-hub/contacts', { action: 'set_staff', assignment_id: c.assignment_id, staff_employee_id: e.target.value })
                          if (!ok) flash(json.error ?? '변경 실패'); else load()
                        }}
                        className={`border rounded px-1 py-0.5 text-[0.6875rem] ${c.staff_employee_id ? 'border-gray-200' : 'border-amber-300 bg-amber-50 text-amber-800'}`}>
                        <option value="">미기입 — 선택</option>
                        {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                    ) : (
                      <span className={c.staff_employee_id ? 'text-gray-700' : 'text-amber-700'}>
                        {c.staff_employee_id ? employees.find(e => e.id === c.staff_employee_id)?.name ?? '등록됨' : '미기입'}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-right text-[0.6875rem] text-gray-500 whitespace-nowrap">
                {c.ended_at ? `종료 ${c.ended_at}` : `배정 ${c.started_at ?? '-'}`}
                {!c.ended_at && canEdit && (
                  <div className="mt-0.5 flex gap-1 justify-end">
                    <button onClick={() => setRowEdit(rowEdit?.id === c.assignment_id ? null : {
                      id: c.assignment_id, title: c.title ?? '', role_memo: c.role_memo ?? '',
                      phone: c.phone ?? '', tel: c.tel ?? '', email: c.email ?? '', busy: false,
                    })} className="px-1.5 py-0.5 border border-gray-200 rounded text-[0.625rem] hover:bg-gray-50">수정</button>
                    {!c.is_representative && (
                      <button onClick={async () => { await post('/api/vendor-hub/contacts', { action: 'set_representative', assignment_id: c.assignment_id }); load() }}
                        className="px-1.5 py-0.5 border border-gray-200 rounded text-[0.625rem] hover:bg-gray-50">대표로</button>
                    )}
                    <button onClick={async () => { await post('/api/vendor-hub/contacts', { action: 'end_assignment', assignment_id: c.assignment_id }); load() }}
                      className="px-1.5 py-0.5 border border-gray-200 rounded text-[0.625rem] text-red-500 hover:bg-red-50">종료</button>
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
                <select value={contactForm.staff} onChange={e => setContactForm(f => ({ ...f, staff: e.target.value }))}
                  className="border border-gray-300 rounded px-2 py-1 text-xs bg-white" title="다올 담당(자사 영업) — 필수">
                  <option value="">다올 담당 *</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
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
                          className="px-1.5 py-0.5 border rounded text-[0.625rem] hover:bg-gray-50">같은 인물 (이동 처리)</button>
                        <button onClick={() => submitContact(false, c.id, false)}
                          className="px-1.5 py-0.5 border rounded text-[0.625rem] hover:bg-gray-50">같은 인물 (겸직)</button>
                      </span>
                    </div>
                  ))}
                  <button onClick={() => submitContact(true)}
                    className="mt-1.5 px-2 py-0.5 border rounded text-[0.625rem] hover:bg-gray-50">아니요, 새 인물로 등록</button>
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
            <div className="text-[0.6875rem] text-gray-500">
              <span className={`px-1.5 py-0.5 rounded-full text-[0.625rem] font-bold mr-1 ${k.tag === '기간' ? 'bg-blue-100 text-blue-700' : 'bg-violet-100 text-violet-700'}`}>{k.tag}</span>
              {k.label}
            </div>
            <div className={`text-lg font-bold mt-0.5 tabular-nums ${k.cls}`}>{k.value}</div>
            <div className="text-[0.625rem] text-gray-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* 미수 경과기간 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-gray-800">미수 경과기간별 현황 <span className="font-normal text-gray-400 text-xs">(전체 기간, 주문일 기준)</span></div>
          {data.aging.opening > 0 && <div className="text-[0.6875rem] text-gray-500">기초이월 잔여 {eok(data.aging.opening)} 별도</div>}
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
                  className="flex items-center justify-center text-[0.625rem] font-semibold border-r-2 border-white last:border-0">
                  {['~30일', '31~60일', '61~90일', '90일+'][i]} {eok(b.v)}
                </div>
              ))}
            </div>
          </>
        ) : <div className="text-xs text-gray-400 mt-2">미수 잔액이 없습니다.</div>}
      </div>

      {/* 탭 */}
      <div className="flex gap-0.5 border-b border-gray-200 mt-5">
        {TABS.filter(t => t !== '소속 부서' || (billing?.children.length ?? 0) > 0).map(t => {
          const count = t === '주문 내역' ? data.orders.length
            : t === '소속 부서' ? (billing?.children.length ?? 0)
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
            {isPersonal && tab === '주문 내역' && (
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mb-3">
                <div className="px-4 pt-3 text-sm font-bold text-gray-800">고객별 소계 {custGroups.length}명</div>
                <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">개인주문은 고객명이 지점명 역할 — 고객을 클릭하면 아래 주문 내역이 그 고객으로 필터됩니다</div>
                <table className="w-full text-sm min-w-[560px]">
                  <thead>
                    <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                      <th className="py-2 px-3 text-left font-medium">고객명</th>
                      <th className="py-2 px-3 text-right font-medium">주문수</th>
                      <th className="py-2 px-3 text-right font-medium">순매출</th>
                      <th className="py-2 px-3 text-right font-medium">미수</th>
                      <th className="py-2 px-3 text-left font-medium">최근 주문일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {custGroups.map(g => (
                      <tr key={g.name || '(없음)'}
                        onClick={() => setCustFilter(custFilter === g.name ? null : g.name)}
                        className={`border-b border-gray-50 cursor-pointer ${custFilter === g.name ? 'bg-slate-100' : 'hover:bg-gray-50'}`}>
                        <td className="py-1.5 px-3 font-medium">{g.name ? honorify(g.name) : '(고객명 없음)'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{g.count}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{won(g.net)}</td>
                        <td className={`py-1.5 px-3 text-right tabular-nums ${g.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(g.outstanding)}</td>
                        <td className="py-1.5 px-3 tabular-nums text-xs">{g.last}</td>
                      </tr>
                    ))}
                    {!custGroups.length && <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-sm">기간 내 주문이 없습니다.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
            <div className={`bg-white border border-gray-200 rounded-xl overflow-x-auto ${tab === '개요' ? 'xl:col-span-3' : ''}`}>
              <div className="px-4 pt-3 text-sm font-bold text-gray-800 flex items-center gap-2">
                ERP 주문 내역{tab === '개요' ? ' (최근)' : ''}
                {custFilter != null && tab === '주문 내역' && (
                  <button onClick={() => setCustFilter(null)}
                    className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[0.6875rem] font-medium hover:bg-slate-700">
                    {custFilter ? honorify(custFilter) : '(고객명 없음)'} ×
                  </button>
                )}
                {(billing?.billing || (billing?.children.length ?? 0) > 0) && (
                  <button onClick={() => setLinkOpen(true)}
                    className="ml-auto px-2 py-0.5 border border-blue-200 text-blue-700 bg-blue-50 rounded text-[0.6875rem] font-medium hover:bg-blue-100"
                    title="청구처 법인 계산서와 이 매출처(또는 소속 부서) 주문을 연결합니다">계산서 ↔ 주문 연결</button>
                )}
              </div>
              <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">주문번호 → 배송 → 계산서 → 수금 → 미수까지 한 줄</div>
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">주문번호</th>
                    <th className="py-2 px-3 text-left font-medium">주문일</th>
                    <th className="py-2 px-3 text-left font-medium">{isPersonal ? '고객명' : '담당자'}</th>
                    <th className="py-2 px-3 text-left font-medium">품목 요약</th>
                    <th className="py-2 px-3 text-right font-medium">순매출</th>
                    <th className="py-2 px-3 text-left font-medium">배송현황</th>
                    <th className="py-2 px-3 text-left font-medium">계산서</th>
                    <th className="py-2 px-3 text-left font-medium">수금</th>
                    <th className="py-2 px-3 text-right font-medium">미수</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === '개요' ? shownOrders.slice(0, 8) : shownOrders).map(o => {
                    const dv = o.delivery ? ORDER_DELIVERY_STATUS_LABEL[o.delivery] : null
                    const viaBilling = !!billing?.via_order_ids.includes(o.id)
                    const invBadge = o.invoice_linked >= o.net && o.net > 0
                      ? (viaBilling ? { t: '청구처 발행', c: 'bg-blue-100 text-blue-700' } : { t: '연결', c: 'bg-green-100 text-green-700' })
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
                        <td className="py-1.5 px-3 text-xs">{o.manager_name ? honorify(o.manager_name) : <span className="text-gray-300">-</span>}</td>
                        <td className="py-1.5 px-3">{o.item_summary}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{won(o.net)}</td>
                        <td className="py-1.5 px-3">
                          {dv ? <span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${dv.cls}`}>{dv.text}</span> : <span className="text-gray-300 text-xs">-</span>}
                        </td>
                        <td className="py-1.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${invBadge.c}`}>{invBadge.t}</span></td>
                        <td className="py-1.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${payBadge.c}`}>{payBadge.t}</span></td>
                        <td className={`py-1.5 px-3 text-right tabular-nums ${o.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(o.outstanding)}</td>
                      </tr>
                    )
                  })}
                  {!shownOrders.length && <tr><td colSpan={9} className="text-center py-10 text-gray-400 text-sm">기간 내 주문이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            {tab === '개요' && (
              <div className="bg-white border border-gray-200 rounded-xl xl:col-span-2">
                <div className="px-4 pt-3 text-sm font-bold text-gray-800">수금 타임라인</div>
                <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">계산서·통장·카드 통합 (최근)</div>
                <ul className="px-4 pb-3">
                  {data.timeline.slice(0, 12).map((e, i) => {
                    const href = tlHref(e)
                    return (
                      <li key={i} className={`flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm ${e.kind === 'alloc' ? 'opacity-60' : ''}`}>
                        <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-bold w-12 text-center ${TL_META[e.kind].cls}`}>{TL_META[e.kind].label}</span>
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

        {tab === '개요' && docSales.length > 0 && (() => {
          const ysum = (m: Record<string, number>, y: string) =>
            Object.entries(m).reduce((s, [k, v]) => s + (k.startsWith(y) ? v : 0), 0)
          const ssum = (s: Record<string, number>) => Object.values(s).reduce((a, b) => a + b, 0)
          const tot = docSales.reduce((s, r) => s + r.total_sales, 0)
          const t25 = docSales.reduce((s, r) => s + ysum(r.monthly, '2025'), 0)
          const t26 = docSales.reduce((s, r) => s + ysum(r.monthly, '2026'), 0)
          const tSeason = docSales.reduce((s, r) => s + ssum(r.season), 0)
          return (
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto mt-3">
              <div className="px-4 pt-3 text-sm font-bold text-gray-800 flex items-baseline gap-2 flex-wrap">
                과거 매출 <span className="text-[0.6875rem] font-normal text-gray-400">{docSales[0].source} 기준 스냅샷 — 참고 지표 (주문 원본 삭제로 드릴다운 불가) · 합계 = 상시 + 명절(25설·25추석·26설·26추석)</span>
              </div>
              <div className="px-4 py-1.5 flex gap-4 text-xs text-gray-600 flex-wrap">
                <span>합계 <b className="tabular-nums">{won(tot)}</b></span>
                <span>상시 2025 <b className="tabular-nums">{won(t25)}</b></span>
                <span>상시 2026 <b className="tabular-nums">{won(t26)}</b></span>
                <span>명절 4회 <b className="tabular-nums">{won(tSeason)}</b></span>
              </div>
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">담당자 (문서 표기)</th>
                    <th className="py-2 px-3 text-left font-medium">다올 담당</th>
                    <th className="py-2 px-3 text-right font-medium">상시 2025</th>
                    <th className="py-2 px-3 text-right font-medium">상시 2026</th>
                    <th className="py-2 px-3 text-right font-medium">명절</th>
                    <th className="py-2 px-3 text-right font-medium">합계</th>
                    <th className="py-2 px-3 text-left font-medium">거래 기간</th>
                    <th className="py-2 px-3 text-left font-medium">유형</th>
                  </tr>
                </thead>
                <tbody>
                  {docSales.slice(0, 30).map((r, i) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-1.5 px-3">{r.manager_name ?? '-'}</td>
                      <td className="py-1.5 px-3 text-xs text-gray-500">{r.daol_staff ?? '-'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(ysum(r.monthly, '2025'))}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(ysum(r.monthly, '2026'))}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(ssum(r.season))}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums font-semibold">{won(r.total_sales)}</td>
                      <td className="py-1.5 px-3 text-xs text-gray-500 tabular-nums whitespace-nowrap">
                        {(r.first_order_date ?? '?')} ~ {(r.last_order_date ?? '?')}
                      </td>
                      <td className="py-1.5 px-3 text-xs text-gray-500">{r.order_type ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {docSales.length > 30 && <div className="px-4 py-2 text-xs text-gray-400">상위 30명 표시 (전체 {docSales.length}명)</div>}
            </div>
          )
        })()}

        {tab === '수금 내역' && (
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="px-4 pt-3 text-[0.6875rem] text-gray-400">
              [배분]은 통장·카드로 들어온 돈을 어느 주문의 수금으로 연결했는지 기록한 항목입니다 —
              같은 돈이 [통장]/[카드] 줄에 이미 표시되므로 금액을 이중으로 세지 않습니다. 괄호 안은 매칭 방식 메모입니다.
            </div>
            <ul className="px-4 py-2">
              {data.timeline.map((e, i) => {
                const href = tlHref(e)
                return (
                  <li key={i} className="flex items-baseline gap-2 py-1.5 border-b border-gray-50 last:border-0 text-sm">
                    <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-bold w-12 text-center ${TL_META[e.kind].cls}`}>{TL_META[e.kind].label}</span>
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

        {tab === '계산서' && (() => {
          const isRoot = (billing?.children.length ?? 0) > 0
          const links = billing?.invoice_links ?? {}
          const unlinked = isRoot ? data.invoices.filter(inv => !links[inv.id]?.length).length : 0
          return (
          <div className="space-y-3">
          {billing?.billing && (
            <div className="bg-white border border-blue-200 rounded-xl overflow-x-auto">
              <div className="px-4 pt-3 text-sm font-bold text-gray-800">청구처 발행 계산서 <span className="font-normal text-xs text-gray-400">{billing.billing.name}로 발행되어 이 매출처 주문에 연결된 것</span></div>
              <table className="w-full text-sm mt-1">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">발행일</th>
                    <th className="py-2 px-3 text-left font-medium">품목</th>
                    <th className="py-2 px-3 text-right font-medium">합계</th>
                    <th className="py-2 px-3 text-left font-medium">연결 주문</th>
                    <th className="py-2 px-3 text-right font-medium">연결 금액</th>
                    <th className="py-2 px-3 text-left font-medium">수금 상태</th>
                  </tr>
                </thead>
                <tbody>
                  {billing.via_invoices.map((v, i) => (
                    <tr key={`${v.id}-${i}`} className="border-b border-gray-50">
                      <td className="py-1.5 px-3 tabular-nums">{v.issue_date}</td>
                      <td className="py-1.5 px-3">{v.item_name ?? '-'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(v.total_amount)}</td>
                      <td className="py-1.5 px-3 text-xs tabular-nums">{v.order_no ?? '-'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(v.amount)}</td>
                      <td className="py-1.5 px-3">
                        <span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${v.payment_status === 'matched' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {v.payment_status === 'matched' ? '수금 매칭됨' : '미매칭'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {!billing.via_invoices.length && <tr><td colSpan={6} className="text-center py-6 text-gray-400 text-sm">아직 연결된 청구처 계산서가 없습니다 — 주문 내역의 &apos;계산서 ↔ 주문 연결&apos;에서 찾으세요.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            {isRoot && (
              <div className="px-4 pt-3 flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-gray-800">발행 계산서 — 어느 부서 건인가</span>
                {unlinked > 0 && <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-amber-100 text-amber-700">연결 안 됨 {unlinked}</span>}
                <button onClick={() => setLinkOpen(true)} className="ml-auto px-2 py-0.5 border border-blue-200 text-blue-700 bg-blue-50 rounded text-[0.6875rem] font-medium hover:bg-blue-100">주문 찾기</button>
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium">발행일</th>
                  <th className="py-2 px-3 text-left font-medium">품목</th>
                  <th className="py-2 px-3 text-right font-medium">공급대가</th>
                  {isRoot && <th className="py-2 px-3 text-left font-medium">연결 부서 · 주문</th>}
                  <th className="py-2 px-3 text-left font-medium">수금 상태</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map(inv => {
                  const ls = links[inv.id] ?? []
                  return (
                  <tr key={inv.id} className={`border-b border-gray-50 ${isRoot && !ls.length ? 'bg-amber-50/50' : ''}`}>
                    <td className="py-1.5 px-3 tabular-nums">
                      <Link href={`/tax-invoices?dir=sales&tax=${inv.tax_type ?? 'taxable'}&invoiceId=${inv.id}`}
                        className="text-blue-600 hover:underline" title="계산서 화면에서 열기">{inv.issue_date}</Link>
                    </td>
                    <td className="py-1.5 px-3 text-gray-700">{inv.item_name ?? '-'}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{won(inv.total_amount)}</td>
                    {isRoot && (
                      <td className="py-1.5 px-3 text-xs">
                        {ls.length ? ls.map((l, i) => (
                          <div key={i}>
                            <Link href={`/sales-hub/${l.vendor_id}`} className="text-blue-700 hover:underline">{l.vendor_name}</Link>
                            <span className="text-gray-400"> · {l.order_no ?? '-'}{ls.length > 1 ? ` · ${won(l.amount)}` : ''}</span>
                          </div>
                        )) : <span className="px-1.5 py-0.5 rounded text-[0.6875rem] font-semibold bg-amber-100 text-amber-700">연결 안 됨</span>}
                      </td>
                    )}
                    <td className="py-1.5 px-3">
                      <span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${inv.payment_status === 'matched' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {inv.payment_status === 'matched' ? '수금 매칭됨' : '미매칭'}
                      </span>
                    </td>
                  </tr>
                  )
                })}
                {!data.invoices.length && <tr><td colSpan={isRoot ? 5 : 4} className="text-center py-10 text-gray-400 text-sm">{billing?.billing ? '이 매출처 이름으로 직접 발행된 계산서는 없습니다(청구처 발행분은 위 표).' : '발행된 매출 계산서가 없습니다.'}</td></tr>}
              </tbody>
            </table>
          </div>
          </div>
          )
        })()}

        {tab === '소속 부서' && billing && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <div className="px-4 pt-3 text-sm font-bold text-gray-800">소속 부서 {billing.children.length}곳</div>
            <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">이 법인을 청구처로 지정한 매출처 — 기간 기준 주문 · 계산서 연결 · 미발행 · 미수. 부서를 누르면 그 부서 상세로.</div>
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                  <th className="py-2 px-3 text-left font-medium">부서</th>
                  <th className="py-2 px-3 text-left font-medium">다올 담당</th>
                  <th className="py-2 px-3 text-right font-medium">주문(순매출)</th>
                  <th className="py-2 px-3 text-right font-medium">계산서 연결</th>
                  <th className="py-2 px-3 text-right font-medium">미발행</th>
                  <th className="py-2 px-3 text-right font-medium">미수</th>
                </tr>
              </thead>
              <tbody>
                {billing.children.map(c => (
                  <tr key={c.vendor_id} className="border-b border-gray-50">
                    <td className="py-1.5 px-3"><Link href={`/sales-hub/${c.vendor_id}?from=${from}&to=${to}`} className="text-blue-700 hover:underline">{c.vendor_name}</Link></td>
                    <td className="py-1.5 px-3 text-xs text-gray-600">{c.staff ?? '-'}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{won(c.net)}</td>
                    <td className="py-1.5 px-3 text-right tabular-nums">{won(c.linked)}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums ${c.unissued > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{won(c.unissued)}</td>
                    <td className={`py-1.5 px-3 text-right tabular-nums ${c.outstanding > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(c.outstanding)}</td>
                  </tr>
                ))}
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
                      <span className={`px-1.5 py-0.5 rounded text-[0.625rem] font-bold ${e.entry_type === 'deposit' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
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
              placeholder="수금 협의, 방문 기록 등 이 거래처 관련 메모" readOnly={!canEdit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm read-only:bg-gray-50" />
            {canEdit && <div className="flex justify-end mt-2">
              <button onClick={saveNote} className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">저장</button>
            </div>}
          </div>
        )}
      </div>
      {linkOpen && (
        <InvoiceLinkModal vendorId={vendorId} vendorName={data.vendor.name} from={from}
          onClose={() => setLinkOpen(false)}
          onApplied={() => { setLinkOpen(false); flash('계산서 ↔ 주문 연결을 저장했습니다.'); load() }} />
      )}
    </div>
  )
}
