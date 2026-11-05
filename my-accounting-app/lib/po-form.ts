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

import { SHIP_KINDS, hasShip, shipAddrLine, type ShipInput } from './ship-address'

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
  }[]
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

// 품목 행 — 택배비를 품목 행으로 풀어낸다 (사용자 확정):
//  상품 행 금액 = 매입합계 - 매입배송비, 택배비 행 = 배송비 합산 1행. 총합계 불변.
export function poFormItemRows(po: PoExcelData): (string | number)[][] {
  const rows: (string | number)[][] = po.items.map((it, i) => [
    i + 1,
    it.item_name ?? '',
    it.quantity ?? 0,
    it.purchase_price ?? 0,
    (it.purchase_total ?? 0) - (it.purchase_shipping ?? 0),
    it.memo ?? '',
  ])
  const shipping = po.items.reduce((s, it) => s + (it.purchase_shipping ?? 0), 0)
  if (shipping > 0) {
    rows.push([rows.length + 1, SHIPPING_ROW_LABEL, 1, shipping, shipping, ''])
  }
  return rows
}

// ── 시트2 '배송명단' ──────────────────────────────────

export const ROSTER_HEADERS = ['NO.', '발송인', '발송인 연락처', '수령인', '주소', '연락처', '제품명', '수량', '배송메모'] as const

// 상품 행별 1행 (택배비 행 제외).
// 배송지(513)가 있는 주문: 지점·샘플 품목 행 = 주문 배송지, 개별 품목 행 = 비움(수령인별 수기).
// 배송지가 없는 주문(513 이전·미입력): 기존대로 수령인·연락처만 주문처 담당자 프리필, 주소 수기.
export function shipForItem(po: PoExcelData, orderKind: string | null | undefined):
  { name: string; phone: string; zip: string; addr: string; addrLine: string } | null {
  if (!hasShip(po.ship)) return null
  if (!SHIP_KINDS.has(orderKind ?? '지점')) return { name: '', phone: '', zip: '', addr: '', addrLine: '' }
  const s = po.ship!
  return {
    name: s.ship_name ?? '', phone: s.ship_phone ?? '', zip: s.ship_zip ?? '',
    addr: [s.ship_addr1, s.ship_addr2].filter(Boolean).join(' '), addrLine: shipAddrLine(s),
  }
}

// 배송명단 대상 = 실제로 보내는 상품만 — 비용 품목 · 부가상품 제외 (2026-11-05 사용자 확정).
// 품목 표(시트1)에는 그대로 남아 금액 · 수량은 빠지지 않는다.
export const rosterItems = (po: PoExcelData) => po.items.filter(it => it.role !== 'fee' && it.role !== 'addon')

export function poRosterRows(po: PoExcelData): (string | number)[][] {
  return rosterItems(po).map((it, i) => {
    const sh = shipForItem(po, it.order_kind)
    return [
      i + 1,
      COMPANY_NAME,
      COMPANY_TEL,
      sh ? sh.name : po.customer_manager ?? '',
      sh ? sh.addrLine : '',                // 배송지 없으면 주소 수기
      sh ? sh.phone : po.customer_phone ?? '',
      it.item_name ?? '',
      it.quantity ?? 0,
      i === 0 ? po.delivery_note ?? '' : '',
    ]
  })
}

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
