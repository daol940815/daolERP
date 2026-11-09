'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import ShipCard, { EMPTY_SHIP } from './ship-card'
import { hasShip, needsShip, SHIP_KINDS, type ShipInput } from '@/lib/ship-address'
import RosterCard from './roster-card'
import { normTel } from '@/lib/contact-phone-sync'
import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import {
  Combo, DiscountInput, SeasonDatalist, SeasonInput, autoGrow, branchLabel, cartonShipping, draftExtrasFromRow, draftFromProduct,
  emptyItem, lineCost, lineTotal, priceRule, purchaseShippingHint, quantityPatch, toInt, won,
} from './form-shared'
import { normalizeSeason, seasonOptions, suggestSeason } from '@/lib/order-season'
import type { ContactOpt, Employee, IndividualCustomerOpt, ItemDraft, Product, Vendor, VendorGroup } from './form-shared'
import { isMoimVendor } from './form-shared'
import IndividualRegister from './individual-register'
import { contactLabel } from '@/lib/contact-label'

// 주문 입력 폼 (신규·수정·재등록 공용) — 시안 "입력은 기존을 닮게" 기준
// 필드 구성·순서는 기존 ERP 업로드 컬럼 순서. 오타의 원천(자유 입력)만
// 마스터 선택으로 바꾼다: 주문처=vendors, 담당자=contacts, 상담자=employees,
// 품번=erp_products. 공용 부품(콤보·가격 규칙)은 form-shared.tsx.
// consultId가 오면 상담일지 내용으로 미리 채워 전환 모드로 동작한다.
// reissueId가 오면 취소·재등록 모드: 원본 내용 프리필(주문일 포함 — 수정 가능),
// 저장 시 원본이 취소 처리되고 새 주문번호로 등록된다 (2026-08-25 확정).

export default function OrderForm({ orderId, consultId, reissueId }: {
  orderId?: string; consultId?: string; reissueId?: string
}) {
  const router = useRouter()
  const isEdit = !!orderId

  // 마스터
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [meName, setMeName] = useState('')
  const [isParttime, setIsParttime] = useState(false)   // 아르바이트 — 신규 담당자 인라인 등록 숨김 ((b) 정책)
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
  const [ship, setShip] = useState<ShipInput>(EMPTY_SHIP)   // 배송지 (513)
  const [shipFromConsult, setShipFromConsult] = useState(false)   // 상담 배송지 승계 시 자동 채움 끔 (706)
  const [prepayBalance, setPrepayBalance] = useState(0)      // 주문처 선결제 잔액 안내 (514)
  const uidRef = useRef(2)
  const nextUid = () => uidRef.current++
  const [items, setItems] = useState<ItemDraft[]>(() => [emptyItem(1)])

  // 수정 모드 정보 (당일 직접 수정만 — 익일 이후는 취소·재등록)
  const [canEdit, setCanEdit] = useState(true)
  // 재등록 모드: 원본 주문번호 (배너 표시용)
  const [reissueFromNo, setReissueFromNo] = useState<string | null>(null)

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // 신규 담당자 인라인 등록
  const [addingContact, setAddingContact] = useState(false)
  const [newContact, setNewContact] = useState({ name: '', title: '', phone: '', staff_employee_id: '' })
  // 상담자 = 고객(지점 × 담당자)의 다올 담당 (112, 2026-11-05). 신규 · 상담 전환은 고객이 정해지면 자동,
  // 직원이 상담자를 직접 고르면 그 뒤로는 덮어쓰지 않는다
  const autoCounselor = useRef(!orderId && !reissueId)

  // 신규 매출처 인라인 등록 (2026-08-25 확정) — vendors 마스터 단일 원천에 등록
  const [addingVendor, setAddingVendor] = useState(false)
  const [newVendor, setNewVendor] = useState({ group_name: '', branch_name: '' })
  // 상담 전환: 자유 입력 담당자명 — 담당자 목록 로드 후 자동 매칭/프리필
  const [pendingManager, setPendingManager] = useState<string | null>(null)
  const [contactsLoadedFor, setContactsLoadedFor] = useState<string | null>(null)

  // 개인 고객(115): 업체가 '개인'이면 지점 없이 고객을 고른다 — 고객마다 전용 매출처
  const [indCustomers, setIndCustomers] = useState<IndividualCustomerOpt[]>([])
  const [addingIndividual, setAddingIndividual] = useState<{ name?: string; title?: string } | null>(null)

  // 상담일지 전환 모드 정보
  const [consultInfo, setConsultInfo] = useState<{ label: string; needMaster: boolean } | null>(null)
  const [usedSeasons, setUsedSeasons] = useState<string[]>([])   // 주문시기(708) 드롭다운 — 이미 쓴 값

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
        setUsedSeasons(m.seasons ?? [])
        setGroups(m.groups ?? [])
        setEmployees(m.employees ?? [])
        setMeName(m.me?.name ?? '')
        setIsParttime(m.me?.is_parttime === true)
        const p = await pRes.json()
        if (pRes.ok) setProducts((p.products ?? []).filter((x: Product) => x.is_active))

        if (orderId || reissueId) {
          const srcId = orderId ?? reissueId
          const oRes = await fetch(`/api/orders-portal/orders/${srcId}`)
          const o = await oRes.json()
          if (!oRes.ok) throw new Error(o.error ?? '주문 조회 실패')
          const ord = o.order
          if (reissueId) {
            // 취소·재등록: 원본 내용 프리필. 주문일도 원본값 프리필 (집계 보전 기본,
            // 오기입 정정 시 화면에서 수정) — 저장 시 원본 취소+링크는 서버가 처리.
            if (ord.source !== 'direct') throw new Error('업로드 주문은 취소·재등록할 수 없습니다.')
            if (ord.canceled_at) throw new Error('이미 취소된 주문입니다. 재등록 주문에서 진행해주세요.')
            setReissueFromNo(ord.order_no ?? srcId)
          } else {
            setOrderNo(ord.order_no)
            setCanEdit(o.can_edit)
          }
          setOrderDate(ord.order_date)
          setVendorId(ord.vendor_id)
          setGroupId(((m.vendors ?? []) as Vendor[]).find(v => v.id === ord.vendor_id)?.group_id ?? null)
          setContactId(ord.contact_id)
          setCounselorId(ord.counselor_employee_id)
          setContactTel(ord.contact ?? '')
          setPhone(ord.phone ?? '')
          setMemo(ord.memo ?? '')
          setShip({
            ship_name: ord.ship_name ?? null, ship_phone: ord.ship_phone ?? null, ship_zip: ord.ship_zip ?? null,
            ship_addr1: ord.ship_addr1 ?? null, ship_addr2: ord.ship_addr2 ?? null,
          })
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          // 취소 처리된 품목 행(511)은 폼에 올리지 않는다 — 다시 살아나는 것을 방지
          const activeItems = (o.items as Record<string, unknown>[]).filter(it => !it.is_canceled)
          // line_no → uid 매핑으로 옵션 연결 복원 (품목은 line_no 순으로 로드됨)
          const lineToUid = new Map<number, number>(
            activeItems.map((it, idx) => [it.line_no as number, idx + 1]),
          )
          uidRef.current = activeItems.length + 1
          setItems(activeItems.map((it, idx) => {
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
              discount_mode: ((it.discount_mode as string) === '단가' ? '단가' : '정액') as '정액' | '단가',
              discount_unit: (it.discount_unit as number) ?? 0,
              purchase_price: (it.purchase_price as number) ?? 0,
              purchase_shipping: (it.purchase_shipping as number) ?? 0,
              ...draftExtrasFromRow(it),   // 매입할인 · 주문시기 (708)
              memo: (it.memo as string) ?? '',
              status: '', option_note: '',   // 상담일지 전용 필드 — 주문 폼에서는 미사용
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
          // 상담에 자유 입력된 업체·지점: 마스터에 같은 이름이 있으면 자동 선택,
          // 없으면 신규 매출처 폼에 미리 채워 한 번에 등록되게 한다 (2026-08-25 확정)
          if (!consult.vendor_id && (consult.bank_name || consult.branch_name)) {
            const bank = String(consult.bank_name ?? '').trim()
            const branch = String(consult.branch_name ?? '').trim()
            const full = [bank, branch].filter(Boolean).join(' ')
            const vlist = (m.vendors ?? []) as Vendor[]
            const matched = vlist.find(v => v.name === full)
              ?? (branch && branch !== full ? vlist.find(v => v.name === branch) : undefined)
            if (matched) {
              setVendorId(matched.id)
              setGroupId(matched.group_id ?? null)
            } else {
              setNewVendor({ group_name: bank || branch, branch_name: bank ? branch : '' })
              setAddingVendor(true)
            }
          }
          // 자유 입력 담당자: 담당자 목록 로드 후 자동 매칭/신규 등록 프리필
          if (!consult.contact_id && consult.manager_name) {
            setPendingManager(String(consult.manager_name))
          }
          // 상담자 = 고객의 다올 담당 — 담당자 목록이 로드되면 아래 effect가 채운다 (상담 작성자 아님, 2026-11-05 사용자 확정)
          setPhone(consult.phone ?? '')
          setContactTel(consult.tel ?? '')
          setMemo(consult.memo ?? '')
          // 배송지 (706): 상담에 입력한 배송지가 주문처 최근 배송지보다 우선 (사용자 확정 2026-11-06)
          if (hasShip(consult)) {
            setShip({
              ship_name: consult.ship_name ?? null, ship_phone: consult.ship_phone ?? null, ship_zip: consult.ship_zip ?? null,
              ship_addr1: consult.ship_addr1 ?? null, ship_addr2: consult.ship_addr2 ?? null,
            })
            setShipFromConsult(true)
          }
          const label = [consult.bank_name, consult.branch_name, consult.manager_name].filter(Boolean).join(' ')
          setConsultInfo({
            label: `${consult.consult_date} 상담 (${consult.consult_type})${label ? ` — ${label}` : ''}`,
            needMaster: !consult.vendor_id || !consult.contact_id,
          })
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          const cItems = (c.items ?? []) as Record<string, unknown>[]
          if (cItems.length) {
            // 상담 품목의 옵션 연결(parent_line_no)도 전환 시 그대로 복원 (701)
            // 배송비 처리 (703 확정): 배송비 "품목"(product_id 있음, 판매 0·매입만)은
            // 일반 품목 행으로 그대로 넘긴다. 702의 이름 고정 의사 행(품목 미연결)만
            // 과거 호환으로 본 상품의 배송비 컬럼에 합산해 접는다.
            const isLegacyShip = (s: Record<string, unknown>) => s.is_shipping === true && !s.product_id
            const shipByParent = new Map<number, number>()   // 키 -1 = 부모 미상 (첫 품목에 합산 — 유실 방지)
            for (const s of cItems) {
              if (isLegacyShip(s)) {
                const fee = ((s.sale_price as number) ?? 0) * ((s.quantity as number) ?? 1)
                const key = (s.parent_line_no as number) || -1
                shipByParent.set(key, (shipByParent.get(key) ?? 0) + fee)
              }
            }
            const realItems = cItems.filter(s => !isLegacyShip(s))
            const realLineToUid = new Map<number, number>(realItems.map((s, idx) => [s.line_no as number, idx + 1]))
            uidRef.current = realItems.length + 1
            setItems(realItems.map((it, idx) => {
              const prod = prodList.find(x => x.id === it.product_id)
              return {
                uid: idx + 1,
                parent_uid: it.parent_line_no ? (realLineToUid.get(it.parent_line_no as number) ?? null) : null,
                product_id: (it.product_id as string) ?? null,
                item_code: (it.item_code as string) ?? '',
                item_name: (it.item_name as string) ?? '',
                order_kind: (it.order_kind as string) ?? '지점',
                purchase_vendor_name: (it.purchase_vendor_name as string) ?? '',
                sale_price: (it.sale_price as number) ?? 0,
                quantity: (it.quantity as number) ?? 1,
                shipping_fee: ((it.shipping_fee as number) ?? 0)
                  + (shipByParent.get(it.line_no as number) ?? 0)
                  + (idx === 0 ? (shipByParent.get(-1) ?? 0) : 0),
                discount_amount: (it.discount_amount as number) ?? 0,
                discount_mode: ((it.discount_mode as string) === '단가' ? '단가' : '정액') as '정액' | '단가',
                discount_unit: (it.discount_unit as number) ?? 0,
                purchase_price: (it.purchase_price as number) ?? 0,
                purchase_shipping: (it.purchase_shipping as number) ?? 0,
                ...draftExtrasFromRow(it),   // 매입할인 · 주문시기 — 상담 값 그대로 (708)
                // 상담 품목의 상태·기타사항은 주문 품목 메모로 병합 (전환 시 유실 방지)
                memo: [
                  (it.memo as string) ?? '',
                  (it.status as string) ? `상태 ${it.status}` : '',
                  (it.option_note as string) ?? '',
                ].filter(Boolean).join(' · '),
                status: '', option_note: '',
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
  }, [orderId, consultId, reissueId])

  // 개인 고객 모드 판정 — 모임(심통회 등)을 고르면 일반 지점과 같다
  const selGroup = groups.find(g => g.id === groupId)
  const indMode = !!selGroup?.is_individual
  const selVendor = vendors.find(v => v.id === vendorId)
  const moimSelected = indMode && !!selVendor && isMoimVendor(selVendor, selGroup?.name)
  const indPick = indMode && !moimSelected
  const loadIndCustomers = useCallback(async (gid: string) => {
    const res = await fetch(`/api/orders-portal/masters?individual_group=${gid}`)
    const json = await res.json().catch(() => ({}))
    setIndCustomers(res.ok ? (json.customers ?? []) : [])
  }, [])
  useEffect(() => {
    if (indMode && groupId) loadIndCustomers(groupId)
    else setIndCustomers([])
  }, [indMode, groupId, loadIndCustomers])
  const pickIndividual = (c: IndividualCustomerOpt) => {
    setVendorId(c.vendor_id)
    setContactId(c.contact_id)
    if (c.phone) setPhone(c.phone)
    autoCounselor.current = true
    setCounselorId(c.staff_employee_id ?? null)
    setAddingIndividual(null)
  }

  // 주문처 선택 → 담당자 목록 + 계산서 발행처(청구처, 114)
  const [billingTo, setBillingTo] = useState<{ name: string; biz_number: string | null } | null>(null)
  const loadContacts = useCallback(async (vid: string) => {
    const res = await fetch(`/api/orders-portal/masters?vendor_id=${vid}`)
    const json = await res.json()
    setContacts(res.ok ? (json.contacts ?? []) : [])
    setBillingTo(res.ok ? (json.billing ?? null) : null)
    setContactsLoadedFor(vid)
  }, [])
  useEffect(() => {
    if (vendorId) loadContacts(vendorId)
    else { setContacts([]); setContactsLoadedFor(null); setBillingTo(null) }
  }, [vendorId, loadContacts])

  // 주문처 선결제 잔액 — 안내만. 사용은 저장 후 주문 상세 › 결제 내역에서 (2026-11-05 확정)
  useEffect(() => {
    setPrepayBalance(0)
    if (!vendorId) return
    let alive = true
    fetch(`/api/orders-portal/prepay-balance?vendor_id=${vendorId}`)
      .then(r => r.ok ? r.json() : null)
      .then(j => { if (alive && j) setPrepayBalance(Number(j.balance ?? 0)) })
      .catch(() => {})
    return () => { alive = false }
  }, [vendorId])

  // 상담 전환의 자유 입력 담당자명 처리 — 목록 로드가 끝난 뒤에만 판정한다.
  // "권오병 부장님" → 이름 권오병·직함 부장 (인물 마스터는 순수 이름만 저장)
  useEffect(() => {
    if (!pendingManager) return
    const stripped = pendingManager.trim().replace(/님$/, '').trim()
    const parts = stripped.split(/\s+/)
    const name = parts.length >= 2 ? parts.slice(0, -1).join(' ') : stripped
    const title = parts.length >= 2 ? parts[parts.length - 1] : ''
    // 개인 고객: 같은 이름의 개인 고객이 하나면 선택, 아니면 신규 개인 고객 등록 프리필
    if (indPick && groupId) {
      const same = indCustomers.filter(c => c.name === name)
      if (same.length === 1) pickIndividual(same[0])
      else setAddingIndividual({ name, title })
      setPendingManager(null)
      return
    }
    if (!vendorId || contactsLoadedFor !== vendorId) return
    const found = contacts.find(c => c.name === name)
    if (found) {
      setContactId(found.contact_id)
      if (found.phone) setPhone(found.phone)
    } else {
      setNewContact({ name, title, phone: '', staff_employee_id: '' })
      setAddingContact(true)
    }
    setPendingManager(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingManager, vendorId, contactsLoadedFor, contacts, indPick, indCustomers])

  // 고객이 정해지면 그 고객의 다올 담당을 상담자로 (자동 모드일 때만 — 비어 있으면 상담자도 비움)
  useEffect(() => {
    if (!autoCounselor.current || !contactId || contactsLoadedFor !== vendorId) return
    const c = contacts.find(x => x.contact_id === contactId)
    if (c) setCounselorId(c.staff_employee_id ?? null)
  }, [contactId, contacts, contactsLoadedFor, vendorId])

  const pickContact = (cid: string | null) => {
    setContactId(cid)
    const c = contacts.find(x => x.contact_id === cid)
    if (c?.phone) setPhone(c.phone)
    if (c?.tel) setContactTel(c.tel)          // 유선도 마스터에서 (116)
    // 직원이 고객을 다시 고르면 그 고객의 다올 담당으로 상담자를 맞춘다 (수정 · 재등록 포함)
    autoCounselor.current = true
    setCounselorId(c?.staff_employee_id ?? null)
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
    setCounselorId(newContact.staff_employee_id || null)   // 새 고객의 다올 담당 = 상담자
    setAddingContact(false)
    setNewContact({ name: '', title: '', phone: '', staff_employee_id: '' })
  }

  // 신규 매출처 등록 — 같은 이름이 이미 있으면 만들지 않고 그걸 선택 (서버 판정)
  const createVendor = async () => {
    if (!newVendor.group_name.trim()) { setError('업체명을 입력해주세요.'); return }
    setError(null)
    const res = await fetch('/api/orders-portal/masters', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create_vendor', ...newVendor }),
    })
    const json = await res.json()
    if (!res.ok) { setError(json.error); return }
    // 마스터 목록 갱신 후 방금 등록한 매출처 선택
    const mRes = await fetch('/api/orders-portal/masters')
    const m = await mRes.json()
    if (mRes.ok) { setVendors(m.vendors ?? []); setGroups(m.groups ?? []) }
    setGroupId(json.group_id ?? null)
    setVendorId(json.vendor_id)
    setContactId(null)
    setAddingVendor(false)
    setNewVendor({ group_name: '', branch_name: '' })
    setNotice(json.existed
      ? '같은 이름의 매출처가 이미 있어 선택했습니다.'
      : '매출처가 등록되었습니다 — 담당자를 선택하거나 신규 등록해주세요.')
  }

  const setItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, ...patch } : it))

  const pickProduct = (i: number, pid: string | null) => {
    const p = products.find(x => x.id === pid)
    if (!p) return
    const cur = items[i]
    if (!cur) return
    setItem(i, { ...draftFromProduct(p, cur), order_season: seasonFor(i) })
  }
  // 주문시기 기본값 (708): 이미 적혀 있으면 유지 → 윗 행 값 → 주문일 기준 제안 (확정은 입력자)
  const seasonFor = (i: number) =>
    items[i]?.order_season || items.slice(0, i).reverse().find(x => x.order_season)?.order_season || suggestSeason(orderDate)

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
      const base: ItemDraft = { ...emptyItem(nextUid()), parent_uid: parent.uid, order_kind: parent.order_kind, quantity: parent.quantity, order_season: parent.order_season }
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
      ...(it ? quantityPatch(it, qty) : {}),   // 단가 할인·매입배송비 자동 재계산 (704)
      ...(it && it.order_kind === '지점' && it.carton_unit > 0
        ? { shipping_fee: cartonShipping(it.carton_unit, it.carton_shipping_fee, it.loose_shipping_fee, qty) }
        : {}),
    })
  }

  const totals = useMemo(() => {
    const filled = items.filter(it => it.item_name.trim())
    const total = filled.reduce((s, it) => s + lineTotal(it), 0)
    const cost = filled.reduce((s, it) => s + lineCost(it), 0)
    return { total, cost, margin: total - cost }
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
      ship,
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
        // 신규·상담 전환·취소 재등록 — 재등록이면 서버가 원본 취소+링크+수금·발주 승계까지 처리
        const res = await fetch('/api/orders-portal/orders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            ...(consultId ? { consultation_id: consultId } : {}),
            ...(reissueId ? { reissue_of: reissueId } : {}),
          }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '저장 실패')
        if (andContinue && !reissueId) {
          setNotice(`주문 ${json.order_no} 저장 완료 — 이어서 입력하세요.`)
          setGroupId(null); setVendorId(null); setContactId(null); setContactTel(''); setPhone(''); setMemo('')
          setItems([emptyItem(nextUid())])
        } else {
          router.push(`/orders/${json.id}`)
        }
      } else {
        const res = await fetch(`/api/orders-portal/orders/${orderId}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '수정 실패')
        if (json.warning) window.alert(json.warning)
        router.push(`/orders/${orderId}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패')
    }
    setSaving(false)
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>
  if (isEdit && !canEdit) {
    return (
      <div className="px-4 py-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
        입력 당일이 지난 주문은 직접 수정할 수 없습니다 — 주문 상세의 <b>취소·재등록</b>으로 진행해주세요.
        (업로드 주문·취소된 주문은 수정 대상이 아닙니다)
      </div>
    )
  }

  const label = 'block text-[0.6875rem] text-gray-500 mb-0.5'
  const free = 'w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm'
  const auto = 'w-full border border-gray-200 bg-gray-50 rounded-lg px-2.5 py-1.5 text-sm text-gray-500'
  // 금액 칸은 colgroup으로 전부 동일 폭 — 칸 안 요소는 폭을 채운다
  const numCell = 'w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs text-right tabular-nums'
  const autoCell = 'w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs text-right tabular-nums text-gray-500'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">
          {isEdit ? '주문 수정' : reissueFromNo ? '주문 취소·재등록' : '신규 주문'}
        </h1>
        {isEdit && orderNo && <span className="text-sm text-gray-400 tabular-nums">{orderNo}</span>}
        <span className="text-[0.6875rem] text-gray-400 ml-auto">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-50 border border-blue-200 align-middle mr-1" />마스터 선택
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-50 border border-gray-200 align-middle ml-3 mr-1" />자동
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-50 border border-amber-200 align-middle ml-3 mr-1" />자유 입력
        </span>
      </div>

      {reissueFromNo && (
        <div className="mt-3 px-4 py-2.5 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg">
          주문 <b className="tabular-nums">{reissueFromNo}</b> 취소·재등록 중 —
          저장하면 원본 주문이 취소 처리되고 새 주문번호로 등록됩니다.
          수금·발주 상태는 새 주문으로 승계됩니다.
          <span className="block text-xs mt-0.5 text-amber-700">
            주문일은 원본 값으로 채워져 있습니다 — 집계(월 매출) 기준을 유지하려면 그대로 두고,
            주문일 자체를 잘못 입력했던 경우에만 수정하세요.
          </span>
        </div>
      )}
      {consultInfo && (
        <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg">
          상담일지에서 전환 중: {consultInfo.label}
          {consultInfo.needMaster && (
            <span className="block text-xs mt-0.5 text-blue-600">
              상담에 자유 입력된 주문처·담당자가 있습니다 — 마스터에 같은 이름이 있으면 자동
              선택했고, 없으면 아래 신규 등록 칸에 미리 채워 두었습니다. 등록 버튼만 누르면 됩니다.
            </span>
          )}
        </div>
      )}
      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 주문 정보 — 기존 입력 순서 그대로 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="text-sm font-bold text-gray-900 mb-3">
          주문 정보 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">기존 입력 순서 그대로</span>
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
                // 소속 지점이 1곳이면 자동 선택, 여러 곳이면 지점 칸에서 선택. 개인 고객 업체는 고객을 고른다.
                const individual = !!groups.find(g => g.id === id)?.is_individual
                setVendorId(!individual && branches.length === 1 ? branches[0].id : null)
                setContactId(null)
                setAddingIndividual(null)
              }}
              placeholder="업체 검색 (지점에서 바로 검색도 가능)"
            />
            <div className="text-[0.625rem] text-gray-400 mt-0.5">업체별 통계의 기준 — 단독 업체도 업체로 고르면 지점이 자동 선택됩니다</div>
          </div>
          <div className="col-span-2 md:col-span-3">
            <label className={label}>지점(부서) — 주문처 {!indMode && <em className="not-italic text-red-500">*</em>}</label>
            <Combo
              value={indPick ? null : vendorId}
              display={(() => {
                const v = vendors.find(x => x.id === vendorId)
                if (!v || indPick) return ''
                return branchLabel(v.name, groups.find(g => g.id === v.group_id)?.name)
              })()}
              options={(groupId ? vendors.filter(v => v.group_id === groupId) : vendors)
                .filter(v => !indMode || isMoimVendor(v, selGroup?.name))
                .filter(v => !v.individual_contact_id)
                .map(v => {
                  const gName = groups.find(g => g.id === v.group_id)?.name
                  return { id: v.id, label: branchLabel(v.name, gName), sub: gName ?? '' }
                })}
              onSelect={id => {
                setVendorId(id)
                setGroupId(vendors.find(v => v.id === id)?.group_id ?? groupId)
                setContactId(null)
              }}
              placeholder={indMode ? '개인 고객은 지점 없음 — 모임 주문만 선택' : groupId ? '소속 지점 선택' : '거래처 마스터 검색 — 자유 입력 불가'}
              required={!indMode}
              footer={!indMode &&
                <button type="button" onMouseDown={e => e.preventDefault()}
                  onClick={() => {
                    setNewVendor(p => ({ ...p, group_name: groups.find(g => g.id === groupId)?.name ?? p.group_name }))
                    setAddingVendor(true)
                  }}
                  className="w-full text-left px-3 py-1.5 text-blue-700 font-medium hover:bg-blue-50">
                  + 신규 매출처 등록
                </button>
              }
            />
            {billingTo && (
              <div className="text-[0.6875rem] text-blue-700 mt-0.5">
                계산서 발행처: <b>{billingTo.name}</b>{billingTo.biz_number ? ` (${billingTo.biz_number})` : ''}
              </div>
            )}
          </div>
          <div className="col-span-2">
            <label className={label}>{indPick ? '고객(주문자)' : '담당자(거래처)'} <em className="not-italic text-red-500">*</em></label>
            <Combo
              value={contactId}
              display={(() => {
                const c = contacts.find(x => x.contact_id === contactId)
                  ?? (indPick ? indCustomers.find(x => x.contact_id === contactId) : undefined)
                return c ? contactLabel(c.name, c.title) : ''
              })()}
              options={indPick
                ? indCustomers.map(c => ({
                    id: c.contact_id,
                    label: contactLabel(c.name, c.title),
                    sub: [employees.find(e => e.id === c.staff_employee_id)?.name ? `다올 ${employees.find(e => e.id === c.staff_employee_id)?.name}` : '', c.phone ?? ''].filter(Boolean).join(' · '),
                  }))
                : contacts.map(c => ({
                    id: c.contact_id,
                    label: contactLabel(c.name, c.title),
                    sub: [c.is_representative ? '대표' : '', c.phone ?? ''].filter(Boolean).join(' · '),
                  }))}
              onSelect={id => {
                if (!indPick) { pickContact(id); return }
                const c = indCustomers.find(x => x.contact_id === id)
                if (c) pickIndividual(c)
                else { setContactId(null) }
              }}
              placeholder={indPick ? '개인 고객 검색 (이름 · 전화번호)' : vendorId ? '담당자 선택' : '주문처를 먼저 선택'}
              required
              footer={indPick ? (!isParttime && (
                <button type="button" onMouseDown={e => e.preventDefault()}
                  onClick={() => setAddingIndividual({})}
                  className="w-full text-left px-3 py-1.5 text-blue-700 font-medium hover:bg-blue-50">
                  + 신규 개인 고객 등록
                </button>
              )) : vendorId && !isParttime && (
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
              onSelect={id => { autoCounselor.current = false; setCounselorId(id) }}
              placeholder="직원 마스터 검색"
              required
            />
            {(() => {
              // 고객 다올 담당 안내 (112): 비어 있으면 고른 상담자가 이 고객의 다올 담당으로 자동 저장
              const c = contacts.find(x => x.contact_id === contactId)
              if (!c) return null
              const staff = c.staff_employee_id ? employees.find(e => e.id === c.staff_employee_id)?.name ?? '등록됨' : null
              if (!staff) return <div className="text-[0.625rem] text-amber-700 mt-0.5">이 고객의 다올 담당 미기입 — 고른 상담자가 다올 담당으로 저장됩니다</div>
              if (counselorId && counselorId !== c.staff_employee_id) return <div className="text-[0.625rem] text-amber-700 mt-0.5">고객 다올 담당은 {staff} — 이번 주문만 다르게 기록</div>
              return <div className="text-[0.625rem] text-gray-400 mt-0.5">고객 다올 담당</div>
            })()}
          </div>
          {/* 연락처 → 마스터 반영 (116): 마스터가 비어 있으면 저장 때 채워지고, 다르면 안내만 (덮어쓰지 않음) */}
          {(() => {
            const c = contacts.find(x => x.contact_id === contactId)
            const hint = (mine: string, master: string | null | undefined) => {
              if (!c || !mine.trim()) return null
              if (!master?.trim()) return <div className="text-[0.625rem] text-gray-400 mt-0.5">저장하면 담당자 마스터에도 기록됩니다</div>
              if (normTel(master) !== normTel(mine)) return <div className="text-[0.625rem] text-amber-700 mt-0.5">마스터 번호와 다름 ({master}) — 이 주문에만 기록</div>
              return null
            }
            return (
              <>
                <div>
                  <label className={label}>연락처</label>
                  <input value={contactTel} onChange={e => setContactTel(e.target.value)} className={free} placeholder="02-" />
                  {hint(contactTel, c?.tel)}
                </div>
                <div>
                  <label className={label}>핸드폰</label>
                  <input value={phone} onChange={e => setPhone(e.target.value)} className={free} placeholder="담당자 선택 시 자동" />
                  {hint(phone, c?.phone)}
                </div>
              </>
            )
          })()}
          <div className="col-span-2">
            <label className={label}>메모</label>
            <input value={memo} onChange={e => setMemo(e.target.value)} className={free} />
          </div>
        </div>

        {prepayBalance > 0 && (
          <div className="mt-3 text-xs px-3 py-2 rounded-lg bg-fuchsia-50 border border-fuchsia-200 text-fuchsia-800">
            이 주문처의 선결제 잔액 <b className="tabular-nums">{prepayBalance.toLocaleString('ko-KR')}원</b> — 저장 후 주문 상세 › 결제 내역에서
            &lsquo;선결제 사용&rsquo;으로 결제에 쓸 수 있습니다.
          </div>
        )}

        {addingVendor && (
          <div className="mt-3 p-3 bg-blue-50/50 border border-blue-200 rounded-lg flex items-end gap-2 flex-wrap">
            <div className="text-xs font-semibold text-blue-800 w-full">신규 매출처 등록</div>
            <div>
              <label className={label}>업체명 *</label>
              <input value={newVendor.group_name}
                onChange={e => setNewVendor(p => ({ ...p, group_name: e.target.value }))}
                placeholder="하나은행" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-40" />
            </div>
            <div>
              <label className={label}>지점(부서)명</label>
              <input value={newVendor.branch_name}
                onChange={e => setNewVendor(p => ({ ...p, branch_name: e.target.value }))}
                placeholder="OO지점 (단일 업체는 비움)" className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-44" />
            </div>
            <button type="button" onClick={createVendor}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm">등록</button>
            <button type="button" onClick={() => setAddingVendor(false)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
            <span className="text-[0.6875rem] text-gray-400">
              거래처 마스터에 즉시 등록됩니다 (매출처 허브에도 보임) — 같은 이름이 있으면 새로 만들지 않고 선택합니다
            </span>
          </div>
        )}

        {addingIndividual && indPick && groupId && (
          <IndividualRegister
            groupId={groupId}
            employees={employees}
            initial={addingIndividual}
            onCancel={() => setAddingIndividual(null)}
            onPick={pickIndividual}
            onDone={async r => {
              const mRes = await fetch('/api/orders-portal/masters')
              const m = await mRes.json().catch(() => ({}))
              if (mRes.ok) setVendors(m.vendors ?? [])
              await loadIndCustomers(groupId)
              setVendorId(r.vendor_id)
              setContactId(r.contact_id)
              if (r.phone) setPhone(r.phone)
              autoCounselor.current = true
              setCounselorId(r.staff_employee_id)
              setAddingIndividual(null)
              setNotice('개인 고객을 등록했습니다 — 고객 전용 매출처가 함께 만들어졌습니다.')
            }}
          />
        )}

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
            <div>
              <label className={label}>다올 담당 *</label>
              <select value={newContact.staff_employee_id} onChange={e => setNewContact(p => ({ ...p, staff_employee_id: e.target.value }))}
                className="border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm w-36 bg-white">
                <option value="">선택</option>
                {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button type="button" onClick={createContact} disabled={!newContact.name.trim() || !newContact.staff_employee_id}
              className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-sm disabled:opacity-50">등록</button>
            <button type="button" onClick={() => setAddingContact(false)}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">취소</button>
            <span className="text-[0.6875rem] text-gray-400">거래처 담당자 마스터에 즉시 등록됩니다</span>
          </div>
        )}
      </div>

      {/* 배송지 (513, 2026-11-04) — 지점·샘플 품목용. 신규·상담 전환만 자동 채움, 수정·재등록은 원본 값 */}
      {(() => {
        const c = contacts.find(x => x.contact_id === contactId)
        return (
          <ShipCard
            value={ship} onChange={setShip} vendorId={vendorId}
            contactName={c ? contactLabel(c.name, c.title) : null}
            contactPhone={c?.phone ?? (phone || null)}
            autoFill={!orderId && !reissueId && !shipFromConsult}
            applies={needsShip(items.filter(it => it.item_name.trim() && !it.is_shipping && !it.parent_uid).map(it => it.order_kind))}
            disabled={isEdit && !canEdit}
          />
        )
      })()}

      {/* 개별 배송 명단 (707, 2026-11-09) — 저장된 주문에서. 상담 전환 주문은 상담 명단이 연결되어 따라온다 */}
      <RosterCard
        orderId={orderId ?? null}
        applies={items.some(it => it.item_name.trim() && !it.is_shipping && !it.parent_uid && !SHIP_KINDS.has(it.order_kind ?? '지점'))}
        isNew={!isEdit}
        disabled={isEdit && !canEdit}
        subject={[orderNo, orderDate].filter(Boolean).join(' · ') || undefined}
        newHint={consultId
          ? '상담일지에 올린 배송명단은 주문을 저장하면 이 주문에 포함된 품목의 행이 자동으로 연결됩니다. 직접 올리려면 저장 후 여기서 업로드하세요.'
          : '주문을 먼저 저장하면 배송명단을 올릴 수 있습니다. 양식은 지금 내려받아 작성해두세요.'}
      />

      {/* 주문 상품 — 기존 컬럼 순서 그대로 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3 overflow-x-auto">
        <div className="text-sm font-bold text-gray-900 mb-3">
          주문 상품 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">품번·품명 검색 시 매입처·가격 자동</span>
        </div>
        <SeasonDatalist id="order-season-options" options={seasonOptions(orderDate, [...usedSeasons, ...items.map(x => x.order_season)])} />
        <table className="w-full text-xs min-w-[1500px] table-fixed">
          {/* 그룹별 동일 폭: 금액 칸 6개는 같은 폭으로 세로 정렬을 맞춘다. 품명이 남는 폭 전부 차지 */}
          <colgroup>
            <col className="w-[8.5rem]" />{/* 검색 */}
            <col />{/* 품명 — 남는 폭 전부 */}
            <col className="w-16" />{/* 배송종류 */}
            <col className="w-[5rem]" />{/* 주문시기 */}
            <col className="w-28" />{/* 매입처 */}
            <col className="w-[5.75rem]" />{/* 판매가 */}
            <col className="w-14" />{/* 갯수 */}
            <col className="w-[5.75rem]" />{/* 배송비 */}
            <col className="w-[5.75rem]" />{/* 판매할인 */}
            <col className="w-[5.75rem]" />{/* 합계 */}
            <col className="w-[5.75rem]" />{/* 매입가 */}
            <col className="w-[5.75rem]" />{/* 매입할인 */}
            <col className="w-[5.75rem]" />{/* 매입배송비 */}
            <col className="w-[5.75rem]" />{/* 매입합계 */}
            <col className="w-24" />{/* 메모 */}
            <col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-1.5 px-1.5 text-left font-medium">품번 · 품명 검색</th>
              <th className="py-1.5 px-1.5 text-left font-medium">품명</th>
              <th className="py-1.5 px-1.5 text-left font-medium">배송종류</th>
              <th className="py-1.5 px-1.5 text-left font-medium" title="상시 · 26설 · 26추석 등 — 목록에서 고르거나 직접 입력">주문시기</th>
              <th className="py-1.5 px-1.5 text-left font-medium">매입처</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매가</th>
              <th className="py-1.5 px-1.5 text-right font-medium">갯수</th>
              <th className="py-1.5 px-1.5 text-right font-medium">배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매할인</th>
              <th className="py-1.5 px-1.5 text-right font-medium">합계금액</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입가</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="정액(행당 금액) 또는 개당 할인 — 매입합계 · 발주서 금액에 반영">매입할인</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="매입가 × 갯수 + 매입배송비 − 매입할인">매입합계</th>
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
                          soldout: !!p.is_soldout,
                          note: p.status_note ?? undefined,
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
                  <SeasonInput value={it.order_season} listId="order-season-options"
                    normalize={normalizeSeason} onChange={v => setItem(i, { order_season: v })} />
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
                  {/* 할인 — 정액 / 개당(× 수량 자동) 구분 (704, 상담일지와 동일) */}
                  <select value={it.discount_mode}
                    onChange={e => {
                      const mode = e.target.value as '정액' | '단가'
                      setItem(i, mode === '단가'
                        ? { discount_mode: mode, discount_amount: (it.discount_unit || 0) * it.quantity }
                        : { discount_mode: mode, discount_unit: 0 })
                    }}
                    className="w-full border border-blue-200 bg-blue-50/40 rounded px-1 py-0.5 text-[0.625rem] mb-0.5">
                    <option value="정액">정액</option>
                    <option value="단가">개당</option>
                  </select>
                  <input
                    value={it.discount_mode === '단가'
                      ? (it.discount_unit ? won(it.discount_unit) : '')
                      : (it.discount_amount ? won(it.discount_amount) : '')}
                    onChange={e => {
                      const v = toInt(e.target.value)
                      setItem(i, it.discount_mode === '단가'
                        ? { discount_unit: v, discount_amount: v * it.quantity }
                        : { discount_amount: v })
                    }}
                    title={it.discount_mode === '단가' ? `개당 할인 — 할인액 ${won(it.discount_amount)}원 자동 계산` : '행당 할인 금액'}
                    className={`${numCell} ${it.discount_amount > 0 ? 'text-red-600 font-semibold border-red-200 bg-red-50/40' : ''}`}
                    placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <div className={autoCell + ' font-semibold text-gray-700'}>
                    {won(lineTotal(it))}
                    {it.discount_amount > 0 && (
                      <div className="text-[0.625rem] text-red-500 font-normal">
                        판매할인 -{won(it.discount_amount)}{it.discount_mode === '단가' ? ` (${won(it.discount_unit)}/개)` : ''}
                      </div>
                    )}
                  </div>
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_price ? won(it.purchase_price) : ''} onChange={e => setItem(i, { purchase_price: toInt(e.target.value) })}
                    className={numCell} placeholder="0" />
                  {/* 품목별 매입가 합계 = 매입가 × 수량 (704 확정) */}
                  {it.purchase_price > 0 && it.quantity > 0 && (
                    <div className="text-[0.625rem] text-gray-400 mt-0.5 tabular-nums">합계 {won(it.purchase_price * it.quantity)}</div>
                  )}
                </td>
                <td className="py-1 px-1.5 text-right">
                  {/* 매입할인 (708) — 정액(행당) / 개당. 매입합계 · 발주서 금액에 반영 */}
                  <DiscountInput mode={it.purchase_discount_mode} unit={it.purchase_discount_unit} amount={it.purchase_discount}
                    quantity={it.quantity} className={numCell}
                    onChange={d => setItem(i, { purchase_discount_mode: d.mode, purchase_discount_unit: d.unit, purchase_discount: d.amount })} />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_shipping ? won(it.purchase_shipping) : ''} onChange={e => setItem(i, { purchase_shipping: toInt(e.target.value) })}
                    title={purchaseShippingHint(it) ?? '카톤 정보가 없는 품목 — 직접 입력'}
                    className={numCell} placeholder="0" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <div className={autoCell + ' font-semibold text-gray-700'}>{won(lineCost(it))}</div>
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
                  <td colSpan={16} className="pb-1.5 pt-0 px-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap pl-4">
                      <span className="text-[0.625rem] text-gray-400">옵션 추가 ({it.purchase_vendor_name})</span>
                      {addonCands.map(p => (
                        <button key={p.id} type="button" onClick={() => addAddon(i, p)}
                          className="px-2 py-0.5 border border-violet-200 bg-violet-50/60 text-violet-700 rounded-full text-[0.6875rem] hover:bg-violet-100">
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
        <button type="button"
          onClick={() => setItems(prev => [...prev, { ...emptyItem(nextUid()), order_season: [...prev].reverse().find(x => x.order_season)?.order_season ?? '' }])}
          className="mt-2 px-3.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-gray-400">
          + 상품 행 추가
        </button>

        <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <div className="flex gap-5 text-sm">
            <span>총금액 <b className="tabular-nums">{won(totals.total)}원</b>
              <span className="text-[0.6875rem] text-gray-400 ml-1">자동 합산</span></span>
            <span className="text-gray-600">매입 합계 <b className="tabular-nums">{won(totals.cost)}원</b></span>
            <span>예상 마진 <b className="tabular-nums text-emerald-700">{won(totals.margin)}원</b></span>
          </div>
          <div className="flex gap-2">
            {!isEdit && !reissueFromNo && (
              <button type="button" disabled={saving} onClick={() => submit(true)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">
                저장 후 계속 입력
              </button>
            )}
            <button type="button" disabled={saving} onClick={() => submit(false)}
              className="px-5 py-2 bg-slate-900 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saving ? '저장 중...' : isEdit ? '수정 저장' : reissueFromNo ? '취소·재등록 저장' : '주문 저장'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
