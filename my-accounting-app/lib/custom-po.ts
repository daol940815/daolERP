// 매입처 자체 발주서 양식 (2026-11-03 사용자 확정 — 1호: 대경사과원예농협)
// 자체 양식을 요구하는 매입처는 발주서 다운로드·메일 첨부가 그 매입처의 양식으로
// 나간다. 양식마다 실물 파일을 셀 단위 분석해 여기 레지스트리에 생성기를 추가한다.
// 매칭은 발주서 스냅샷의 매입처 표기(vendor_name) 기준 — 매입처 표기를 바꾸면
// 연결이 끊기므로 개명 시 이 목록도 함께 갱신할 것.
import type { PoExcelData } from './po-form'
import { COMPANY_TEL } from './po-form'

// ── 대경사과원예농협: '송장등록' 리스트 (위탁 직배송 접수 양식) ──
// 실발송 예시(2026-09-17) 기준 매핑:
//  보내는사람 = 주문처 + 담당자(존칭 '님' 제거 관례), 연락처1 = 다올 TEL
//  받는사람·연락처·우편번호·주소 = 수령인별 수기 기입 (다운로드 후 행을 늘려 작성)
//  상품명·수량 = 품목별 1행, 공급가 = 매입 단가, 판매가·등록명·쇼핑몰·산지 = 공란
//  주문번호1 = 발주번호(회신 대조용), 배송메세지 = 발주 배송 참고 프리필
async function buildDaekyungInvoice(po: PoExcelData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('송장등록')
  // 원본 열 너비 그대로 (서식·수식·병합 없음 — 원본과 동일하게 민짜 리스트)
  ws.columns = [11, 9.5, 48.5, 12.88, 13, 17.25, 16.38, 13.38, 13, 78, 30.12, 6.62, 6.5, 8, 11, 24.38, 12.75, 10.88]
    .map(w => ({ width: w }))
  const FONT = { name: '맑은 고딕', size: 11 }
  const header = ['송장번호', '주문번호1', '보내는사람', '연락처1', '연락처2', '받는사람', '연락처1', '연락처2',
    '우편번호', '주소', '상품명', '등록명', ' 수량 ', ' 판매가 ', ' 공급가 ', '배송메세지', '쇼핑몰', '산지']
  header.forEach((h, i) => {
    const c = ws.getCell(1, i + 1)
    c.value = h
    c.font = FONT
  })
  const sender = [po.customer, (po.customer_manager ?? '').replace(/님$/, '').trim()]
    .filter(Boolean).join(' ')
  po.items.forEach((it, i) => {
    const r = i + 2
    const values: (string | number)[] = [
      '',                       // 송장번호 — 매입처 기입
      po.po_no,                 // 주문번호1 = 발주번호
      sender, COMPANY_TEL, '',
      '', '', '', '', '',       // 받는사람·연락처·우편번호·주소 — 수령인별 수기
      it.item_name ?? '',
      '',                       // 등록명 (공란 — 사용자 확정)
      it.quantity ?? 0,
      '',                       // 판매가 (실발송 예시 기준 공란)
      it.purchase_price ?? 0,   // 공급가 = 매입 단가
      po.delivery_note ?? '',
      '', '',                   // 쇼핑몰·산지 (공란 — 사용자 확정)
    ]
    values.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1)
      c.value = v
      c.font = FONT
    })
  })
  return Buffer.from(await wb.xlsx.writeBuffer())
}

interface CustomPoForm {
  key: string
  label: string                        // 발송 페이지·파일명 표기
  filePrefix: string                   // 첨부 파일명 접두 (예: 송장등록)
  matches: (vendorName: string) => boolean
  build: (po: PoExcelData) => Promise<Buffer>
}

const FORMS: CustomPoForm[] = [
  {
    key: 'daekyung',
    label: '대경사과원예농협 송장등록 양식',
    filePrefix: '송장등록',
    matches: name => name.replace(/\s+/g, '').includes('대경사과'),
    build: buildDaekyungInvoice,
  },
]

export function findCustomPoForm(vendorName: string | null | undefined): CustomPoForm | null {
  if (!vendorName) return null
  return FORMS.find(f => f.matches(vendorName)) ?? null
}
