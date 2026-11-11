'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Combo, ComboFree, DiscountInput, SeasonDatalist, SeasonInput, autoGrow, branchLabel, draftExtrasFromRow, draftFromProduct, emptyItem,
  lineCost, lineTotal, priceRule, purchaseShippingHint, quantityPatch, splitByGroupPrefix, toInt, won,
} from '../form-shared'
import { normalizeSeason, seasonOptions, suggestSeason } from '@/lib/order-season'
import type { ContactOpt, IndividualCustomerOpt, ItemDraft, Product, Vendor, VendorGroup } from '../form-shared'
import { isMoimVendor } from '../form-shared'
import IndividualRegister from '../individual-register'
import { contactLabel } from '@/lib/contact-label'
import ShipCard, { EMPTY_SHIP } from '../ship-card'
import { needsShip, SHIP_KINDS, type ShipInput } from '@/lib/ship-address'
import RosterCard from '../roster-card'
import ReasonPicker from '@/components/ui/ReasonPicker'
import { CONSULT_CLOSE_REASONS, CONSULT_DELETE_REASONS, composeReason } from '@/lib/cancel-reasons'
import { normTel } from '@/lib/contact-phone-sync'

const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })

// 상담일지 폼 (신규·수정 공용) — 실물 '주문상담' 시트 컬럼 구성.
// 필수는 상담일·구분뿐. 업체·지점·담당자는 마스터 검색 + 자유 입력 겸용
// (상담 단계는 신규 고객 가능 — 주문 전환 시점에 마스터 등록 안내).
// 품목·가격 규칙은 주문 입력과 동일 (form-shared 공용).

const TYPES = ['주문', '문의', '요청', '결제', '기타'] as const

// copyId·copyLines: 목록 체크박스 "선택 복사" — 원본 상담의 선택 품목(line_no)으로
// 새 상담을 프리필한다 (고객이 이전 주문 품목을 다시 찾는 경우). 결제정보는 복사 안 함.
export default function ConsultForm({ consultId, copyId, copyLines }: {
  consultId?: string; copyId?: string; copyLines?: number[]
}) {
  const router = useRouter()
  const isEdit = !!consultId

  // 마스터
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [groups, setGroups] = useState<VendorGroup[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [contacts, setContacts] = useState<ContactOpt[]>([])
  const [usedSeasons, setUsedSeasons] = useState<string[]>([])   // 주문시기(708) 드롭다운 — 이미 쓴 값

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
  const [paymentLocked, setPaymentLocked] = useState(false)   // 저장돼 있으나 열람 권한 없음 ((b) 정책)
  const [isParttime, setIsParttime] = useState(false)         // 아르바이트 — 인라인 등록 버튼 숨김
  const [paymentRevealed, setPaymentRevealed] = useState<string | null>(null)
  const [senderName, setSenderName] = useState('')
  const [ship, setShip] = useState<ShipInput>(EMPTY_SHIP)   // 배송지 (706) — 주문서와 같은 구조
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

  // 신규 매출처 인라인 등록 (자유 입력분 → 마스터)
  const [regOpen, setRegOpen] = useState(false)
  const [regBusy, setRegBusy] = useState(false)
  const [regGroupName, setRegGroupName] = useState('')
  const [regBranch, setRegBranch] = useState('')
  const [regContactName, setRegContactName] = useState('')
  const [regContactTitle, setRegContactTitle] = useState('')
  const [regContactPhone, setRegContactPhone] = useState('')
  const [regStaff, setRegStaff] = useState('')   // 새 고객의 다올 담당 (112 — 필수)

  // 주문 진행 요청 (705, 2026-11-05): 요청받은 직원은 열람 · 전환만 — canEdit=false면 읽기 전용
  const [canEdit, setCanEdit] = useState(true)
  const [isAssignee, setIsAssignee] = useState(false)
  const [orderRequest, setOrderRequest] = useState<{ assignee_id: string; assignee_name: string | null; requested_by_name: string | null; requested_at: string | null; memo: string | null } | null>(null)
  const [employees, setEmployees] = useState<{ id: string; name: string; team: string | null; position: string | null; employment_type?: string | null }[]>([])
  const [reqAssignee, setReqAssignee] = useState('')
  const [reqMemo, setReqMemo] = useState('')
  // 완료 회신 (515): 요청 진행 상태 · 전환 전 처리 불가 회신
  const [requestStatus, setRequestStatus] = useState<{ state: string; label: string; memo: string | null; by: string | null; at: string | null; requested_by_name: string | null } | null>(null)
  const [canUnable, setCanUnable] = useState(false)
  const [unableOpen, setUnableOpen] = useState(false)
  const [unableMemo, setUnableMemo] = useState('')
  const [unableBusy, setUnableBusy] = useState(false)

  // 처리 불가 회신 (515) — 요청이 요청자에게 되돌아가고, 요청받은 직원은 이 상담을 더 열 수 없다
  const submitUnable = async () => {
    if (!unableMemo.trim()) { setError('처리 불가 사유를 적어주세요.'); return }
    setUnableBusy(true); setError(null)
    const res = await fetch(`/api/orders-portal/consultations/${consultId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'unable', memo: unableMemo.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setUnableBusy(false)
    if (!res.ok) { setError(json.error ?? '처리 불가 회신 실패'); return }
    window.alert('처리 불가 회신을 보냈습니다. 요청이 요청자에게 되돌아갔습니다.')
    router.push('/orders/consultations?scope=assigned')
  }

  // 종결 · 삭제 기록 (709, 2026-11-10 사용자 결정 — 사유 필수, 종결 상담 수정 잠금, 숨김 삭제)
  const [closeInfo, setCloseInfo] = useState<{ reason: string | null; by: string | null; at: string | null } | null>(null)
  const [deleteInfo, setDeleteInfo] = useState<{ reason: string | null; by: string | null; at: string | null } | null>(null)
  const [endMode, setEndMode] = useState<'close' | 'delete' | null>(null)
  const [endPick, setEndPick] = useState<string | null>(null)
  const [endText, setEndText] = useState('')
  const [endBusy, setEndBusy] = useState(false)

  const converted = status === '주문전환'
  const closed = status === '종결'
  const deleted = !!deleteInfo
  // 전환 후 수정 잠금(이력 보존) · 종결 · 삭제된 상담 잠금 · 요청받은 직원 읽기 전용
  const locked = converted || (isEdit && (closed || deleted || !canEdit))

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
        setEmployees(m.employees ?? [])
        setUsedSeasons(m.seasons ?? [])
        setIsParttime(m.me?.is_parttime === true)
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
          setPaymentLocked(c.payment_locked === true)
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
          setShip({
            ship_name: v.ship_name ?? null, ship_phone: v.ship_phone ?? null, ship_zip: v.ship_zip ?? null,
            ship_addr1: v.ship_addr1 ?? null, ship_addr2: v.ship_addr2 ?? null,
          })
          setStatus(v.status)
          setCloseInfo(v.status === '종결' ? { reason: v.close_reason ?? null, by: c.closed_by_name ?? null, at: v.closed_at ?? null } : null)
          setDeleteInfo(v.deleted_at ? { reason: v.delete_reason ?? null, by: c.deleted_by_name ?? null, at: v.deleted_at } : null)
          setOrders(c.orders ?? [])
          setCanEdit(c.can_edit !== false)
          setIsAssignee(c.is_assignee === true)
          setOrderRequest(c.order_request ?? null)
          setRequestStatus(c.request_status ?? null)
          setCanUnable(c.can_unable === true)
          setReqAssignee(c.order_request?.assignee_id ?? '')
          setReqMemo(c.order_request?.memo ?? '')
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          const cItems = (c.items ?? []) as Record<string, unknown>[]
          if (cItems.length) {
            // line_no → uid 매핑으로 옵션 연결 복원 (품목은 line_no 순으로 로드됨)
            const lineToUid = new Map<number, number>(cItems.map((it, idx) => [it.line_no as number, idx + 1]))
            const loaded = cItems.map((it, idx) => {
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
                discount_mode: (it.discount_mode as '정액' | '단가') ?? '정액',
                discount_unit: (it.discount_unit as number) ?? 0,
                purchase_price: (it.purchase_price as number) ?? 0,
                purchase_shipping: (it.purchase_shipping as number) ?? 0,
                ...draftExtrasFromRow(it),   // 매입할인 · 주문시기 (708)
                memo: (it.memo as string) ?? '',
                status: (it.status as string) ?? '',
                option_note: (it.option_note as string) ?? '',
                is_shipping: it.is_shipping === true,
                branch_sale_price: prod?.sale_price ?? 0,
                individual_sale_price: prod?.individual_sale_price ?? 0,
                branch_purchase_price: prod?.purchase_price ?? 0,
                carton_unit: prod?.carton_unit ?? 0,
                carton_shipping_fee: prod?.carton_shipping_fee ?? 0,
                loose_shipping_fee: prod?.loose_shipping_fee ?? 0,
              }
            })
            // 702 이전 저장분: 품목 배송비 열 값은 배송비(카톤외) 행으로 풀어낸다 (합계 불변)
            const converted: ItemDraft[] = []
            let nextId = cItems.length + 1
            for (const it of loaded) {
              if (it.is_shipping || it.shipping_fee <= 0) { converted.push(it); continue }
              const fee = it.shipping_fee
              converted.push({ ...it, shipping_fee: 0 })
              converted.push({
                ...emptyItem(nextId++),
                parent_uid: it.uid,
                is_shipping: true,
                item_name: '배송비(카톤외)',
                order_kind: it.order_kind,
                quantity: 1,
                sale_price: fee,
              })
            }
            uidRef.current = nextId
            setItems(converted)
          }
        } else if (copyId) {
          // 선택 복사 — 원본 상담의 머리 정보 + 선택 품목(딸린 옵션·배송비 포함)으로 새 상담 프리필
          const cRes = await fetch(`/api/orders-portal/consultations/${copyId}`)
          const c = await cRes.json()
          if (!cRes.ok) throw new Error(c.error ?? '복사할 상담일지 조회 실패')
          const v = c.consult
          setConsultType(v.consult_type ?? '문의')     // 상담일은 오늘 유지, 상태·결제정보는 복사 안 함
          setGroupId(v.vendor_group_id)
          setVendorId(v.vendor_id)
          setContactId(v.contact_id)
          setBankText(v.bank_name ?? '')
          setBranchText(v.branch_name ?? '')
          setManagerText(v.manager_name ?? '')
          setPhone(v.phone ?? '')
          setTel(v.tel ?? '')
          setSenderName(v.sender_name ?? '')
          setInvoiceEmail(v.invoice_email ?? '')
          setFax(v.fax ?? '')
          setBizNumber(v.biz_number ?? '')
          setCeoName(v.ceo_name ?? '')
          setShip({
            ship_name: v.ship_name ?? null, ship_phone: v.ship_phone ?? null, ship_zip: v.ship_zip ?? null,
            ship_addr1: v.ship_addr1 ?? null, ship_addr2: v.ship_addr2 ?? null,
          })
          const prodList: Product[] = pRes.ok ? (p.products ?? []) : []
          const src = (c.items ?? []) as Record<string, unknown>[]
          const wantAll = !copyLines?.length
          const wanted = new Set(copyLines ?? [])
          const picked = src.filter(it => {
            const line = it.line_no as number
            const parent = it.parent_line_no as number | null
            return wantAll || wanted.has(line) || (parent != null && wanted.has(parent))
          })
          if (picked.length) {
            const lineToUid = new Map<number, number>(picked.map((it, idx) => [it.line_no as number, idx + 1]))
            uidRef.current = picked.length + 1
            setItems(picked.map((it, idx) => {
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
                shipping_fee: 0,
                discount_amount: (it.discount_amount as number) ?? 0,
                discount_mode: (it.discount_mode as '정액' | '단가') ?? '정액',
                discount_unit: (it.discount_unit as number) ?? 0,
                purchase_price: (it.purchase_price as number) ?? 0,
                purchase_shipping: (it.purchase_shipping as number) ?? 0,
                ...draftExtrasFromRow(it),
                order_season: suggestSeason(new Date().toLocaleDateString('sv-SE')),   // 주문시기는 오늘 기준으로 새로 제안
                memo: (it.memo as string) ?? '',
                status: '',                                  // 상태는 복사 시점 기준 아님 — 새로 판정
                option_note: (it.option_note as string) ?? '',
                is_shipping: it.is_shipping === true,
                branch_sale_price: prod?.sale_price ?? 0,
                individual_sale_price: prod?.individual_sale_price ?? 0,
                branch_purchase_price: prod?.purchase_price ?? 0,
                carton_unit: prod?.carton_unit ?? 0,
                carton_shipping_fee: prod?.carton_shipping_fee ?? 0,
                loose_shipping_fee: prod?.loose_shipping_fee ?? 0,
              }
            }))
          }
          setNotice('이전 상담을 복사했습니다 — 내용 확인 후 저장해주세요. (결제정보는 복사되지 않습니다)')
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : '조회 실패')
      }
      setLoading(false)
    })()
    // copyLines는 URL에서 한 번 파싱되어 바뀌지 않는다 — 의존성에서 제외
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [consultId, copyId])

  // 개인 고객(115): 업체가 '개인'이면 지점 없이 고객을 고른다(모임 선택 시는 일반 지점과 같다)
  const [indCustomers, setIndCustomers] = useState<IndividualCustomerOpt[]>([])
  const [addingIndividual, setAddingIndividual] = useState(false)
  const selGroup = groups.find(g => g.id === groupId)
  const indMode = !!selGroup?.is_individual
  const selVendor = vendors.find(v => v.id === vendorId)
  const indPick = indMode && !(selVendor && isMoimVendor(selVendor, selGroup?.name))
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
    setBranchText('')
    setContactId(c.contact_id)
    setManagerText(contactLabel(c.name, c.title))
    if (c.phone) setPhone(c.phone)
    setAddingIndividual(false)
  }

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

  // 상담 품목은 배송비를 열이 아니라 배송비 행으로 다룬다 (702) — 판매 배송비 shipping_fee는 항상 0
  const pickProduct = (i: number, pid: string | null) => {
    const p = products.find(x => x.id === pid)
    const cur = items[i]
    if (!p || !cur) return
    setItem(i, { ...draftFromProduct(p, cur), shipping_fee: 0, order_season: seasonFor(i) })
  }
  // 주문시기 기본값 (708): 이미 적혀 있으면 유지 → 윗 행 값 → 상담일 기준 제안 (확정은 작성자)
  const seasonFor = (i: number) =>
    items[i]?.order_season || items.slice(0, i).reverse().find(x => x.order_season)?.order_season || suggestSeason(consultDate)
  const setKind = (i: number, kind: string) => {
    const it = items[i]
    if (!it) return
    setItem(i, {
      order_kind: kind,
      ...(it.product_id ? priceRule({ ...it, order_kind: kind }, it.quantity) : {}),
      shipping_fee: 0,
    })
  }
  // 수량 변경 → 단가 할인·매입배송비(카톤단위/카톤외 자동 구분) 재계산 (704)
  const setQuantity = (i: number, qty: number) => {
    const it = items[i]
    setItem(i, it ? quantityPatch(it, qty) : { quantity: qty })
  }

  // 배송비는 703부터 품목 마스터의 배송비 품목(is_shipping)을 옵션 칩으로 추가한다 —
  // 702의 이름 고정 의사 행은 과거 저장분 표시용으로만 남는다.

  const totals = useMemo(() => {
    const filled = items.filter(it => it.item_name.trim())
    const total = filled.reduce((s, it) => s + lineTotal(it), 0)
    const cost = filled.reduce((s, it) => s + lineCost(it), 0)
    const discount = filled.reduce((s, it) => s + (it.discount_amount || 0), 0)
    const purchaseDiscount = filled.reduce((s, it) => s + (it.purchase_discount || 0), 0)
    return { total, cost, margin: total - cost, discount, purchaseDiscount }
  }, [items])

  // 단가변경 자동 판정 — 입력 판매가가 원가표(구분별 규칙) 자동가와 다르면 표기 (실무자 요청)
  const priceChanged = (it: ItemDraft): boolean => {
    if (!it.product_id) return false
    const auto = priceRule(it, it.quantity || 1)
    return auto.sale_price !== undefined && it.sale_price !== auto.sale_price
  }

  // 인라인 등록 대상: 지점 미연결 자유 입력, 또는 지점은 연결됐는데 담당자만 자유 입력
  const needsRegister = indPick
    ? (!contactId && !!managerText.trim())
    : (!vendorId && !!(bankText.trim() || branchText.trim())) ||
      (!!vendorId && !contactId && !!managerText.trim())

  const openRegister = () => {
    setRegGroupName(bankText.trim())
    setRegBranch(vendorId ? '' : branchText.trim())
    setRegContactName(managerText.trim())   // 직함 포함 입력이면 직접 나눠 적도록 안내
    setRegContactTitle('')
    setRegContactPhone(phone.trim())
    setRegOpen(true)
  }

  const registerVendor = async () => {
    if (!vendorId && !regGroupName.trim()) { alert('업체명을 입력해주세요.'); return }
    if (regContactName.trim() && !regStaff) { alert('다올 담당(자사 영업 직원)을 선택해주세요. 은행 · 지점 · 고객마다 담당이 기입되어야 합니다.'); return }
    setRegBusy(true)
    try {
      const res = await fetch('/api/orders-portal/masters', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create_sales_vendor',
          // 지점이 이미 연결된 경우: 그 지점에 담당자만 등록
          ...(vendorId
            ? { group_id: groupId ?? undefined, group_name: bankText, branch_name: branchText }
            : { group_id: groupId ?? undefined, group_name: regGroupName, branch_name: regBranch }),
          contact_name: regContactName || undefined,
          contact_title: regContactTitle || undefined,
          contact_phone: regContactPhone || undefined,
          staff_employee_id: regStaff || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '등록 실패')
      setGroupId(json.group_id ?? null)
      setVendorId(json.vendor_id)
      setBankText(json.group_name ?? regGroupName)
      setBranchText(branchLabel(json.vendor_name as string, json.group_name as string | null))
      if (json.contact_id) {
        setContactId(json.contact_id)
        setManagerText(contactLabel(regContactName, regContactTitle || null))
      }
      setRegOpen(false)
      setNotice([
        json.vendor_reused ? '기존 지점에 연결했습니다' : '지점을 매출처 마스터에 등록했습니다',
        json.contact_id ? (json.contact_reused ? '기존 담당자에 연결했습니다' : '담당자를 등록했습니다') : '',
      ].filter(Boolean).join(' · ') + ' — 매출처 목록에 반영됩니다.')
    } catch (e) {
      alert(e instanceof Error ? e.message : '등록 실패')
    }
    setRegBusy(false)
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
    ship,   // 배송지 (706) — 서버가 ship_* 컬럼으로 저장
    // 주문 진행 요청 (705) — 비우면 요청 취소
    order_request: { assignee_id: reqAssignee || null, memo: reqMemo.trim() || null },
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
      // 상담은 저장됐지만 주문 진행 요청이 막힌 경우 (아르바이트 · 마스터 미연결 등)
      if (json.request_error) window.alert(`상담은 저장됐지만 주문 진행 요청은 하지 못했습니다.\n${json.request_error}`)
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

  // 종결 · 삭제는 사유 창에서 확정, 재개는 바로 (2026-11-10)
  const endReason = composeReason(endPick, endText)
  const openEnd = (mode: 'close' | 'delete') => {
    setEndMode(endMode === mode ? null : mode); setEndPick(null); setEndText(''); setError(null)
  }
  const act = async (action: 'close' | 'reopen' | 'delete') => {
    if (action !== 'reopen' && !endReason) return
    setEndBusy(true); setError(null)
    const res = await fetch(
      action === 'delete'
        ? `/api/orders-portal/consultations/${consultId}?reason=${encodeURIComponent(endReason)}`
        : `/api/orders-portal/consultations/${consultId}`, {
      method: action === 'delete' ? 'DELETE' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      ...(action !== 'delete' ? { body: JSON.stringify({ action, ...(action === 'close' ? { reason: endReason } : {}) }) } : {}),
    })
    const json = await res.json().catch(() => ({}))
    setEndBusy(false)
    if (!res.ok) { setError(json.error ?? '처리 실패'); return }
    if (action === 'reopen') { window.location.reload(); return }
    router.push('/orders/consultations')
  }

  if (loading) return <div className="text-center py-16 text-gray-400">로딩 중...</div>

  const label = 'block text-[0.6875rem] text-gray-500 mb-0.5'
  const free = 'w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm disabled:opacity-60'
  const numCell = 'w-full border border-amber-200 bg-amber-50/30 rounded px-1.5 py-1 text-xs text-right tabular-nums'
  const autoCell = 'w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs text-right tabular-nums text-gray-500'

  return (
    <div>
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">{isEdit ? '상담일지' : '상담 기록'}</h1>
        {isEdit && (
          <span className={`inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.6875rem] font-medium ${
            deleted ? 'bg-red-100 text-red-700'
              : status === '주문전환' ? 'bg-emerald-100 text-emerald-700'
              : status === '종결' ? 'bg-gray-100 text-gray-500' : 'bg-amber-100 text-amber-800'}`}>
            {deleted ? '삭제됨' : status}
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
              <button onClick={() => openEnd('close')} className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600">종결</button>
              <button onClick={() => openEnd('delete')} className="px-3 py-1.5 border border-red-200 text-red-600 rounded-lg text-sm">삭제</button>
            </>
          )}
          {isEdit && canEdit && closed && !deleted && (
            <button onClick={() => act('reopen')} disabled={endBusy}
              title="다시 진행중으로 돌립니다 — 종결 기록은 업무일지에 남습니다"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">재개</button>
          )}
        </span>
      </div>

      {/* 종결 · 삭제 사유 (709, 2026-11-10 — 사유 필수) */}
      {endMode && (
        <div className={`mt-3 p-3 rounded-lg border space-y-2 ${endMode === 'delete' ? 'bg-red-50/60 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
          <div className="text-sm font-bold text-gray-900">{endMode === 'close' ? '종결 사유' : '상담일지 삭제 사유'}</div>
          {orderRequest && (
            <div className="text-[0.8125rem] px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
              이 상담은 <b>{orderRequest.assignee_name ?? ''}</b>에게 주문 진행을 요청해 둔 상태입니다. {endMode === 'close' ? '종결' : '삭제'}하면 요청이 끝나고, {orderRequest.assignee_name ?? '요청받은 직원'}에게 사유와 함께 알림이 갑니다.
            </div>
          )}
          <ReasonPicker options={endMode === 'close' ? CONSULT_CLOSE_REASONS : CONSULT_DELETE_REASONS}
            picked={endPick} onPick={setEndPick} text={endText} onText={setEndText} multiline={endMode === 'close'}
            placeholder={endMode === 'close' ? '자세한 사유 (기타를 고르면 필수) — 예: 내년 1월 예산 확정 후 재문의 예정' : undefined} />
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => act(endMode)} disabled={!endReason || endBusy}
              className={`px-3.5 py-1.5 text-white rounded-lg text-sm disabled:opacity-40 disabled:cursor-not-allowed ${endMode === 'delete' ? 'bg-red-600' : 'bg-slate-900'}`}>
              {endBusy ? '처리 중...' : endMode === 'close' ? '종결하기' : '삭제하기'}
            </button>
            <button onClick={() => setEndMode(null)} className="px-3.5 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-sm bg-white">닫기</button>
            <span className="text-[0.6875rem] text-gray-500">
              {endMode === 'close'
                ? '종결하면 주문 전환 · 삭제 · 주문 진행 요청이 막히고 내용 수정이 잠깁니다. "재개"로 되돌릴 수 있습니다.'
                : '실제로 지우지 않고 "삭제됨"으로 숨깁니다. 목록에서 안 보이고, 관리자는 "삭제된 것 보기"로 확인할 수 있습니다.'}
            </span>
          </div>
        </div>
      )}
      {closed && !deleted && (
        <div className="mt-3 px-4 py-2.5 bg-slate-50 border border-slate-200 text-slate-800 text-sm rounded-lg">
          종결된 상담입니다{closeInfo?.reason ? <> — <b>{closeInfo.reason}</b></> : ' (사유 기록 없음)'}
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {[closeInfo?.by, closeInfo?.at ? fmtWhen(closeInfo.at) : null].filter(Boolean).join(' · ')}{closeInfo?.at ? ' 종결 · ' : ''}내용을 고치려면 &ldquo;재개&rdquo;를 누르세요.
          </div>
        </div>
      )}
      {deleted && (
        <div className="mt-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
          삭제된 상담일지입니다. 목록에서는 숨겨집니다.{deleteInfo?.reason && <> 사유: <b>{deleteInfo.reason}</b></>}
          <div className="text-xs text-red-500 mt-0.5 tabular-nums">
            {[deleteInfo?.by, deleteInfo?.at ? fmtWhen(deleteInfo.at) : null].filter(Boolean).join(' · ')} 삭제
          </div>
        </div>
      )}

      {converted && (
        <div className="mt-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg">
          주문으로 전환된 상담입니다 — 이력 보존을 위해 수정할 수 없습니다.
          {orderRequest && <span className="text-emerald-700"> · {orderRequest.requested_by_name ?? ''} 요청 → {orderRequest.assignee_name ?? ''} 진행</span>}
          {/* 완료 회신 상태 (515) — 회신 대기 / 완료 / 변경 있음 / 처리 불가 */}
          {requestStatus && requestStatus.state !== 'converted' && (
            <div className="mt-1 text-[0.8125rem]">
              <span className={`inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-medium mr-1.5 ${
                requestStatus.state === 'waiting' ? 'bg-orange-100 text-orange-700'
                  : requestStatus.state === 'unable' ? 'bg-red-100 text-red-700'
                  : requestStatus.state === 'changed' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-700'}`}>{requestStatus.label}</span>
              {requestStatus.state === 'waiting'
                ? <span className="text-gray-600">주문 입력됨 — 완료 회신을 기다리는 중</span>
                : <span className="text-gray-700">{requestStatus.by ?? ''} 회신{requestStatus.memo ? `: “${requestStatus.memo}”` : ''}</span>}
              {orders[0] && <a href={`/orders/${orders[0].id}`} className="ml-1.5 text-blue-700 hover:underline">주문 보기</a>}
            </div>
          )}
        </div>
      )}
      {/* 처리 불가로 되돌아온 요청 (515) — 요청자 화면 */}
      {!converted && !closed && !deleted && !orderRequest && requestStatus?.state === 'returned' && (
        <div className="mt-3 px-4 py-2.5 bg-red-50 border border-red-200 text-red-900 text-sm rounded-lg">
          <span className="inline-block px-1.5 py-0.5 rounded text-[0.6875rem] font-medium mr-1.5 bg-red-100 text-red-700">처리 불가</span>
          <b>{requestStatus.by ?? ''}</b> 회신{requestStatus.memo ? `: “${requestStatus.memo}”` : ''}
          <div className="mt-1 text-[0.75rem] text-red-700">아래 &lsquo;주문 진행 요청&rsquo; 칸에서 다른 직원에게 다시 요청하거나 직접 주문서로 전환하세요.</div>
        </div>
      )}
      {/* 주문 진행 요청 (705) — 요청받은 직원에게는 요청 내용, 작성자에게는 진행 상태 */}
      {!converted && !closed && !deleted && orderRequest && isAssignee && (
        <div className="mt-3 px-4 py-2.5 bg-blue-50 border border-blue-200 text-blue-900 text-sm rounded-lg">
          <b>{orderRequest.requested_by_name ?? ''}</b>님이 주문 진행을 요청했습니다
          {orderRequest.requested_at && <span className="text-blue-700"> · {new Date(orderRequest.requested_at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
          {orderRequest.memo && <div className="mt-0.5 text-blue-800">&ldquo;{orderRequest.memo}&rdquo;</div>}
          {!canEdit && <div className="mt-1 text-[0.6875rem] text-blue-700">상담 내용은 수정할 수 없고, 아래 &lsquo;주문서로 전환&rsquo;으로 주문을 입력합니다. 고칠 부분은 주문서에서 바꾸세요. 주문 입력 후 주문 상세에서 &lsquo;완료 회신&rsquo;을 보내야 요청이 완료됩니다.</div>}
          {canUnable && (unableOpen ? (
            <div className="mt-2">
              <textarea value={unableMemo} onChange={e => setUnableMemo(e.target.value)} rows={2}
                placeholder="처리 불가 사유 (필수) — 예: 요청 품목 전부 품절, 대체 상품 고객 확인 필요"
                className="w-full border border-red-300 rounded-lg px-3 py-2 text-sm bg-white text-gray-900" />
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[0.6875rem] text-blue-700">보내면 요청이 {orderRequest.requested_by_name ?? '요청자'}에게 되돌아가고, 내 목록에서 빠집니다.</span>
                <span className="flex-1" />
                <button type="button" onClick={() => setUnableOpen(false)} className="px-2.5 py-1 text-xs text-gray-500">취소</button>
                <button type="button" onClick={submitUnable} disabled={unableBusy}
                  className="px-3 py-1 text-xs rounded-lg bg-red-600 text-white disabled:opacity-50">{unableBusy ? '보내는 중...' : '처리 불가 회신 보내기'}</button>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-right">
              <button type="button" onClick={() => setUnableOpen(true)}
                className="px-3 py-1 text-xs rounded-lg border border-red-300 text-red-700 bg-white hover:bg-red-50">처리 불가 회신</button>
            </div>
          ))}
        </div>
      )}
      {!converted && !closed && !deleted && orderRequest && !isAssignee && (
        <div className="mt-3 px-4 py-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg">
          <b>{orderRequest.assignee_name ?? ''}</b>에게 주문 진행을 요청했습니다 — 주문 입력 · 완료 회신이 오면 알림이 옵니다.
        </div>
      )}
      {error && <div className="mt-3 px-4 py-2.5 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}
      {notice && <div className="mt-3 px-4 py-2.5 bg-emerald-50 text-emerald-700 text-sm rounded-lg">{notice}</div>}

      {/* 상담 정보 — 실물 컬럼 순서 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
        <div className="text-sm font-bold text-gray-900 mb-3">
          상담 정보 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">필수는 상담일·구분뿐 — 아는 만큼만</span>
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
                    const individual = !!groups.find(g => g.id === id)?.is_individual
                    if (individual) { setVendorId(null); setBranchText(''); setContactId(null) }
                    else if (branches.length === 1) { setVendorId(branches[0].id); setBranchText('') }
                  }
                }}
                placeholder="마스터 검색 · 신규명 자유 입력" />
            )}
          </div>
          <div className="col-span-2">
            <label className={label}>부서(지점)</label>
            {locked ? <div className={free}>{branchText || '-'}</div> : (
              <ComboFree text={branchText}
                selectedId={indPick ? null : vendorId}
                options={(groupId ? vendors.filter(v => v.group_id === groupId) : vendors)
                  .filter(v => !v.individual_contact_id && (!indMode || isMoimVendor(v, selGroup?.name)))
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
                placeholder={indMode ? '개인 고객은 지점 없음 — 모임만 선택' : '지점 검색 · 자유 입력'} />
            )}
          </div>

          <div className="col-span-2">
            <label className={label}>{indPick ? '고객(주문자)' : '담당자'}</label>
            {locked ? <div className={free}>{managerText || '-'}</div> : indPick ? (
              <ComboFree text={managerText} selectedId={contactId}
                options={indCustomers.map(c => ({
                  id: c.contact_id,
                  label: contactLabel(c.name, c.title),
                  sub: [employees.find(e => e.id === c.staff_employee_id)?.name ? `다올 ${employees.find(e => e.id === c.staff_employee_id)?.name}` : '', c.phone ?? ''].filter(Boolean).join(' · '),
                }))}
                onChange={({ id, text }) => {
                  const c = id ? indCustomers.find(x => x.contact_id === id) : undefined
                  if (c) { pickIndividual(c); return }
                  // 자유 입력: 저장 때 같은 이름의 개인 고객이 하나면 연결, 없으면 새 고객으로 등록된다
                  setContactId(null); setManagerText(text)
                  if (selVendor?.individual_contact_id) setVendorId(null)
                }}
                placeholder="개인 고객 검색 · 자유 입력" />
            ) : (
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
                    if (c?.tel) setTel(c.tel)          // 유선도 마스터에서 (116)
                  }
                }}
                placeholder={vendorId ? '담당자 선택 · 자유 입력' : '자유 입력 (지점 선택 시 마스터 검색)'} />
            )}
            {/* 고객별 다올 담당 (112) — 주문 전환 시 상담자가 됨 (상담일지 작성자 아님) */}
            {contactId && (() => {
              const c = contacts.find(x => x.contact_id === contactId)
                ?? (indPick ? indCustomers.find(x => x.contact_id === contactId) : undefined)
              if (!c) return null
              const staff = c.staff_employee_id ? employees.find(e => e.id === c.staff_employee_id)?.name ?? '등록됨' : null
              return staff
                ? <div className="text-[0.625rem] text-gray-500 mt-0.5">이 고객의 다올 담당: <b>{staff}</b> (주문 시 상담자)</div>
                : <div className="text-[0.625rem] text-amber-700 mt-0.5">이 고객의 다올 담당 미기입 — 주문 입력 때 고른 상담자가 다올 담당으로 저장됩니다</div>
            })()}
          </div>
          {/* 연락처 → 마스터 반영 (116): 마스터가 비어 있으면 저장 때 채워지고, 다르면 안내만 (덮어쓰지 않음) */}
          {(() => {
            const c = contacts.find(x => x.contact_id === contactId)
            const hint = (mine: string, master: string | null | undefined) => {
              if (!c) return null
              if (!mine.trim()) return null
              if (!master?.trim()) return <div className="text-[0.625rem] text-gray-400 mt-0.5">저장하면 담당자 마스터에도 기록됩니다</div>
              if (normTel(master) !== normTel(mine)) return <div className="text-[0.625rem] text-amber-700 mt-0.5">마스터 번호와 다름 ({master}) — 이 상담에만 기록</div>
              return null
            }
            return (
              <>
                <div>
                  <label className={label}>핸드폰</label>
                  <input value={phone} disabled={locked} onChange={e => setPhone(e.target.value)} className={free} placeholder="010-" />
                  {hint(phone, c?.phone)}
                </div>
                <div>
                  <label className={label}>연락처(유선)</label>
                  <input value={tel} disabled={locked} onChange={e => setTel(e.target.value)} className={free} placeholder="02-" />
                  {hint(tel, c?.tel)}
                </div>
              </>
            )
          })()}
          {/* 상태·기타사항은 품목별 입력으로 이동 (509, 실무자 요청) — 이전 기록만 표시 */}
          {(productStatus || optionNote) && (
            <div className="col-span-2 md:col-span-6 text-xs text-gray-400">
              이전 기록(상담 단위): {[productStatus && `상태 ${productStatus}`, optionNote && `기타 ${optionNote}`].filter(Boolean).join(' · ')}
              <span className="ml-1.5">— 이제 상담 품목의 행별 상태·기타사항 칸에 입력합니다</span>
            </div>
          )}
        </div>

        {/* 신규 매출처 인라인 등록 (2026-08-26 사용자 확정) — 자유 입력분을 그 자리에서
            마스터에 올린다. 정규화 동일명이 있으면 새로 만들지 않고 연결 (중복 방지). */}
        {!locked && !isParttime && indPick && needsRegister && !addingIndividual && (
          <div className="mt-3 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2 flex-wrap">
            <span>자유 입력한 고객이 개인 고객 목록에 없습니다 — 저장하면 같은 이름의 개인 고객이 하나일 때 그 고객으로, 없으면 새 고객으로 등록됩니다. 직함 · 전화 · 다올 담당까지 지금 넣으려면 등록하세요.</span>
            <button type="button" onClick={() => setAddingIndividual(true)}
              className="ml-auto px-3 py-1 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700">
              + 개인 고객 등록
            </button>
          </div>
        )}
        {!locked && !isParttime && indPick && addingIndividual && groupId && (
          <IndividualRegister
            groupId={groupId}
            employees={employees}
            initial={(() => {
              const t = managerText.trim().replace(/님$/, '').trim().split(/\s+/)
              return { name: t[0] ?? '', title: t.slice(1).join(' '), phone: phone.trim() }
            })()}
            onCancel={() => setAddingIndividual(false)}
            onPick={pickIndividual}
            onDone={async r => {
              const mRes = await fetch('/api/orders-portal/masters')
              const m = await mRes.json().catch(() => ({}))
              if (mRes.ok) setVendors(m.vendors ?? [])
              await loadIndCustomers(groupId)
              setVendorId(r.vendor_id); setBranchText(''); setContactId(r.contact_id)
              if (r.phone) setPhone(r.phone)
              setAddingIndividual(false)
              setNotice('개인 고객을 등록했습니다 — 고객 전용 매출처가 함께 만들어졌습니다.')
            }}
          />
        )}
        {!locked && !isParttime && !indPick && needsRegister && !regOpen && (
          <div className="mt-3 px-3.5 py-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center gap-2 flex-wrap">
            <span>
              {!vendorId
                ? '자유 입력한 업체·지점이 매출처 마스터에 없습니다 — 등록하면 매출처 목록에 반영되고 주문 전환 시 바로 쓸 수 있습니다.'
                : '자유 입력한 담당자가 마스터에 없습니다 — 등록하면 담당자 목록에 반영됩니다.'}
            </span>
            <button type="button" onClick={openRegister}
              className="ml-auto px-3 py-1 bg-amber-600 text-white rounded-lg font-medium hover:bg-amber-700">
              + 매출처 마스터 등록
            </button>
          </div>
        )}
        {!locked && !isParttime && regOpen && (
          <div className="mt-3 p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
            <div className="text-xs font-bold text-gray-700 mb-2">
              신규 매출처 등록 <span className="font-normal text-gray-400 ml-1">이름이 같은 기존 지점·담당자가 있으면 새로 만들지 않고 연결됩니다</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-x-3 gap-y-2">
              <div>
                <label className={label}>업체명 {groupId && <span className="text-blue-600">(선택됨)</span>}</label>
                <input value={regGroupName} disabled={!!groupId || regBusy}
                  onChange={e => setRegGroupName(e.target.value)}
                  className={free} placeholder="예: 하나은행" />
              </div>
              <div>
                <label className={label}>지점명 <span className="text-gray-400">(없으면 단일 업체)</span></label>
                <input value={regBranch} disabled={regBusy || !!vendorId}
                  onChange={e => setRegBranch(e.target.value)}
                  className={free} placeholder="예: 오류동지점" />
              </div>
              <div>
                <label className={label}>담당자 이름 <span className="text-gray-400">(직함 제외)</span></label>
                <input value={regContactName} disabled={regBusy}
                  onChange={e => setRegContactName(e.target.value)}
                  className={free} placeholder="예: 권오병" />
              </div>
              <div>
                <label className={label}>직함</label>
                <input value={regContactTitle} disabled={regBusy}
                  onChange={e => setRegContactTitle(e.target.value)}
                  className={free} placeholder="예: 부장" />
              </div>
              <div>
                <label className={label}>핸드폰</label>
                <input value={regContactPhone} disabled={regBusy}
                  onChange={e => setRegContactPhone(e.target.value)}
                  className={free} placeholder="010-" />
              </div>
              <div>
                <label className={label}>다올 담당 {regContactName.trim() && <em className="not-italic text-red-500">*</em>}</label>
                <select value={regStaff} disabled={regBusy} onChange={e => setRegStaff(e.target.value)}
                  className="w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm">
                  <option value="">선택</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-2.5">
              <span className="text-[0.6875rem] text-gray-400">
                인물 마스터에는 이름만 저장됩니다 — 직함은 배정 정보로, 존칭은 표시에서 붙습니다.
              </span>
              <span className="ml-auto flex gap-2">
                <button type="button" disabled={regBusy} onClick={() => setRegOpen(false)}
                  className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs text-gray-600">닫기</button>
                <button type="button" disabled={regBusy} onClick={registerVendor}
                  className="px-3.5 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-medium disabled:opacity-50">
                  {regBusy ? '등록 중...' : '마스터에 등록'}
                </button>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 상담 품목 — 주문 입력과 동일 규칙 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3 overflow-x-auto">
        <div className="text-sm font-bold text-gray-900 mb-3">
          상담 품목 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">품번 검색 시 원가표 기준 자동 — 수정 가능</span>
        </div>
        <SeasonDatalist id="consult-season-options" options={seasonOptions(consultDate, [...usedSeasons, ...items.map(x => x.order_season)])} />
        <table className="w-full text-xs min-w-[1680px] table-fixed">
          <colgroup>
            {/* 품번 폭을 상품명과 비슷하게 — 드롭다운 가독 (사용자 피드백 6) */}
            <col className="w-[14%]" /><col className="w-[14%]" /><col className="w-16" /><col className="w-[5rem]" /><col className="w-12" />
            <col className="w-[4.25rem]" /><col className="w-[5.5rem]" /><col className="w-[5.5rem]" />
            <col className="w-[5.5rem]" /><col className="w-24" />
            <col className="w-[5.5rem]" /><col className="w-[5.5rem]" /><col className="w-[6.75rem]" /><col className="w-[5.5rem]" /><col className="w-[5.5rem]" /><col className="w-8" />
          </colgroup>
          <thead>
            <tr className="bg-gray-50 text-gray-500 border-b border-gray-200">
              <th className="py-1.5 px-1.5 text-left font-medium">품번 검색</th>
              <th className="py-1.5 px-1.5 text-left font-medium">상품명</th>
              <th className="py-1.5 px-1.5 text-left font-medium" title="지점 배송 · 개별 배송 · 샘플 — 가격 규칙과 배송지 · 배송명단 적용이 달라집니다">배송종류</th>
              <th className="py-1.5 px-1.5 text-left font-medium" title="상시 · 26설 · 26추석 등 — 목록에서 고르거나 직접 입력">주문시기</th>
              <th className="py-1.5 px-1.5 text-right font-medium">수량</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="원가표 카톤단위 — 자동 표기">카톤</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매가</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="정액(행당 금액) 또는 개당 할인">판매할인</th>
              <th className="py-1.5 px-1.5 text-right font-medium">판매합계</th>
              <th className="py-1.5 px-1.5 text-left font-medium">매입처</th>
              <th className="py-1.5 px-1.5 text-right font-medium">매입가</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="정액(행당 금액) 또는 개당 할인 — 매입합계 · 발주서 금액에 반영">매입할인</th>
              <th className="py-1.5 px-1.5 text-left font-medium" title="수량 기준 카톤단위/카톤외 자동 구분 — 수정 가능">매입배송비</th>
              <th className="py-1.5 px-1.5 text-right font-medium" title="매입가 × 수량 + 매입배송비 − 매입할인">매입합계</th>
              <th className="py-1.5 px-1.5 text-right font-medium">마진</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              // 옵션 추가 후보: 같은 매입처의 부가상품 (본 상품 행에만 노출)
              const isMain = !it.parent_uid && !it.is_shipping
              // 부가상품 + 배송비 품목(703) — 같은 매입처만
              const addonCands = !locked && isMain && it.purchase_vendor_name
                ? products.filter(p => (p.is_addon || p.is_shipping) && p.purchase_vendor_name === it.purchase_vendor_name)
                : []

              // 배송비 행 (702) — 이름 고정, 수량·금액만 수정. 주문 전환 시 본 상품 배송비로 합산
              // 702 의사 행(품목 미연결 배송비)만 특수 렌더 — 703 배송비 품목은 일반 행
              if (it.is_shipping && !it.product_id) {
                return (
                <tr key={it.uid} className="border-b border-gray-50 align-top bg-amber-50/40">
                  <td className="py-1 px-1.5">
                    <div className="flex items-center gap-1 text-xs text-gray-600 px-1.5 py-1">
                      <span className="text-gray-400 shrink-0">└</span>
                      <span className="font-medium">{it.item_name}</span>
                    </div>
                  </td>
                  <td className="py-1 px-1.5">
                    <div className="text-[0.6875rem] text-gray-400 px-1.5 py-1">
                      {it.item_name === '배송비(카톤단위)' ? '카톤 수 × 카톤택배비 (수정 가능)' : '낱개·택배 등 (금액 직접 입력)'}
                    </div>
                  </td>
                  <td className="py-1 px-1.5 text-center text-gray-300 text-xs">-</td>
                  <td className="py-1 px-1.5 text-center text-gray-300 text-xs">-</td>
                  <td className="py-1 px-1.5 text-right">
                    <input value={it.quantity || ''} disabled={locked} onChange={e => setQuantity(i, toInt(e.target.value))}
                      className={numCell} placeholder="1" />
                  </td>
                  <td className="py-1 px-1.5 text-center text-gray-300 text-xs">-</td>
                  <td className="py-1 px-1.5 text-right">
                    <input value={it.sale_price ? won(it.sale_price) : ''} disabled={locked}
                      onChange={e => setItem(i, { sale_price: toInt(e.target.value) })} className={numCell} placeholder="0" />
                  </td>
                  <td className="py-1 px-1.5 text-center text-gray-300 text-xs">-</td>
                  <td className="py-1 px-1.5 text-right">
                    <div className={autoCell + ' font-semibold text-gray-700'}>{won(lineTotal(it))}</div>
                  </td>
                  {/* 매입처 · 매입가 · 매입할인 · 매입배송비 · 매입합계 · 마진 */}
                  {Array.from({ length: 6 }, (_, k) => (
                    <td key={k} className="py-1 px-1.5 text-center text-gray-300 text-xs">-</td>
                  ))}
                  <td className="py-1 px-1 text-center">
                    {!locked && (
                      <button type="button" onClick={() => removeRow(it.uid)}
                        className="text-red-400 hover:text-red-600 text-sm" title="배송비 행 삭제">✕</button>
                    )}
                  </td>
                </tr>
                )
              }

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
                          note: p.status_note ?? undefined,
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
                <td className="py-1 px-1.5">
                  <SeasonInput value={it.order_season} disabled={locked} listId="consult-season-options"
                    normalize={normalizeSeason} onChange={v => setItem(i, { order_season: v })} />
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
                  {/* 할인 — 정액(행당 금액) / 단가(개당 원 × 수량 자동) 구분 (704) */}
                  <select value={it.discount_mode} disabled={locked}
                    onChange={e => {
                      const mode = e.target.value as '정액' | '단가'
                      setItem(i, mode === '단가'
                        ? { discount_mode: mode, discount_amount: (it.discount_unit || 0) * it.quantity }
                        : { discount_mode: mode, discount_unit: 0 })
                    }}
                    className="w-full border border-blue-200 bg-blue-50/40 rounded px-1 py-0.5 text-[0.625rem] mb-0.5 disabled:opacity-60">
                    <option value="정액">정액</option>
                    <option value="단가">개당</option>
                  </select>
                  <input
                    value={it.discount_mode === '단가'
                      ? (it.discount_unit ? won(it.discount_unit) : '')
                      : (it.discount_amount ? won(it.discount_amount) : '')}
                    disabled={locked}
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
                <td className="py-1 px-1.5">
                  <input value={it.purchase_vendor_name} disabled={locked}
                    onChange={e => setItem(i, { purchase_vendor_name: e.target.value })}
                    title={it.purchase_vendor_name}
                    className="w-full border border-gray-200 bg-gray-50 rounded px-1.5 py-1 text-xs disabled:opacity-60" />
                </td>
                <td className="py-1 px-1.5 text-right">
                  <input value={it.purchase_price ? won(it.purchase_price) : ''} disabled={locked}
                    onChange={e => setItem(i, { purchase_price: toInt(e.target.value) })} className={numCell} placeholder="0" />
                  {/* 품목별 매입가 합계 = 매입가 × 수량 (사용자 확정 2026-10-16) */}
                  {it.purchase_price > 0 && it.quantity > 0 && (
                    <div className="text-[0.625rem] text-gray-400 mt-0.5 tabular-nums">합계 {won(it.purchase_price * it.quantity)}</div>
                  )}
                </td>
                <td className="py-1 px-1.5 text-right">
                  {/* 매입할인 (708) — 정액(행당) / 개당. 매입합계 · 발주서 금액에 반영 */}
                  <DiscountInput mode={it.purchase_discount_mode} unit={it.purchase_discount_unit} amount={it.purchase_discount}
                    quantity={it.quantity} disabled={locked} className={numCell}
                    onChange={d => setItem(i, { purchase_discount_mode: d.mode, purchase_discount_unit: d.unit, purchase_discount: d.amount })} />
                </td>
                <td className="py-1 px-1.5">
                  {/* 매입배송비 — 수량 기준 카톤단위/카톤외 자동 구분 (수정 가능, 704 확정) */}
                  <input value={it.purchase_shipping ? won(it.purchase_shipping) : ''} disabled={locked}
                    onChange={e => setItem(i, { purchase_shipping: toInt(e.target.value) })}
                    title={purchaseShippingHint(it) ?? '카톤 정보가 없는 품목 — 직접 입력'}
                    className={numCell} placeholder="0" />
                  {purchaseShippingHint(it) && (
                    <div className="text-[0.625rem] text-gray-400 mt-0.5">{purchaseShippingHint(it)!.replace('자동 계산: ', '').replace(' (수정 가능)', '')}</div>
                  )}
                </td>
                <td className="py-1 px-1.5 text-right">
                  <div className={autoCell + ' font-semibold text-gray-700'}>{won(lineCost(it))}</div>
                </td>
                <td className="py-1 px-1.5 text-right">
                  {(() => {
                    const total = lineTotal(it)
                    const margin = total - lineCost(it)
                    const pct = total > 0 ? Math.round((margin / total) * 1000) / 10 : null
                    return (
                      <div className={`${autoCell} ${margin >= 0 ? 'text-emerald-700' : 'text-red-500'}`}>
                        {won(margin)}
                        {/* 마진율(%) 표기 — 실무자 요청 */}
                        {pct !== null && <div className="text-[0.625rem] font-normal">{pct}%</div>}
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
                <td colSpan={16} className="pb-1.5 pt-0 px-1.5">
                  <div className="flex items-center gap-2 pl-4 flex-wrap">
                    <span className="text-[0.625rem] text-gray-400 shrink-0">상태</span>
                    <input value={it.status} disabled={locked}
                      onChange={e => setItem(i, { status: e.target.value })}
                      placeholder="품절·단가변경 등 (품절 상품 선택 시 자동)"
                      className={`w-56 border rounded px-1.5 py-0.5 text-[0.6875rem] disabled:opacity-60 ${
                        it.status ? 'border-red-200 bg-red-50/40 text-red-700' : 'border-gray-200 bg-gray-50'}`} />
                    {priceChanged(it) && (
                      <span className="inline-block whitespace-nowrap px-1.5 py-0.5 rounded text-[0.625rem] font-medium bg-amber-100 text-amber-800"
                        title="입력 판매가가 원가표 자동가와 다릅니다 — 저장 시 상태에 병기">단가변경</span>
                    )}
                    <span className="text-[0.625rem] text-gray-400 shrink-0 ml-2">색상·옵션 등 기타</span>
                    <input value={it.option_note} disabled={locked}
                      onChange={e => setItem(i, { option_note: e.target.value })}
                      placeholder="색상, 각인 문구 등"
                      className="flex-1 min-w-48 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5 text-[0.6875rem] disabled:opacity-60" />
                    <span className="text-[0.625rem] text-gray-400 shrink-0 ml-2">비고</span>
                    <input value={it.memo} disabled={locked}
                      onChange={e => setItem(i, { memo: e.target.value })}
                      className="flex-1 min-w-40 border border-gray-200 bg-gray-50 rounded px-1.5 py-0.5 text-[0.6875rem] disabled:opacity-60" />
                  </div>
                </td>
              </tr>
              {addonCands.length > 0 && (
                <tr className="border-b border-gray-50">
                  <td colSpan={16} className="pb-1.5 pt-0 px-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap pl-4">
                      <span className="text-[0.625rem] text-gray-400">옵션 추가 ({it.purchase_vendor_name})</span>
                      {addonCands.map(p => (
                        <button key={p.id} type="button" onClick={() => addAddon(i, p)}
                          className={p.is_shipping
                            ? 'px-2 py-0.5 border border-amber-300 bg-amber-50 text-amber-800 rounded-full text-[0.6875rem] hover:bg-amber-100'
                            : 'px-2 py-0.5 border border-violet-200 bg-violet-50/60 text-violet-700 rounded-full text-[0.6875rem] hover:bg-violet-100'}>
                          + {p.item_name}
                          {p.is_shipping
                            ? (p.purchase_price > 0 ? ` (매입 ${won(p.purchase_price)})` : '')
                            : (p.sale_price > 0 ? ` (${won(p.sale_price)})` : '')}
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
          <button type="button"
            onClick={() => setItems(prev => [...prev, { ...emptyItem(nextUid()), order_season: [...prev].reverse().find(x => x.order_season)?.order_season ?? '' }])}
            className="mt-2 px-3.5 py-1.5 border border-dashed border-gray-300 rounded-lg text-xs text-gray-500 hover:border-gray-400">
            + 품목 행 추가
          </button>
        )}
        <div className="flex gap-5 text-sm mt-3 flex-wrap">
          <span>예상 합계 <b className="tabular-nums">{won(totals.total)}원</b></span>
          {totals.discount > 0 && (
            <span className="text-red-600">판매할인 합계 <b className="tabular-nums">-{won(totals.discount)}원</b></span>
          )}
          {/* 매입 합계 = 매입가×수량 + 매입배송비 − 매입할인 (마진 공식과 동일 기준 — 합계 − 매입 = 마진) */}
          <span className="text-gray-600">매입 합계 <b className="tabular-nums">{won(totals.cost)}원</b>
            <span className="text-[0.6875rem] text-gray-400 ml-1">배송비 포함{totals.purchaseDiscount > 0 ? ` · 매입할인 -${won(totals.purchaseDiscount)}원 반영` : ''}</span>
          </span>
          <span>예상 마진 <b className="tabular-nums text-emerald-700">{won(totals.margin)}원</b>
            {totals.total > 0 && (
              <span className="text-xs text-emerald-700 ml-1">({Math.round((totals.margin / totals.total) * 1000) / 10}%)</span>
            )}
          </span>
        </div>
      </div>

      {/* 결제 정보 — 발송 정보와 분리 (사용자 피드백 1) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="text-sm font-bold text-gray-900 mb-3">
          결제 정보 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">결제정보는 암호화 저장 · 계산서 발행용 포함</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
          <div className="col-span-2">
            <label className={label}>결제정보 <span className="text-blue-600">(암호화 저장)</span></label>
            {/* (b) 정책: 열람은 본인 작성분 또는 결제정보 열람 권한 계정만 */}
            {paymentLocked && (
              <div className="text-xs text-gray-400 mb-1">
                저장됨 — 열람 권한이 없습니다 (본인 작성분 또는 결제정보 열람 권한 계정만)
              </div>
            )}
            {paymentMasked && !payment && (
              <div className="text-xs text-gray-500 mb-1 tabular-nums">
                저장됨: {paymentRevealed ?? paymentMasked}
                {!paymentRevealed && (
                  <button type="button" onClick={revealPayment} className="ml-1.5 text-blue-600 hover:underline">[열람]</button>
                )}
              </div>
            )}
            <input value={payment} disabled={locked} onChange={e => setPayment(e.target.value)}
              placeholder={paymentMasked || paymentLocked ? '새 값 입력 시 교체 (비우면 유지)' : '카드번호 등 — 평문 입력, 암호화 저장'}
              className={free} />
          </div>
          {/* 계산서 발행용 정보 (509 — 실무자 요청) */}
          <div className="col-span-2 md:col-span-1">
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
        </div>
      </div>

      {/* 발송 정보 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mt-3">
        <div className="text-sm font-bold text-gray-900 mb-3">
          발송 정보 <span className="text-[0.6875rem] font-normal text-gray-400 ml-1">발주서·배송 관리(3단계)로 흘러감</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-x-3 gap-y-2.5">
          {/* 보내는분 명의 — 결제에서 발송으로 이동 (실무자 피드백 3, 선물대행배송 다수) */}
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
            <label className={label} title="명단 주소의 수령인에게 확인 전화를 했는지 — 배송지 기재란이 아님 (개별 주문용)">주소확인여부</label>
            <input value={addressChecked} disabled={locked} onChange={e => setAddressChecked(e.target.value)} className={free}
              placeholder="확인 전화 여부 (개별 주문)" />
          </div>
          <div>
            <label className={label}>고객명단수단</label>
            <input value={rosterMethod} disabled={locked} onChange={e => setRosterMethod(e.target.value)} className={free} placeholder="엑셀/문자 등" />
          </div>
          <div className="col-span-2 md:col-span-2">
            <label className={label}>메모 (감사 문구 등)</label>
            <textarea value={memo} rows={2} disabled={locked} onChange={e => setMemo(e.target.value)}
              className="w-full border border-amber-200 bg-amber-50/30 rounded-lg px-2.5 py-1.5 text-sm resize-y disabled:opacity-60" />
          </div>
        </div>

        {/* 배송지 (706, 2026-11-06) — 주문서 ShipCard 그대로. 신규만 자동 채움, 수정·복사는 저장값.
            주문 전환 시 여기 값이 주문처 최근 배송지보다 우선 (사용자 확정) */}
        {(() => {
          const c = contacts.find(x => x.contact_id === contactId)
          return (
            <div className="mt-3">
              <ShipCard
                value={ship} onChange={setShip} vendorId={vendorId}
                contactName={c ? contactLabel(c.name, c.title) : (managerText.trim() || null)}
                contactPhone={c?.phone ?? (phone || null)}
                autoFill={!isEdit && !copyId}
                applies={needsShip(items.filter(it => it.item_name.trim() && !it.is_shipping && !it.parent_uid).map(it => it.order_kind))}
                disabled={locked}
              />
            </div>
          )
        })()}

        {/* 개별 배송 명단 (707, 2026-11-09) — 개별 품목이 있을 때만. 저장된 상담에서 업로드, 전환 시 주문에 연결 */}
        <RosterCard
          consultationId={consultId ?? null}
          applies={items.some(it => it.item_name.trim() && !it.is_shipping && !it.parent_uid && !SHIP_KINDS.has(it.order_kind ?? '지점'))}
          isNew={!isEdit}
          disabled={locked}
          subject={[bankText, branchText].filter(Boolean).join(' ') + ' 상담' || undefined}
          newHint={copyId ? '복사한 상담을 저장하면 배송명단을 새로 올릴 수 있습니다(명단은 복사되지 않습니다).' : undefined}
        />

        {/* 주문 진행 요청 (705, 2026-11-05) — 상담만 하고 주문 입력은 다른 직원에게. 비우면 내가 직접 진행 */}
        {!locked && (() => {
          const picked = employees.find(e => e.id === reqAssignee)
          const ptBlock = picked?.employment_type === 'parttime' && (!vendorId || !contactId)
          return (
            <div className="mt-4 p-3 rounded-lg border border-blue-200 bg-blue-50/40">
              <div className="text-sm font-bold text-gray-900 mb-2">
                주문 진행 요청 <span className="text-[0.6875rem] font-normal text-gray-500 ml-1">상담만 하고 주문 입력은 다른 직원에게 맡길 때 · 비워두면 내가 직접 진행</span>
              </div>
              <div className="flex gap-3 flex-wrap items-start">
                <div className="w-64">
                  <label className={label}>주문 진행 담당</label>
                  <select value={reqAssignee} onChange={e => setReqAssignee(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white">
                    <option value="">요청 안 함 (내가 진행)</option>
                    {employees.map(e => (
                      <option key={e.id} value={e.id}>
                        {e.name}{[e.team, e.employment_type === 'parttime' ? '아르바이트' : e.position].filter(Boolean).length ? ` (${[e.team, e.employment_type === 'parttime' ? '아르바이트' : e.position].filter(Boolean).join(' · ')})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1 min-w-[16rem]">
                  <label className={label}>요청 메모 (선택)</label>
                  <input value={reqMemo} onChange={e => setReqMemo(e.target.value)} disabled={!reqAssignee}
                    placeholder="예: 11/10 출고 맞춰서 발주까지 부탁해요"
                    className="w-full border border-gray-300 rounded-lg px-2.5 py-1.5 text-sm bg-white disabled:bg-gray-50" />
                </div>
              </div>
              {ptBlock && (
                <div className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
                  이 상담은 주문처 · 담당자가 마스터에 연결되지 않았습니다. 아르바이트는 신규 거래처 · 담당자 등록이 막혀 있어 전환할 수 없습니다 — 먼저 연결하거나 다른 직원에게 요청하세요.
                </div>
              )}
              {reqAssignee && !ptBlock && (
                <div className="mt-1.5 text-[0.6875rem] text-gray-500">저장하면 {picked?.name ?? ''}님에게 알림(PC 알림 포함)이 갑니다. 그 직원은 이 상담을 열람 · 주문 전환만 할 수 있습니다.</div>
              )}
            </div>
          )
        })()}

        <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
          <span className="text-[0.6875rem] text-gray-400">
            저장 시 업무일지에 자동 기재됩니다
          </span>
          {!locked && (
            <span className="flex gap-2">
              <button disabled={saving} onClick={() => save(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 disabled:opacity-50">저장</button>
              {/* (b) 정책: 지점·담당자 마스터 연결이 끝난 상담만 주문 전환 */}
              <button disabled={saving || !vendorId || !contactId} onClick={() => save(true)}
                title={!vendorId || !contactId
                  ? '마스터 미연결 상담은 전환할 수 없습니다 — 위의 매출처 마스터 등록 또는 마스터 선택 후 전환해주세요'
                  : undefined}
                className="px-5 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
                {saving ? '저장 중...' : '저장 후 주문서로 전환'}
              </button>
            </span>
          )}
          {/* 요청받은 직원 (읽기 전용) — 저장 없이 바로 전환 */}
          {locked && !converted && (
            <span className="flex gap-2">
              {status === '진행중' && !deleted && (
                <button disabled={!vendorId || !contactId} onClick={() => router.push(`/orders/new?consult=${consultId}`)}
                  title={!vendorId || !contactId ? '마스터 미연결 상담은 전환할 수 없습니다 — 요청한 직원에게 연결을 부탁하세요' : undefined}
                  className="px-5 py-2 bg-blue-700 text-white rounded-lg text-sm font-semibold disabled:opacity-50">주문서로 전환</button>
              )}
              <button onClick={() => router.push('/orders/consultations')}
                className="px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600">목록으로</button>
            </span>
          )}
          {converted && (
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
