// 발주서 양식 정의 (다올커머스 발주서) — 엑셀 생성(lib/purchase-orders.ts)과
// 화면 미리보기(app/(orders)/orders/po-detail.tsx)가 같은 셀 값·순서·색을 쓰도록
// 한 곳에 둔다. 서버 의존성 없는 순수 정의만 (클라이언트 번들에 안전).

export const COMPANY_NAME = '다올커머스'
export const COMPANY_PHONE = '070-7007-4582'   // 발송인·발주자 연락처 (양식 원본 값)

// 양식 색상 (엑셀 원본에서 추출, RGB hex — 사용처에서 접두사 FF/# 부여)
export const PO_COLORS = {
  navy: '1F2A44', gold: 'C0810A', labelBg: 'EEF2F7', totalBg: 'FDECC8',
  goldRowBg: 'FFF7E6', ink: '111827', label: '334155', totalInk: 'B00020',
}

export interface PoExcelData {
  po_no: string
  order_date: string | null        // 주문일
  ship_request: string | null      // 출고요청일 (상담일지 배송요청일)
  vendor_name: string              // 공급처(매입처)
  vendor_phone: string | null      // 공급처 연락처 (매입처 마스터)
  delivery_kind: string | null     // 배송구분 (품목 구분에서 판정)
  customer: string                 // 주문처(거래처)
  customer_manager: string | null  // 주문처 담당자 (고객처 담당자)
  customer_phone: string | null    // 주문처 연락처
  staff_name: string | null        // 발주 담당자 (발주서 작성자)
  staff_phone: string | null       // 발주자 연락처 (작성자 직원 연락처, 없으면 회사 번호)
  total_amount: number
  delivery_note: string | null     // 배송메모 (첫 품목 행에 기재)
  items: {
    item_code: string | null; item_name: string | null; order_kind: string | null
    quantity: number; purchase_price: number; purchase_shipping: number
    purchase_total: number; memo: string | null
  }[]
}

// 품목 표 헤더 15열 — navy: 발주 내용 / gold: 배송 수기 보완란
export const PO_HEADERS: { label: string; tone: 'navy' | 'gold' }[] = [
  { label: 'NO', tone: 'navy' },
  { label: '발송인', tone: 'gold' },
  { label: '발송인 연락처', tone: 'gold' },
  { label: '수령인', tone: 'gold' },
  { label: '수령인 연락처', tone: 'gold' },
  { label: '우편번호', tone: 'gold' },
  { label: '배송지 주소', tone: 'gold' },
  { label: '제품명', tone: 'navy' },
  { label: '규격/옵션', tone: 'navy' },
  { label: '수량', tone: 'navy' },
  { label: '단가', tone: 'navy' },
  { label: '합계', tone: 'navy' },
  { label: '비고', tone: 'navy' },
  { label: '배송메모', tone: 'gold' },
  { label: '송장번호', tone: 'gold' },
]
// 골드 열(1-based) — 품목 행에서 연한 골드 배경으로 수기란 표시
export const PO_GOLD_COLS = new Set([2, 3, 4, 5, 6, 7, 14, 15])
// 숫자 열(0-based) — 수량·단가·합계 (우측 정렬·천단위 표기)
export const PO_NUM_COLS = new Set([9, 10, 11])

// 상단 정보 그리드 12칸 — 배치 순서 = 엑셀 병합 순서 (3칸 × 4행)
export function poFormInfo(po: PoExcelData): { label: string; value: string | number | null; bold?: boolean }[] {
  return [
    { label: '발주번호', value: po.po_no, bold: true },
    { label: '주문일', value: po.order_date },
    { label: '출고요청일', value: po.ship_request },
    { label: '공급처(매입처)', value: po.vendor_name },
    { label: '공급처 연락처', value: po.vendor_phone },
    { label: '배송구분', value: po.delivery_kind, bold: true },
    { label: '주문처(거래처)', value: po.customer },
    { label: '주문처 담당자', value: po.customer_manager },
    { label: '주문처 연락처', value: po.customer_phone },
    { label: '발주 담당자', value: po.staff_name },
    { label: '발주자 연락처', value: po.staff_phone || COMPANY_PHONE },
    { label: '총 합계금액 (VAT 포함)', value: po.total_amount },
  ]
}

// 품목 행 값 15열 — 엑셀 출력과 완전히 동일한 값
// (합계에 매입배송비 포함 시 비고에 명시, 배송메모는 첫 행에만)
export function poFormItemRows(po: PoExcelData): (string | number)[][] {
  return po.items.map((it, i) => {
    const noteParts: string[] = []
    if (it.memo) noteParts.push(it.memo)
    if ((it.purchase_shipping ?? 0) > 0) noteParts.push(`배송비 ${it.purchase_shipping.toLocaleString('ko-KR')}원 포함`)
    return [
      i + 1,
      COMPANY_NAME, COMPANY_PHONE,
      po.customer_manager ?? '', po.customer_phone ?? '',
      '', '',                                    // 우편번호·배송지 주소 — 수기 기입
      it.item_name ?? '', it.item_code ?? '',
      it.quantity ?? 0, it.purchase_price ?? 0, it.purchase_total ?? 0,
      noteParts.join(' · '),                     // 비고
      i === 0 ? po.delivery_note ?? '' : '',     // 배송메모 — 첫 행에만
      '',                                        // 송장번호 — 매입처 기입
    ]
  })
}
