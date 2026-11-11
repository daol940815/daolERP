// 품목 관리 목록 조건 ↔ 주소(URL) · 원가표 다운로드 — 한 원천 (2026-11-11, docs/product-master-track.md)
//
// 주소와 원가표 다운로드(products/export)가 같은 함수로 같은 값을 만든다:
//   filter=<상태 칩>  (기본 'active'면 생략)
//   cond=<필드>:<값>   (확정된 조건 칩, 순서 그대로 반복 — 첫 ':'로만 나눔)
// 정렬(sort · dir)은 주소에만 — 원가표 다운로드는 품번순 고정이라 넘기지 않는다.
// 입력 중인 검색어 · 검색 구분 선택은 유지 대상이 아니다(다운로드만 입력 중 검색어를 cond로 하나 더 붙임 — 기존 동작).

export type CondField = 'all' | 'code' | 'name' | 'vendor' | 'category'
export const COND_FIELDS: CondField[] = ['all', 'code', 'name', 'vendor', 'category']
export interface ProductCond { field: CondField; value: string }

export type ProductFilter = 'active' | 'inactive' | 'addon' | 'cost' | 'all'
export const PRODUCT_FILTERS: ProductFilter[] = ['active', 'inactive', 'addon', 'cost', 'all']
export const DEFAULT_FILTER: ProductFilter = 'active'

export const encodeCond = (c: ProductCond) => `${c.field}:${c.value}`
export function decodeCond(raw: string): ProductCond | null {
  const i = raw.indexOf(':')
  if (i <= 0) return null
  const field = raw.slice(0, i) as CondField
  const value = raw.slice(i + 1).trim()
  if (!value || !COND_FIELDS.includes(field)) return null
  return { field, value }
}

/** 상태 칩 + 조건 칩 → 주소 · 다운로드 공용 파라미터 (기존 다운로드와 같은 순서: filter 다음 cond) */
export function listParams(filter: ProductFilter, conds: ProductCond[]): URLSearchParams {
  const p = new URLSearchParams()
  if (filter !== DEFAULT_FILTER) p.set('filter', filter)
  for (const c of conds) p.append('cond', encodeCond(c))
  return p
}

/** 주소 → 상태 칩 · 조건 칩 (엉뚱한 값은 기본값 · 버림, 같은 조건 중복 제거) */
export function readListParams(sp: URLSearchParams): { filter: ProductFilter; conds: ProductCond[] } {
  const f = sp.get('filter') as ProductFilter | null
  const conds: ProductCond[] = []
  for (const raw of sp.getAll('cond')) {
    const c = decodeCond(raw)
    if (c && !conds.some(x => x.field === c.field && x.value === c.value)) conds.push(c)
  }
  return { filter: f && PRODUCT_FILTERS.includes(f) ? f : DEFAULT_FILTER, conds }
}
