'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { getPeriodRange } from '@/lib/period-presets'
import PeriodPresets from '@/components/ui/PeriodPresets'
import type { PurchaseHubDetail } from '@/lib/purchase-hub'
import { contactLabel } from '@/lib/contact-label'
import type { PurchaseHubPerms } from '@/components/purchase-hub/perms'
import PoFormTab from '@/components/purchase-hub/po-form-tab'

// 매입처 관리 — 매입처 360° 상세(B) 공용 컴포넌트
// 영업·주문 영역과 회계·재무 영역 양쪽에서 쓴다 (basePath·perms는 목록과 동일 의미).
// 목록(A)의 기간이 URL로 넘어와 기본값이 되고, 여기서 바꿔도 목록에는 영향이 없다.
// 담당직원·거래처 담당자 배정은 매출처 허브의 범용 API(/api/vendor-hub/staff·contacts)를 재사용한다.

const won = (n: number) => n.toLocaleString('ko-KR')
// 카드 금액은 1,000,000원 형식 그대로 — '2.78억' 축약은 정확한 금액 확인이 어려워 폐기 (2026-11-11 사용자 요청)
const eok = (n: number) => `${won(n)}원`

const STATUS_META: Record<string, { label: string; cls: string }> = {
  normal:   { label: '정상',            cls: 'bg-green-100 text-green-700' },
  unpaid:   { label: '미지급',          cls: 'bg-amber-100 text-amber-700' },
  over90:   { label: '미지급 90일 초과', cls: 'bg-red-100 text-red-700' },
  overpaid: { label: '과다지급',        cls: 'bg-violet-100 text-violet-700' },
  dormant:  { label: '휴면 전환',       cls: 'bg-gray-100 text-gray-500' },
  retail:   { label: '별도 구매처',      cls: 'bg-sky-100 text-sky-700' },
}
const TL_META: Record<string, { label: string; cls: string }> = {
  invoice: { label: '계산서', cls: 'bg-blue-100 text-blue-700' },
  bank:    { label: '통장',   cls: 'bg-emerald-100 text-emerald-700' },
  card:    { label: '카드',   cls: 'bg-orange-100 text-orange-700' },
}
const TABS = ['개요', '계산서', '지급 내역', '통장 내역', 'ERP 발주', '발주서 양식', '활동 메모'] as const

// 통장 ↔ 계산서 대사 판정 (423, 2026-11-11 승인 시안)
const VERDICT_META: Record<string, { label: string; cls: string; hint: string }> = {
  ok:            { label: '정상',                     cls: 'bg-gray-100 text-gray-600',      hint: '계산서 없이 나간 출금이 없습니다.' },
  match_missing: { label: '매칭 누락 (계산서 있음)',   cls: 'bg-sky-100 text-sky-800',        hint: '계산서 없이 나간 출금이 있는데 미지급 잔여가 남은 계산서도 있습니다 — 계산서 내역에서 결제를 연결하세요.' },
  invoice_check: { label: '계산서 확인 필요',          cls: 'bg-amber-100 text-amber-800',    hint: '계산서 없이 나간 출금이 있고 남은 계산서가 없습니다 — 초과 지급이거나 계산서 미발행(미수취)입니다.' },
  inflow:        { label: '입금 있음 (환불·정산)',      cls: 'bg-violet-100 text-violet-800',  hint: '이 매입처에서 들어온 돈이 있습니다 — 반품·환불·정산인지 확인하세요.' },
  other_vendor:  { label: '이 매입처 밖의 계산서에 연결',  cls: 'bg-violet-100 text-violet-800',  hint: '이 매입처로 연결된 출금이 이 매입처에 붙지 않은 계산서에 배분돼 있습니다 — "거래처 미연결 계산서"면 그 계산서에 거래처를 연결하면 ③·④로 들어옵니다(418 재연결 SQL). 같은 회사의 중복 거래처면 통합, 청구처 구조면 정상, 다른 회사면 오매칭입니다.' },
  excluded:      { label: '대사 제외',                cls: 'bg-gray-100 text-gray-500',      hint: '카드사 거래처는 카드대금 출금이라 매입 대사 대상이 아닙니다.' },
}

interface Candidate { id: string; name: string; phone: string | null; history?: { vendor_name: string; title: string | null; started_at: string | null; ended_at: string | null }[] }

export default function PurchaseHubDetailView({ basePath, perms }: {
  basePath: string
  perms: PurchaseHubPerms
}) {
  const params = useParams<{ vendorId: string }>()
  const router = useRouter()
  const sp = useSearchParams()
  const vendorId = params.vendorId

  // 목록에서 넘어온 기간이 기본, 없으면 당년 (관리·분석 화면 표준)
  const [from, setFrom] = useState(sp.get('from') ?? getPeriodRange('당년').from)
  const [to, setTo] = useState(sp.get('to') ?? getPeriodRange('당년').to)
  const [data, setData] = useState<PurchaseHubDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<(typeof TABS)[number]>('개요')
  // 통장 내역 탭 필터 / 키워드 편집 칸 (423)
  const [bankView, setBankView] = useState<'unmatched' | 'all' | 'in'>('unmatched')
  const [kwInput, setKwInput] = useState<{ invoice: string; bank: string }>({ invoice: '', bank: '' })
  const [kwBusy, setKwBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const flash = (m: string) => { setMsg(m); setTimeout(() => setMsg(null), 4000) }

  // 담당 입력 상태 (매출처 허브와 동일한 흐름)
  const [staffForm, setStaffForm] = useState<{ open: boolean; name: string; team: string; primary: boolean }>({ open: false, name: '', team: '', primary: false })
  const [employees, setEmployees] = useState<{ id: string; name: string; team: string | null; vendor_count: number }[]>([])
  const [contactForm, setContactForm] = useState<{ open: boolean; name: string; title: string; phone: string; role: string; rep: boolean }>({ open: false, name: '', title: '', phone: '', role: '', rep: false })
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [note, setNote] = useState('')
  // 미결제금 기초원장 입력 (개별 수동 입력 — 엑셀 일괄 적재는 별도 루틴)
  const [openingForm, setOpeningForm] = useState<{ open: boolean; amount: string; asOf: string; note: string }>({ open: false, amount: '', asOf: '', note: '' })
  // 발주 이메일 인라인 수정 (원가표 적재 508 누락분 보완)
  const [emailForm, setEmailForm] = useState<{ open: boolean; value: string }>({ open: false, value: '' })
  // 거래처 기본정보 수정 (거래처명·사업자번호)
  const [infoForm, setInfoForm] = useState<{ open: boolean; name: string; biz: string }>({ open: false, name: '', biz: '' })

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/purchase-hub/${vendorId}?from=${from}&to=${to}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '조회 실패')
      setData(json); setNote(json.vendor.note ?? '')
      setOpeningForm(f => ({
        ...f,
        amount: json.links.opening ? String(json.links.opening.amount) : '',
        asOf: json.links.opening?.as_of_date ?? '',
        note: json.links.opening?.note ?? '',
      }))
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

  // 키워드 저장 — 계산서(match_aliases) / 통장(bank_keywords) 따로. 다른 거래처와 겹치면 서버가 경고를 돌려준다.
  const saveKeywords = async (kind: 'invoice' | 'bank', next: string[]) => {
    setKwBusy(true)
    try {
      const res = await fetch(`/api/vendors/${vendorId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'invoice' ? { match_aliases: next } : { bank_keywords: next }) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { flash(json.error ?? '키워드 저장 실패'); return }
      const warn: string[] = json.warnings ?? []
      flash(warn.length ? `저장됨 · 주의: ${warn.join(' / ')}` : `${kind === 'invoice' ? '계산서' : '통장'} 키워드 저장 완료`)
      setKwInput(k => ({ ...k, [kind]: '' }))
      load()
    } finally { setKwBusy(false) }
  }
  // 통장 거래의 거래처 연결 해제 (오매칭 교정) — 원본은 그대로, 연결 정보만 비운다
  const unlinkBankTx = async (txId: string, basis: string) => {
    if (!window.confirm('이 거래의 매입처 연결을 해제합니다. 거래 자체는 바뀌지 않습니다. 계속할까요?')) return
    const res = await fetch(`/api/transactions/${txId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ vendor_id: null }) })
    if (!res.ok) { flash('연결 해제 실패'); return }
    const m = basis.match(/통장 키워드 "(.+)"/)
    if (m && data && window.confirm(`통장 키워드 "${m[1]}"로 연결된 거래였습니다. 이 키워드도 지울까요? (지우지 않으면 다음 자동 매칭에서 다시 연결됩니다)`)) {
      await saveKeywords('bank', data.keywords.bank.filter(k => k !== m[1]))
    } else { flash('연결 해제 완료'); load() }
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

  const patch = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/purchase-hub/${vendorId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok, json }
  }

  const saveNote = async () => {
    const { ok } = await patch({ note })
    flash(ok ? '메모 저장됨' : '저장 실패')
    if (ok) load()
  }

  // 매입처 구분 변경 (602) — 상품 매입처 / 별도 구매처 / 경비성
  const KIND_LABEL: Record<string, string> = { partner: '상품 매입처', retail: '별도 구매처', expense: '경비성' }
  const changeKind = async (next: string) => {
    if (next === data?.vendor.purchase_kind) return
    const { ok, json } = await patch({ purchase_kind: next })
    flash(ok ? `${KIND_LABEL[next]}(으)로 변경됨` : (json.error ?? '변경 실패'))
    if (ok) load()
  }

  const saveInfo = async () => {
    const { ok, json } = await patch({ name: infoForm.name, biz_number: infoForm.biz })
    flash(ok ? '거래처 정보 저장됨' : (json.error ?? '저장 실패'))
    if (ok) { setInfoForm(f => ({ ...f, open: false })); load() }
  }

  // 비활성화 — 실적이 있어 지울 수 없는 거래처를 정리하는 방법
  const toggleActive = async () => {
    const next = !(data?.vendor.is_active ?? true)
    if (!window.confirm(next
      ? '이 매입처를 다시 활성화할까요?'
      : '이 매입처를 비활성화할까요?\n기록은 그대로 남고, 신규 선택 목록에서만 빠집니다.')) return
    const { ok, json } = await patch({ is_active: next })
    flash(ok ? (next ? '활성화됨' : '비활성화됨') : (json.error ?? '변경 실패'))
    if (ok) load()
  }

  // 삭제 — 서버가 실적을 확인해 하나라도 있으면 거부한다 (비활성화 안내)
  const removeVendor = async () => {
    if (!window.confirm('이 매입처를 삭제할까요?\n실적이 하나라도 있으면 삭제되지 않습니다. 되돌릴 수 없습니다.')) return
    const res = await fetch(`/api/purchase-hub/${vendorId}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) { flash(json.error ?? '삭제 실패'); return }
    router.push(`${basePath}?from=${from}&to=${to}`)
  }

  const saveEmail = async () => {
    const { ok, json } = await patch({ email: emailForm.value })
    flash(ok ? '발주 이메일 저장됨' : (json.error ?? '저장 실패'))
    if (ok) { setEmailForm(f => ({ ...f, open: false })); load() }
  }

  const saveOpening = async () => {
    const amount = Number(openingForm.amount.replace(/[^\d]/g, ''))
    if (!openingForm.asOf) { flash('기준일을 입력하세요.'); return }
    const { ok, json } = await patch({ opening: { amount, as_of_date: openingForm.asOf, note: openingForm.note } })
    flash(ok ? '기초원장 저장됨' : (json.error ?? '저장 실패'))
    if (ok) { setOpeningForm(f => ({ ...f, open: false })); load() }
  }

  // 지급 내역 = 실제 출금(통장·카드)만. 계산서 발행 기록은 계산서 탭이 담당한다.
  // 탭 건수와 목록이 같은 배열을 보도록 한 곳에서 만든다 (2026-10-23 사용자 지적).
  const paymentRows = useMemo(() => (data?.timeline ?? []).filter(e => e.kind !== 'invoice'), [data])

  const agingTotal = useMemo(() => data ? data.aging.b30 + data.aging.b60 + data.aging.b90 + data.aging.over90 : 0, [data])

  // 타임라인 이벤트별 원본 화면 링크
  const invTaxType = useMemo(() => new Map((data?.invoices ?? []).map(i => [i.id, i.tax_type ?? 'taxable'])), [data])
  const tlHref = useCallback((e: { kind: string; ref_id: string | null }): string | null => {
    if (!perms.accounting) return null   // 권한 없는 화면으로 보내지 않는다
    if (e.kind === 'invoice' && e.ref_id) return `/tax-invoices?dir=purchase&tax=${invTaxType.get(e.ref_id) ?? 'taxable'}&invoiceId=${e.ref_id}`
    if (e.kind === 'bank') return `/transactions?vendorId=${vendorId}`
    if (e.kind === 'card') return '/cards?tab=expenses'
    return null
  }, [invTaxType, vendorId, perms.accounting])

  if (loading && !data) return <div className="text-center py-24 text-gray-400">매입처 데이터를 모으는 중...</div>
  if (error) return <div className="mt-8 px-4 py-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>
  if (!data) return null
  const meta = STATUS_META[data.status] ?? STATUS_META.normal

  return (
    <div>
      {msg && <div className="fixed top-4 right-4 z-50 px-4 py-2.5 bg-slate-900 text-white text-sm rounded-lg shadow">{msg}</div>}

      <div className="text-xs text-gray-400">
        <Link href={`${basePath}?from=${sp.get('from') ?? from}&to=${sp.get('to') ?? to}`} className="hover:underline">매입처 관리</Link>
        {' > '}<b className="text-gray-700">{data.vendor.name}</b>
      </div>

      {/* 상세 기간 (목록 기간이 기본값, 독립 변경) */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2">
        {/* 표준 기간 칩 (최근 7일 ~ 전체 기간) — 매출처 허브 상세와 같은 부품 (2026-11-11 사용자 요청) */}
        <PeriodPresets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t) }} />
        <span className="text-gray-300 text-xs">|</span>
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
            {!data.vendor.is_active && (
              <span className="px-2 py-0.5 rounded text-[0.6875rem] font-semibold bg-gray-200 text-gray-600">비활성</span>
            )}
            <span className={`px-2 py-0.5 rounded text-[0.6875rem] font-semibold ${meta.cls}`}>{meta.label}</span>
            <select value={data.vendor.purchase_kind} onChange={e => changeKind(e.target.value)} disabled={!perms.edit}
              title="상품 매입처=발주·미지급 관리 대상 / 별도 구매처=온·오프라인에서 사 온 곳(즉시 결제) / 경비성=택배·전기·리스 등"
              className="border border-gray-300 rounded px-1.5 py-0.5 text-[0.6875rem] text-gray-600">
              <option value="partner">상품 매입처</option>
              <option value="retail">별도 구매처</option>
              <option value="expense">경비성</option>
            </select>
          </div>
          {infoForm.open ? (
            <div className="mt-1.5 p-3 bg-gray-50 border border-gray-200 rounded-lg flex gap-2 flex-wrap items-center text-xs">
              <span className="text-gray-500">거래처명</span>
              <input value={infoForm.name} onChange={e => setInfoForm(f => ({ ...f, name: e.target.value }))}
                className="border border-gray-300 rounded px-2 py-1 w-48" />
              <span className="text-gray-500">사업자번호</span>
              <input value={infoForm.biz} onChange={e => setInfoForm(f => ({ ...f, biz: e.target.value }))}
                placeholder="숫자 10자리" className="border border-gray-300 rounded px-2 py-1 w-36" />
              <button onClick={saveInfo} className="px-2.5 py-1 bg-slate-900 text-white rounded">저장</button>
              <button onClick={() => setInfoForm({ open: false, name: '', biz: '' })}
                className="text-[0.6875rem] text-gray-400 hover:text-gray-600">취소</button>
            </div>
          ) : (
            <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
              <span>사업자번호 {data.vendor.biz_number ?? '미입력'}</span>
              {perms.edit && <button onClick={() => setInfoForm({ open: true, name: data.vendor.name, biz: data.vendor.biz_number ?? '' })}
                className="text-[0.6875rem] text-gray-400 hover:text-gray-600 underline">정보 수정</button>}
            </div>
          )}
          {/* 발주 이메일 — 발주서 발송에 쓰는 주소 (원가표 적재분, 누락 시 여기서 보완) */}
          <div className="text-xs mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-gray-500">발주 이메일</span>
            {emailForm.open ? (
              <>
                <input value={emailForm.value} onChange={e => setEmailForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="example@company.com" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') saveEmail() }}
                  className="border border-gray-300 rounded px-2 py-0.5 text-xs w-56" />
                <button onClick={saveEmail} className="px-2 py-0.5 bg-slate-900 text-white rounded text-[0.6875rem]">저장</button>
                <button onClick={() => setEmailForm({ open: false, value: '' })}
                  className="text-[0.6875rem] text-gray-400 hover:text-gray-600">취소</button>
              </>
            ) : (
              <>
                {data.vendor.email
                  ? <a href={`mailto:${data.vendor.email}`} className="text-blue-600 hover:underline">{data.vendor.email}</a>
                  : data.vendor.purchase_kind !== 'partner'
                    ? <span className="text-gray-400">관리 대상 아님</span>
                    : <span className="text-orange-600">미입력</span>}
                {perms.edit && <button onClick={() => setEmailForm({ open: true, value: data.vendor.email ?? '' })}
                  className="text-[0.6875rem] text-gray-400 hover:text-gray-600 underline">수정</button>}
              </>
            )}
          </div>
          <div className="flex gap-1.5 flex-wrap mt-2">
            <Link href={`/erp-aliases?type=purchase&q=${encodeURIComponent(data.vendor.name)}`}
              title="매입처 연결 키워드에서 별칭 관리"
              className={`px-2 py-0.5 rounded-full text-[0.6875rem] border hover:underline ${data.links.alias_count ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              ERP 별칭 {data.links.alias_count || '미'}연동
            </Link>
            <button onClick={() => perms.edit && setOpeningForm(f => ({ ...f, open: !f.open }))} disabled={!perms.edit}
              title={perms.edit ? '미결제금 기초원장 (기준일 + 기초잔액) 입력' : '기초원장 (수정 권한 필요)'}
              className={`px-2 py-0.5 rounded-full text-[0.6875rem] border hover:underline ${data.links.opening ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-orange-50 text-orange-700 border-orange-100'}`}>
              기초원장 {data.links.opening ? `${data.links.opening.as_of_date} 기준 ${eok(data.links.opening.amount)}` : '미입력'}
            </button>
          </div>
          {openingForm.open && (
            <div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg flex gap-2 flex-wrap items-center text-xs">
              <span className="text-gray-500">기준일</span>
              <input type="date" value={openingForm.asOf} onChange={e => setOpeningForm(f => ({ ...f, asOf: e.target.value }))}
                className="border border-gray-300 rounded px-2 py-1" />
              <span className="text-gray-500">기초 미지급 잔액</span>
              <input value={openingForm.amount} onChange={e => setOpeningForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="0" className="border border-gray-300 rounded px-2 py-1 w-32 text-right tabular-nums" />
              <input value={openingForm.note} onChange={e => setOpeningForm(f => ({ ...f, note: e.target.value }))}
                placeholder="메모 (선택)" className="border border-gray-300 rounded px-2 py-1 w-40" />
              <button onClick={saveOpening} className="px-2.5 py-1 bg-slate-900 text-white rounded">저장</button>
              <span className="text-[0.6875rem] text-gray-400">기준일 이후 계산서(+)·지급(-)만 잔액에 반영됩니다</span>
            </div>
          )}
        </div>
        <div className="text-right text-xs text-gray-500">
          {data.vendor.note && <div>최근 메모: &quot;{data.vendor.note.slice(0, 40)}{data.vendor.note.length > 40 ? '…' : ''}&quot;</div>}
          {perms.edit && <div className="mt-1.5 flex gap-1.5 justify-end">
            <button onClick={toggleActive}
              title="기록은 남기고 신규 선택 목록에서만 제외합니다"
              className="px-2 py-1 border border-gray-300 rounded text-[0.6875rem] text-gray-600 hover:bg-gray-50">
              {data.vendor.is_active ? '비활성화' : '활성화'}
            </button>
            <button onClick={removeVendor}
              title="실적이 없는 거래처만 삭제됩니다"
              className="px-2 py-1 border border-gray-200 rounded text-[0.6875rem] text-red-500 hover:bg-red-50">
              삭제
            </button>
          </div>}
        </div>
      </div>

      {/* 담당 패널 */}
      <div className="grid lg:grid-cols-2 gap-3 mt-4">
        {/* 자사 담당직원 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold text-gray-800">자사 담당직원 <span className="text-gray-400 font-normal">· {data.staff.length}명</span></div>
            {perms.edit && <button onClick={() => setStaffForm(f => ({ ...f, open: !f.open }))}
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
                {perms.edit && <div className="mt-0.5 flex gap-1 justify-end">
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
            {perms.edit && <button onClick={() => setContactForm(f => ({ ...f, open: !f.open }))}
              className="text-xs px-2 py-1 border border-gray-300 rounded hover:bg-gray-50">담당자 추가</button>}
          </div>
          {data.contacts.map(c => (
            <div key={c.assignment_id} className={`flex items-start justify-between py-2 border-b border-gray-50 last:border-0 ${c.ended_at ? 'opacity-50' : ''}`}>
              <div>
                <span className="font-semibold text-sm">{contactLabel(c.name, c.title)}</span>
                {c.is_representative && <span className="ml-1.5 px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full text-[0.625rem] font-bold">대표</span>}
                <div className="text-[0.6875rem] text-gray-400">
                  {[c.role_memo, c.phone, c.email].filter(Boolean).join(' · ') || '연락처 미입력'}
                </div>
              </div>
              <div className="text-right text-[0.6875rem] text-gray-500 whitespace-nowrap">
                {c.ended_at ? `종료 ${c.ended_at}` : `배정 ${c.started_at ?? '-'}`}
                {!c.ended_at && perms.edit && (
                  <div className="mt-0.5 flex gap-1 justify-end">
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
          // 금액은 선택 기간 합계 — 건수도 같은 기간으로 센다 (옛 라벨 '(전체 기간)'이 전체 합계처럼 읽혔다, 2026-11-11)
          { tag: '기간', label: '매입 (계산서)', value: eok(data.kpi.invoice_total), sub: `${from} ~ ${to} · 계산서 ${data.invoices.filter(i => i.issue_date >= from && i.issue_date <= to).length}건 (전체 ${data.invoices.length}건)`, cls: '' },
          { tag: '기간', label: '지급액', value: eok(data.kpi.paid_total), sub: '계산서 매칭 + 미지급금 상계', cls: '' },
          // 605: 미지급도 기간 기준(기간 안에 발행된 계산서 중 미지급). 과다지급은 기간 몫이 아니라 현재 잔액으로 보여 준다
          (data.kpi.period_outstanding === undefined || data.kpi.outstanding < 0)
            ? { tag: '누적', label: '미지급 잔액', value: eok(data.kpi.outstanding), sub: data.kpi.outstanding < 0 ? '음수 = 과다지급 (기간 무관)' : `기초이월 ${eok(data.kpi.opening_remain)} 포함`, cls: data.kpi.outstanding > 0 ? 'text-red-600' : data.kpi.outstanding < 0 ? 'text-violet-600' : '' }
            : { tag: '기간', label: '미지급 (기간 발행분)', value: eok(data.kpi.period_outstanding), sub: `누적 잔액 ${eok(data.kpi.outstanding)} · 90일 초과 ${eok(data.kpi.period_over90)}`, cls: data.kpi.period_outstanding > 0 ? 'text-red-600' : '' },
          { tag: '기간', label: 'ERP 발주', value: eok(data.kpi.erp_amount), sub: '품목 매입가 합 (취소 제외)', cls: '' },
          { tag: '기간', label: '카드 매입', value: eok(data.kpi.card_total), sub: '가맹점 사업자번호 매칭 (참고)', cls: '' },
          { tag: '누적', label: '평균 지급일', value: data.kpi.avg_pay_days != null ? `${data.kpi.avg_pay_days}일` : '-', sub: '계산서 발행→출금 (금액 가중)', cls: '' },
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

      {/* 통장 ↔ 계산서 대사 (423, 2026-11-11 승인) — 이 매입처에 연결된 통장 입출금과 계산서 합계를 선택 기간으로 견준다 */}
      {(() => {
        const b = data.bank
        const v = VERDICT_META[b.verdict] ?? VERDICT_META.ok
        const net = b.out_total - b.in_total
        const diff = net - b.invoice_total
        return (
          <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm font-bold text-gray-800">통장 ↔ 계산서 대사 <span className="font-normal text-gray-400 text-xs">({from} ~ {to} · 이 매입처에 연결된 통장 거래 기준)</span></div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${v.cls}`}>{v.label}{b.unmatched_out > 0 ? ` — 계산서 없는 출금 ${eok(b.unmatched_out)}` : ''}</span>
                <Link href={`/transactions?q=${encodeURIComponent('거래처:없음 출금')}&from=${from}&to=${to}`} className="text-xs text-blue-600 hover:underline" title="아직 어느 거래처에도 연결되지 않은 출금 — 이 매입처 것이 있으면 거래처를 지정하고 통장 키워드를 학습시키세요">거래처 미연결 출금 보기 →</Link>
              </div>
            </div>
            {b.excluded_reason ? (
              <p className="text-xs text-gray-500 mt-2">{b.excluded_reason}</p>
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-sm mt-3">
                  {[
                    { l: '① 통장 출금', v: eok(b.out_total), s: `연결 거래 ${b.out_count}건`, cls: '' },
                    { l: '② 통장 입금 (환불·정산)', v: eok(b.in_total), s: `${b.in_count}건`, cls: b.in_total > 0 ? 'text-violet-700' : '' },
                    { l: '③ 계산서 합계', v: eok(b.invoice_total), s: '매입 계산서 (발행일 기준)', cls: '' },
                    { l: '④ 지급 (매칭·상계)', v: eok(b.paid_total), s: '계산서 결제연결 + 미지급금 상계', cls: '' },
                    { l: '⑤ 계산서 없는 출금', v: eok(b.unmatched_out), s: `계산서에 배분되지 않은 출금 잔여 · ${b.unmatched_out_count}건 (일부만 연결된 건 포함)`, cls: b.unmatched_out > 0 ? 'text-amber-700' : '', hi: b.unmatched_out > 0 },
                    { l: '⑥ 통장 순지급 − 계산서', v: `${diff > 0 ? '+' : ''}${eok(diff)}`, s: '(① − ②) − ③ · +는 초과·미발행, −는 미지급', cls: diff > 0 ? 'text-amber-700' : diff < 0 ? 'text-red-600' : '' },
                  ].map((k, i) => (
                    <div key={i} className={k.hi ? 'bg-amber-50 rounded-lg p-2 -m-2' : ''}>
                      <div className="text-[0.6875rem] text-gray-500">{k.l}</div>
                      <div className={`font-bold tabular-nums ${k.cls}`}>{k.v}</div>
                      <div className="text-[0.625rem] text-gray-400">{k.s}</div>
                    </div>
                  ))}
                </div>
                {/* ①이 어디로 갔는지 — 연결은 '배분 금액'이라 출금 전액과 다를 수 있다 */}
                <p className="text-[0.6875rem] text-gray-500 mt-3">
                  ① 통장 출금 {eok(b.out_total)} = 이 매입처 계산서에 배분 {eok(b.linked_own_total)}
                  {b.linked_other_total > 0 && <> + <span className="text-violet-700">다른 거래처 계산서에 배분 {eok(b.linked_other_total)} ({b.linked_other_vendors.map(v => `${v.name} ${eok(v.amount)}`).join(', ')})</span></>}
                  {b.offset_total > 0 && <> + 미지급금 상계 {eok(b.offset_total)}</>}
                  {' '}+ 미배분 잔여 {eok(b.unmatched_out)}.
                  {b.linked_own_total !== b.paid_total && <> ④ 지급과 다른 것은 ④가 이 매입처 계산서에 연결된 모든 출금(다른 거래처로 연결된 통장 거래 포함)을 세기 때문입니다.</>}
                </p>
                <p className="text-[0.6875rem] text-gray-500 mt-1">{v.hint} 월말 지급 · 익월 계산서처럼 시점 차이가 있으면 짧은 기간에서는 차이가 커 보입니다 — 당년 · 전체 기간으로 보세요.
                  {b.unmatched_out_count > 0 && <> <button onClick={() => { setTab('통장 내역'); setBankView('unmatched') }} className="text-blue-600 hover:underline">계산서 없는 출금 {b.unmatched_out_count}건 보기</button></>}
                </p>
              </>
            )}
          </div>
        )
      })()}

      {/* 미지급 경과기간 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-bold text-gray-800">미지급 경과기간별 현황 <span className="font-normal text-gray-400 text-xs">(전체 기간 · 지급 누계가 오래된 계산서부터 갚은 것으로 보고 계산)</span></div>
          {data.aging.opening > 0 && <div className="text-[0.6875rem] text-gray-500">기초이월 잔여 {eok(data.aging.opening)} 별도</div>}
        </div>
        {agingTotal > 0 ? (
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
        ) : <div className="text-xs text-gray-400 mt-2">계산서 기준 미지급 잔액이 없습니다.</div>}
      </div>

      {/* 탭 */}
      <div className="flex gap-0.5 border-b border-gray-200 mt-5">
        {TABS.map(t => {
          const count = t === '계산서' ? data.invoices.length
            : t === '지급 내역' ? paymentRows.length
            : t === '통장 내역' ? data.bank.rows.length
            : t === 'ERP 발주' ? data.erp_items.length
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
        {(tab === '개요' || tab === '계산서') && (
          <div className={tab === '개요' ? 'grid xl:grid-cols-5 gap-3' : ''}>
            <div className={`bg-white border border-gray-200 rounded-xl overflow-x-auto ${tab === '개요' ? 'xl:col-span-3' : ''}`}>
              <div className="px-4 pt-3 text-sm font-bold text-gray-800">매입 세금계산서{tab === '개요' ? ' (최근)' : ''}</div>
              <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">
                지급·잔여는 이 계산서에 실제로 연결된 출금 기준입니다. 매입처 전체 잔액·경과기간 막대는 오래된 계산서부터 지급된 것으로 보는 총액 방식이라 건별 합계와 다를 수 있습니다.
              </div>
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">발행일</th>
                    <th className="py-2 px-3 text-left font-medium">구분</th>
                    <th className="py-2 px-3 text-right font-medium">총액 (부가세 포함)</th>
                    <th className="py-2 px-3 text-left font-medium">지급 연결</th>
                    <th className="py-2 px-3 text-right font-medium">미연결 잔여</th>
                  </tr>
                </thead>
                <tbody>
                  {(tab === '개요' ? data.invoices.slice(0, 12) : data.invoices).map(inv => {
                    // 연결 기준: 이 계산서에 매칭된 출금 합(paid_alloc)으로 판정 (잔액 합계의 FIFO와 별개)
                    const linkUnpaid = Math.max(0, inv.total_amount - inv.paid_alloc)
                    const payBadge = inv.total_amount > 0 && linkUnpaid === 0
                      ? { t: '완료', c: 'bg-green-100 text-green-700' }
                      : inv.paid_alloc > 0 ? { t: '일부', c: 'bg-amber-100 text-amber-700' }
                      : { t: '미연결', c: 'bg-red-100 text-red-700' }
                    return (
                      <tr key={inv.id} className="border-b border-gray-50">
                        <td className="py-1.5 px-3 tabular-nums">
                          <Link href={`/tax-invoices?dir=purchase&tax=${inv.tax_type ?? 'taxable'}&invoiceId=${inv.id}`}
                            className="text-blue-600 hover:underline" title="계산서 화면에서 열기">{inv.issue_date}</Link>
                        </td>
                        <td className="py-1.5 px-3 text-xs text-gray-500">{inv.tax_type === 'exempt' ? '면세' : '과세'}</td>
                        <td className="py-1.5 px-3 text-right tabular-nums">{won(inv.total_amount)}</td>
                        <td className="py-1.5 px-3"><span className={`px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${payBadge.c}`}>{payBadge.t}</span></td>
                        <td className={`py-1.5 px-3 text-right tabular-nums ${linkUnpaid > 0 ? 'text-red-600' : 'text-gray-400'}`}>{won(linkUnpaid)}</td>
                      </tr>
                    )
                  })}
                  {!data.invoices.length && <tr><td colSpan={5} className="text-center py-10 text-gray-400 text-sm">수취한 매입 계산서가 없습니다.</td></tr>}
                </tbody>
              </table>
              {tab === '개요' && data.invoices.length > 12 && (
                <button onClick={() => setTab('계산서')}
                  className="w-full px-4 py-2 text-left text-[0.6875rem] text-blue-600 hover:bg-blue-50/40 border-t border-gray-100">
                  최근 12건만 표시 중 — 외 {data.invoices.length - 12}건은 계산서 탭에서 확인
                </button>
              )}
            </div>
            {tab === '개요' && (
              <div className="bg-white border border-gray-200 rounded-xl xl:col-span-2">
                <div className="px-4 pt-3 text-sm font-bold text-gray-800">매입·지급 타임라인</div>
                <div className="px-4 pb-1 text-[0.6875rem] text-gray-400">계산서 수취와 출금을 시간순으로 함께 봅니다 (최근)</div>
                <ul className="px-4 pb-3">
                  {data.timeline.slice(0, 12).map((e, i) => {
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
                  {!data.timeline.length && <li className="text-xs text-gray-400 py-4">지급·수취 이력이 없습니다.</li>}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === '지급 내역' && (
          <div className="bg-white border border-gray-200 rounded-xl">
            <div className="px-4 pt-3 text-[0.6875rem] text-gray-400">
              실제로 돈이 나간 기록만 봅니다 — 계산서 발행 기록은 계산서 탭에 있습니다.
              [통장]은 계산서에 연결된 출금과 미지급금(2001) 상계로 확정된 출금,
              [카드]는 가맹점 사업자번호가 이 매입처와 일치하는 법인카드 결제분입니다.
              카드 대금은 카드사에 지급되므로 미지급 잔액 계산에는 넣지 않습니다.
            </div>
            <ul className="px-4 py-2">
              {paymentRows.map((e, i) => {
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
              {!paymentRows.length && <li className="text-xs text-gray-400 py-6">지급 이력이 없습니다.</li>}
            </ul>
          </div>
        )}

        {tab === '통장 내역' && (() => {
          const rows = data.bank.rows.filter(r => bankView === 'all' ? true : bankView === 'in' ? r.amount_in > 0 : r.unallocated > 0)
          const cnt = { unmatched: data.bank.rows.filter(r => r.unallocated > 0).length, all: data.bank.rows.length, in: data.bank.rows.filter(r => r.amount_in > 0).length }
          return (
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs mb-2">
                {([['unmatched', `계산서 없는 출금만 (${cnt.unmatched})`], ['all', `전체 (${cnt.all})`], ['in', `입금만 (${cnt.in})`]] as const).map(([k, l]) => (
                  <button key={k} onClick={() => setBankView(k)} className={`px-2 py-1 rounded-full border ${bankView === k ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}>{l}</button>
                ))}
                <span className="text-gray-400 ml-1">연결 거래 전체(기간 무관) · 적요 클릭 = 통장 내역 화면의 그 행</span>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs text-gray-400 border-b border-gray-200">
                    <th className="py-2.5 px-3 font-medium">거래일</th><th className="py-2.5 px-3 font-medium">적요 / 보낸분·받는분</th><th className="py-2.5 px-3 font-medium">계좌</th>
                    <th className="py-2.5 px-3 font-medium text-right">출금</th><th className="py-2.5 px-3 font-medium text-right">입금</th><th className="py-2.5 px-3 font-medium">계산서 연결</th><th className="py-2.5 px-3 font-medium">연결 근거</th><th className="py-2.5 px-3 font-medium">조치</th>
                  </tr></thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map(r => {
                      const unmatched = r.unallocated > 0
                      return (
                        <tr key={r.id} className={unmatched ? 'bg-amber-50/40' : ''}>
                          <td className="px-3 py-2 tabular-nums whitespace-nowrap">{r.tx_date}</td>
                          <td className="px-3 py-2"><Link href={`/transactions?txId=${r.id}`} className="text-blue-700 hover:underline">{r.description ?? '(적요 없음)'}</Link>{r.counterparty_name && r.counterparty_name !== r.description && <span className="text-gray-400 text-xs ml-1">{r.counterparty_name}</span>}</td>
                          <td className="px-3 py-2 text-xs text-gray-500">{r.account_alias ?? '-'}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-red-600">{r.amount_out > 0 ? won(r.amount_out) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-blue-600">{r.amount_in > 0 ? won(r.amount_in) : ''}</td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {r.invoice_linked > 0 && <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-700">연결 {won(r.invoice_linked)}</span>}
                            {r.linked_other > 0 && <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 ml-1" title="이 매입처가 아닌 다른 거래처의 계산서에 연결된 금액">{r.linked_other_names.join(' · ') || '다른 거래처'} 계산서 {won(r.linked_other)}</span>}
                            {r.is_offset && <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">미지급금 상계</span>}
                            {r.amount_out > 0 && r.unallocated > 0 && (r.invoice_linked + r.linked_other > 0)
                              && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 ml-1" title="출금 중 계산서에 배분되지 않은 금액">잔여 {won(r.unallocated)}</span>}
                            {r.amount_out > 0 && r.invoice_linked + r.linked_other === 0 && !r.is_offset && <span className="text-gray-400">없음</span>}
                            {r.amount_out === 0 && <span className="text-gray-300">-</span>}
                          </td>
                          <td className="px-3 py-2 text-xs text-gray-500">
                            {r.basis}
                            {r.tagged_vendor_name && <span className="block text-violet-700" title="이 출금의 통장 거래처는 다른 곳으로 지정돼 있지만, 이 매입처 계산서에 결제연결된 금액이 있어 함께 보여 줍니다">통장 거래처: {r.tagged_vendor_name}</span>}
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {unmatched && <Link href={`/tax-invoices?dir=purchase&tax=taxable&vendorId=${data.vendor.id}`} className="text-blue-600 hover:underline" title="이 매입처 계산서 목록에서 결제 연결">계산서 매칭</Link>}
                            {perms.edit && !r.tagged_vendor_name && <>{unmatched && ' · '}<button onClick={() => unlinkBankTx(r.id, r.basis)} className="text-gray-500 hover:underline">연결 해제</button></>}
                          </td>
                        </tr>
                      )
                    })}
                    {!rows.length && <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">해당하는 통장 거래가 없습니다.</td></tr>}
                  </tbody>
                </table>
              </div>

              {/* 키워드 두 칸 — 계산서 매칭 키워드(match_aliases) / 통장 키워드(bank_keywords, 423) */}
              <div className="grid md:grid-cols-2 gap-3 mt-4">
                {(['invoice', 'bank'] as const).map(kind => {
                  const list = kind === 'invoice' ? data.keywords.invoice : data.keywords.bank
                  const disabled = !perms.edit || kwBusy || (kind === 'bank' && !data.keywords.bank_column)
                  return (
                    <div key={kind} className={`bg-white border rounded-xl p-4 ${kind === 'bank' ? 'border-emerald-300' : 'border-gray-200'}`}>
                      <div className="font-bold text-gray-800 text-sm">{kind === 'invoice' ? '계산서 매칭 키워드' : '통장 키워드'}</div>
                      <p className="text-[0.6875rem] text-gray-500 mb-2">
                        {kind === 'invoice'
                          ? '계산서의 공급자 상호가 거래처명과 다를 때 씁니다. 사업자번호가 있으면 거의 쓰이지 않습니다.'
                          : data.keywords.bank_column
                            ? '통장 적요 · 보낸분/받는분에서 이 매입처를 찾는 표현(입금자명 · 약칭). 다른 거래처와 겹치면 자동 연결이 둘 다 건너뛰므로 저장 시 경고합니다.'
                            : '마이그레이션 423 실행 전입니다 — 지금은 계산서 매칭 키워드가 통장 매칭에도 쓰입니다.'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1 text-xs">
                        {list.map(k => (
                          <span key={k} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border ${kind === 'bank' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                            {k}{perms.edit && !disabled && <button onClick={() => saveKeywords(kind, list.filter(x => x !== k))} className="opacity-60 hover:opacity-100" title="제거">✕</button>}
                          </span>
                        ))}
                        {!list.length && <span className="text-gray-400">없음</span>}
                        {perms.edit && (
                          <input value={kwInput[kind]} disabled={disabled}
                            onChange={e => setKwInput(s => ({ ...s, [kind]: e.target.value }))}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && kwInput[kind].trim()) { e.preventDefault(); saveKeywords(kind, [...list, kwInput[kind].trim()]) } }}
                            placeholder="+ 추가 후 Enter" className="border border-gray-300 rounded px-2 py-0.5 w-32 disabled:opacity-50" />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}

        {tab === 'ERP 발주' && (
          <div className="space-y-3">
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-sm font-bold text-gray-800 mb-1">정산월별 발주 규모 <span className="font-normal text-gray-400 text-xs">(취소 제외, 정산월 없으면 주문월)</span></div>
              <div className="flex gap-1.5 flex-wrap">
                {data.erp_months.slice(0, 18).map(m => (
                  <div key={m.month} className="px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs">
                    <span className="text-gray-500">{m.month}</span>
                    <span className="ml-1.5 font-semibold tabular-nums">{eok(m.amount)}</span>
                    <span className="ml-1 text-gray-400">({m.item_count}건)</span>
                  </div>
                ))}
                {!data.erp_months.length && <span className="text-xs text-gray-400 py-2">ERP 발주 이력이 없습니다. 매입 별칭 연결을 확인하세요.</span>}
              </div>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <div className="px-4 pt-3 pb-1 text-sm font-bold text-gray-800">발주 품목 <span className="font-normal text-gray-400 text-xs">주문시스템 3단계(발주서)가 열리면 발주 이력의 원천이 됩니다</span></div>
              <table className="w-full text-sm min-w-[680px]">
                <thead>
                  <tr className="bg-gray-50 text-gray-500 text-xs border-b border-gray-200">
                    <th className="py-2 px-3 text-left font-medium">주문번호</th>
                    <th className="py-2 px-3 text-left font-medium">주문일</th>
                    <th className="py-2 px-3 text-left font-medium">품목</th>
                    <th className="py-2 px-3 text-right font-medium">수량</th>
                    <th className="py-2 px-3 text-right font-medium">매입액</th>
                    <th className="py-2 px-3 text-left font-medium">정산월</th>
                  </tr>
                </thead>
                <tbody>
                  {data.erp_items.map((it, i) => (
                    <tr key={i} className={`border-b border-gray-50 ${it.is_canceled ? 'opacity-40 line-through' : ''}`}>
                      <td className="py-1.5 px-3 text-xs tabular-nums">
                        {it.order_no
                          ? <Link href={`/erp-orders?q=${encodeURIComponent(it.order_no)}`} className="text-blue-600 hover:underline" title="ERP 주문내역에서 열기">{it.order_no}</Link>
                          : <span className="text-gray-500">-</span>}
                      </td>
                      <td className="py-1.5 px-3 tabular-nums text-xs">{it.order_date ?? '-'}</td>
                      <td className="py-1.5 px-3">{it.item_name ?? '-'}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{it.quantity}</td>
                      <td className="py-1.5 px-3 text-right tabular-nums">{won(it.purchase_total)}</td>
                      <td className="py-1.5 px-3 tabular-nums text-xs text-gray-500">{it.settlement_month ?? '-'}</td>
                    </tr>
                  ))}
                  {!data.erp_items.length && (
                    <tr><td colSpan={6} className="text-center py-10 text-gray-400 text-sm">발주 품목이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
              {data.erp_items.length >= 500 && (
                <div className="px-4 py-2 text-[0.6875rem] text-gray-400">최근 500건만 표시 중 — 전체는 ERP 주문내역 화면에서 확인하세요.</div>
              )}
            </div>
          </div>
        )}

        {/* 업체 발주서 양식 (516) — 등록 · 수정은 매입처 관리 수정 권한(API의 can_edit) */}
        {tab === '발주서 양식' && <PoFormTab vendorId={vendorId} vendorName={data.vendor.name} />}

        {tab === '활동 메모' && (
          <div className="bg-white border border-gray-200 rounded-xl p-4 max-w-2xl">
            <div className="text-sm font-bold text-gray-800 mb-2">활동 메모</div>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={6}
              placeholder="지급 협의, 정산 이슈 등 이 매입처 관련 메모" readOnly={!perms.edit}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm read-only:bg-gray-50" />
            {perms.edit && <div className="flex justify-end mt-2">
              <button onClick={saveNote} className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-sm">저장</button>
            </div>}
          </div>
        )}
      </div>
    </div>
  )
}
