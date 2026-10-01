'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

// 주문 입력·상담일지 폼 공용 부품 — 마스터 타입, 품목 행 모델, 가격 규칙, 자동완성 콤보.
// 가격 규칙(구분별 자동)은 두 화면이 반드시 같아야 하므로 여기 한 곳에만 둔다.

export interface Vendor { id: string; name: string; type: string | null; group_id?: string | null }
export interface VendorGroup { id: string; name: string }
export interface Employee { id: string; name: string; position: string | null; team: string | null }
export interface ContactOpt { contact_id: string; name: string; phone: string | null; title: string | null; is_representative: boolean }
export interface Product {
  id: string; item_code: string | null; item_name: string; option_name: string | null
  purchase_vendor_name: string | null; category: string | null
  sale_price: number; individual_sale_price: number; purchase_price: number
  carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
  is_addon: boolean; is_active: boolean; is_soldout?: boolean; is_shipping?: boolean
}

export interface ItemDraft {
  uid: number                     // 행 식별자 (옵션 연결용, 화면 전용)
  parent_uid: number | null       // 옵션(부가상품) 행이 딸린 본 상품 행의 uid
  product_id: string | null
  item_code: string
  item_name: string
  order_kind: string
  purchase_vendor_name: string
  sale_price: number
  quantity: number
  shipping_fee: number
  discount_amount: number
  purchase_price: number
  purchase_shipping: number
  memo: string
  status: string                  // 품목 상태 (품절·단가변경 등 — 상담일지에서 사용)
  option_note: string             // 색상·옵션 등 기타사항 (품목별 — 상담일지에서 사용)
  is_shipping?: boolean           // 배송비 행 (상담일지 전용, 702)
  // 구분별 가격·카톤 배송비 자동 적용용 (품목 마스터에서 복사 — 서버 전송 안 함)
  branch_sale_price: number       // 지점판매가
  individual_sale_price: number   // 개별판매가 (배송비 포함, 0=미지정)
  branch_purchase_price: number   // 지점매입가
  carton_unit: number
  carton_shipping_fee: number     // 카톤당 택배비
  loose_shipping_fee: number      // 카톤외(낱개 1건) 택배비
}

export const emptyItem = (uid: number): ItemDraft => ({
  uid, parent_uid: null,
  product_id: null, item_code: '', item_name: '', order_kind: '지점',
  purchase_vendor_name: '', sale_price: 0, quantity: 1, shipping_fee: 0,
  discount_amount: 0, purchase_price: 0, purchase_shipping: 0, memo: '',
  status: '', option_note: '', is_shipping: false,
  branch_sale_price: 0, individual_sale_price: 0, branch_purchase_price: 0,
  carton_unit: 0, carton_shipping_fee: 0, loose_shipping_fee: 0,
})

// 배송비 행 이름 (상담 품목 — 702)
export const SHIPPING_ROW_NAMES = ['배송비(카톤단위)', '배송비(카톤외)'] as const

// 품명 칸 자동 높이 — 내용 길이에 맞춰 줄바꿈되어 항상 전체가 보인다
export const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}

// 지점 배송비 공식(사용자 확정): 꽉 찬 카톤 수 × 카톤택배비 + (나머지 낱개 있으면 카톤외택배비 1건)
export const cartonShipping = (unit: number, cartonFee: number, looseFee: number, qty: number) => {
  if (unit <= 0 || qty <= 0) return 0
  return Math.floor(qty / unit) * cartonFee + (qty % unit > 0 ? looseFee : 0)
}

// 지점(부서) 표시명 — 거래처 전체 이름에서 업체명 접두를 뗀다.
// "하나은행 경영지원실" + 업체 "하나은행" → "경영지원실". 접두가 없으면 전체 이름 그대로.
// 법인 접두("(주)", "㈜", "주식회사")는 양쪽에서 무시하고 매칭한다 —
// "(주)하나은행오류동지점" + "하나은행" → "오류동지점" (2026-08-18 보정, 702와 동일 규칙)
const stripCorpPrefix = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '')
export const branchLabel = (vendorName: string, groupName?: string | null): string => {
  if (!groupName) return vendorName
  const vn = stripCorpPrefix(vendorName)
  const gn = stripCorpPrefix(groupName)
  if (vn.startsWith(gn)) {
    const rest = vn.slice(gn.length).trim()
    return rest || vendorName
  }
  return vendorName
}

// 그룹 미연결 거래처의 업체명 접두 분리 — "하나은행오류동지점"처럼 그룹에 안 이어진
// 거래처도 이름이 어느 업체(그룹)명으로 시작하면 업체/지점으로 나눠 보여준다
// (실무자 지적 2026-08-19: 부서(지점)에 은행명이 붙어 나오는 잔존 사례의 원인)
export function splitByGroupPrefix(name: string, groups: { id: string; name: string }[]) {
  const g = groups
    .filter(x => name.startsWith(x.name) && name.length > x.name.length)
    .sort((a, b) => b.name.length - a.name.length)[0]   // 긴 이름 우선
  if (!g) return null
  const rest = name.slice(g.name.length).trim()
  return rest ? { group: g, branch: rest } : null
}

export const won = (n: number) => n.toLocaleString('ko-KR')
export const toInt = (s: string) => {
  const n = Number(s.replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}
export const lineTotal = (it: ItemDraft) => it.sale_price * it.quantity + it.shipping_fee - it.discount_amount

// 구분별 가격·배송비 규칙 (원가표 확정 구조)
//  지점: 지점판매가·지점매입가 + 배송비 = 꽉 찬 카톤×카톤택배비 + (낱개 있으면 카톤외택배비)
//  개별: 판매가 = 개별판매가(배송비 포함, 미지정이면 지점판매가+카톤외택배비),
//        매입가 = 지점매입가 + 카톤외택배비 (원가표의 '개별매입가' 파생 개념), 배송비 0
//  샘플: 판매용 견본 무상 발송 — 판매가 0·배송비 0, 매입가는 개별 방식 (사용자 확정)
export function priceRule(
  it: Pick<ItemDraft, 'order_kind' | 'branch_sale_price' | 'individual_sale_price' | 'branch_purchase_price' | 'carton_unit' | 'carton_shipping_fee' | 'loose_shipping_fee'>,
  qty: number,
): Partial<ItemDraft> {
  if (it.order_kind === '개별') {
    return {
      sale_price: it.individual_sale_price > 0
        ? it.individual_sale_price
        : it.branch_sale_price + it.loose_shipping_fee,
      purchase_price: it.branch_purchase_price + it.loose_shipping_fee,
      shipping_fee: 0,
    }
  }
  if (it.order_kind === '지점') {
    return {
      sale_price: it.branch_sale_price,
      purchase_price: it.branch_purchase_price,
      ...(it.carton_unit > 0
        ? { shipping_fee: cartonShipping(it.carton_unit, it.carton_shipping_fee, it.loose_shipping_fee, qty) }
        : {}),
    }
  }
  if (it.order_kind === '샘플') {
    return {
      sale_price: 0,
      shipping_fee: 0,
      purchase_price: it.branch_purchase_price + it.loose_shipping_fee,
    }
  }
  return {}
}

// 품목 마스터에서 행 초깃값 구성 (품번 선택 시)
export function draftFromProduct(p: Product, base: ItemDraft): Partial<ItemDraft> {
  const master = {
    order_kind: base.order_kind,
    branch_sale_price: p.sale_price,
    individual_sale_price: p.individual_sale_price ?? 0,
    branch_purchase_price: p.purchase_price,
    carton_unit: p.carton_unit ?? 0,
    carton_shipping_fee: p.carton_shipping_fee ?? 0,
    loose_shipping_fee: p.loose_shipping_fee ?? 0,
  }
  const draft: Partial<ItemDraft> = {
    product_id: p.id,
    item_code: p.item_code ?? '',
    item_name: p.item_name,
    purchase_vendor_name: p.purchase_vendor_name ?? '',
    sale_price: p.sale_price,
    purchase_price: p.purchase_price,
    status: p.is_soldout ? '품절' : '',   // 마스터 품절 자동표기 (수정 가능)
    is_shipping: !!p.is_shipping,
    ...master,
    ...priceRule({ ...base, ...master }, base.quantity || 1),
  }
  // 배송비 품목(703): 판매가 0 기본 — 배송비는 판매가에 녹이는 경우가 대부분 (수정 가능)
  if (p.is_shipping) draft.sale_price = 0
  return draft
}

// ── 자동완성 콤보 (마스터 선택 전용 — 목록에 없는 값은 확정 불가) ──
export function Combo({ value, display, options, onSelect, placeholder, required, footer }: {
  value: string | null
  display: string
  options: { id: string; label: string; sub?: string; soldout?: boolean }[]
  onSelect: (id: string | null) => void
  placeholder: string
  required?: boolean
  footer?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = text.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, 50)
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q),
    ).slice(0, 50)
  }, [options, q])

  return (
    <div ref={boxRef} className="relative">
      <input
        value={open ? text : display}
        onFocus={() => { setOpen(true); setText('') }}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm bg-blue-50/40 ${
          required && !value ? 'border-red-300' : 'border-blue-200'
        }`}
      />
      {open && (
        // 행 길이 확대(실무자 요청): 입력칸보다 넓게 펼쳐 긴 품명이 잘리지 않게 한다
        <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg
                        max-h-80 overflow-y-auto text-sm min-w-full w-max max-w-[34rem]">
          {filtered.map(o => (
            <button type="button" key={o.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onSelect(o.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-50 whitespace-normal leading-snug">
              {o.label}
              {o.soldout && (
                <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-[10px] font-medium bg-red-50 text-red-600 align-middle">품절</span>
              )}
              {o.sub && <span className="text-xs text-gray-400 ml-1.5">{o.sub}</span>}
            </button>
          ))}
          {!filtered.length && <div className="px-3 py-2 text-xs text-gray-400">일치하는 항목이 없습니다</div>}
          {footer}
        </div>
      )}
    </div>
  )
}

// ── 자유 입력 겸용 콤보 (상담일지 — 마스터에 없으면 입력한 문자열 그대로 사용) ──
export function ComboFree({ text, selectedId, options, onChange, placeholder }: {
  text: string
  selectedId: string | null
  options: { id: string; label: string; sub?: string }[]
  onChange: (patch: { id: string | null; text: string }) => void
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const q = text.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, 50)
    return options.filter(o =>
      o.label.toLowerCase().includes(q) || (o.sub ?? '').toLowerCase().includes(q),
    ).slice(0, 50)
  }, [options, q])

  return (
    <div ref={boxRef} className="relative">
      <input
        value={text}
        onFocus={() => setOpen(true)}
        onChange={e => onChange({ id: null, text: e.target.value })}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm ${
          selectedId ? 'bg-blue-50/40 border-blue-200' : 'bg-amber-50/30 border-amber-200'
        }`}
        title={selectedId ? '마스터 연결됨' : '자유 입력 (마스터 미연결)'}
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-20 top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-y-auto text-sm">
          {filtered.map(o => (
            <button type="button" key={o.id}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onChange({ id: o.id, text: o.label }); setOpen(false) }}
              className="w-full text-left px-3 py-1.5 hover:bg-blue-50 border-b border-gray-50">
              {o.label}
              {o.sub && <span className="text-xs text-gray-400 ml-1.5">{o.sub}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
