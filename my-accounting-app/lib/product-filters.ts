// 품목 관리 항목 필터 · 금액대 칩 — 화면 · 원가표 다운로드 공용 (2026-11-19 실무자 요청 · 사용자 승인, docs/product-master-track.md)
//
// 항목 필터: 품목 관리 표의 모든 항목에 조건을 걸고 칩으로 쌓는다. 칩끼리 · 기존 검색 칩과 모두 "그리고".
// 금액대 칩: 기준(지점판매가 기본 · 개별판매가 · 매입가) 하나의 구간 7개, 여러 개 켜면 "또는"(그중 하나에 들면 표시).
// 주소 · 다운로드 파라미터: flt=<항목>~<조건>~<값1>~<값2> 반복(값은 encodeURIComponent) / band=<구간> 반복 / basis=<기준>(기본 sale 생략)

import { branchMargin, individualMargin, roundProfit } from '@/lib/product-margin'

export interface FilterableProduct {
  item_code: string | null; item_name: string; category: string | null; purchase_vendor_name: string | null
  sale_price: number; individual_sale_price: number; purchase_price: number
  carton_unit: number | null; carton_shipping_fee: number; loose_shipping_fee: number
  is_addon: boolean; is_active: boolean; is_soldout?: boolean; is_shipping?: boolean
  status_note?: string | null; memo: string | null
}

export type FieldKind = 'text' | 'num' | 'rate' | 'bool'
export type FilterFieldKey =
  | 'code' | 'name' | 'category' | 'vendor' | 'phone' | 'memo' | 'status_note'
  | 'sale' | 'individual' | 'purchase' | 'carton' | 'carton_fee' | 'loose_fee' | 'b_profit' | 'i_profit'
  | 'b_rate' | 'i_rate'
  | 'active' | 'soldout' | 'addon' | 'cost'

export const FILTER_FIELDS: { key: FilterFieldKey; label: string; kind: FieldKind }[] = [
  { key: 'code', label: '품번', kind: 'text' },
  { key: 'name', label: '품명', kind: 'text' },
  { key: 'category', label: '분류(목차)', kind: 'text' },
  { key: 'vendor', label: '매입처', kind: 'text' },
  { key: 'phone', label: '매입처 연락처', kind: 'text' },
  { key: 'sale', label: '지점판매가', kind: 'num' },
  { key: 'individual', label: '개별판매가', kind: 'num' },
  { key: 'purchase', label: '매입가', kind: 'num' },
  { key: 'b_profit', label: '지점 이익금', kind: 'num' },
  { key: 'b_rate', label: '지점 마진율', kind: 'rate' },
  { key: 'i_profit', label: '개별 이익금', kind: 'num' },
  { key: 'i_rate', label: '개별 마진율', kind: 'rate' },
  { key: 'carton', label: '카톤단위', kind: 'num' },
  { key: 'carton_fee', label: '카톤택배비', kind: 'num' },
  { key: 'loose_fee', label: '카톤외택배비', kind: 'num' },
  { key: 'memo', label: '메모', kind: 'text' },
  { key: 'status_note', label: '원가표 상태 메모', kind: 'text' },
  { key: 'active', label: '사용 중', kind: 'bool' },
  { key: 'soldout', label: '품절', kind: 'bool' },
  { key: 'addon', label: '부가상품(옵션)', kind: 'bool' },
  { key: 'cost', label: '비용 품목', kind: 'bool' },
]
const FIELD = new Map(FILTER_FIELDS.map(f => [f.key, f]))
export const fieldOf = (k: FilterFieldKey) => FIELD.get(k)!

export type FilterOp =
  | 'contains' | 'not_contains' | 'eq' | 'empty' | 'not_empty'
  | 'gte' | 'lte' | 'between'
  | 'negative' | 'none'
  | 'yes' | 'no'
export const OPS: Record<FieldKind, { op: FilterOp; label: string; values: 0 | 1 | 2 }[]> = {
  text: [
    { op: 'contains', label: '포함', values: 1 }, { op: 'not_contains', label: '포함 안 함', values: 1 },
    { op: 'eq', label: '같음', values: 1 }, { op: 'empty', label: '비어 있음', values: 0 }, { op: 'not_empty', label: '값 있음', values: 0 },
  ],
  num: [
    { op: 'gte', label: '이상', values: 1 }, { op: 'lte', label: '이하', values: 1 }, { op: 'between', label: '범위', values: 2 },
    { op: 'eq', label: '같음', values: 1 }, { op: 'empty', label: '비어 있음', values: 0 },
  ],
  rate: [
    { op: 'gte', label: '이상', values: 1 }, { op: 'lte', label: '이하', values: 1 }, { op: 'between', label: '범위', values: 2 },
    { op: 'negative', label: '마이너스만', values: 0 }, { op: 'none', label: '판매가 없음', values: 0 },
  ],
  bool: [{ op: 'yes', label: '예', values: 0 }, { op: 'no', label: '아니오', values: 0 }],
}
export const opsOf = (k: FilterFieldKey) => OPS[fieldOf(k).kind]

export interface ItemFilter { field: FilterFieldKey; op: FilterOp; a?: string; b?: string }

export const toNum = (s?: string): number | null => {
  const t = (s ?? '').replace(/[^\d.-]/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** 칩 이름: "지점판매가 3,000 ~ 15,000" · "지점 마진율 20% 이상" · "메모 비어 있음" · "품절 아니오" */
export function filterLabel(f: ItemFilter): string {
  const fd = fieldOf(f.field)
  const opLabel = OPS[fd.kind].find(o => o.op === f.op)?.label ?? ''
  const fmt = (v?: string) => {
    if (fd.kind === 'text') return `"${v ?? ''}"`
    const n = toNum(v)
    const s = n === null ? '' : n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
    return fd.kind === 'rate' ? `${s}%` : s
  }
  if (f.op === 'between') return `${fd.label} ${fmt(f.a)} ~ ${fmt(f.b)}`
  if (f.op === 'gte' || f.op === 'lte') return `${fd.label} ${fmt(f.a)} ${opLabel}`
  if (f.op === 'contains' || f.op === 'not_contains' || f.op === 'eq') return `${fd.label} ${fmt(f.a)} ${opLabel}`
  return `${fd.label} ${opLabel}`
}

/** 조건이 완성됐는지 (값 칸이 필요한 조건은 값이 있어야, 범위는 둘 중 하나 이상) */
export function isComplete(f: ItemFilter): boolean {
  const spec = opsOf(f.field).find(o => o.op === f.op)
  if (!spec) return false
  const kind = fieldOf(f.field).kind
  if (spec.values === 0) return true
  if (kind === 'text') return !!(f.a ?? '').trim()
  if (spec.values === 2) return toNum(f.a) !== null || toNum(f.b) !== null
  return toNum(f.a) !== null
}

// 항목 값 — 글자는 문자열, 숫자는 숫자(0 · 빈 값은 화면에서 '-' = null), 마진율은 % 숫자
function fieldValue(p: FilterableProduct, k: FilterFieldKey, phones?: Record<string, string>): string | number | boolean | null {
  const txt = (v?: string | null) => (v ?? '').trim() || null
  const num = (v?: number | null) => (v ? Number(v) : null)
  switch (k) {
    case 'code': return txt(p.item_code)
    case 'name': return txt(p.item_name)
    case 'category': return txt(p.category)
    case 'vendor': return txt(p.purchase_vendor_name)
    case 'phone': return p.purchase_vendor_name ? txt(phones?.[p.purchase_vendor_name]) : null
    case 'memo': return txt(p.memo)
    case 'status_note': return txt(p.status_note)
    case 'sale': return num(p.sale_price)
    case 'individual': return num(p.individual_sale_price)
    case 'purchase': return num(p.purchase_price)
    case 'carton': return num(p.carton_unit)
    case 'carton_fee': return p.carton_unit ? num(p.carton_shipping_fee) : null   // 화면과 같음: 카톤단위 없으면 '-'
    case 'loose_fee': return num(p.loose_shipping_fee)
    case 'b_profit': return roundProfit(branchMargin(p).profit, p.purchase_price)
    case 'i_profit': { const m = individualMargin(p); return m ? roundProfit(m.profit, p.purchase_price) : null }
    case 'b_rate': { const r = branchMargin(p).rate; return r === null ? null : Math.round(r * 1000) / 10 }
    case 'i_rate': { const m = individualMargin(p); return m?.rate == null ? null : Math.round(m.rate * 1000) / 10 }
    case 'active': return p.is_active
    case 'soldout': return !!p.is_soldout
    case 'addon': return !!p.is_addon
    case 'cost': return !!p.is_shipping
  }
}

/** 항목 필터 하나에 맞는지 — 마진율은 화면 표시값(소수 첫째 자리)으로 비교 */
export function matchFilter(p: FilterableProduct, f: ItemFilter, phones?: Record<string, string>): boolean {
  const v = fieldValue(p, f.field, phones)
  const kind = fieldOf(f.field).kind
  if (kind === 'bool') return f.op === 'yes' ? v === true : v === false
  if (kind === 'text') {
    const s = (v as string | null)?.toLowerCase() ?? ''
    const q = (f.a ?? '').trim().toLowerCase()
    switch (f.op) {
      case 'contains': return s.includes(q)
      case 'not_contains': return !s.includes(q)
      case 'eq': return s === q
      case 'empty': return !s
      case 'not_empty': return !!s
      default: return true
    }
  }
  const n = v as number | null
  if (f.op === 'empty') return n === null
  if (f.op === 'none') return n === null
  if (n === null) return false
  if (f.op === 'negative') return n < 0
  const a = toNum(f.a), b = toNum(f.b)
  switch (f.op) {
    case 'gte': return a === null || n >= a
    case 'lte': return a === null || n <= a
    case 'eq': return a === null || n === a
    case 'between': return (a === null || n >= Math.min(a, b ?? a)) && (b === null || n <= Math.max(b, a ?? b))
    default: return true
  }
}

// ── 금액대 칩 ──
export type PriceBasis = 'sale' | 'individual' | 'purchase'
export const PRICE_BASES: { key: PriceBasis; label: string }[] = [
  { key: 'sale', label: '지점판매가' }, { key: 'individual', label: '개별판매가' }, { key: 'purchase', label: '매입가' },
]
export const DEFAULT_BASIS: PriceBasis = 'sale'
// 경계값은 위 구간에 포함 (5,000원 = "5천~1만")
export const PRICE_BANDS: { key: string; label: string; min: number; max: number }[] = [
  { key: 'u1k', label: '1천원 미만', min: 0, max: 1000 },
  { key: '1k5k', label: '1천~5천', min: 1000, max: 5000 },
  { key: '5k10k', label: '5천~1만', min: 5000, max: 10000 },
  { key: '10k30k', label: '1만~3만', min: 10000, max: 30000 },
  { key: '30k50k', label: '3만~5만', min: 30000, max: 50000 },
  { key: '50k100k', label: '5만~10만', min: 50000, max: 100000 },
  { key: 'o100k', label: '10만 이상', min: 100000, max: Infinity },
]
export const priceOf = (p: FilterableProduct, basis: PriceBasis): number | null => {
  const v = basis === 'sale' ? p.sale_price : basis === 'individual' ? p.individual_sale_price : p.purchase_price
  return v ? Number(v) : null   // 0 · 빈 값 = 금액대 없음(어느 칩에도 안 듦)
}
export const inBand = (price: number | null, band: string): boolean => {
  const b = PRICE_BANDS.find(x => x.key === band)
  return !!b && price !== null && price >= b.min && price < b.max
}
/** 켠 금액대 중 하나에 드는지 (아무것도 안 켰으면 통과) */
export const matchBands = (p: FilterableProduct, bands: string[], basis: PriceBasis): boolean =>
  !bands.length || bands.some(b => inBand(priceOf(p, basis), b))

// ── 주소 · 다운로드 파라미터 ──
const enc = (s?: string) => encodeURIComponent(s ?? '').replace(/~/g, '%7E')   // 구분자 '~'는 encodeURIComponent가 남겨 두므로 직접
export const encodeFilter = (f: ItemFilter) => [f.field, f.op, enc(f.a), enc(f.b)].join('~')
export function decodeFilter(raw: string): ItemFilter | null {
  const [field, op, a, b] = raw.split('~')
  if (!FIELD.has(field as FilterFieldKey)) return null
  if (!opsOf(field as FilterFieldKey).some(o => o.op === op)) return null
  let da = '', db = ''
  try { da = decodeURIComponent(a ?? ''); db = decodeURIComponent(b ?? '') } catch { return null }
  const f: ItemFilter = { field: field as FilterFieldKey, op: op as FilterOp, ...(da ? { a: da } : {}), ...(db ? { b: db } : {}) }
  return isComplete(f) ? f : null
}

export function appendFilterParams(p: URLSearchParams, filters: ItemFilter[], bands: string[], basis: PriceBasis) {
  for (const f of filters) p.append('flt', encodeFilter(f))
  for (const b of bands) p.append('band', b)
  if (basis !== DEFAULT_BASIS) p.set('basis', basis)
}
export function readFilterParams(sp: URLSearchParams): { filters: ItemFilter[]; bands: string[]; basis: PriceBasis } {
  const filters: ItemFilter[] = []
  for (const raw of sp.getAll('flt')) {
    const f = decodeFilter(raw)
    if (f && !filters.some(x => encodeFilter(x) === encodeFilter(f))) filters.push(f)
  }
  const bands = Array.from(new Set(sp.getAll('band').filter(b => PRICE_BANDS.some(x => x.key === b))))
  const bs = sp.get('basis') as PriceBasis | null
  return { filters, bands, basis: bs && PRICE_BASES.some(x => x.key === bs) ? bs : DEFAULT_BASIS }
}
