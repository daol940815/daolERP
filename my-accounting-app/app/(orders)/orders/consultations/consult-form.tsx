'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Combo, ComboFree, autoGrow, branchLabel, cartonShipping, draftFromProduct, emptyItem,
  lineTotal, priceRule, splitByGroupPrefix, toInt, won,
} from '../form-shared'
import type { ContactOpt, ItemDraft, Product, Vendor, VendorGroup } from '../form-shared'
import { contactLabel } from '@/lib/contact-label'

// 상담일지 폼 (신규·수정 공용) — 실물 '주문상담' 시트 컬럼 구성.
// 필수는 상담일·구분뿐. 업체·지점·담당자는 마스터 검색 + 자유 입력 겸용
// (상담 단계는 신규 고객 가능 — 주문 전환 시점에 마스터 등록 안내).
// 품목·가격 규칙은 주문 입력과 동일 (form-shared 공용).

const TYPES = ['주문', '문의', '요청', '결제', '기타'] as const

export default function ConsultForm({ consultId }: { consultId?: string }) {
  const router = useRouter()
  const isEdit = !!consultId

  // 마스터
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [contacts, setContacts] = useState<ContactOpt[]>([])

  // 상담 본문 (실물 컬럼 순서)
  const [consultDate, setConsultDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [consultType, setConsultType] = useState<string>('문의')
  const [groupId, setGroupId] = useState<string | null>(null)
  const [bankText, setBankText] = useState('')
  const [vendorId, setVendorId] = useState<string | null>(null)
  const [branchText, setBranchText] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [managerText, setManagerText] = useState('')
  const [phone, setPhone] = useState('')
  const [tel, setTel] = useState('')
  // 상담 단위 상태·기타사항은 품목별로 이동(509, 실무자 요청) — 기존 기록은 읽기 전용 표시·보존
  const [productStatus, setProductStatus] = useState('')
  const [optionNote, setOptionNote] = useState('')
  const [payment, setPayment] = useState('')            // 새로 입력하는 결제정보 (평문)
  const [paymentMasked, setPaymentMasked] = useState<string | null>(null)
  const [paymentRevealed, setPaymentRevealed] = useState<string | null>(null)
  const [senderName, setSenderName] = useState('')
  const [deliveryRequest, setDeliveryRequest] = useState('')
  const [greetingCard, setGreetingCard] = useState('')
  const [addressChecked, setAddressChecked] = useState('')
  const [rosterMethod, setRosterMethod] = useState('')
  const [memo, setMemo] = useState('')
  // 결제·발송 정보 확장 (509 — 계산서 발행용)
  const [invoiceEmail, setInvoiceEmail] = useState('')
  const [fax, setFax] = useState('')
  const [bizNumber, setBizNumber] = useState('')
  const [ceoName, setCeoName] = useState('')

  const uidRef = useRef(2)
  const nextUid = () => uidRef.current++
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem(1)])

  const [status, setStatus] = useState('진행중')
  const [orders, setOrders] = useState<{ id: string; order_no: string; order_date: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const locked = status === '주문전환'   // 전환 후 수정 잠금 (이력 보존)

  useEffect(() => {
    (async () => {
      try {
        const [mRes, pRes] = await Promise.all([
          fetch('/api/orders-portal/masters'),
          fetch('/api/orders-portal/products'),
        ])
        const m = await mRes.json()
        if (!mRes.ok) throw new Error(m.error ?? '마스터 조회 실패')
        setVendors(m.vendors ?? [])
        setGroups(m.groups ?? [])
        const p = await pRes.json()
        if (pRes.ok) setProducts((p.products ?? []).filter((x: Product) => x.is_active))

        if (consultId) {
          const cRes = await fetch(`/api/orders-portal/consultations/${consultId}`)
          const c = await cRes.json()
          if (!cRes.ok) throw new Error(c.error ?? '상담일지 조회 실패')
          const v = c.consult
          setConsultDate(v.consult_date)
          setConsultType(v.consult_type)
          setGroupId(v.vendor_group_id)
          setVendorId(v.vendor_id)
          setContactId(v.contact_id)
          setBankText(v.bank_name ?? '')
          setBranchText(v.branch_name ?? '')
          setManagerText(v.manager_name ?? '')
          setPhone(v.phone ?? '')
          setTel(v.tel ?? '')
          setProductStatus(v.product_status ?? '')
          setOptionNote(v.option_note ?? '')
          setPaymentMasked(c.payment_masked ?? null)
          setSenderName(v.sender_name ?? '')
          setDeliveryRequest(v.delivery_request ?? '')
          setGreetingCard(v.greeting_card ?? '')
          setAddressChecked(v.address_checked ?? '')
          setRosterMethod(v.roster_method ?? '')
          setMemo(v.memo ?? '')
          setInvoiceEmail(v.invoice_email ?? '')
          setFax(v.fax ?? '')
          setBizNumber(v.biz_number ?? '')
          setCeoName(v.ceo_name ?? '')
          setStatus(v.status)
          setOrders(c.orders ?? [])
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          const cItems = (c.items ?? []) as Record<string, unknown>[]
          if (cItems.length) {
            // line_no → uid 매핑으로 옵션 연결 복원 (품목은 line_no 순으로 로드됨)
            const lineToUid = new Map<number, number>(cItems.map((it, idx) => [it.line_no as number, idx + 1]))
            uidRef.current = cItems.length + 1
            setItems(cItems.map((it, idx) => {
              const prod = prodList.find(x => x.id === it.product_id)
              return {
                ...emptyItem(idx + 1),
                parent_uid: it.parent_line_no ? (lineToUid.get(it.parent_line_no as number) ?? null) : null,
                product_id: (it.product_id as string) ?? null,
                item_code: (it.item_code as string) ?? '',
                item_name: (it.item_name as string) ?? '',
                order_kind: (it.order_kind as string) ?? '지점',
                purchase_vendor_name: (it.purchase_vendor_name as string) ?? '',
                sale_price: (it.sale_price as number) ?? 0,
                quantity: (it.quantity as number) ?? 1,
                shipping_fee: (it.shipping_fee as number) ?? 0,
                discount_amount: (it.discount_amount as number) ?? 0,
                purchase_price: (it.purchase_price as number) ?? 0,
                purchase_shipping: (it.purchase_shipping as number) ?? 0,
                memo: (it.memo as string) ?? '',
                status: (it.status as string) ?? '',
                option_note: (it.option_note as string) ?? '',
                branch_sale_price: prod?.sale_price ?? 0,
                individual_sale_price: prod?.individual_sale_price ?? 0,
                branch_purchase_price: prod?.purchase_price ?? 0,
                carton_unit: prod?.carton_unit ?? 0,
                carton_shipping_fee: prod?.carton_shipping_fee ?? 0,
                loose_shipping_fee: prod?.loose_shipping_fee ?? 0,
              }
            }))
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '조회 실패')
      }
      setLoading(false)
    })()
  }, [consultId])

  // 지점(vendors) 선택 시 담당자 목록
  useEffect(() => {
    if (!vendorId) { setContacts([]); return }
    (async () => {
      const res = await fetch(`/api/orders-portal/masters?vendor_id=${vendorId}`)
      const json = await res.json()
      setContacts(res.ok ? (json.contacts ?? []) : [])
    })()
  }, [vendorId])

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))

  // 옵션(부가상품) 추가 — 본 상품 행 아래 붙는다 (주문 입력과 동일 동작)
  const addAddon = (parentIdx: number, p: Product) => {
    setItems(prev => {
      const parent = prev[parentIdx]
      if (!parent) return prev
      const base: ItemDraft = { ...emptyItem(nextUid()), parent_uid: parent.uid, order_kind: parent.order_kind, quantity: parent.quantity }
      const draft: ItemDraft = { ...base, ...draftFromProduct(p, base) }
      // 본 상품 행의 기존 옵션 묶음 뒤에 삽입
      let at = parentIdx + 1
      while (at < prev.length && prev[at].parent_uid === parent.uid) at++
      return [...prev.slice(0, at), draft, ...prev.slice(at)]
    })
  }

  // 행 삭제 — 본 상품 행을 지우면 딸린 옵션 행도 함께 삭제
  const removeRow = (uid: number) =>
    setItems(prev => prev.filter(it => it.uid !== uid && it.parent_uid !== uid))

  const pickProduct = (i: number, pid: string | null) => {
    const p = products.find(x => x.id === pid)
    const cur = items[i]
    if (!p || !cur) return
    setItem(i, draftFromProduct(p, cur))
  }
  const setKind = (i: number, kind: string) => {
    const it = items[i]
    if (!it) return
    setItem(i, { order_kind: kind, ...(it.product_id ? priceRule({ ...it, order_kind: kind }, it.quantity) : {}) })
  }
  const setQuantity = (i: number, qty: number) => {
    const it = items[i]
    setItem(i, {
      quantity: qty,
      ...(it && it.order_kind === '지점' && it.carton_unit > 0
        ? { shipping_fee: cartonShipping(it.carton_unit, it.carton_shipping_fee, it.loose_shipping_fee, qty) }
        : {}),
    })
  }

  const totals = useMemo(() => {
    const filled = items.filter(it => it.item_name.trim())
    const total = filled.reduce((s, it) => s + lineTotal(it), 0)
    const cost = filled.reduce((s, it) => s + it.purchase_price * it.quantity + it.purchase_shipping, 0)
    const discount = filled.reduce((s, it) => s + (it.discount_amount || 0), 0)
    return { total, margin: total - cost, discount }
  }, [items])

  // 단가변경 자동 판정 — 입력 판매가가 원가표(구분별 규칙) 자동가와 다르면 표기 (실무자 요청)
  const priceChanged = (it: ItemDraft): boolean => {
    if (!it.product_id) return false
    const auto = priceRule(it, it.quantity || 1)
    return auto.sale_price !== undefined && it.sale_price !== auto.sale_price
  }
  // 매입배송비 선택 상태 (값에서 역산 — 별도 상태 불필요)
  const shipMode = (it: ItemDraft): 'none' | 'carton' | 'loose' | 'custom' => {
    if (!it.purchase_shipping) return 'none'
    if (it.carton_shipping_fee > 0 && it.purchase_shipping === it.carton_shipping_fee) return 'carton'
    if (it.loose_shipping_fee > 0 && it.purchase_shipping === it.loose_shipping_fee) return 'loose'
    return 'custom'
  }

  const revealPayment = async () => {
    const res = await fetch(`/api/orders-portal/consultations/${consultId}?reveal=1`)
    const json = await res.json()
    if (res.ok) setPaymentRevealed(json.payment ?? '(없음)')
    else setError(json.error)
  }

  const buildPayload = () => ({
    consult_date: consultDate,
    consult_type: consultType,
    vendor_group_id: groupId,
    vendor_id: vendorId,
    contact_id: contactId,
    bank_name: bankText || null,
    branch_name: branchText || null,
    manager_name: managerText || null,
    phone: phone || null,
    tel: tel || null,
    product_status: productStatus || null,
    option_note: optionNote || null,
    payment_info: payment,             // 빈 값 = 기존 유지
    sender_name: senderName || null,
    delivery_request: deliveryRequest || null,
    greeting_card: greetingCard || null,
    address_checked: addressChecked || null,
    roster_method: rosterMethod || null,
    memo: memo || null,
    invoice_email: invoiceEmail || null,
    fax: fax || null,
    biz_number: bizNumber || null,
    ceo_name: ceoName || null,
    items: (() => {
      // 옵션 연결(parent_uid)을 저장용 행 번호(parent_line_no)로 직렬화 — 주문 입력과 동일
      const filled = items.filter(it => it.item_name.trim())
      const posByUid = new Map(filled.map((it, idx) => [it.uid, idx + 1]))
      return filled.map(it => ({
        ...it,
        // 단가변경 자동 표기 — 저장 시점에 원가표 대조 결과를 상태에 병기
        status: (() => {
          const parts = it.status.trim() ? [it.status.trim()] : []
          if (priceChanged(it) && !parts.some(p => p.includes('단가변경'))) parts.push('단가변경')
          return parts.join(' · ') || null
        })(),
        parent_line_no: it.parent_uid ? (posByUid.get(it.parent_uid) ?? null) : null,
      }))
    })(),
  })

  const save = async (convertAfter?: boolean): Promise<void> => {
    setError(null); setNotice(null); setSaving(true)
    try {
      const url = isEdit ? `/api/orders-portal/consultations/${consultId}` : '/api/orders-portal/consultations'
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '저장 실패')
      const id = isEdit ? consultId : json.id
      if (convertAfter) {
        router.push(`/orders/new?consult=${id}`)
        return
      }
      if (!isEdit && json.work_logged) setNotice('저장 완료 — 업무일지에 기재되었습니다.')
      router.push('/orders/consultations')
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    }
    setSaving(false)
  }

  const act = async (action: 'close' | 'reopen' | 'delete') => {
    if (action === 'delete' && !confirm('이 상담일지를 삭제할까요?')) return
    const res = await fetch(`/api/orders-portal/consultations/${consultId}`, {
      method: action === 'delete' ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      ...(action !== 'delete' ? { body: JSON.stringify({ action }) } : {}),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    router.push('/orders/consultations')
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>

  const label = 'block text-[11px] text-gray-500 mb-0.5'
  const free = 'w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-60'
  const numCell = 'w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs text-right tabular-nums'
  const autoCell = 'w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs text-right tabular-nums text-gray-500'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">{isEdit ? '상담일지' : '상담 기록'}</h1>
        {isEdit && (
          <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[11px] font-medium ${
            status === '주문전환' ? 'bg-emerald-100 text-emerald-700'
              : status === '종결' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-800'}`}>
            {status}
          </span>
        )}
        {orders.map(o => (
          <a key={o.id} href={`/orders/${o.id}`} className="text-xs text-blue-700 hover:underline tabular-nums">
            {o.order_no}
          </a>
        ))}
        <span className="ml-auto flex gap-2">
          {isEdit && !locked && status === '진행중' && (
            <>
              <button onClick={() => act('close')} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">종결</button>
              <button onClick={() => act('delete')} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm">삭제</button>
            </>
          )}
          {isEdit && status === '종결' && (
            <button onClick={() => act('reopen')} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">재개</button>
          )}
        </span>
      </div>

      {locked && (
        <div className="mt-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg">
          주문으로 전환된 상담입니다 — 이력 보존을 위해 수정할 수 없습니다.
        </div>
      )}
      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 상담 정보 — 실물 컬럼 순서 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="text-sm font-bold text-gray-900 mb-3">
          상담 정보 <span className="text-[11px] font-normal text-gray-400 ml-1">필수는 상담일·구분뿐 — 아는 만큼만</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
          <div>
            <label className={label}>상담일 <em className="not-italic text-red-500">*</em></label>
            <input type="date" value={consultDate} disabled={locked}
              onChange={e => setConsultDate(e.target.value)} className={free} />
          </div>
          <div>
            <label className={label}>구분 <em className="not-italic text-red-500">*</em></label>
            <select value={consultType} disabled={locked} onChange={e => setConsultType(e.target.value)}
              className="w-full border border-blue-200 bg-blue-50/40 rounded-lg px-2 py-1.5 text-sm disabled:opacity-60">
              {TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={label}>업체(은행)</label>
            {locked ? <div className={free}>{bankText || '-'}</div> : (
              <ComboFree text={bankText} selectedId={groupId}
                options={groups.map(g => ({ id: g.id, label: g.name }))}
                onChange={({ id, text }) => {
                  setGroupId(id); setBankText(text)
                  if (id) {
                    const branches = vendors.filter(v => v.group_id === id)
                    if (branches.length === 1) { setVendorId(branches[0].id); setBranchText('') }
                  }
                }}
                placeholder="마스터 검색 · 신규명 자유 입력" />
            )}
          </div>
          <div className="col-span-2">
            <label className={label}>부서(지점)</label>
            {locked ? <div className={free}>{branchText || '-'}</div> : (
              <ComboFree text={branchText}
                selectedId={vendorId}
                options={(groupId ? vendors.filter(v => v.group_id === groupId) : vendors)
                  .map(v => {
                    const gName = groups.find(g => g.id === v.group_id)?.name
                    // 그룹 미연결이어도 업체명 접두가 있으면 지점명만 표시 (은행명 잔존 보정)
                    const split = !gName ? splitByGroupPrefix(v.name, groups) : null
                    return {
                      id: v.id,
                      label: gName ? branchLabel(v.name, gName) : (split?.branch ?? v.name),
                      sub: gName ?? split?.group.name ?? '',
                    }
                  })}
                onChange={({ id, text }) => {
                  setVendorId(id)
                  if (id) {
                    const v = vendors.find(x => x.id === id)
                    const gName = v?.group_id ? groups.find(g => g.id === v.group_id)?.name : null
                    const split = v && !gName ? splitByGroupPrefix(v.name, groups) : null
                    if (v?.group_id && gName) {
                      // 업체 소속 지점: 업체=그룹명, 부서=접두 뗀 지점명
                      setGroupId(v.group_id)
                      setBankText(gName)
                      setBranchText(branchLabel(v.name, gName))
                    } else if (v && split) {
                      // 그룹 미연결이지만 업체명 접두 매칭: 업체/지점으로 분리 저장
                      setGroupId(split.group.id)
                      setBankText(split.group.name)
                      setBranchText(split.branch)
                    } else if (v) {
                      // 단일 업체: 업체=거래처명, 부서 비움
                      setBankText(v.name)
                      setBranchText('')
                    }
                  } else {
                    setBranchText(text)
                  }
                  setContactId(null)
                }}
                placeholder="지점 검색 · 자유 입력" />
            )}
          </div>

          <div className="col-span-2">
            <label className={label}>담당자</label>
            {locked ? <div className={free}>{managerText || '-'}</div> : (
              <ComboFree text={managerText} selectedId={contactId}
                options={contacts.map(c => ({
                  id: c.contact_id,
                  label: contactLabel(c.name, c.title),
                  sub: [c.is_representative ? '대표' : '', c.phone ?? ''].filter(Boolean).join(' · '),
                }))}
                onChange={({ id, text }) => {
                  setContactId(id); setManagerText(text)
                  if (id) {
                    const c = contacts.find(x => x.contact_id === id)
                    if (c?.phone) setPhone(c.phone)
                  }
                }}
                placeholder={vendorId ? '담당자 선택 · 자유 입력' : '자유 입력 (지점 선택 시 마스터 검색)'} />
            )}
          </div>
          <div>
            <label className={label}>핸드폰</label>
            <input value={phone} disabled={locked} onChange={e => setPhone(e.target.value)} className={free} placeholder="010-" />
          </div>
          <div>
            <label className={label}>연락처(유선)</label>
            <input value={tel} disabled={locked} onChange={e => setTel(e.target.value)} className={free} placeholder="02-" />
          </div>
          {/* 상태·기타사항은 품목별 입력으로 이동 (509, 실무자 요청) — 이전 기록만 표시 */}
          {(productStatus || optionNote) && (
            <div className="col-span-2 md:col-span-6 text-xs text-gray-400">
              이전 기록(상담 단위): {[productStatus && `상태 ${productStatus}`, optionNote && `기타 ${optionNote}`].filter(Boolean).join(' · ')}
              <span className="ml-1.5">— 이제 상담 품목의 행별 상태·기타사항 칸에 입력합니다</span>
            </div>
          )}
        </div>
      </div>

      {/* 상담 품목 — 주문 입력과 동일 규칙 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3 overflow-x-auto">
        <div className="text-sm font-bold text-gray-900 mb-3">
          상담 품목 <span className="text-[11px] font-normal text-gray-400 ml-1">품번 검색 시 원가표 기준 자동 — 수정 가능</span>
        </div>
        <table className="w-full text-xs min-w-[1420px] table-fixed">
          <colgroup>
            <col className="w-[8.5rem]" /><col /><col className="w-16" /><col className="w-12" />
            <col className="w-[4.25rem]" /><col className="w-[5.5rem]" /><col className="w-[5.5rem]" />
            <col className="w-[5.5rem]" /><col className="w-[5.5rem]" /><col className="w-24" />
            <col className="w-[5.5rem]" /><col className="w-[6.75rem]" /><col className="w-[5.5rem]" /><col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-1.5 px-1.5 text-left font-medium">품번 검색</th>
              <th className="py-1.5 px-1.5 text-left font-medium">상품명</th>
              <th className="py-1.5 px-1.5 text-left font-medium">구분</th>
              <th className="py-1.5 px-1.5 text-right font-medium">수량</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="원가표 카톤단위 — 자동 표기">카톤</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매가</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="할인 적용 시 별도 표기">할인</th>
              <th className="py-1.5 px-1.5 text-right font-medium">배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매합계</th>
              <th className="py-1.5 px-1.5 text-left font-medium">매입처</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입가</th>
              <th className="py-1.5 px-1.5 text-left font-medium" title="카톤단위/카톤외 택배비 중 선택">매입배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium">마진</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              // 옵션 추가 후보: 같은 매입처의 부가상품 (본 상품 행에만 노출)
              const addonCands = !locked && !it.parent_uid && it.purchase_vendor_name
                ? products.filter(p => p.is_addon && p.purchase_vendor_name === it.purchase_vendor_name)
                : []
              return (
              <Fragment key={it.uid}>
              <tr className={`border-b border-gray-50 align-top ${it.parent_uid ? 'bg-slate-50/60' : ''}`}>
                <td className="py-1 px-1.5">
                  <div className="flex items-center gap-1">
                    {it.parent_uid != null && <span className="text-gray-400 text-xs shrink-0" title="옵션 (부가상품)">└</span>}
                    <div className="flex-1">
                      <Combo value={it.product_id}
                        display={it.item_code || (it.product_id ? it.item_name : '')}
                        options={products.map(p => ({
                          id: p.id,
                          label: [p.item_code, p.item_name].filter(Boolean).join(' · '),
                          sub: [p.category, p.purchase_vendor_name].filter(Boolean).join(' · '),
                          soldout: !!p.is_soldout,
                        }))}
                        onSelect={id => pickProduct(i, id)}
                        placeholder="품번·품명 검색" />
                    </div>
                  </div>
                </td>
                <td className="py-1 px-1.5">
                  <textarea key={`${it.uid}:${it.product_id ?? ''}`} value={it.item_name} rows={1} ref={autoGrow}
                    disabled={locked}
                    onChange={e => { setItem(i, { item_name: e.target.value, product_id: null }); autoGrow(e.target) }}
                    placeholder="마스터에 없으면 직접 입력"
                    className="w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs resize-none overflow-hidden leading-relaxed block disabled:opacity-60" />
                </td>
                <td className="py-1 px-1.5">
                  <select value={it.order_kind} disabled={locked} onChange={e => setKind(i, e.target.value)}
                    className="border border-blue-200 bg-blue-50/40 rounded px-1 py-1 text-xs disabled:opacity-60">
                    <option>지점</option><option>개별</option><option>샘플</option>
                  </select>
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.quantity || ''} disabled={locked} onChange={e => setQuantity(i, toInt(e.target.value))}
                    className={numCell} placeholder="1" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  {/* 카톤단위 자동 표기 (원가표) */}
                  <div className={autoCell}
                    title={it.carton_unit > 0 ? `1카톤 ${it.carton_unit}개 — 지점 배송비 자동 계산에 사용` : '카톤단위 미지정'}>
                    {it.carton_unit > 0 ? `${it.carton_unit}개` : '-'}
                  </div>
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.sale_price ? won(it.sale_price) : ''} disabled={locked}
                    onChange={e => setItem(i, { sale_price: toInt(e.target.value) })} className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  {/* 할인 별도 표기란 — 적용 시 붉은 강조 */}
                  <input value={it.discount_amount ? won(it.discount_amount) : ''} disabled={locked}
                    onChange={e => setItem(i, { discount_amount: toInt(e.target.value) })}
                    className={`${numCell} ${it.discount_amount > 0 ? 'text-red-600 font-semibold border-red-200 bg-red-50/40' : ''}`}
                    placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.shipping_fee ? won(it.shipping_fee) : ''} disabled={locked}
                    onChange={e => setItem(i, { shipping_fee: toInt(e.target.value) })} className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <div className={autoCell + ' font-semibold text-gray-700'}>
                    {won(lineTotal(it))}
                    {it.discount_amount > 0 && (
                      <div className="text-[10px] text-red-500 font-normal">할인 -{won(it.discount_amount)}</div>
                    )}
                  </div>
                </td>
                <td className="py-1 px-1.5">
                  <input value={it.purchase_vendor_name} disabled={locked}
                    onChange={e => setItem(i, { purchase_vendor_name: e.target.value })}
                    title={it.purchase_vendor_name}
                    className="w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs disabled:opacity-60" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_price ? won(it.purchase_price) : ''} disabled={locked}
                    onChange={e => setItem(i, { purchase_price: toInt(e.target.value) })} className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5">
                  {/* 매입배송비 — 카톤단위/카톤외 택배비 중 선택 (실무자 요청) */}
                  <select value={shipMode(it)} disabled={locked}
                    onChange={e => {
                      const m = e.target.value
                      setItem(i, {
                        purchase_shipping: m === 'carton' ? it.carton_shipping_fee
                          : m === 'loose' ? it.loose_shipping_fee : 0,
                      })
                    }}
                    className="w-full border border-blue-200 bg-blue-50/40 rounded px-1 py-1 text-xs disabled:opacity-60">
                    <option value="none">없음</option>
                    <option value="carton" disabled={it.carton_shipping_fee <= 0}>
                      카톤단위{it.carton_shipping_fee > 0 ? ` ${won(it.carton_shipping_fee)}` : ''}
                    </option>
                    <option value="loose" disabled={it.loose_shipping_fee <= 0}>
                      카톤외{it.loose_shipping_fee > 0 ? ` ${won(it.loose_shipping_fee)}` : ''}
                    </option>
                    {shipMode(it) === 'custom' && <option value="custom">직접 {won(it.purchase_shipping)}</option>}
                  </select>
                </td>
                <td className="py-1 px-1.5 text-right">
                  {(() => {
                    const total = lineTotal(it)
                    const margin = total - it.purchase_price * it.quantity - it.purchase_shipping
                    const pct = total > 0 ? Math.round((margin / total) * 1000) / 10 : null
                    return (
                      <div className={`${autoCell} ${margin >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                        {won(margin)}
                        {/* 마진율(%) 표기 — 실무자 요청 */}
                        {pct !== null && <div className="text-[10px] font-normal">{pct}%</div>}
                      </div>
                    )
                  })()}
                </td>
                <td className="py-1 px-1 text-center">
                  {!locked && items.length > 1 && (
                    <button type="button" onClick={() => removeRow(it.uid)}
                      className="text-red-400 hover:text-red-600 text-sm"
                      title={it.parent_uid ? '옵션 행 삭제' : '행 삭제 (딸린 옵션도 함께 삭제)'}>✕</button>
                  )}
                </td>
              </tr>
              {/* 품목별 상태·기타사항 (509 — 상담정보에서 이동) */}
              <tr className={`border-b border-gray-50 ${it.parent_uid ? 'bg-slate-50/60' : ''}`}>
                <td colSpan={14} className="pb-1.5 pt-0 px-1.5">
                  <div className="flex items-center gap-2 pl-4 flex-wrap">
                    <span className="text-[10px] text-gray-400 shrink-0">상태</span>
                    <input value={it.status} disabled={locked}
                      onChange={e => setItem(i, { status: e.target.value })}
                      placeholder="품절·단가변경 등 (품절 상품 선택 시 자동)"
                      className={`w-56 border rounded px-1.5 py-0.5 text-[11px] disabled:opacity-60 ${
                        it.status ? 'border-red-200 bg-red-50/40 text-red-700' : 'border-gray-200 bg-gray-50'}`} />
                    {priceChanged(it) && (
                      <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800"
                        title="입력 판매가가 원가표 자동가와 다릅니다 — 저장 시 상태에 병기">단가변경</span>
                    )}
                    <span className="text-[10px] text-gray-400 shrink-0 ml-2">색상·옵션 등 기타</span>
                    <input value={it.option_note} disabled={locked}
                      onChange={e => setItem(i, { option_note: e.target.value })}
                      placeholder="색상, 각인 문구 등"
                      className="flex-1 min-w-48 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5 text-[11px] disabled:opacity-60" />
                  </div>
                </td>
              </tr>
              {addonCands.length > 0 && (
                <tr className="border-b border-gray-50">
                  <td colSpan={14} className="pb-1.5 pt-0 px-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap pl-4">
                      <span className="text-[10px] text-gray-400">옵션 추가 ({it.purchase_vendor_name})</span>
                      {addonCands.map(p => (
                        <button key={p.id} type="button" onClick={() => addAddon(i, p)}
                          className="px-2 py-0.5 border border-violet-200 bg-violet-50/60 text-violet-700 rounded-full text-[11px] hover:bg-violet-100">
                          + {p.item_name}{p.sale_price > 0 ? ` (${won(p.sale_price)})` : ''}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
              )
            })}
          </tbody>
        </table>
        {!locked && (
          <button type="button" onClick={() => setItems(prev => [...prev, emptyItem(nextUid())])}
            className="mt-2 px-3.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-gray-400">
            + 품목 행 추가
          </button>
        )}
        <div className="flex gap-5 text-sm mt-3 flex-wrap">
          <span>예상 합계 <b className="tabular-nums">{won(totals.total)}원</b></span>
          {totals.discount > 0 && (
            <span className="text-red-600">할인 합계 <b className="tabular-nums">-{won(totals.discount)}원</b></span>
          )}
          <span>예상 마진 <b className="tabular-nums text-emerald-700">{won(totals.margin)}원</b>
            {totals.total > 0 && (
              <span className="text-xs text-emerald-700 ml-1">({Math.round((totals.margin / totals.total) * 1000) / 10}%)</span>
            )}
          </span>
        </div>
      </div>

      {/* 결제·발송 정보 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="text-sm font-bold text-gray-900 mb-3">
          결제·발송 정보 <span className="text-[11px] font-normal text-gray-400 ml-1">발주서·배송 관리(3단계)로 흘러감</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
          <div className="col-span-2">
            <label className={label}>결제정보 <span className="text-blue-600">(암호화 저장)</span></label>
            {paymentMasked && !payment && (
              <div className="text-xs text-gray-500 mb-1 tabular-nums">
                저장됨: {paymentRevealed ?? paymentMasked}
                {!paymentRevealed && (
                  <button type="button" onClick={revealPayment} className="ml-1.5 text-blue-600 hover:underline">[열람]</button>
                )}
              </div>
            )}
            <input value={payment} disabled={locked} onChange={e => setPayment(e.target.value)}
              placeholder={paymentMasked ? '새 값 입력 시 교체 (비우면 유지)' : '카드번호 등 — 평문 입력, 암호화 저장'}
              className={free} />
          </div>
          <div>
            <label className={label}>보내는분 명의</label>
            <input value={senderName} disabled={locked} onChange={e => setSenderName(e.target.value)} className={free} />
          </div>
          <div>
            <label className={label}>배송요청일</label>
            <input value={deliveryRequest} disabled={locked} onChange={e => setDeliveryRequest(e.target.value)} className={free} placeholder="예: 9/16" />
          </div>
          <div>
            <label className={label}>인사장·명함</label>
            <input value={greetingCard} disabled={locked} onChange={e => setGreetingCard(e.target.value)} className={free} />
          </div>
          <div>
            <label className={label}>주소확인여부</label>
            <input value={addressChecked} disabled={locked} onChange={e => setAddressChecked(e.target.value)} className={free} />
          </div>
          <div>
            <label className={label}>고객명단수단</label>
            <input value={rosterMethod} disabled={locked} onChange={e => setRosterMethod(e.target.value)} className={free} placeholder="엑셀/문자 등" />
          </div>
          {/* 계산서 발행용 정보 (509 — 실무자 요청) */}
          <div className="col-span-2">
            <label className={label}>계산서 이메일</label>
            <input value={invoiceEmail} disabled={locked} onChange={e => setInvoiceEmail(e.target.value)} className={free} placeholder="세금계산서 수신" />
          </div>
          <div>
            <label className={label}>팩스</label>
            <input value={fax} disabled={locked} onChange={e => setFax(e.target.value)} className={free} placeholder="02-" />
          </div>
          <div>
            <label className={label}>사업자등록번호</label>
            <input value={bizNumber} disabled={locked} onChange={e => setBizNumber(e.target.value)} className={free} placeholder="000-00-00000" />
          </div>
          <div>
            <label className={label}>대표자명</label>
            <input value={ceoName} disabled={locked} onChange={e => setCeoName(e.target.value)} className={free} />
          </div>
          <div className="col-span-2 md:col-span-5">
            <label className={label}>메모 (감사 문구 등)</label>
            <textarea value={memo} rows={2} disabled={locked} onChange={e => setMemo(e.target.value)}
              className="w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm resize-y disabled:opacity-60" />
          </div>
        </div>

        <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <span className="text-[11px] text-gray-400">
            {contactId
              ? '저장 시 영업일지에 상담 활동이 자동 기재됩니다'
              : '담당자를 마스터에서 선택하면 영업일지에 자동 기재됩니다'}
          </span>
          {!locked && (
            <span className="flex gap-2">
              <button disabled={saving} onClick={() => save(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">저장</button>
              <button disabled={saving} onClick={() => save(true)}
                className="px-5 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? '저장 중...' : '저장 후 주문서로 전환'}
              </button>
            </span>
          )}
          {locked && (
            <span className="flex gap-2">
              <button onClick={() => router.push(`/orders/new?consult=${consultId}`)}
                className="px-4 py-2 border border-blue-200 text-blue-700 rounded-lg text-sm">주문서로 추가 전환 (분할 주문)</button>
              <button onClick={() => router.push('/orders/consultations')}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600">목록으로</button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
