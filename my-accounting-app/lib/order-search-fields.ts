// 주문 현황 항목별 검색 — 화면(항목 선택 칸 · 조건 칩)과 서버 필터가 함께 쓰는 정의 (2026-11-09).
// 서버 전용 코드를 넣지 말 것(클라이언트에서도 import).

export type SearchField =
  | 'bank' | 'branch' | 'customer' | 'manager' | 'staff' | 'order_no'   // 주문 필드
  | 'item_name' | 'item_code' | 'channel' | 'purchase'                  // 품목 필드

// 항목 선택 칸에 보이는 순서 · 이름 (주문처 = 업체+지점은 입력 지정어로만 남김)
export const SEARCH_FIELDS: { key: SearchField; label: string }[] = [
  { key: 'bank', label: '업체(은행)' },
  { key: 'branch', label: '부서(지점)' },
  { key: 'manager', label: '담당자(이름 · 연락처)' },
  { key: 'channel', label: '상담자' },
  { key: 'staff', label: '다올직원' },
  { key: 'item_name', label: '품목' },
  { key: 'item_code', label: '품번' },
  { key: 'purchase', label: '매입처' },
  { key: 'order_no', label: '주문번호' },
]

export const FIELD_SHORT: Record<SearchField, string> = {
  bank: '업체', branch: '지점', customer: '주문처', manager: '담당자', channel: '상담자',
  staff: '다올직원', item_name: '품목', item_code: '품번', purchase: '매입처', order_no: '주문번호',
}

// 입력 지정어 ("업체-하나은행" / "업체:하나은행")
export const FIELD_ALIAS: Record<string, SearchField> = {
  '업체': 'bank', '은행': 'bank',
  '지점': 'branch', '부서': 'branch',
  '주문처': 'customer',
  '담당자': 'manager',
  '직원': 'staff', '다올직원': 'staff',
  '상담자': 'channel',
  '상품': 'item_name', '품목': 'item_name', '품명': 'item_name',
  '품번': 'item_code',
  '매입처': 'purchase',
  '주문번호': 'order_no', '번호': 'order_no',
}

const FIELD_KEYS = new Set<string>(Object.keys(FIELD_SHORT))

// 검색 조건 1개. field null = 모든 항목에서 찾기
export interface SearchCond { field: SearchField | null; value: string }

// '전체 항목' 입력: 띄어쓰기 · 쉼표로 나눠 각각 조건(AND). 지정어가 붙은 단어는 그 항목 조건.
// 화이트리스트에 없는 접두(품번 "25-01" 등)는 일반 단어로 취급.
export function parseFreeText(q: string): SearchCond[] {
  return q.split(/[\s,]+/).filter(Boolean).map(raw => {
    const m = raw.match(/^(.+?)[-:](.+)$/)
    if (m && FIELD_ALIAS[m[1]]) return { field: FIELD_ALIAS[m[1]], value: m[2] }
    return { field: null, value: raw }
  })
}

// URL 파라미터 c=<field>:<value> (field 'all' = 모든 항목). 항목을 고른 값은 띄어쓰기를 포함해 한 조건.
export const encodeCond = (c: SearchCond) => `${c.field ?? 'all'}:${c.value}`
export function decodeCond(s: string): SearchCond | null {
  const i = s.indexOf(':')
  if (i < 0) return null
  const f = s.slice(0, i)
  const value = s.slice(i + 1).trim()
  if (!value) return null
  if (f === 'all') return { field: null, value }
  if (!FIELD_KEYS.has(f)) return null
  return { field: f as SearchField, value }
}

// 내 주문 필터 (2026-11-09 사용자 결정)
//  - consult 내 상담건: 주문 상담자(고객 다올 담당) = 나 OR 연결된 상담일지 작성자 = 나
//  - handled 내 처리건: 주문 입력자 = 나
// 상담자 = 입력자인 주문은 어느 쪽을 켜도 보인다.
export type MineFilter = 'all' | 'consult' | 'handled'
