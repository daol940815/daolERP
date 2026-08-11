'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Combo, autoGrow, branchLabel, cartonShipping, draftFromProduct, emptyItem, lineTotal,
  priceRule, toInt, won,
} from './form-shared'
import type { ContactOpt, Employee, ItemDraft, Product, Vendor, VendorGroup } from './form-shared'

// 주문 입력 폼 (신규·수정 공용) — 시안 "입력은 기존을 닮게" 기준
// 필드 구성·순서는 기존 ERP 업로드 컬럼 순서. 오타의 원천(자유 입력)만
// 마스터 선택으로 바꾼다: 주문처=vendors, 담당자=contacts, 상담자=employees,
// 품번=erp_products. 공용 부품(콤보·가격 규칙)은 form-shared.tsx.
// consultId가 오면 상담일지 내용으로 미리 채워 전환 모드로 동작한다.

export default function OrderForm({ orderId, consultId }: { orderId?: string; consultId?: string }) {
  const router = useRouter()
  const isEdit = !!orderId

  // 마스터
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [meName, setMeName] = useState('')
  const [contacts, setContacts] = useState<ContactOpt[]>([])

  // 폼 상태 (기존 컬럼 순서)
  const [orderDate, setOrderDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [orderNo, setOrderNo] = useState<string | null>(null)
  const [groupId, setGroupId] = useState<string | null>(null)   // 업체 (vendor_groups)
  const [vendorId, setVendorId] = useState<string | null>(null) // 지점(부서) = vendors
  const [contactId, setContactId] = useState<string | null>(null)
  const [counselorId, setCounselorId] = useState<string | null>(null)
  const [contactTel, setContactTel] = useState('')
  const [phone, setPhone] = useState('')
  const [memo, setMemo] = useState('')
  const uidRef = useRef(2)
  const nextUid = () => uidRef.current++
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem(1)])

  // 수정 모드 정보
  const [canEdit, setCanEdit] = useState(true)
  const [needsRequest, setNeedsRequest] = useState(false)
  const [reason, setReason] = useState('')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 신규 담당자 인라인 등록
  const [addingContact, setAddingContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', title: '', phone: '' })

  // 상담일지 전환 모드 정보
  const [consultInfo, setConsultInfo] = useState<{ label: string; needMaster: boolean } | null>(null)

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
        setEmployees(m.employees ?? [])
        setMeName(m.me?.name ?? '')
        const p = await pRes.json()
        if (pRes.ok) setProducts((p.products ?? []).filter((x: Product) => x.is_active))

        if (orderId) {
          const oRes = await fetch(`/api/orders-portal/orders/${orderId}`)
          const o = await oRes.json()
          if (!oRes.ok) throw new Error(o.error ?? '주문 조회 실패')
          const ord = o.order
          setOrderDate(ord.order_date)
          setOrderNo(ord.order_no)
          setVendorId(ord.vendor_id)
          setGroupId(((m.vendors ?? []) as Vendor[]).find(v => v.id === ord.vendor_id)?.group_id ?? null)
          setContactId(ord.contact_id)
          setCounselorId(ord.counselor_employee_id)
          setContactTel(ord.contact ?? '')
          setPhone(ord.phone ?? '')
          setMemo(ord.memo ?? '')
          setCanEdit(o.can_edit)
          setNeedsRequest(o.needs_request)
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          // line_no → uid 매핑으로 옵션 연결 복원 (품목은 line_no 순으로 로드됨)
          const lineToUid = new Map<number, number>(
            (o.items as Record<string, unknown>[]).map((it, idx) => [it.line_no as number, idx + 1]),
          )
          uidRef.current = (o.items as unknown[]).length + 1
          setItems((o.items as Record<string, unknown>[]).map((it, idx) => {
            const prod = prodList.find(x => x.id === it.product_id)
            return {
              uid: idx + 1,
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
              branch_sale_price: prod?.sale_price ?? 0,
              individual_sale_price: prod?.individual_sale_price ?? 0,
              branch_purchase_price: prod?.purchase_price ?? 0,
              carton_unit: prod?.carton_unit ?? 0,
              carton_shipping_fee: prod?.carton_shipping_fee ?? 0,
              loose_shipping_fee: prod?.loose_shipping_fee ?? 0,
            }
          }))
        } else if (consultId) {
          // 상담일지 → 주문 전환: 상담 내용으로 미리 채움
          const cRes = await fetch(`/api/orders-portal/consultations/${consultId}`)
          const c = await cRes.json()
          if (!cRes.ok) throw new Error(c.error ?? '상담일지 조회 실패')
          const consult = c.consult
          setVendorId(consult.vendor_id)
          setGroupId(consult.vendor_group_id
            ?? ((m.vendors ?? []) as Vendor[]).find(v => v.id === consult.vendor_id)?.group_id ?? null)
          setContactId(consult.contact_id)
          setCounselorId(consult.employee_id)   // 상담자 = 상담 작성자
          setPhone(consult.phone ?? '')
          setContactTel(consult.tel ?? '')
          setMemo(consult.memo ?? '')
          const label = [consult.bank_name, consult.branch_name, consult.manager_name].filter(Boolean).join(' ')
          setConsultInfo({
            label: `${consult.consult_date} 상담 (${consult.consult_type})${label ? ` — ${label}` : ''}`,
            needMaster: !consult.vendor_id || !consult.contact_id,
          })
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          const cItems = (c.items ?? []) as Record<string, unknown>[]
          if (cItems.length) {
            uidRef.current = cItems.length + 1
            setItems(cItems.map((it, idx) => {
              const prod = prodList.find(x => x.id === it.product_id)
              return {
                uid: idx + 1,
                parent_uid: null,
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
  }, [orderId, consultId])

  // 주문처 선택 → 담당자 목록
  const loadContacts = useCallback(async (vid: string) => {
    const res = await fetch(`/api/orders-portal/masters?vendor_id=${vid}`)
    const json = await res.json()
    setContacts(res.ok ? (json.contacts ?? []) : [])
  }, [])
  useEffect(() => {
    if (vendorId) loadContacts(vendorId)
    else setContacts([])
  }, [vendorId, loadContacts])

  const pickContact = (cid: string | null) => {
    setContactId(cid)
    const c = contacts.find(x => x.contact_id === cid)
    if (c?.phone) setPhone(c.phone)
  }

  const createContact = async () => {
    if (!vendorId || !newContact.name.trim()) return
    const res = await fetch('/api/orders-portal/masters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_contact', vendor_id: vendorId, ...newContact }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    await loadContacts(vendorId)
    setContactId(json.contact_id)
    if (newContact.phone) setPhone(newContact.phone)
    setAddingContact(false)
    setNewContact({ name: '', title: '', phone: '' })
  }

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))

  const pickProduct = (i: number, pid: string | null) => {
    const p = products.find(x => x.id === pid)
    if (!p) return
    const cur = items[i]
    if (!cur) return
    setItem(i, draftFromProduct(p, cur))
  }

  // 구분 변경 시 마스터 기준으로 판매가·매입가·배송비 재적용 (칸은 수정 가능 — 추천값)
  const setKind = (i: number, kind: string) => {
    const it = items[i]
    if (!it) return
    const next = { ...it, order_kind: kind }
    setItem(i, { order_kind: kind, ...(it.product_id ? priceRule(next, it.quantity) : {}) })
  }

  // 옵션(부가상품) 추가 — 같은 매입처의 부가상품을 본 상품 행 바로 아래에 붙인다
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

  // 갯수 변경 시 지점 구분 + 카톤단위가 있으면 배송비 재계산
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
    return { total, margin: total - cost }
  }, [items])

  const submit = async (andContinue?: boolean) => {
    setError(null); setNotice(null)
    const payload = {
      order_date: orderDate,
      vendor_id: vendorId,
      contact_id: contactId,
      counselor_employee_id: counselorId,
      contact: contactTel || null,
      phone: phone || null,
      memo: memo || null,
      items: (() => {
        const filled = items.filter(it => it.item_name.trim())
        const posByUid = new Map(filled.map((it, idx) => [it.uid, idx + 1]))
        return filled.map(it => ({
          ...it,
          parent_line_no: it.parent_uid ? (posByUid.get(it.parent_uid) ?? null) : null,
        }))
      })(),
    }
    if (!payload.vendor_id) { setError('주문처를 선택해주세요.'); return }
    if (!payload.contact_id) { setError('거래처 담당자를 선택해주세요. (없으면 "+ 신규 담당자"로 등록)'); return }
    if (!payload.counselor_employee_id) { setError('상담자를 선택해주세요.'); return }
    if (!payload.items.length) { setError('품목을 1개 이상 입력해주세요.'); return }

    setSaving(true)
    try {
      if (!isEdit) {
        const res = await fetch('/api/orders-portal/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(consultId ? { ...payload, consultation_id: consultId } : payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '저장 실패')
        if (andContinue) {
          setNotice(`주문 ${json.order_no} 저장 완료 — 이어서 입력하세요.`)
          setGroupId(null); setVendorId(null); setContactId(null); setContactTel(''); setPhone(''); setMemo('')
          setItems([emptyItem(nextUid())])
        } else {
          router.push(`/orders/${json.id}`)
        }
      } else if (canEdit) {
        const res = await fetch(`/api/orders-portal/orders/${orderId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '수정 실패')
        router.push(`/orders/${orderId}`)
      } else {
        if (!reason.trim()) throw new Error('수정 요청 사유를 입력해주세요.')
        const res = await fetch('/api/orders-portal/change-requests', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order_id: orderId, request_type: 'edit', reason, payload }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '요청 실패')
        setNotice('수정 요청이 접수되었습니다. 관리자 승인 후 반영됩니다.')
        setTimeout(() => router.push(`/orders/${orderId}`), 1200)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    }
    setSaving(false)
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>
  if (isEdit && !canEdit && !needsRequest) {
    return (
      <div className="px-4 py-3 bg-red-50 text-red-700 text-sm rounded-lg">
        이 주문은 수정할 수 없습니다. (업로드 주문이거나 권한이 없습니다)
      </div>
    )
  }

  const label = 'block text-[11px] text-gray-500 mb-0.5'
  const free = 'w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm'
  const auto = 'w-full border border-gray-200 bg-gray-50 rounded-lg px-2.5 py-1.5 text-sm text-gray-500'
  // 금액 칸은 colgroup으로 전부 동일 폭 — 칸 안 요소는 폭을 채운다
  const numCell = 'w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs text-right tabular-nums'
  const autoCell = 'w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs text-right tabular-nums text-gray-500'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">{isEdit ? (canEdit ? '주문 수정' : '주문 수정 요청') : '신규 주문'}</h1>
        {isEdit && orderNo && <span className="text-sm text-gray-400 tabular-nums">{orderNo}</span>}
        <span className="text-[11px] text-gray-400 ml-auto">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200 align-middle mr-1" />마스터 선택
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-50 border border-gray-200 align-middle ml-3 mr-1" />자동
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-200 align-middle ml-3 mr-1" />자유 입력
        </span>
      </div>

      {isEdit && !canEdit && needsRequest && (
        <div className="mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          입력 당일이 지난 주문입니다 — 저장하면 수정 요청으로 접수되고, 관리자 승인 후 반영됩니다.
        </div>
      )}
      {consultInfo && (
        <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
          상담일지에서 전환 중: {consultInfo.label}
          {consultInfo.needMaster && (
            <span className="block text-xs mt-0.5 text-blue-600">
              상담에 자유 입력된 주문처·담당자가 있습니다 — 마스터에서 선택(없으면 등록)해야 저장할 수 있습니다.
            </span>
          )}
        </div>
      )}
      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 주문 정보 — 기존 입력 순서 그대로 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="text-sm font-bold text-gray-900 mb-3">
          주문 정보 <span className="text-[11px] font-normal text-gray-400 ml-1">기존 입력 순서 그대로</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
          <div>
            <label className={label}>주문일 <em className="not-italic text-red-500">*</em></label>
            <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
              className="w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2 py-1.5 text-sm" />
          </div>
          <div className="col-span-2">
            <label className={label}>업체 (은행·그룹)</label>
            <Combo
              value={groupId}
              display={groups.find(g => g.id === groupId)?.name ?? ''}
              options={groups.map(g => ({ id: g.id, label: g.name }))}
              onSelect={id => {
                setGroupId(id)
                const branches = vendors.filter(v => v.group_id === id)
                // 소속 지점이 1곳이면 자동 선택, 여러 곳이면 지점 칸에서 선택
                setVendorId(branches.length === 1 ? branches[0].id : null)
                setContactId(null)
              }}
              placeholder="업체 검색 (지점에서 바로 검색도 가능)"
            />
            <div className="text-[10px] text-gray-400 mt-0.5">업체별 통계의 기준 — 단일 업체는 비워두고 지점만 선택</div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={label}>지점(부서) — 주문처 <em className="not-italic text-red-500">*</em></label>
            <Combo
              value={vendorId}
              display={(() => {
                const v = vendors.find(x => x.id === vendorId)
                if (!v) return ''
                return branchLabel(v.name, groups.find(g => g.id === v.group_id)?.name)
              })()}
              options={(groupId ? vendors.filter(v => v.group_id === groupId) : vendors)
                .map(v => {
                  const gName = groups.find(g => g.id === v.group_id)?.name
                  return { id: v.id, label: branchLabel(v.name, gName), sub: gName ?? '' }
                })}
              onSelect={id => {
                setVendorId(id)
                setGroupId(vendors.find(v => v.id === id)?.group_id ?? null)
                setContactId(null)
              }}
              placeholder={groupId ? '소속 지점 선택' : '거래처 마스터 검색 — 자유 입력 불가'}
              required
            />
          </div>
          <div className="col-span-2">
            <label className={label}>담당자(거래처) <em className="not-italic text-red-500">*</em></label>
            <Combo
              value={contactId}
              display={(() => {
                const c = contacts.find(x => x.contact_id === contactId)
                return c ? [c.name, c.title].filter(Boolean).join(' ') : ''
              })()}
              options={contacts.map(c => ({
                id: c.contact_id,
                label: [c.name, c.title].filter(Boolean).join(' '),
                sub: [c.is_representative ? '대표' : '', c.phone ?? ''].filter(Boolean).join(' · '),
              }))}
              onSelect={pickContact}
              placeholder={vendorId ? '담당자 선택' : '주문처를 먼저 선택'}
              required
              footer={vendorId && (
                <button type="button" onMouseDown={e => e.preventDefault()}
                  onClick={() => setAddingContact(true)}
                  className="w-full text-left px-3 py-1.5 text-blue-700 font-medium hover:bg-blue-50">
                  + 신규 담당자 등록
                </button>
              )}
            />
          </div>

          <div>
            <label className={label}>다올직원</label>
            <div className={auto}>{meName || '(로그인 계정)'}</div>
          </div>
          <div>
            <label className={label}>상담자 <em className="not-italic text-red-500">*</em></label>
            <Combo
              value={counselorId}
              display={employees.find(e => e.id === counselorId)?.name ?? ''}
              options={employees.map(e => ({
                id: e.id, label: e.name,
                sub: [e.team, e.position].filter(Boolean).join(' · '),
              }))}
              onSelect={setCounselorId}
              placeholder="직원 마스터 검색"
              required
            />
          </div>
          <div>
            <label className={label}>연락처</label>
            <input value={contactTel} onChange={e => setContactTel(e.target.value)} className={free} placeholder="02-" />
          </div>
          <div>
            <label className={label}>핸드폰</label>
            <input value={phone} onChange={e => setPhone(e.target.value)} className={free} placeholder="담당자 선택 시 자동" />
          </div>
          <div className="col-span-2">
            <label className={label}>메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} className={free} />
          </div>
        </div>

        {addingContact && (
          <div className="mt-3 p-3 bg-blue-50/50 border border-blue-200 rounded-lg flex items-end gap-2 flex-wrap">
            <div>
              <label className={label}>이름 *</label>
              <input value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-32" />
            </div>
            <div>
              <label className={label}>직함</label>
              <input value={newContact.title} onChange={e => setNewContact(p => ({ ...p, title: e.target.value }))}
                placeholder="지점장 등" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-28" />
            </div>
            <div>
              <label className={label}>휴대폰</label>
              <input value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))}
                placeholder="010-" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-36" />
            </div>
            <button type="button" onClick={createContact}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm">등록</button>
            <button type="button" onClick={() => setAddingContact(false)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
            <span className="text-[11px] text-gray-400">거래처 담당자 마스터에 즉시 등록됩니다</span>
          </div>
        )}
      </div>

      {/* 주문 상품 — 기존 컬럼 순서 그대로 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3 overflow-x-auto">
        <div className="text-sm font-bold text-gray-900 mb-3">
          주문 상품 <span className="text-[11px] font-normal text-gray-400 ml-1">품번·품명 검색 시 매입처·가격 자동</span>
        </div>
        <table className="w-full text-xs min-w-[1240px] table-fixed">
          {/* 그룹별 동일 폭: 금액 칸 6개는 같은 폭으로 세로 정렬을 맞춘다. 품명이 남는 폭 전부 차지 */}
          <colgroup>
            <col className="w-[8.5rem]" />{/* 검색 */}
            <col />{/* 품명 — 남는 폭 전부 */}
            <col className="w-16" />{/* 구분 */}
            <col className="w-28" />{/* 매입처 */}
            <col className="w-[5.75rem]" />{/* 판매가 */}
            <col className="w-14" />{/* 갯수 */}
            <col className="w-[5.75rem]" />{/* 배송비 */}
            <col className="w-[5.75rem]" />{/* 할인 */}
            <col className="w-[5.75rem]" />{/* 합계 */}
            <col className="w-[5.75rem]" />{/* 매입가 */}
            <col className="w-[5.75rem]" />{/* 매입배송비 */}
            <col className="w-24" />{/* 메모 */}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-1.5 px-1.5 text-left font-medium">품번 · 품명 검색</th>
              <th className="py-1.5 px-1.5 text-left font-medium">품명</th>
              <th className="py-1.5 px-1.5 text-left font-medium">구분</th>
              <th className="py-1.5 px-1.5 text-left font-medium">매입처</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매가</th>
              <th className="py-1.5 px-1.5 text-right font-medium">갯수</th>
              <th className="py-1.5 px-1.5 text-right font-medium">배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium">할인금액</th>
              <th className="py-1.5 px-1.5 text-right font-medium">합계금액</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입가</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입배송비</th>
              <th className="py-1.5 px-1.5 text-left font-medium">메모</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              // 옵션 추가 후보: 같은 매입처의 부가상품 (본 상품 행에만 노출)
              const addonCands = !it.parent_uid && it.purchase_vendor_name
                ? products.filter(p => p.is_addon && p.purchase_vendor_name === it.purchase_vendor_name)
                : []
              return (
              <Fragment key={it.uid}>
              <tr className={`border-b border-gray-50 align-top ${it.parent_uid ? 'bg-slate-50/60' : ''}`}>
                <td className="py-1 px-1.5">
                  <div className="flex items-center gap-1">
                    {it.parent_uid != null && <span className="text-gray-400 text-xs shrink-0" title="옵션 (부가상품)">└</span>}
                    <div className="flex-1">
                      <Combo
                        value={it.product_id}
                        display={it.item_code || (it.product_id ? it.item_name : '')}
                        options={products.map(p => ({
                          id: p.id,
                          label: [p.item_code, p.item_name].filter(Boolean).join(' · '),
                          sub: [p.category, p.purchase_vendor_name].filter(Boolean).join(' · '),
                        }))}
                        onSelect={id => pickProduct(i, id)}
                        placeholder="품번·품명 검색"
                      />
                    </div>
                  </div>
                </td>
                <td className="py-1 px-1.5">
                  {/* key에 product_id 포함 — 품번 선택으로 품명이 바뀌면 리마운트되어 높이 재계산 */}
                  <textarea key={`${it.uid}:${it.product_id ?? ''}`} value={it.item_name} rows={1} ref={autoGrow}
                    onChange={e => { setItem(i, { item_name: e.target.value, product_id: null }); autoGrow(e.target) }}
                    placeholder="마스터에 없으면 직접 입력"
                    className="w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs
                               resize-none overflow-hidden leading-relaxed block" />
                </td>
                <td className="py-1 px-1.5">
                  <select value={it.order_kind} onChange={e => setKind(i, e.target.value)}
                    title="지점: 지점판매가+카톤 배송비 자동 / 개별: 개별판매가(배송비 포함) / 샘플: 판매가·배송비 0, 매입가만 발생"
                    className="border border-blue-200 bg-blue-50/40 rounded px-1 py-1 text-xs">
                    <option>지점</option><option>개별</option><option>샘플</option>
                  </select>
                </td>
                <td className="py-1 px-1.5">
                  <input value={it.purchase_vendor_name} onChange={e => setItem(i, { purchase_vendor_name: e.target.value })}
                    placeholder="품번 선택 시 자동" title={it.purchase_vendor_name}
                    className="w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.sale_price ? won(it.sale_price) : ''} onChange={e => setItem(i, { sale_price: toInt(e.target.value) })}
                    className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.quantity || ''} onChange={e => setQuantity(i, toInt(e.target.value))}
                    className="w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs text-right tabular-nums" placeholder="1" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.shipping_fee ? won(it.shipping_fee) : ''} onChange={e => setItem(i, { shipping_fee: toInt(e.target.value) })}
                    className={numCell} placeholder="0"
                    title={it.carton_unit > 0
                      ? `자동: 꽉 찬 카톤 × ${won(it.carton_shipping_fee)} + 낱개 있으면 카톤외 ${won(it.loose_shipping_fee)} (카톤단위 ${it.carton_unit}) — 수정 가능`
                      : undefined} />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.discount_amount ? won(it.discount_amount) : ''} onChange={e => setItem(i, { discount_amount: toInt(e.target.value) })}
                    className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <div className={autoCell + ' font-semibold text-gray-700'}>{won(lineTotal(it))}</div>
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_price ? won(it.purchase_price) : ''} onChange={e => setItem(i, { purchase_price: toInt(e.target.value) })}
                    className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_shipping ? won(it.purchase_shipping) : ''} onChange={e => setItem(i, { purchase_shipping: toInt(e.target.value) })}
                    className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5">
                  <input value={it.memo} onChange={e => setItem(i, { memo: e.target.value })} title={it.memo}
                    className="w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs" />
                </td>
                <td className="py-1 px-1 text-center">
                  {items.length > 1 && (
                    <button type="button" onClick={() => removeRow(it.uid)}
                      className="text-red-400 hover:text-red-600 text-sm"
                      title={it.parent_uid ? '옵션 행 삭제' : '행 삭제 (딸린 옵션도 함께 삭제)'}>✕</button>
                  )}
                </td>
              </tr>
              {addonCands.length > 0 && (
                <tr className="border-b border-gray-50">
                  <td colSpan={13} className="pb-1.5 pt-0 px-1.5">
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
        <button type="button" onClick={() => setItems(prev => [...prev, emptyItem(nextUid())])}
          className="mt-2 px-3.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-gray-400">
          + 상품 행 추가
        </button>

        <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <div className="flex gap-5 text-sm">
            <span>총금액 <b className="tabular-nums">{won(totals.total)}원</b>
              <span className="text-[11px] text-gray-400 ml-1">자동 합산</span></span>
            <span>예상 마진 <b className="tabular-nums text-emerald-700">{won(totals.margin)}원</b></span>
          </div>
          <div className="flex gap-2">
            {!isEdit && (
              <button type="button" disabled={saving} onClick={() => submit(true)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">
                저장 후 계속 입력
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => submit(false)}
              className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? '저장 중...' : isEdit ? (canEdit ? '수정 저장' : '수정 요청 제출') : '주문 저장'}
            </button>
          </div>
        </div>

        {isEdit && !canEdit && needsRequest && (
          <div className="mt-3">
            <label className={label}>수정 요청 사유 <em className="not-italic text-red-500">*</em></label>
            <input value={reason} onChange={e => setReason(e.target.value)}
              placeholder="예: 지점 요청으로 수량 변경"
              className="w-full max-w-xl border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
        )}
      </div>
    </div>
  )
}
