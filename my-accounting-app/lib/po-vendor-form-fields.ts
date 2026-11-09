// 업체 발주서 양식 — 칸 연결 설정의 타입 · 값 목록 (516, 2026-11-09)
// 클라이언트(칸 연결 화면)와 서버(채우기 엔진 lib/po-vendor-form.ts · 자동 인식 lib/po-form-recognize.ts)가 함께 쓴다. exceljs 의존 없음.

// 칸 하나에 무엇을 넣나
//  tpl  = 문구 틀. '{qty}' 처럼 값 하나면 숫자 · 날짜 그대로, '{item_name} ({qty}개)' 처럼 섞으면 글자, 틀 없는 글자는 고정 문구
//  keep = 양식에 이미 적힌 값 유지(시작 행 값을 모든 행에 반복)
//  blank = 비움 · skip = 건드리지 않음(수식 · 업체가 채우는 칸)
export type ValueSpec =
  | { k: 'tpl'; v: string }
  | { k: 'keep' }
  | { k: 'blank' }
  | { k: 'skip' }

export interface CatalogMap {
  name_col: string      // 품명이 인쇄된 열
  qty_col: string       // 수량을 넣을 열
  pack_col?: string | null   // 입수 열 — 있으면 수량 = ERP 수량 ÷ 입수(BOX 환산, 2026-11-09). '' · null = 환산 안 함, 없음 = 머리글 '입수' 자동
  start_row: number
  end_row: number
}

export interface SheetMap {
  name: string                          // 시트 이름
  mode: 'rows' | 'catalog' | 'cells-only'
  header_row?: number | null            // 머리글 행 (표시용)
  start_row: number                     // 첫 품목 행
  end_row?: number | null               // 준비된 마지막 행 (테두리 · 수식이 있는 곳까지). 없으면 무제한
  insert_before?: number | null         // 꼬리 영역(안내 줄 · 합계) 시작 행 — 행이 늘면 이 앞에 끼워 넣는다
  clear_examples?: boolean              // 예시 행 지우기
  unify_style?: boolean                 // (사용 안 함 — 행 서식은 항상 첫 품목 행 기준, 2026-11-09 확정. 옛 저장값 호환용)
  style_row?: number | null             // (사용 안 함 — 위와 같음)
  columns: Record<string, ValueSpec>    // 열 글자 → 값 (rows 모드)
  cells?: Record<string, ValueSpec>     // 칸 주소 → 값 (머리 칸 · 발주처 정보 등)
  required?: string[]                   // 필수 열 — 비면 경고
  catalog?: CatalogMap | null           // catalog 모드: 인쇄된 품목 목록에 수량만
}

export interface FormMapping {
  version?: 1
  sheets: SheetMap[]
}

export type How = 'auto' | 'check' | 'none'
export interface RecognizedColumn { col: string; header: string; spec: ValueSpec; how: How; reason: string; required?: boolean }
export interface RecognizedCell { addr: string; label: string; spec: ValueSpec; how: How; reason: string }
export interface RecognizedSheet {
  name: string
  state: 'visible' | 'hidden' | 'veryHidden'
  header_row: number | null
  start_row: number | null
  end_row: number | null
  insert_before: number | null
  example_rows: number
  mode: SheetMap['mode'] | null
  columns: RecognizedColumn[]
  cells: RecognizedCell[]
  notes: string[]
}
export interface RecognizeResult { sheets: RecognizedSheet[]; target: string | null; mapping: FormMapping; notes: string[] }

// 인식 결과(시트 1개) → 칸 연결 기본값. 화면에서 시트를 바꿀 때도 같은 규칙
export function toSheetMap(t: RecognizedSheet): SheetMap {
  const sm: SheetMap = {
    name: t.name,
    mode: t.mode ?? 'rows',
    header_row: t.header_row,
    start_row: t.start_row ?? 1,
    end_row: t.end_row,
    insert_before: t.insert_before,
    clear_examples: t.example_rows > 0,
    columns: Object.fromEntries(t.columns.filter(c => c.spec.k !== 'skip').map(c => [c.col, c.spec])),
    cells: Object.fromEntries(t.cells.map(c => [c.addr, c.spec])),
    required: t.columns.filter(c => c.required).map(c => c.col),
  }
  if (sm.mode === 'catalog') {
    const n = t.columns.find(c => c.spec.k === 'tpl' && c.spec.v === '{item_name}')
    const q = t.columns.find(c => c.spec.k === 'tpl' && c.spec.v === '{qty}')
    const pack = t.columns.find(c => /입수/.test(c.header))
    if (n && q) sm.catalog = { name_col: n.col, qty_col: q.col, pack_col: pack?.col ?? null, start_row: sm.start_row, end_row: sm.end_row ?? sm.start_row }
    sm.columns = {}
  }
  return sm
}

// 다올 고정 정보 (사업자등록증 · 2026-11-09 사용자 확정 — 업체 양식 주소는 '덕이동 1234-1')
export const COMPANY_INFO = {
  co_name: '다올커머스',
  co_corp: '주식회사 다올커머스',
  co_ceo: '이정철',
  co_bizno: '701-88-00023',
  co_tel: '031-922-4582',
  co_fax: '031-624-4584',
  co_addr: '경기도 고양시 일산서구 덕이동 1234-1',
  co_email: 'daol825@naver.com',
} as const

export type FieldGroup = '주문' | '품목' | '받는분' | '보내는분 · 담당' | '다올 정보'
export interface FieldDef { key: string; label: string; group: FieldGroup; scope: 'order' | 'line'; example: string }

// 칸 연결 화면 드롭다운 · 문구 틀 도움말
export const FIELDS: FieldDef[] = [
  { key: 'po_no', label: '발주번호', group: '주문', scope: 'order', example: 'P261109-001' },
  { key: 'po_date', label: '발주일(오늘)', group: '주문', scope: 'order', example: '2026-11-09' },
  { key: 'order_date', label: '주문일', group: '주문', scope: 'order', example: '2026-11-08' },
  { key: 'ship_request', label: '출고요청일', group: '주문', scope: 'order', example: '2026-11-12' },
  { key: 'customer', label: '주문처(은행 지점)', group: '주문', scope: 'order', example: '가나은행 다라지점' },
  { key: 'customer_bank', label: '주문처 은행(업체)', group: '주문', scope: 'order', example: '가나은행' },
  { key: 'customer_branch', label: '주문처 지점(부서)', group: '주문', scope: 'order', example: '다라지점' },
  { key: 'delivery_note', label: '배송메모(발주)', group: '주문', scope: 'order', example: '부재 시 경비실' },
  { key: 'total', label: '발주 합계', group: '주문', scope: 'order', example: '150000' },

  { key: 'line_no', label: '순번(1부터)', group: '품목', scope: 'line', example: '1' },
  { key: 'item_name', label: '품명', group: '품목', scope: 'line', example: '사과 선물세트' },
  { key: 'item_code', label: '품목코드', group: '품목', scope: 'line', example: 'A-100' },
  { key: 'item_memo', label: '품목 비고(옵션)', group: '품목', scope: 'line', example: '빨강' },
  { key: 'qty', label: '수량', group: '품목', scope: 'line', example: '3' },
  { key: 'unit_price', label: '매입 단가', group: '품목', scope: 'line', example: '25000' },
  { key: 'amount', label: '매입 금액', group: '품목', scope: 'line', example: '75000' },
  { key: 'ship_fee', label: '매입 배송비', group: '품목', scope: 'line', example: '3000' },
  { key: 'order_kind', label: '배송 구분(지점 · 개별 · 샘플)', group: '품목', scope: 'line', example: '지점' },

  { key: 'r_name', label: '받는분 이름', group: '받는분', scope: 'line', example: '홍길동' },
  { key: 'r_name_hon', label: '받는분 이름 + 님', group: '받는분', scope: 'line', example: '홍길동 님' },
  { key: 'r_phone', label: '받는분 연락처', group: '받는분', scope: 'line', example: '010-0000-0000' },
  { key: 'r_zip', label: '받는분 우편번호', group: '받는분', scope: 'line', example: '10000' },
  { key: 'r_addr', label: '받는분 주소', group: '받는분', scope: 'line', example: '서울시 중구 가나로 1' },
  { key: 'r_msg', label: '배송메시지', group: '받는분', scope: 'line', example: '문 앞' },
  // 주문 배송지(한 곳) — 머리 칸용. 배송지가 없으면 첫 수령인 (2026-11-09 깨끗한나라 배송메모)
  { key: 'ship_memo', label: '배송지 묶음(상세주소 · 이름 · 연락처, 줄바꿈)', group: '받는분', scope: 'order', example: '서울시 중구 가나로 1 2층 / 홍길동 / 010-0000-0000' },
  { key: 'ship_addr', label: '배송지 상세주소(주문)', group: '받는분', scope: 'order', example: '서울시 중구 가나로 1 2층' },
  { key: 'ship_name', label: '배송지 받는분(주문)', group: '받는분', scope: 'order', example: '홍길동' },
  { key: 'ship_phone', label: '배송지 연락처(주문)', group: '받는분', scope: 'order', example: '010-0000-0000' },

  { key: 'sender', label: '보내는분 명의(상담일지)', group: '보내는분 · 담당', scope: 'order', example: '가나은행 다라지점장' },
  { key: 'manager', label: '고객 담당자(님 포함)', group: '보내는분 · 담당', scope: 'order', example: '김가나 과장님' },
  { key: 'manager_plain', label: '고객 담당자(님 없이)', group: '보내는분 · 담당', scope: 'order', example: '김가나 과장' },
  { key: 'manager_phone', label: '고객 담당자 연락처', group: '보내는분 · 담당', scope: 'order', example: '02-000-0000' },
  { key: 'staff', label: '다올 발주 담당자', group: '보내는분 · 담당', scope: 'order', example: '이다올' },
  { key: 'staff_title', label: '다올 담당자 + 직급', group: '보내는분 · 담당', scope: 'order', example: '이다올 대리' },
  { key: 'staff_phone', label: '다올 담당자 연락처', group: '보내는분 · 담당', scope: 'order', example: '010-1111-2222' },

  { key: 'co_name', label: '다올커머스', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_name },
  { key: 'co_corp', label: '상호(법인명)', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_corp },
  { key: 'co_ceo', label: '대표자', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_ceo },
  { key: 'co_bizno', label: '사업자등록번호', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_bizno },
  { key: 'co_tel', label: '대표번호', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_tel },
  { key: 'co_fax', label: '팩스', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_fax },
  { key: 'co_addr', label: '다올 주소', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_addr },
  { key: 'co_email', label: '다올 이메일', group: '다올 정보', scope: 'order', example: COMPANY_INFO.co_email },
]

export const FIELD_KEYS = new Set(FIELDS.map(f => f.key))
export const FIELD_BY_KEY = new Map(FIELDS.map(f => [f.key, f]))

// 화면 표시용 한 줄 요약: '품명' · '{item_name} ({qty}개)' · '양식 값 유지' …
export function specLabel(spec: ValueSpec | undefined): string {
  if (!spec || spec.k === 'skip') return '건드리지 않음'
  if (spec.k === 'blank') return '비움'
  if (spec.k === 'keep') return '양식 값 유지'
  const one = spec.v.match(/^\{([a-z_0-9]+)\}$/)
  if (one) return FIELD_BY_KEY.get(one[1])?.label ?? spec.v
  return spec.v
}

// 저장 전 검사 — 화면 · API 공통
export function validateMapping(m: unknown): { ok: true; mapping: FormMapping } | { ok: false; error: string } {
  const mm = m as FormMapping
  if (!mm || !Array.isArray(mm.sheets) || !mm.sheets.length) return { ok: false, error: '채울 시트가 없습니다.' }
  const col = /^[A-Z]{1,3}$/, addr = /^[A-Z]{1,3}[1-9]\d{0,5}$/
  const specOk = (s: ValueSpec) => s && (s.k === 'keep' || s.k === 'blank' || s.k === 'skip' || (s.k === 'tpl' && typeof s.v === 'string' && s.v.length <= 200))
  for (const s of mm.sheets) {
    if (!s.name) return { ok: false, error: '시트 이름이 비어 있습니다.' }
    if (!['rows', 'catalog', 'cells-only'].includes(s.mode)) return { ok: false, error: `'${s.name}' 채우는 방식이 올바르지 않습니다.` }
    if (!Number.isInteger(s.start_row) || s.start_row < 1) return { ok: false, error: `'${s.name}' 시작 행이 올바르지 않습니다.` }
    if (s.end_row != null && s.end_row < s.start_row) return { ok: false, error: `'${s.name}' 마지막 행이 시작 행보다 앞입니다.` }
    if (s.insert_before != null && s.insert_before <= s.start_row) return { ok: false, error: `'${s.name}' 꼬리 영역은 시작 행보다 뒤여야 합니다.` }
    for (const [k, v] of Object.entries(s.columns ?? {})) {
      if (!col.test(k) || !specOk(v)) return { ok: false, error: `'${s.name}' ${k}열 설정이 올바르지 않습니다.` }
    }
    for (const [k, v] of Object.entries(s.cells ?? {})) {
      if (!addr.test(k) || !specOk(v)) return { ok: false, error: `'${s.name}' ${k}칸 설정이 올바르지 않습니다.` }
    }
    if (s.mode === 'catalog') {
      const c = s.catalog
      if (!c || !col.test(c.name_col) || !col.test(c.qty_col) || (!!c.pack_col && !col.test(c.pack_col)) || !(c.end_row >= c.start_row)) {
        return { ok: false, error: `'${s.name}' 품목 목록 범위가 올바르지 않습니다.` }
      }
    }
  }
  return { ok: true, mapping: { version: 1, sheets: mm.sheets } }
}
