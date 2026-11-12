// 발주서 양식 정의 (다올커머스 발주서 — 2026-08-24 영업지원팀 개정 양식) —
// 엑셀 생성(lib/purchase-orders.ts)과 화면 미리보기(po-detail.tsx)가 같은
// 셀 값·순서·색을 쓰도록 한 곳에 둔다. 서버 의존성 없는 순수 정의만.
//
// 개정 내용 (사용자 확정 2026-08-24):
//  - 시트 2장: '발주서'(명세) + '배송명단'(수령인별 배송 리스트)
//  - 헤더: 발주번호가 맨 위 (배송구분 항목 삭제), 공급처·주문처는 한 칸씩 아래로
//  - 품목 표에서 배송구분 열 삭제 → 비고로 통일 (지점/개별 통합)
//  - 택배비는 품목 행으로 풀어서 기재 (상품 행 금액에서 배송비 분리, 총합계 불변)
//  - TEL·FAX 고정, 발주담당자·연락처는 발송 시점 로그인 직원 기준

import { SHIP_KINDS, hasShip, type ShipInput } from './ship-address'
import { rosterAddr, type RosterRowInput } from './delivery-roster'

export const COMPANY_NAME = '다올커머스'
export const COMPANY_PHONE = '070-7007-4582'   // 직원 연락처 미등록 시 대체
export const COMPANY_TEL = '031-922-4582'      // 양식 고정값 (사용자 확정)
export const COMPANY_FAX = '031-624-4584'      // 양식 고정값 (사용자 확정)

// 양식 색상 (개정 양식 원본에서 셀 단위 추출 — 테마 색은 RGB로 환산)
export const PO_COLORS = {
  labelBg: 'EEF2F7', label: '334155', ink: '000000',
  accentBg: 'FFFF00', accentInk: '0000FF',   // 출고요청일 강조 (노란 배경·파란 글씨)
  itemHeadBg: '44546A', itemHeadInk: 'FFFFFF',   // 품목 헤더 (남색 배경·흰 글씨)
  qtyInk: 'FF0000',                          // 수량 강조 (빨간 글씨)
  noteInk: '0000FF',                         // 비고 열 (파란 글씨 관례)
  totalInk: 'CC0000',                        // 합계 값 (붉은 굵은 글씨)
  totalBg: 'FFF2CC',                         // 합계 값 배경 (FFC000의 80% 밝기)
  title: '000000',                           // 제목 (검정 17pt 굵게)
}

export interface PoExcelData {
  po_no: string
  order_date: string | null        // 주문일
  ship_request: string | null      // 출고요청일 (상담일지 배송요청일)
  vendor_name: string              // 공급처(매입처)
  customer: string                 // 주문처(거래처)
  customer_bank: string | null     // 은행(업체)명 — 메일 치환 변수용 (2026-11-02)
  customer_branch: string | null   // 지점(부서)명 — 메일 치환 변수용
  customer_manager: string | null  // 배송명단 수령인 프리필
  customer_phone: string | null    // 배송명단 연락처 프리필
  staff_name: string | null        // 발주담당자 — 발송 시점 로그인 직원
  staff_phone: string | null       // 발주자 연락처 = 업무용 핸드폰(205) → 직원 핸드폰 → 회사 번호
  total_amount: number
  delivery_note: string | null     // 배송명단 배송메모 프리필
  ship?: ShipInput | null          // 주문 배송지 (513) — 지점·샘플 품목 행에 자동 채움
  items: {
    item_code: string | null; item_name: string | null; order_kind: string | null
    quantity: number; purchase_price: number; purchase_shipping: number
    purchase_total: number; memo: string | null
    // 품목 구분 (2026-11-05): fee = 비용 품목(품목 마스터 '비용 품목' 체크 — 배송비 · 퀵비 · 설치비 등),
    // addon = 부가상품(쇼핑백 · 포장지 — 본 상품과 함께 감). 둘 다 자사 양식 배송명단에서 제외
    role?: 'fee' | 'addon' | null
    // 택배비 줄 (2026-11-12): 품목 관리의 박스당 택배비(카톤택배비 > 0 이면 카톤, 0이면 카톤외)와
    // 원 주문 품목의 실제 매입배송비(판매가 발주 요아럽은 스냅샷이 판매 배송비라 박스 수를 여기서 센다). null = 알 수 없음
    ship_box_fee?: number | null
    ship_purchase?: number | null
  }[]
  // 판매가 발주 매입처(요아럽 — po_use_sale_price): 택배비 줄 단가 · 금액이 고객 택배비 기준
  sale_basis?: boolean
  // 개별 배송 명단 행 (707) — 이 주문에 연결된 수령인 행. 개별 품목 행을 수령인별로 펼친다
  roster_rows?: RosterRowInput[] | null
}

// ── 시트1 '발주서' ────────────────────────────────────

// 헤더 정보 9칸 — 3칸 × 3행 (배치 순서 = 엑셀 병합 순서)
export function poFormInfo(po: PoExcelData): { label: string; value: string | number | null; bold?: boolean; accent?: boolean }[] {
  return [
    { label: '발주번호', value: po.po_no },   // 값 셀은 원본과 같이 일반 굵기
    { label: '주문일', value: po.order_date },
    { label: '출고요청일', value: po.ship_request, accent: true },
    { label: '공급처', value: po.vendor_name },
    { label: '발주담당자', value: po.staff_name },
    { label: '발주자 연락처', value: po.staff_phone || COMPANY_PHONE },
    { label: '주문처', value: po.customer },
    { label: 'TEL', value: COMPANY_TEL },
    { label: 'FAX', value: COMPANY_FAX },
  ]
}

// 품목 표 6열 (배송구분 열 삭제 — 비고로 통일)
export const PO_HEADERS = ['NO', '제품명', '수량', '단가', '금액', '비고'] as const
export const PO_NUM_COLS = new Set([2, 3, 4])   // 수량·단가·금액 (0-based)

export const SHIPPING_ROW_LABEL = '택배비'

// 택배비 줄 (2026-11-12 사용자 확정 — 자사 기본 발주서만, 업체 자체 발주서는 대상 아님):
//  - 매입배송비가 있는 품목만 줄을 만든다(모든 업체). 합포장은 사람이 매입배송비를 0으로 고친다.
//  - 박스 수 = 매입배송비 ÷ 박스당 택배비. 줄 = 박스 수 × 단가, 박스당 금액이 다르면 줄을 나눈다. 합계는 늘 저장값과 같다.
//  - 나누어떨어지지 않으면 수량 · 단가를 비우고(금액은 그대로) 알림 — 사람이 엑셀을 고쳐 수정본으로 올린다.
//  - 판매가 발주(요아럽): 조건 · 박스 수는 같고, 단가 · 금액만 고객 택배비(스냅샷) 기준 — 기본 0원이면 박스 수 × 0.
export interface PoShipLine { qty: number | null; unit: number | null; amount: number }
export function poShippingLines(po: PoExcelData): { lines: PoShipLine[]; warnings: string[] } {
  const lines: PoShipLine[] = []
  const warnings: string[] = []
  const byUnit = new Map<number, PoShipLine>()
  const add = (unit: number, boxes: number) => {
    const cur = byUnit.get(unit)
    if (cur) { cur.qty = (cur.qty ?? 0) + boxes; cur.amount += unit * boxes; return }
    const line = { qty: boxes, unit, amount: unit * boxes }
    byUnit.set(unit, line)
    lines.push(line)
  }
  const w = (n: number) => n.toLocaleString('ko-KR')
  const name = (it: PoExcelData['items'][number]) => it.item_name || '품목'
  for (const it of po.items) {
    const stored = it.purchase_shipping ?? 0            // 발주 스냅샷 (판매가 발주면 고객 택배비)
    const fee = it.ship_box_fee ?? 0
    const actual = po.sale_basis ? it.ship_purchase : stored   // 박스 수를 셀 실제 매입배송비
    if (actual == null) {
      // 원 주문 품목 연결이 끊겨 실제 매입배송비를 알 수 없음 — 저장된 값 그대로 한 줄(이전 방식)
      if (stored > 0) {
        lines.push({ qty: 1, unit: stored, amount: stored })
        warnings.push(`택배비 확인 필요 — ${name(it)}: 원 주문 품목 연결이 끊겨 박스 수를 셀 수 없어 이전 방식(1 × ${w(stored)}원)으로 적었습니다.`)
      }
      continue
    }
    if (actual <= 0) {
      if (stored > 0) {
        // 이번 규칙 이전에 만든 판매가 발주 — 매입배송비 0인데 고객 택배비가 발주 금액에 들어가 있음 (합계 보존)
        lines.push({ qty: 1, unit: stored, amount: stored })
        warnings.push(`택배비 확인 필요 — ${name(it)}: 매입배송비가 0원인데 이전 방식으로 만든 발주서라 고객 택배비 ${w(stored)}원이 들어 있습니다. 필요하면 발주서를 다시 만들어 주세요.`)
      }
      continue
    }
    const boxes = fee > 0 && actual % fee === 0 ? actual / fee : null
    if (boxes && stored % boxes === 0) { add(stored / boxes, boxes); continue }
    lines.push({ qty: null, unit: null, amount: stored })
    warnings.push(`택배비 수량 확인 필요 — ${name(it)}: ${
      fee > 0
        ? `매입배송비 ${w(actual)}원이 박스당 ${w(fee)}원으로 나누어떨어지지 않아`
        : boxes ? `고객 택배비 ${w(stored)}원이 ${boxes}박스로 나누어떨어지지 않아` : '품목 관리에 박스당 택배비가 없어'
    } 수량 · 단가를 비웠습니다. 엑셀을 내려받아 고친 뒤 수정본으로 올려 주세요. 합계는 ${w(stored)}원 그대로입니다.`)
  }
  return { lines, warnings }
}

// 품목 행 — 택배비를 품목 행으로 풀어낸다 (사용자 확정):
//  상품 행 금액 = 매입합계 - 매입배송비, 택배비 행 = 박스 수 × 단가 (poShippingLines). 총합계 불변.
export function poFormItemRows(po: PoExcelData): (string | number)[][] {
  const rows: (string | number)[][] = po.items.map((it, i) => [
    i + 1,
    it.item_name ?? '',
    it.quantity ?? 0,
    it.purchase_price ?? 0,
    (it.purchase_total ?? 0) - (it.purchase_shipping ?? 0),
    it.memo ?? '',
  ])
  for (const l of poShippingLines(po).lines) {
    rows.push([rows.length + 1, SHIPPING_ROW_LABEL, l.qty ?? '', l.unit ?? '', l.amount, ''])
  }
  return rows
}

// 발주서 파일 이름 (2026-11-12 사용자 확정) — 다운로드 · 메일 첨부 공통
//   {작성일 yymmdd}_다올커머스_{배송종류}_발주서_{매입처}_{은행 지점}_{고객}_{순번}.xlsx
//   - 작성일 · 순번 = 발주번호(POyymmdd-##)의 날짜 · 순번 (그날 발주서 전체 순번이라 같은 날 이름이 겹치지 않는다)
//   - 배송종류: 발주서 품목의 지점 · 개별 · 샘플, 섞이면 둘 다 ('지점·개별')
//   - 매출처: 은행명 + 지점명(지점명이 비면 은행명만) · 고객: 주문 담당자 이름, '님' 없이
//   - 빈 항목은 칸째 뺀다 · 파일 이름에 못 쓰는 글자는 '_'
//   - 예외 없음 — 업체 양식 · 대경사과 자체 양식도 '발주서' (2026-11-12 사용자 확정)
const PO_KIND_ORDER = ['지점', '개별', '샘플']
export function poFileName(p: {
  po_no: string; created_at?: string | null; vendor_name: string | null
  bank_name?: string | null; branch_name?: string | null; manager_name?: string | null
  kinds: (string | null | undefined)[]
}): string {
  const clean = (v: string | null | undefined) =>
    String(v ?? '').replace(/[\\/:*?"<>|\r\n\t]/g, '_').replace(/\s+/g, ' ').trim().replace(/^_+|_+$/g, '')
  const m = p.po_no.match(/^PO(\d{6})-(\d+)$/)
  const date = m ? m[1]
    : p.created_at ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date(p.created_at)).slice(2).replace(/-/g, '')
    : ''
  const seq = m ? m[2] : clean(p.po_no)
  const kinds = Array.from(new Set(p.kinds.map(k => clean(k)).filter(Boolean)))
    .sort((a, b) => {
      const ia = PO_KIND_ORDER.indexOf(a), ib = PO_KIND_ORDER.indexOf(b)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
  const customer = [clean(p.bank_name), clean(p.branch_name)].filter(Boolean).join(' ')
  const manager = clean(String(p.manager_name ?? '').replace(/\s*님$/, ''))
  const parts = [date, COMPANY_NAME, kinds.join('·'), '발주서', clean(p.vendor_name), customer, manager, seq]
  return `${parts.filter(Boolean).join('_')}.xlsx`
}

// 출고요청일 표기 통일 (2026-11-09 사용자 승인) — 상담일지 배송요청일은 자유 입력 글자('11월 12일' · '11/12' · '11.12(수)' …)라
// 발주서에 그대로 들어가 날짜 서식이 먹지 않았다. 발주서 만들 때만 날짜로 읽어 'YYYY-MM-DD'로 통일한다(상담일지 원본은 그대로).
//  - 연도 없음 → 주문일 연도. 주문일보다 60일 넘게 앞서면 다음 해 (12/28 주문의 '1/3' = 다음 해 1월 3일)
//  - 날짜로 읽을 수 없는 표기('11월 중순' · '빠른 배송' · '11/12까지')는 글자 그대로
export function normalizeShipRequest(raw: string | null | undefined, orderDate?: string | null): string | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  const t = text
    .replace(/\(\s*[월화수목금토일](요일)?\s*\)/g, '')   // (수) · (수요일)
    .replace(/\s+[월화수목금토일]요일$/, '')               // 끝의 ' 수요일'
    .replace(/\s+/g, ' ').trim()
  const pad = (n: number) => String(n).padStart(2, '0')
  const valid = (y: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d))
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
  }
  const out = (y: number, m: number, d: number) => (valid(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : text)
  let m: RegExpMatchArray | null
  if ((m = t.match(/^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?$/))) return out(+m[1], +m[2], +m[3])
  if ((m = t.match(/^(\d{2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})\.?$/))) return out(2000 + +m[1], +m[2], +m[3])
  if ((m = t.match(/^(\d{4})(\d{2})(\d{2})$/))) return out(+m[1], +m[2], +m[3])
  if ((m = t.match(/^(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*[.일]?$/))) {
    const mo = +m[1], d = +m[2]
    const base = /^\d{4}-\d{2}-\d{2}/.test(orderDate ?? '') ? orderDate!.slice(0, 10)
      : new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date())
    let y = +base.slice(0, 4)
    if (!valid(y, mo, d)) return mo === 2 && d === 29 && valid(y + 1, mo, d) ? out(y + 1, mo, d) : text
    const diff = (Date.UTC(y, mo - 1, d) - Date.parse(`${base}T00:00:00Z`)) / 86400000
    if (diff < -60) y += 1
    return out(y, mo, d)
  }
  return text
}

// ── 시트2 '배송명단' ──────────────────────────────────

export const ROSTER_HEADERS = ['NO.', '발송인', '발송인 연락처', '수령인', '주소', '연락처', '제품명', '수량', '배송메모'] as const

// 상품 행별 1행 (택배비 행 제외).
// 배송지(513)가 있는 주문: 지점·샘플 품목 행 = 주문 배송지, 개별 품목 행 = 명단(707) 또는 비움(수령인별 수기).
// 배송지가 없는 주문(513 이전·미입력): 기존대로 수령인·연락처만 주문처 담당자 프리필, 주소 수기.
// 주소는 "주소 + 상세"만 — 우편번호는 시트에 넣지 않는다 (2026-11-09 사용자 확정: 주소 앞 우편번호 결합 금지).
export function shipForItem(po: PoExcelData, orderKind: string | null | undefined):
  { name: string; phone: string; zip: string; addr: string } | null {
  if (!hasShip(po.ship)) return null
  if (!SHIP_KINDS.has(orderKind ?? '지점')) return { name: '', phone: '', zip: '', addr: '' }
  const s = po.ship!
  return {
    name: s.ship_name ?? '', phone: s.ship_phone ?? '', zip: s.ship_zip ?? '',
    addr: [s.ship_addr1, s.ship_addr2].filter(Boolean).join(' '),
  }
}

// 개별 품목 행에 붙는 명단 행 — 연결 품목(product_id 우선, 없으면 상품명·품번)으로 고른다
const normKey = (v: unknown) => String(v ?? '').replace(/\s+/g, '').toLowerCase()
export function rosterRowsForItem(po: PoExcelData, it: PoExcelData['items'][number]): RosterRowInput[] {
  const rows = po.roster_rows ?? []
  if (!rows.length || SHIP_KINDS.has(it.order_kind ?? '지점')) return []
  const name = normKey(it.item_name), code = normKey(it.item_code)
  return rows.filter(r => r.item_name && (normKey(r.item_name) === name || (code && normKey(r.item_code) === code)))
}

// 배송명단 대상 = 실제로 보내는 상품만 — 비용 품목 · 부가상품 제외 (2026-11-05 사용자 확정).
// 품목 표(시트1)에는 그대로 남아 금액 · 수량은 빠지지 않는다.
export const rosterItems = (po: PoExcelData) => po.items.filter(it => it.role !== 'fee' && it.role !== 'addon')

// 배송명단 행 — 지점·샘플 품목 = 1행(주문 배송지), 개별 품목 = 연결된 명단 행마다 1행(707).
// 명단이 없는 개별 품목은 기존대로 1행(수령인별 수기). 배송메모: 명단 행 메모 → 없으면 첫 행에 발주 배송메모.
export function poRosterRows(po: PoExcelData): (string | number)[][] {
  const out: (string | number)[][] = []
  let noteUsed = false
  const firstNote = () => { if (noteUsed) return ''; noteUsed = true; return po.delivery_note ?? '' }
  for (const it of rosterItems(po)) {
    const fromRoster = rosterRowsForItem(po, it)
    if (fromRoster.length) {
      for (const r of fromRoster) {
        out.push([out.length + 1, COMPANY_NAME, COMPANY_TEL, r.recipient_name ?? '', rosterAddr(r), r.phone ?? '',
          it.item_name ?? '', r.quantity ?? 0, r.memo ?? firstNote()])
      }
      continue
    }
    const sh = shipForItem(po, it.order_kind)
    out.push([
      out.length + 1,
      COMPANY_NAME,
      COMPANY_TEL,
      sh ? sh.name : po.customer_manager ?? '',
      sh ? sh.addr : '',                    // 배송지 없으면 주소 수기 · 우편번호는 넣지 않는다
      sh ? sh.phone : po.customer_phone ?? '',
      it.item_name ?? '',
      it.quantity ?? 0,
      firstNote(),
    ])
  }
  return out
}

// 미리보기 접기 (화면용) — 앞 n행만, 나머지는 "외 N행"
export const ROSTER_PREVIEW_ROWS = 20

// ── 메일 프리셋 치환 (발송 페이지·서버 발송 공용) ──────────────────
// {발주번호} 같은 변수를 실제 값으로 바꾼다. 값이 없는 변수는 그대로 남겨
// 사용자가 발송 전에 알아챌 수 있게 한다.
export function fillMailTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{([^{}\n]+)\}/g, (raw, key: string) => vars[key.trim()] ?? raw)
}

export function poMailVars(form: PoExcelData, orderNo?: string | null): Record<string, string> {
  const items = form.items ?? []
  const first = items[0]?.item_name ?? ''
  return {
    '발주번호': form.po_no,
    '매입처명': form.vendor_name,
    '주문번호': orderNo ?? '',
    '주문처': form.customer,
    '은행명': form.customer_bank ?? form.customer,        // 업체(은행)명 — 미상이면 주문처 전체
    '지점명': form.customer_branch ?? '',                 // 지점(부서)명
    '상품명': items.length > 1 ? `${first} 외 ${items.length - 1}건` : first,
    '품목목록': items.map(it => `- ${it.item_name ?? ''} ${it.quantity ?? 0}개`).join('\n'),
    '품목수': String(items.length),
    '합계금액': (form.total_amount ?? 0).toLocaleString('ko-KR'),
    '출고요청일': form.ship_request ?? '',
    '발주담당자': form.staff_name ?? '',
  }
}
