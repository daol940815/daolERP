'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fmtPurchasePrice, purchaseAmount, toPurchasePrice } from '@/lib/purchase-price'
import { shipBoxes } from '@/lib/ship-boxes'

// 주문 입력·상담일지 폼 공용 부품 — 마스터 타입, 품목 행 모델, 가격 규칙, 자동완성 콤보.
// 가격 규칙(구분별 자동)은 두 화면이 반드시 같아야 하므로 여기 한 곳에만 둔다.

export interface Vendor { id: string; name: string; type: string | null; group_id?: string | null; individual_contact_id?: string | null; parent_vendor_id?: string | null }

// 하위 조직(120) 경로 — 지점 검색 결과에 '본점 › 채널전략부 ›'처럼 상위 조직 단위를 붙인다(같은 이름 팀 구분용, 표시 전용).
// 단위 이름 = 매출처 이름에서 상위 조직 이름(없으면 업체명)을 뗀 것.
export function orgPathLabel(v: Vendor, byId: Map<string, Vendor>, groupName: string | null | undefined): string {
  const strip = (name: string, prefix: string | null | undefined) => {
    if (!prefix) return name
    const n = name.replace(/\s+/g, ''), p = prefix.replace(/\s+/g, '')
    if (!n.startsWith(p) || n === p) return name
    let i = 0, k = 0
    while (i < name.length && k < p.length) { if (name[i] !== ' ') k++; i++ }
    return name.slice(i).trim()
  }
  const units: string[] = []
  const seen = new Set<string>([v.id])
  let cur = v.parent_vendor_id ? byId.get(v.parent_vendor_id) : undefined
  while (cur && !seen.has(cur.id) && units.length < 6) {
    seen.add(cur.id)
    const parent = cur.parent_vendor_id ? byId.get(cur.parent_vendor_id) : undefined
    units.unshift(strip(cur.name, parent?.name ?? groupName))
    cur = parent
  }
  return units.join(' › ')
}
// 지점 검색 결과 보조 줄: 업체 › 상위 조직 단위들
export const orgSubLabel = (v: Vendor, byId: Map<string, Vendor>, groupName: string | null | undefined) =>
  [groupName ?? '', orgPathLabel(v, byId, groupName)].filter(Boolean).join(' › ')
export interface VendorGroup { id: string; name: string; is_individual?: boolean }
// 개인 고객 업체(115)의 고객 — 고객마다 전용 매출처(vendor_id)
export interface IndividualCustomerOpt {
  vendor_id: string; vendor_name: string; contact_id: string; name: string
  title: string | null; phone: string | null; code: string | null; staff_employee_id: string | null
}
// 개인 고객 업체의 지점 중 '모임'(심통회 등) — 고객 전용 매출처도, 입력 창구(업체명과 같은 이름)도 아닌 지점
export const isMoimVendor = (v: Vendor, groupName: string | undefined) =>
  !v.individual_contact_id && !!groupName && v.name.replace(/\s+/g, '') !== groupName.replace(/\s+/g, '')
export interface Employee { id: string; name: string; position: string | null; team: string | null }
export interface ContactOpt { contact_id: string; name: string; phone: string | null; tel?: string | null; title: string | null; is_representative: boolean; staff_employee_id?: string | null }
export interface Product {
  id: string; item_code: string | null; item_name: string; option_name: string | null
  purchase_vendor_name: string | null; category: string | null
  sale_price: number; individual_sale_price: number; purchase_price: number
  carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
  is_addon: boolean; is_active: boolean; is_soldout?: boolean; is_shipping?: boolean
  status_note?: string | null   // 원가표 상태 메모 원문 (512)
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
  discount_mode: '정액' | '단가'  // 할인 종류 (704) — discount_amount는 항상 최종 할인액
  discount_unit: number           // 단가 할인의 개당 할인액(원)
  purchase_price: number
  purchase_shipping: number
  purchase_discount: number                // 매입할인 최종 금액 (708) — 매입합계 = 매입가×수량 + 매입배송비 − 매입할인
  purchase_discount_mode: '정액' | '단가'  // 매입할인 종류 — 정액(행당 금액) / 단가(개당)
  purchase_discount_unit: number           // 개당 매입할인액(원)
  order_season: string                     // 주문시기 (708) — 상시 · 26설 · 26추석 …
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
  // 고객 택배비 박스당 단가 (화면 전용 — 저장은 shipping_fee 합계만, 2026-11-12 택배비 확정)
  // null = 합계 입력 상태(매입배송비 0 · 박스 수 불명 · 나누어떨어지지 않는 옛 값)
  ship_unit?: number | null
}

export const emptyItem = (uid: number): ItemDraft => ({
  uid, parent_uid: null,
  product_id: null, item_code: '', item_name: '', order_kind: '지점',
  purchase_vendor_name: '', sale_price: 0, quantity: 1, shipping_fee: 0,
  discount_amount: 0, discount_mode: '정액', discount_unit: 0,
  purchase_price: 0, purchase_shipping: 0,
  purchase_discount: 0, purchase_discount_mode: '정액', purchase_discount_unit: 0, order_season: '',
  memo: '',
  status: '', option_note: '', is_shipping: false,
  branch_sale_price: 0, individual_sale_price: 0, branch_purchase_price: 0,
  carton_unit: 0, carton_shipping_fee: 0, loose_shipping_fee: 0,
})

// 배송비 행 이름 (상담 품목 — 702)
export const SHIPPING_ROW_NAMES = ['배송비(카톤단위)', '배송비(카톤외)'] as const

// 수량 변경 시 함께 재계산할 값 (704·사용자 확정 2026-10-16):
//  - 단가 할인: 개당 할인액 × 수량 = 최종 할인액
//  - 매입배송비: 원가표 카톤 정보가 있으면 카톤단위/카톤외 자동 구분 (cartonShipping 공식,
//    수동 수정 가능 — 다음 수량 변경 시 다시 자동값으로)
export function quantityPatch(it: ItemDraft, qty: number): Partial<ItemDraft> {
  const base = quantityPatchBase(it, qty)
  // 고객 택배비: 박스당 단가 유지 × 새 박스 수 (2026-11-12 확정)
  return { ...base, ...reshipPatch({ ...it, ...base }) }
}
function quantityPatchBase(it: ItemDraft, qty: number): Partial<ItemDraft> {
  return {
    quantity: qty,
    ...(it.discount_mode === '단가' ? { discount_amount: (it.discount_unit || 0) * qty } : {}),
    ...(it.purchase_discount_mode === '단가' ? { purchase_discount: (it.purchase_discount_unit || 0) * qty } : {}),
    ...(it.carton_unit > 0
      ? { purchase_shipping: cartonShipping(it.carton_unit, it.carton_shipping_fee, it.loose_shipping_fee, qty) }
      : {}),
  }
}

// 매입배송비 자동 계산 내역 설명 (툴팁용)
export function purchaseShippingHint(it: ItemDraft): string | null {
  if (it.carton_unit <= 0 || it.quantity <= 0) return null
  const cartons = Math.floor(it.quantity / it.carton_unit)
  const loose = it.quantity % it.carton_unit > 0
  const parts: string[] = []
  if (cartons > 0) parts.push(`${cartons}카톤 × ${it.carton_shipping_fee.toLocaleString('ko-KR')}`)
  if (loose) parts.push(`낱개 ${it.loose_shipping_fee.toLocaleString('ko-KR')}`)
  return parts.length ? `자동 계산: ${parts.join(' + ')} (수정 가능)` : null
}

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

// ── 고객 택배비 '택배비(판매)' (2026-11-12 사용자 확정, DB 변경 없음) ──
//  박스 수 (2026-11-17 확정, lib/ship-boxes.ts): 매입배송비가 자동 계산값 그대로면 수량으로 센다 — 꽉 찬 카톤 수 + 낱개 1박스.
//  사람이 고친 매입배송비는 박스당 택배비(카톤택배비, 없으면 카톤외택배비)로 나누어떨어질 때만 (아니면 null)
//  지점 품목만 입력: 박스 수가 있으면 박스당 단가 입력(합계 = 박스 수 × 단가), 없으면 받는 금액(합계) 그대로.
//  저장은 기존 판매 배송비(shipping_fee)에 합계. 기본값 0원. 발주서 택배비 줄과 같은 규칙(lib/po-form.ts).
export const boxFeeOf = (it: Pick<ItemDraft, 'carton_shipping_fee' | 'loose_shipping_fee'>) =>
  (it.carton_shipping_fee || 0) > 0 ? it.carton_shipping_fee : (it.loose_shipping_fee || 0)
export function boxCountOf(it: Pick<ItemDraft, 'purchase_shipping' | 'carton_shipping_fee' | 'loose_shipping_fee' | 'carton_unit' | 'quantity'>): number | null {
  return shipBoxes(it).boxes
}
// 칸 안내용 박스 구성 글 (2카톤 × 4,000 + 낱개 1 × 3,500)
export function boxBreakdown(it: Pick<ItemDraft, 'purchase_shipping' | 'carton_shipping_fee' | 'loose_shipping_fee' | 'carton_unit' | 'quantity'>): string {
  const r = shipBoxes(it)
  if (!r.boxes) return ''
  if (r.composed) {
    const cartons = Math.floor((it.quantity || 0) / (it.carton_unit || 1))
    const loose = r.boxes - cartons
    return [cartons ? `${cartons}카톤 × ${won(it.carton_shipping_fee || 0)}` : '', loose ? `낱개 1 × ${won(it.loose_shipping_fee || 0)}` : '']
      .filter(Boolean).join(' + ')
  }
  return `매입배송비 ${won(it.purchase_shipping || 0)} ÷ ${won(r.lines[0]?.fee ?? 0)}`
}
export const customerShipApplies = (it: Pick<ItemDraft, 'order_kind'>) => it.order_kind === '지점'

// 저장값(합계)에서 화면 상태 복원 — 나누어떨어지면 박스당 단가, 아니면 합계 그대로(null)
export function shipUnitFromTotal(it: Pick<ItemDraft, 'order_kind' | 'shipping_fee' | 'purchase_shipping' | 'carton_shipping_fee' | 'loose_shipping_fee' | 'carton_unit' | 'quantity'>): number | null {
  if (!customerShipApplies(it)) return null
  const boxes = boxCountOf(it)
  if (!boxes) return null
  const fee = it.shipping_fee || 0
  return fee % boxes === 0 ? fee / boxes : null
}

export const withShipUnit = (d: ItemDraft): ItemDraft => ({ ...d, ship_unit: shipUnitFromTotal(d) })

// 수량 · 매입배송비 · 구분이 바뀐 뒤 고객 택배비 재계산 (patch를 적용한 다음 상태를 받는다)
//  - 박스 수 있음 + 박스당 단가 있음 → 단가 유지 × 새 박스 수
//  - 박스 수 있음 + 단가 없음(합계 상태) → 나누어떨어지면 단가로 전환, 아니면 합계 유지(확인 표시)
//  - 박스 수 없음(매입배송비 0 등) → 마지막 합계 유지, 합계 입력 상태로 (남는 문제 '가' — 고객 택배비가 소리 없이 0이 되지 않게)
export function reshipPatch(next: ItemDraft): Partial<ItemDraft> {
  if (!customerShipApplies(next)) return { ship_unit: null }
  const boxes = boxCountOf(next)
  if (!boxes) return { ship_unit: null }
  if (next.ship_unit != null) return { shipping_fee: next.ship_unit * boxes }
  const fee = next.shipping_fee || 0
  return fee % boxes === 0 ? { ship_unit: fee / boxes } : {}
}

// '택배비(판매)' 칸 배포 기준 시각 (남는 문제 '라' — 마지막 저장 시각 기준).
// 상담일지의 updated_at이 이보다 이전이면 702 이전 호환 변환(판매 배송비 → 배송비(카톤외) 행)을 적용한다.
// 702 이후 상담일지 화면은 판매 배송비를 늘 0으로 저장했으므로, 이 시각 이후 저장분의 판매 배송비는 새 칸의 값이다.
export const SHIP_COLUMN_SINCE = Date.parse('2026-11-12T00:00:00+09:00')
export const savedBeforeShipColumn = (updatedAt: unknown) => {
  const t = typeof updatedAt === 'string' ? Date.parse(updatedAt) : NaN
  return !Number.isFinite(t) || t < SHIP_COLUMN_SINCE
}

// '택배비(판매)' 칸에 값 입력
export function customerShipInput(it: ItemDraft, v: number): Partial<ItemDraft> {
  const boxes = customerShipApplies(it) ? boxCountOf(it) : null
  return boxes ? { ship_unit: v, shipping_fee: v * boxes } : { ship_unit: null, shipping_fee: v }
}

// ── '택배비(판매)' 입력 칸 (상담일지 · 주문서 공용) ──
export function CustomerShipInput({ it, disabled, onChange, className }: {
  it: ItemDraft; disabled?: boolean; onChange: (patch: Partial<ItemDraft>) => void; className: string
}) {
  if (!customerShipApplies(it)) {
    // 지점 품목만 입력 — 개별 · 샘플은 비활성. 옛 값이 남아 있으면 그대로 보여준다(합계 불변)
    return (
      <div className="text-xs text-gray-400 text-right tabular-nums py-1" title="택배비(판매)는 지점 품목만 입력합니다">
        {it.shipping_fee ? won(it.shipping_fee) : '—'}
      </div>
    )
  }
  const boxes = boxCountOf(it)
  const perBox = !!boxes && it.ship_unit != null
  const needCheck = !!boxes && it.ship_unit == null && (it.shipping_fee || 0) > 0
  const shown = perBox ? it.ship_unit! : (it.shipping_fee || 0)
  return (
    <>
      <NumInput value={shown ? won(shown) : ''} disabled={disabled}
        onChange={e => onChange(customerShipInput(it, toInt(e.target.value)))}
        title={boxes
          ? `박스당 단가 입력 — ${boxBreakdown(it)} = ${boxes}박스`
          : (it.purchase_shipping || 0) > 0
            ? `받는 금액(합계)을 입력 — 직접 고친 매입배송비 ${won(it.purchase_shipping)}가 박스당 택배비${boxFeeOf(it) ? ` ${won(boxFeeOf(it))}` : '(품목 관리 값 없음)'}로 나누어떨어지지 않아 박스 수를 셀 수 없습니다`
            : '받는 금액(합계)을 그대로 입력 — 매입배송비가 없어 박스 계산이 없습니다'}
        className={className} placeholder="0" />
      <div className={`text-[0.625rem] mt-0.5 tabular-nums whitespace-nowrap ${needCheck ? 'text-amber-600' : 'text-gray-400'}`}>
        {needCheck
          ? `박스당 단가 확인 (${boxes}박스)`
          : boxes
            ? `박스당 · ${boxes}박스${(it.shipping_fee || 0) > 0 ? ` = ${won(it.shipping_fee)}` : ''}`
            : (it.purchase_shipping || 0) > 0 ? '박스 수 불명 · 합계 입력' : '합계 입력'}
      </div>
    </>
  )
}

// 지점(부서) 표시명 — 거래처 전체 이름에서 업체명 접두를 뗀다.
// "하나은행 경영지원실" + 업체 "하나은행" → "경영지원실". 접두가 없으면 전체 이름 그대로.
// 법인 접두("(주)", "㈜", "주식회사")는 양쪽에서 무시하고 매칭한다 —
// "(주)하나은행오류동지점" + "하나은행" → "오류동지점" (2026-08-18 보정, 702와 동일 규칙)
const stripCorpPrefix = (s: string) => s.replace(/^\s*(\(주\)|㈜|주식회사)\s*/, '')
// 단독 매출처(이름 = 업체명, 예: '푸본현대생명')는 지점이 없으므로 빈 문자열 — 화면에는 NO_BRANCH로 보인다
// (2026-11-19 사용자 요청: 지점 칸에 업체명이 반복돼 '없는 지점'으로 오해).
export const NO_BRANCH = '지점 없음'
export const branchLabel = (vendorName: string, groupName?: string | null): string => {
  if (!groupName) return vendorName
  const vn = stripCorpPrefix(vendorName)
  const gn = stripCorpPrefix(groupName)
  if (vn.startsWith(gn)) return vn.slice(gn.length).trim()
  return vendorName
}
// 목록 · 표시용 — 단독 매출처는 '지점 없음'
export const branchText = (vendorName: string, groupName?: string | null): string =>
  branchLabel(vendorName, groupName) || NO_BRANCH

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
// 숫자 칸 값 읽기 — 쉼표 · 글자는 버리고 소수점은 살려 원 단위로 반올림 (2026-11-16: 점을 지워 462.2가 4622(10배)로 들어가던 문제)
export const toInt = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ''))
  return Number.isFinite(n) ? Math.round(n) : 0
}

// ── 숫자 입력 칸 (상담일지 · 주문서 공용, 2026-11-16) ──
// 금액 칸은 입력할 때마다 쉼표 표기로 다시 그려서, 소수점을 치면 점이 사라지고 다음 숫자가 뒤에 붙어 10배가 됐다(462.2 → 4622).
// 소수점을 친 동안에는 친 글자를 그대로 보여 주고, 계산 쪽(onChange)에는 반올림한 정수만 넘긴다. 칸을 벗어나면 원 단위 표기로 돌아간다.
// 사용법은 <input>과 같다 — onChange 안에서 toInt(e.target.value)로 읽으면 된다.
// decimals: 소수 자리를 받는 칸(매입가 — 518, 둘째 자리까지). 이때는 친 값을 그대로 넘기고, 셋째 자리부터만 반올림 안내.
export function NumInput({ value, onChange, onBlur, decimals = 0, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { decimals?: number }) {
  const [raw, setRaw] = useState<string | null>(null)
  const round = (t: string) => decimals > 0 ? toPurchasePrice(t) : toInt(t)
  const rounded = raw != null ? round(raw) : 0
  const frac = raw != null ? (raw.split('.')[1] ?? '').replace(/\D/g, '') : ''
  const showTip = raw != null && frac.length > decimals
  return (
    <span className="relative block">
      <input {...rest} inputMode="decimal"
        value={raw ?? (value as string | number | undefined) ?? ''}
        onChange={e => {
          const typed = e.target.value
          if (!typed.includes('.')) { setRaw(null); onChange?.(e); return }
          setRaw(typed)
          e.target.value = String(round(typed))   // 계산 쪽에는 반올림한 값만 (정수 칸은 정수, 매입가는 소수 둘째 자리)
          onChange?.(e)
          e.target.value = typed
        }}
        onBlur={e => { setRaw(null); onBlur?.(e) }} />
      {showTip && (
        <span className="absolute right-0 top-full z-10 mt-0.5 whitespace-nowrap rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[0.625rem] text-amber-700 shadow-sm">
          {decimals > 0 ? `소수 ${decimals}째 자리까지 — ${fmtPurchasePrice(rounded)}` : `원 단위로 반올림해 ${won(rounded)}`}(으)로 저장됩니다
        </span>
      )}
    </span>
  )
}
export const lineTotal = (it: ItemDraft) => it.sale_price * it.quantity + it.shipping_fee - it.discount_amount
// 매입합계 (708) — 매입가 × 수량 + 매입배송비 − 매입할인. 서버 purchase_total과 같은 공식
export const lineCost = (it: Pick<ItemDraft, 'purchase_price' | 'quantity' | 'purchase_shipping' | 'purchase_discount'>) =>
  purchaseAmount(it.purchase_price, it.quantity) + it.purchase_shipping - (it.purchase_discount || 0)   // 매입가는 소수 가능 — 원 단위 반올림 (518)
export { fmtPurchasePrice, purchaseAmount, toPurchasePrice }

// 저장된 품목 행(상담·주문)에서 매입할인 · 주문시기 읽기 — 708 미적용 DB면 기본값
export const draftExtrasFromRow = (r: Record<string, unknown>): Pick<ItemDraft, 'purchase_discount' | 'purchase_discount_mode' | 'purchase_discount_unit' | 'order_season'> => ({
  purchase_discount: Number(r.purchase_discount ?? 0) || 0,
  purchase_discount_mode: r.purchase_discount_mode === '단가' ? '단가' : '정액',
  purchase_discount_unit: Number(r.purchase_discount_unit ?? 0) || 0,
  order_season: String(r.order_season ?? ''),
})

// 구분별 가격·배송비 규칙 (원가표 확정 구조)
//  지점: 지점판매가·지점매입가 (고객 택배비 자동 채움은 2026-11-12 제거 — 매입배송비 자동 계산은 quantityPatch에 그대로)
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
      purchase_price: toPurchasePrice(it.branch_purchase_price + it.loose_shipping_fee),
      shipping_fee: 0,
    }
  }
  if (it.order_kind === '지점') {
    // 고객 택배비(판매 배송비)는 자동으로 채우지 않는다 — 기본 0원, '택배비(판매)' 칸에서 입력 (2026-11-12 확정)
    void qty
    return {
      sale_price: it.branch_sale_price,
      purchase_price: it.branch_purchase_price,
    }
  }
  if (it.order_kind === '샘플') {
    return {
      sale_price: 0,
      shipping_fee: 0,
      purchase_price: toPurchasePrice(it.branch_purchase_price + it.loose_shipping_fee),
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
    // 마스터 상태 자동표기 (수정 가능) — 원가표 메모 첫 줄 우선, 없으면 품절 플래그
    status: (p.status_note ?? '').split('\n')[0].trim() || (p.is_soldout ? '품절' : ''),
    is_shipping: !!p.is_shipping,
    shipping_fee: 0, ship_unit: null,   // 품목을 새로 고르면 고객 택배비는 기본 0원 (2026-11-12)
    ...master,
    ...priceRule({ ...base, ...master }, base.quantity || 1),
    // 매입배송비 자동 (704 확정): 카톤 정보가 있으면 수량 기준 카톤단위/카톤외 자동 구분
    ...(master.carton_unit > 0
      ? { purchase_shipping: cartonShipping(master.carton_unit, master.carton_shipping_fee, master.loose_shipping_fee, base.quantity || 1) }
      : {}),
  }
  // 배송비 품목(703): 판매가 0 기본 — 배송비는 판매가에 녹이는 경우가 대부분 (수정 가능)
  if (p.is_shipping) draft.sale_price = 0
  return draft
}

// ── 콤보 드롭다운 공용 (2026-11-18 사용자 피드백) ──
// 1) 목록을 body 아래에 띄운다(포털 + fixed) — 상담 품목 표처럼 overflow가 걸린 카드 안에서도 잘리지 않는다.
//    아래 공간이 모자라면 위로 펼친다. 스크롤 · 창 크기 변경 시 입력칸을 따라간다.
// 2) 방향키 ↑↓로 항목 이동, Tab · Enter로 선택 확정, Esc로 닫기. Tab은 선택 후 다음 칸으로 그대로 넘어간다.
type FloatPos = { left: number; top?: number; bottom?: number; minWidth: number; maxWidth: number; maxHeight: number }

function useFloatingList(open: boolean, anchorRef: React.RefObject<HTMLElement>, opts: { maxRem: number; wide: boolean }) {
  const [pos, setPos] = useState<FloatPos | null>(null)
  const { maxRem, wide } = opts
  useLayoutEffect(() => {
    if (!open) { setPos(null); return }
    const place = () => {
      const el = anchorRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      const vw = window.innerWidth, vh = window.innerHeight
      const want = maxRem * rem
      const below = vh - r.bottom - 12, above = r.top - 12
      const up = below < Math.min(want, 12 * rem) && above > below
      const left = Math.max(8, Math.min(r.left, vw - 8 - r.width))
      const maxWidth = wide ? Math.max(r.width, Math.min(34 * rem, vw - left - 8)) : r.width
      setPos({
        left, minWidth: r.width, maxWidth,
        maxHeight: Math.max(6 * rem, Math.min(want, up ? above : below)),
        ...(up ? { bottom: vh - r.top + 4 } : { top: r.bottom + 4 }),
      })
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open, anchorRef, maxRem, wide])
  return pos
}

function useComboKeys<T>(open: boolean, filtered: T[], listRef: React.RefObject<HTMLDivElement>,
  handlers: { pick: (o: T) => void; openList: () => void; close: () => void }) {
  const [active, setActive] = useState(-1)
  useEffect(() => { if (!open) setActive(-1) }, [open])
  useEffect(() => { setActive(a => (a >= filtered.length ? filtered.length - 1 : a)) }, [filtered.length])
  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, listRef])

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); handlers.openList() }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setActive(a => Math.min(a + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive(a => Math.max(a - 1, 0))
        break
      case 'Enter':
        if (e.nativeEvent.isComposing) return   // 한글 조합 중 Enter는 글자 확정용
        if (active >= 0 && filtered[active]) { e.preventDefault(); handlers.pick(filtered[active]) }
        break
      case 'Tab':
        // 고른 항목이 있으면 확정하고, 포커스는 다음 칸으로 그대로 넘어간다
        if (active >= 0 && filtered[active]) handlers.pick(filtered[active])
        else handlers.close()
        break
      case 'Escape':
        e.preventDefault()
        handlers.close()
        break
    }
  }
  return { active, setActive, onKeyDown, resetActive: () => setActive(-1) }
}

function FloatingList({ pos, listRef, children }: {
  pos: FloatPos | null; listRef: React.RefObject<HTMLDivElement>; children: React.ReactNode
}) {
  if (!pos || typeof document === 'undefined') return null
  return createPortal(
    <div ref={listRef} role="listbox"
      style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, minWidth: pos.minWidth, maxWidth: pos.maxWidth, maxHeight: pos.maxHeight }}
      className="z-50 bg-white border border-gray-300 rounded-lg shadow-lg overflow-y-auto text-sm w-max">
      {children}
    </div>,
    document.body,
  )
}

function useOutsideClose(open: boolean, refs: React.RefObject<HTMLElement>[], close: () => void) {
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!refs.some(r => r.current?.contains(e.target as Node))) close()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

// ── 자동완성 콤보 (마스터 선택 전용 — 목록에 없는 값은 확정 불가) ──
// footer는 노드 또는 (입력어 · 닫기) 함수 — 고객 쌍방향 추천(2026-11-18)이 목록 아래 구역을 붙일 때 쓴다. onQuery = 입력어 알림
export type ComboFooter = React.ReactNode | ((ctx: { q: string; close: () => void }) => React.ReactNode)
// 검색은 이름(label)과 옛 이름 별칭(keywords)만 본다(2026-11-23 사용자 결정 — 업체명은 업체명만, 지점명은 지점명만, 고객명은 고객명만).
// 보조 줄(sub — 상위 조직 경로 · 담당 직원 · 전화 · 품목 분류 · 매입처 등)은 보여 주기만 한다. 보조 줄도 찾아야 하는 칸이 생기면 searchSub(지금은 쓰는 곳 없음).
const comboMatch = (o: { label: string; sub?: string; keywords?: string }, q: string, searchSub: boolean) =>
  o.label.toLowerCase().includes(q) || (o.keywords ?? '').toLowerCase().includes(q) || (searchSub && (o.sub ?? '').toLowerCase().includes(q))

export function Combo({ value, display, options, onSelect, placeholder, required, footer, onQuery, searchSub = false }: {
  value: string | null
  display: string
  options: { id: string; label: string; sub?: string; soldout?: boolean; note?: string; keywords?: string }[]
  onSelect: (id: string | null) => void
  placeholder: string
  required?: boolean
  footer?: ComboFooter
  onQuery?: (q: string) => void
  searchSub?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useOutsideClose(open, [boxRef, listRef], () => setOpen(false))

  const q = text.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, 50)
    return options.filter(o => comboMatch(o, q, searchSub)).slice(0, 50)
  }, [options, q, searchSub])

  // 행 길이 확대(실무자 요청): 입력칸보다 넓게 펼쳐 긴 품명이 잘리지 않게 한다(최대 34rem)
  const pos = useFloatingList(open, boxRef, { maxRem: 20, wide: true })
  const pick = (o: { id: string }) => { onSelect(o.id); setOpen(false) }
  const keys = useComboKeys(open, filtered, listRef, {
    pick, openList: () => { setOpen(true); setText('') }, close: () => setOpen(false),
  })
  const footerNode = typeof footer === 'function' ? footer({ q: text, close: () => setOpen(false) }) : footer

  return (
    <div ref={boxRef} className="relative">
      <input
        value={open ? text : display}
        onFocus={() => { setOpen(true); setText(''); onQuery?.('') }}
        onChange={e => { setText(e.target.value); setOpen(true); keys.resetActive(); onQuery?.(e.target.value) }}
        onKeyDown={keys.onKeyDown}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm bg-blue-50/40 ${
          required && !value ? 'border-red-300' : 'border-blue-200'
        }`}
      />
      {open && (
        <FloatingList pos={pos} listRef={listRef}>
          {filtered.map((o, idx) => (
            <button type="button" key={o.id} data-idx={idx} tabIndex={-1}
              role="option" aria-selected={idx === keys.active}
              onMouseDown={e => e.preventDefault()}
              onMouseMove={() => { if (keys.active !== idx) keys.setActive(idx) }}
              onClick={() => pick(o)}
              className={`w-full text-left px-3 py-2 border-b border-gray-50 whitespace-normal leading-snug ${
                idx === keys.active ? 'bg-blue-100' : 'hover:bg-blue-50'
              }`}>
              {o.label}
              {o.soldout && (
                <span className="ml-1.5 inline-block whitespace-nowrap px-1 py-0.5 rounded text-[0.625rem] font-medium bg-red-50 text-red-600 align-middle">품절</span>
              )}
              {/* 원가표 상태 메모 (512) — '블랙 품절'·'단가인상' 등 실무 참고 */}
              {o.note && <span className="text-[0.625rem] text-amber-600 ml-1.5">{o.note}</span>}
              {o.sub && <span className="text-xs text-gray-400 ml-1.5">{o.sub}</span>}
            </button>
          ))}
          {/* 고를 목록 자체가 비어 있으면(지점 미선택 담당자 칸 등) 안내 없이 아래 구역만 */}
          {!filtered.length && options.length > 0 && <div className="px-3 py-2 text-xs text-gray-400">일치하는 항목이 없습니다</div>}
          {footerNode}
        </FloatingList>
      )}
    </div>
  )
}

// ── 자유 입력 겸용 콤보 (상담일지 — 마스터에 없으면 입력한 문자열 그대로 사용) ──
export function ComboFree({ text, selectedId, options, onChange, placeholder, footer, searchSub = false }: {
  text: string
  selectedId: string | null
  options: { id: string; label: string; sub?: string; keywords?: string }[]   // keywords = 검색에만 쓰는 별칭(표시 안 함, 2026-11-19)
  onChange: (patch: { id: string | null; text: string }) => void
  placeholder: string
  footer?: ComboFooter
  searchSub?: boolean
}) {
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  useOutsideClose(open, [boxRef, listRef], () => setOpen(false))

  const q = text.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return options.slice(0, 50)
    return options.filter(o => comboMatch(o, q, searchSub)).slice(0, 50)
  }, [options, q, searchSub])

  const footerNode = typeof footer === 'function' ? footer({ q: text, close: () => setOpen(false) }) : footer
  const pos = useFloatingList(open, boxRef, { maxRem: footerNode ? 26 : 16, wide: !!footerNode })
  const pick = (o: { id: string; label: string }) => { onChange({ id: o.id, text: o.label }); setOpen(false) }
  const keys = useComboKeys(open, filtered, listRef, {
    pick, openList: () => setOpen(true), close: () => setOpen(false),
  })

  return (
    <div ref={boxRef} className="relative">
      <input
        value={text}
        onFocus={() => setOpen(true)}
        onChange={e => { onChange({ id: null, text: e.target.value }); setOpen(true); keys.resetActive() }}
        onKeyDown={keys.onKeyDown}
        placeholder={placeholder}
        className={`w-full border rounded-lg px-2.5 py-1.5 text-sm ${
          selectedId ? 'bg-blue-50/40 border-blue-200' : 'bg-amber-50/30 border-amber-200'
        }`}
        title={selectedId ? '마스터 연결됨' : '자유 입력 (마스터 미연결)'}
      />
      {open && (filtered.length > 0 || !!footerNode) && (
        <FloatingList pos={pos} listRef={listRef}>
          {filtered.map((o, idx) => (
            <button type="button" key={o.id} data-idx={idx} tabIndex={-1}
              role="option" aria-selected={idx === keys.active}
              onMouseDown={e => e.preventDefault()}
              onMouseMove={() => { if (keys.active !== idx) keys.setActive(idx) }}
              onClick={() => pick(o)}
              className={`w-full text-left px-3 py-1.5 border-b border-gray-50 ${
                idx === keys.active ? 'bg-blue-100' : 'hover:bg-blue-50'
              }`}>
              {o.label}
              {o.sub && <span className="text-xs text-gray-400 ml-1.5">{o.sub}</span>}
            </button>
          ))}
          {footerNode}
        </FloatingList>
      )}
    </div>
  )
}

// ── 할인 입력 칸 (정액 / 개당) — 매입할인(708)용. 판매할인과 같은 모양 ──
// amount는 항상 최종 할인액. 개당이면 unit × 수량으로 자동 계산
export function DiscountInput({ mode, unit, amount, quantity, disabled, onChange, className, title }: {
  mode: '정액' | '단가'; unit: number; amount: number; quantity: number; disabled?: boolean
  onChange: (patch: { mode: '정액' | '단가'; unit: number; amount: number }) => void
  className: string; title?: string
}) {
  return (
    <>
      <select value={mode} disabled={disabled}
        onChange={e => {
          const m = e.target.value as '정액' | '단가'
          onChange(m === '단가' ? { mode: m, unit, amount: (unit || 0) * quantity } : { mode: m, unit: 0, amount })
        }}
        className="w-full border border-blue-200 bg-blue-50/40 rounded px-1 py-0.5 text-[0.625rem] mb-0.5 disabled:opacity-60">
        <option value="정액">정액</option>
        <option value="단가">개당</option>
      </select>
      <NumInput
        value={mode === '단가' ? (unit ? won(unit) : '') : (amount ? won(amount) : '')}
        disabled={disabled}
        onChange={e => {
          const v = toInt(e.target.value)
          onChange(mode === '단가' ? { mode, unit: v, amount: v * quantity } : { mode, unit: 0, amount: v })
        }}
        title={title ?? (mode === '단가' ? `개당 할인 — 할인액 ${won(amount)}원 자동 계산` : '행당 할인 금액')}
        className={`${className} ${amount > 0 ? 'text-red-600 font-semibold border-red-200 bg-red-50/40' : ''}`}
        placeholder="0" />
      {mode === '단가' && amount > 0 && (
        <div className="text-[0.625rem] text-red-500 mt-0.5 tabular-nums">-{won(amount)}</div>
      )}
    </>
  )
}

// ── 주문시기 입력 (708) — 글자 입력 + 드롭다운 제안. 칸을 벗어나면 표기 통일(26 추석 → 26추석) ──
export function SeasonInput({ value, onChange, disabled, listId, normalize }: {
  value: string; onChange: (v: string) => void; disabled?: boolean; listId: string
  normalize: (v: string) => string
}) {
  return (
    <input value={value} disabled={disabled} list={listId}
      onChange={e => onChange(e.target.value)}
      onBlur={e => { const n = normalize(e.target.value); if (n !== e.target.value) onChange(n) }}
      placeholder="선택·입력"
      title="주문시기 — 목록에서 고르거나 직접 입력 (예: 상시, 26추석)"
      className="w-full border border-blue-200 bg-blue-50/40 rounded px-1.5 py-1 text-xs disabled:opacity-60" />
  )
}
export function SeasonDatalist({ id, options }: { id: string; options: string[] }) {
  return <datalist id={id}>{options.map(o => <option key={o} value={o} />)}</datalist>
}
