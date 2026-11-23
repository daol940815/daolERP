// 상담일지 출력 양식 엑셀 (2026-11-16 사용자 승인 — 시안 docs/mockups/상담일지_출력양식_시안.html v1)
//  - 2026-11-19: 상담자용(보관용) · 발주자용(실무용) 2부를 한 시트에 위아래로 — 사이 페이지 나누기, 인쇄 한 번에 2장 (CONSULT_SHEET_COPIES).
//  - 실무 양식 "입력용(명절)"의 배치(A4 가로 한 장: 머리 정보 → 품목 표 → 총계 → 발송 · 결제 → 비고)를 따르되
//    칸은 ERP 상담일지 항목 기준으로 추가 · 변경, 숨겨져 있던 마진율은 행마다 · 총계에 모두 표기 (사용자 지시).
//  - 원 양식의 '주문상담' 참조 수식은 쓰지 않고 값으로 채운다. 합계 · 마진율만 수식(캐시 값 포함).
//  - 품목은 ERP 품목 열 전체 15열. 부자재는 본 상품 아래 "└" 행, 배송비는 비용 행. 품목 수만큼 + 빈 행 2.
//  - 결제정보는 호출부가 마스킹 · 평문을 정해서 넘긴다 (ERP 열람 규칙). 시트2 '배송명단'은 명단(707)이 있을 때만.
import type { ShipInput } from './ship-address'
import { purchasePriceNumFmt } from './purchase-price'
import type { RosterRowInput } from './delivery-roster'
import type { PoExcelData } from './po-form'
import { addPoRosterSheet } from './purchase-orders'

export interface ConsultSheetItem {
  line_no: number
  parent_line_no: number | null
  is_shipping: boolean
  item_code: string | null
  order_kind: string | null
  item_name: string | null
  purchase_vendor_name: string | null   // 매입처명 (2026-11-16 사용자 요청 — 품목 표에 열 추가)
  quantity: number
  sale_price: number
  discount_amount: number
  discount_mode: string | null
  discount_unit: number
  line_total: number
  purchase_price: number
  purchase_shipping: number
  purchase_discount: number
  purchase_discount_mode: string | null
  purchase_discount_unit: number
  purchase_total: number
  status: string | null
  memo: string | null
  option_note: string | null
}

export interface ConsultSheetData {
  status: string                      // 진행중 · 주문전환 · 종결
  order_nos: string[]                 // 전환된 주문번호
  closed: { by: string | null; at: string | null; reason: string | null } | null
  consult_date: string
  consult_type: string
  season: string                      // 주문시기 (품목 값이 다르면 "26설 외")
  writer: string | null               // 작성자
  counselor: string | null            // 상담자 = 고객의 다올 담당
  order_progress: string | null       // 주문 진행 담당 (요청) / 주문 입력 직원
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null         // 존칭 표기
  tel: string | null
  phone: string | null
  billing_name: string | null         // 계산서 발행처(청구처, 114)
  items: ConsultSheetItem[]
  sender_name: string | null
  delivery_request: string | null
  greeting_card: string | null
  address_checked: string | null
  roster_method: string | null
  ship: ShipInput | null
  payment: string | null              // 마스킹 또는 평문 (호출부 결정)
  payment_plain: boolean
  invoice_email: string | null
  fax: string | null
  biz_number: string | null
  ceo_name: string | null
  prepay: boolean
  memo: string | null
  printed_by: string | null
  printed_at: string                  // 표시용 문자열
  roster_rows: RosterRowInput[] | null   // 707 명단 행 — 시트2는 발주서와 같은 규칙으로 품목 행에 붙인다
}

export const CONSULT_SHEET_NOTICE = '※ 다올보유위한 샘플발주, 제안용 샘플발주, 서비스 발주도 매출처를 기재바랍니다.'

// 파일명: 상담일_상담일지_업체_지점.xlsx (거래명세서 규칙과 동일 구조)
export function consultSheetFileName(d: ConsultSheetData): string {
  const clean = (s: string | null) => String(s ?? '').replace(/[\\/:*?"<>|]/g, ' ').trim()
  return `${[d.consult_date, '상담일지', clean(d.bank_name), clean(d.branch_name)].filter(Boolean).join('_')}.xlsx`
}

const FONT = '맑은 고딕'
const LABEL_BG = 'FFDBE5F1'    // 머리 라벨 (원 양식 theme8 80%)
const LABEL2_BG = 'FFE7E6E6'   // 하단 라벨 (theme2)
const IHEAD_BG = 'FFF2F2F2'    // 품목 헤더
const TOTAL_BG = 'FFFFF2CC'    // 총계
const NUM = '#,##0'
const PCT = '0.0%'
const won = (n: number) => Math.round(n).toLocaleString('ko-KR')

// 16열: NO 품번 배송종류 품명 수량 판매단가 판매할인 판매합계 매입처 매입단가 매입배송비 매입할인 매입합계 마진율 상태 비고
const WIDTHS = [4.5, 9, 7.5, 24, 6, 10, 9.5, 12, 11, 10, 9.5, 9.5, 12, 7, 8.5, 18]

// ── 행 높이 맞춤 (2026-11-19 사용자 승인 — 시안 docs/mockups/상담일지_출력_높이맞춤_시안.html) ──
// 엑셀은 병합 칸 · 높이를 정한 행을 자동으로 늘리지 않으므로, 글자 수와 칸 넓이로 줄 수를 세어 높이를 넣는다.
// 지금 높이는 최소값(짧은 상담은 모양 그대로). 한글 = 글자 크기만큼, 영문 · 숫자 = 그 절반 남짓으로 폭을 잡고 여유를 둔다.
const MAX_ROW_PT = 409          // 엑셀 행 높이 한계 — 메모는 나누지 않으므로(사용자 결정) 이보다 길면 그 이상은 잘린다
const colPx = (w: number) => Math.floor(w * 7 + 5)
function textPx(line: string, size: number): number {
  let px = 0
  for (const ch of line) {
    const code = ch.codePointAt(0) ?? 0
    const wide = code >= 0x1100 && (code <= 0x115f || (code >= 0x2e80 && code <= 0xa4cf) || (code >= 0xac00 && code <= 0xd7a3)
      || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xfe30 && code <= 0xfe4f) || (code >= 0xff00 && code <= 0xff60))
    px += size * 1.333 * (wide ? 0.92 : ch === ' ' ? 0.3 : 0.52)   // 맑은 고딕 기준 근사
  }
  return px
}
// 칸 하나에 필요한 높이(pt) — widthUnits = 칸(병합이면 합친) 열 넓이 합, indent = 왼쪽 들여쓰기 여부
export function neededHeight(text: string, widthUnits: number, size: number, indent = false): number {
  if (!text) return 0
  const usable = Math.max(20, colPx(widthUnits) - (indent ? 14 : 6))
  let lines = 0
  // 낱말 단위 줄바꿈으로 줄 끝이 비는 만큼 여유
  for (const para of text.split('\n')) lines += Math.max(1, Math.ceil(textPx(para, size) * 1.08 / usable))
  const lineH = size * 1.5                      // 맑은 고딕 줄 간격 (9pt 두 줄 = 30 — 기존 개당 할인 행 높이와 같음)
  return Math.min(MAX_ROW_PT, (lines + (lines >= 3 ? 0.5 : 0)) * lineH + 3)
}
const colIdx = (letters: string) => letters.split('').reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0)

// 한 장을 두 부 찍는다 (2026-11-19 실무 요청 — 예전 주문서 출력처럼 상담자 보관용 1장 + 발주자 실무용 1장).
//  두 부는 내용이 같고 제목만 다르다. 한 시트에 위아래로 쌓고 사이에 페이지 나누기 → 엑셀 인쇄 한 번에 2장.
export const CONSULT_SHEET_COPIES = [
  { key: 'counselor', title: '< 상담일지 - 상담자용(보관용) >' },
  { key: 'orderer', title: '< 상담일지 - 발주자용(실무용) >' },
] as const

export async function buildConsultSheetExcel(d: ConsultSheetData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('상담일지', {
    views: [{ showGridLines: false }],
    pageSetup: {
      // 가로 한 장 폭에 맞추고 세로는 자동 — 세로 방향의 수동 페이지 나누기(부 사이)는 그대로 지켜진다
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    },
  })
  ws.columns = WIDTHS.map(w => ({ width: w }))

  const items = [...d.items].sort((a, b) => a.line_no - b.line_no)
  let top = 1
  CONSULT_SHEET_COPIES.forEach((copy, i) => {
    const end = writeConsultCopy(ws, d, items, top, copy.title)
    if (i < CONSULT_SHEET_COPIES.length - 1) ws.getRow(end).addPageBreak()
    top = end + 1
  })
  // 품목 헤더 반복 인쇄(printTitlesRow)는 두지 않는다 — 둘째 부 첫 장 제목 위에 첫째 부 헤더가 찍히기 때문
  ws.pageSetup.printArea = `A1:P${top - 1}`

  // ── 시트2 배송명단 — 발주서 시트2와 완전히 동일 (addPoRosterSheet · poRosterRows 공용, 2026-11-16 사용자 요청):
  //    지점 · 샘플 품목 = 상담 배송지(706) 1행, 개별 품목 = 연결된 명단(707) 행마다 1행(없으면 빈 1행), 비용 · 부자재 행 제외,
  //    발송인 = 다올커머스 · 회사 TEL, 배송지 없으면 수령인 · 연락처는 담당자. 발주서는 매입처별 품목만, 여기는 상담 품목 전체.
  const rosterItems = items.filter(it => !it.parent_line_no && !it.is_shipping && it.item_name)
  if (rosterItems.length) {
    const poLike: PoExcelData = {
      po_no: '', order_date: d.consult_date, ship_request: d.delivery_request, vendor_name: '', customer: [d.bank_name, d.branch_name].filter(Boolean).join(' ') || '-',
      customer_bank: d.bank_name, customer_branch: d.branch_name, customer_manager: d.manager_name, customer_phone: d.phone ?? d.tel,
      staff_name: d.writer, staff_phone: null, total_amount: 0, delivery_note: null, ship: d.ship,
      roster_rows: d.roster_rows ?? null,
      items: items.map(it => ({
        item_code: it.item_code, item_name: it.item_name, order_kind: it.order_kind, quantity: it.quantity,
        purchase_price: it.purchase_price, purchase_shipping: it.purchase_shipping, purchase_total: it.purchase_total, memo: it.memo,
        role: it.is_shipping ? 'fee' : it.parent_line_no ? 'addon' : null,
      })),
    }
    addPoRosterSheet(wb, poLike)
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}


// 출력물 한 부 — top 행부터 그리고 마지막 행 번호를 돌려준다. 아래 행 번호는 모두 부 안에서의 상대 행(1 = 제목 줄).
function writeConsultCopy(ws: import('exceljs').Worksheet, d: ConsultSheetData, items: ConsultSheetItem[], top: number, title: string): number {
  const R = (n: number) => top - 1 + n                                   // 상대 행 → 시트 행
  const shift = (range: string) => range.replace(/([A-Z]+)(\d+)/g, (_, c: string, n: string) => `${c}${R(Number(n))}`)
  const row = (n: number) => ws.getRow(R(n))
  const cellAt = (n: number, c: number) => ws.getCell(R(n), c)
  const cellA = (ref: string) => ws.getCell(shift(ref))
  // 행마다 필요한 높이(상대 행 → pt) — 마지막에 지금 높이와 비교해 큰 쪽으로
  const need = new Map<number, number>()
  const wantH = (r: number, h: number) => { if (h > (need.get(r) ?? 0)) need.set(r, h) }

  const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true }
  const left = { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true, indent: 1 }
  const right = { horizontal: 'right' as const, vertical: 'middle' as const, wrapText: true }   // 개당 할인은 두 줄 — 자동 줄바꿈
  const font = (over: Record<string, unknown> = {}) => ({ name: FONT, size: 10, ...over })
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const boxRange = (r1: number, c1: number, r2: number, c2: number) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) cellAt(r, c).border = box
  }
  // 병합 칸 하나 채우기 — range "A3:B3" 또는 "C3" (상대 행)
  const put = (range: string, v: string | number | null, opt: { label?: 'head' | 'sub'; align?: 'l' | 'c' | 'r'; bold?: boolean; size?: number; fmt?: string } = {}) => {
    const abs = shift(range)
    if (abs.includes(':')) ws.mergeCells(abs)
    const cell = ws.getCell(abs.split(':')[0])
    cell.value = v ?? ''
    cell.font = font({ bold: !!opt.bold, size: opt.size ?? 10 })
    cell.alignment = opt.align === 'l' ? left : opt.align === 'r' ? right : center
    if (opt.label === 'head') cell.fill = fill(LABEL_BG)
    if (opt.label === 'sub') cell.fill = fill(LABEL2_BG)
    if (opt.fmt) cell.numFmt = opt.fmt
    if (typeof v === 'string' && v && !opt.label) {   // 라벨(고정 문구)은 지금 높이 기준으로 설계됨 — 계산하지 않는다
      const m = range.match(/^([A-Z]+)(\d+)(?::([A-Z]+)\d+)?$/)
      if (m) {
        const c1 = colIdx(m[1]), c2 = m[3] ? colIdx(m[3]) : c1
        const w = WIDTHS.slice(c1 - 1, c2).reduce((a, b) => a + b, 0)
        wantH(Number(m[2]), neededHeight(v, w, opt.size ?? 10, opt.align === 'l'))
      }
    }
    return cell
  }

  // ── 1~2행 제목 ──
  row(1).height = 30
  put('A1:C1', '다올커머스', { align: 'l', size: 9 })
  put('D1:M1', title, { label: 'head', bold: true, size: 15 })
  const statusText = [
    `상태 ${d.status}`,
    d.order_nos.length ? `주문번호 ${d.order_nos.join(', ')}` : '',
    d.closed ? `종결 ${[d.closed.at, d.closed.by].filter(Boolean).join(' ')}${d.closed.reason ? ` · 사유 ${d.closed.reason}` : ''}` : '',
  ].filter(Boolean).join('\n')
  put('N1:P1', statusText, { align: 'r', size: 8 })
  row(1).getCell(14).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }
  row(2).height = 6

  // ── 3~6행 머리 정보 (ERP 기준) ──
  for (const r of [3, 4, 5, 6]) row(r).height = 22
  put('A3:B3', '상담일', { label: 'head' }); put('C3', '구분', { label: 'head' }); put('D3', '주문시기', { label: 'head' })
  put('E3:F3', '작성자', { label: 'head' }); put('G3:H3', '상담자(다올 담당)', { label: 'head' }); put('I3:J3', '주문 진행', { label: 'head' })
  put('K3:L3', '은행/업체명', { label: 'head' }); put('M3:P3', '지점/부서명', { label: 'head' })
  put('A4:B4', d.consult_date); put('C4', d.consult_type); put('D4', d.season)
  put('E4:F4', d.writer); put('G4:H4', d.counselor); put('I4:J4', d.order_progress)
  put('K4:L4', d.bank_name); put('M4:P4', d.branch_name)
  put('A5:B5', '주문자명(담당자)', { label: 'head' }); put('C5:F5', '연락처', { label: 'head' })
  put('G5:J5', '계산서 발행처(청구처)', { label: 'head' }); put('K5:P5', '감사 서명란', { label: 'head' })
  put('A6:B6', d.manager_name)
  put('C6:F6', [d.tel ? `(유 선) ${d.tel}` : '', d.phone ? `(핸드폰) ${d.phone}` : ''].filter(Boolean).join('    '), { align: 'l' })
  put('G6:J6', d.billing_name)
  put('K6:P6', '')
  row(6).height = 30
  boxRange(3, 1, 6, 16)

  // ── 7행 안내문 ──
  row(7).height = 16
  put('A7:P7', CONSULT_SHEET_NOTICE, { align: 'l', size: 8 })
  cellA('A7').font = font({ size: 8, color: { argb: 'FF64748B' } })

  // ── 8행 품목 헤더 ──
  const HEAD = ['NO', '품번', '배송종류', '품명', '수량', '판매단가\n(vat포함)', '판매할인', '판매합계',
    '매입처', '매입단가', '매입배송비', '매입할인', '매입합계', '마진율', '상태', '비고(메모 · 기타)']
  row(8).height = 30
  HEAD.forEach((h, i) => {
    const c = cellAt(8, i + 1)
    c.value = h; c.font = font({ size: 9 }); c.fill = fill(IHEAD_BG); c.alignment = center
  })

  // ── 품목 행 (품목 수 + 빈 행 2) ──
  const first = 9
  let no = 0
  items.forEach((it, i) => {
    const r = first + i
    row(r).height = 20
    const sub = !!it.parent_line_no
    if (!sub) no += 1
    const kind = sub ? '부자재' : it.is_shipping ? '비용' : (it.order_kind ?? '')
    const margin = it.line_total > 0 ? (it.line_total - it.purchase_total) / it.line_total : null
    const disc = it.discount_amount > 0 && it.discount_mode === '단가'
      ? `${won(it.discount_amount)}\n개당 ${won(it.discount_unit)}` : it.discount_amount
    const pdisc = it.purchase_discount > 0 && it.purchase_discount_mode === '단가'
      ? `${won(it.purchase_discount)}\n개당 ${won(it.purchase_discount_unit)}` : it.purchase_discount
    const vals: (string | number | null)[] = [
      sub ? '' : no, it.item_code ?? '', kind, `${sub ? '└ ' : ''}${it.item_name ?? ''}`, it.quantity,
      it.sale_price, disc, it.line_total,
      it.purchase_vendor_name ?? '', it.purchase_price, it.purchase_shipping, pdisc, it.purchase_total,
      margin === null ? '-' : margin, it.status ?? '',
      [it.memo, it.option_note].filter(Boolean).join(' · '),
    ]
    vals.forEach((v, ci) => {
      const c = cellAt(r, ci + 1)
      c.value = v
      c.font = font({ size: 9, color: sub ? { argb: 'FF475569' } : undefined })
      const col = ci + 1
      c.alignment = col === 4 || col === 16 ? left : [6, 7, 8, 10, 11, 12, 13].includes(col) ? right : center
      if ([6, 8, 10, 11, 13].includes(col) || (typeof v === 'number' && (col === 7 || col === 12))) c.numFmt = NUM
      if (col === 14 && typeof v === 'number') { c.numFmt = PCT; c.alignment = center }
      if (col === 5) c.numFmt = NUM
      if (col === 9 && typeof v === 'number') c.numFmt = purchasePriceNumFmt(v)   // 매입가 — 소수(462.2)는 소수까지 (518)
      if (typeof v === 'string' && v) wantH(r, neededHeight(v, WIDTHS[ci], 9, col === 4 || col === 16))
    })
    if (typeof disc === 'string' || typeof pdisc === 'string') row(r).height = 30   // 두 줄 값 행
  })
  const blankFrom = first + items.length
  for (let k = 0; k < 2; k++) {
    const r = blankFrom + k
    row(r).height = 20
    cellAt(r, 1).value = no + k + 1
    cellAt(r, 1).font = font({ size: 9, color: { argb: 'FF94A3B8' } })
    cellAt(r, 1).alignment = center
  }
  const last = blankFrom + 1
  const totalRow = last + 1
  boxRange(8, 1, totalRow, 16)

  // ── 총계 행 (수식 + 캐시 값) — 수식 안의 행 번호는 시트 행(R) ──
  type F = import('exceljs').CellFormulaValue
  const mains = items.filter(it => !it.parent_line_no)
  const sumQty = mains.reduce((s, it) => s + it.quantity, 0)
  const sumDisc = items.reduce((s, it) => s + it.discount_amount, 0)
  const sumSale = items.reduce((s, it) => s + it.line_total, 0)
  const sumPShip = items.reduce((s, it) => s + it.purchase_shipping, 0)
  const sumPDisc = items.reduce((s, it) => s + it.purchase_discount, 0)
  const sumPur = items.reduce((s, it) => s + it.purchase_total, 0)
  const marginAmt = sumSale - sumPur
  const marginPct = sumSale > 0 ? marginAmt / sumSale : 0
  row(totalRow).height = 22
  put(`A${totalRow}:D${totalRow}`, '총 계', { bold: true })
  const sumCell = (col: string, result: number) => {
    const c = cellA(`${col}${totalRow}`)
    c.value = { formula: `SUM(${col}${R(first)}:${col}${R(last)})`, result } as F
    c.font = font({ size: 9, bold: true }); c.alignment = right; c.numFmt = NUM
  }
  const valCell = (col: string, v: number, align: typeof right | typeof center) => {
    const c = cellA(`${col}${totalRow}`)
    c.value = v; c.numFmt = NUM; c.alignment = align; c.font = font({ size: 9, bold: true })
  }
  // 수량은 부자재 행 제외라 값으로, 금액은 열 합계 수식 (할인 칸은 문자열이 섞일 수 있어 값으로)
  valCell('E', sumQty, center)
  valCell('G', sumDisc, right)
  sumCell('H', sumSale)
  sumCell('K', sumPShip)
  valCell('L', sumPDisc, right)
  sumCell('M', sumPur)
  const tr = R(totalRow)
  const pctCell = cellA(`N${totalRow}`)
  pctCell.value = { formula: `IF(H${tr}=0,0,(H${tr}-M${tr})/H${tr})`, result: marginPct } as F
  pctCell.font = font({ size: 9, bold: true }); pctCell.alignment = center; pctCell.numFmt = PCT
  put(`O${totalRow}:P${totalRow}`, `마진 ${won(marginAmt)}원`, { align: 'l', bold: true, size: 9 })
  for (let c = 1; c <= 16; c++) cellAt(totalRow, c).fill = fill(TOTAL_BG)

  // ── 발송 정보 · 결제 · 발행 정보 · 비고 ──
  const shipText = d.ship
    ? [d.ship.ship_name, d.ship.ship_phone, [d.ship.ship_addr1, d.ship.ship_addr2].filter(Boolean).join(' '),
      d.ship.ship_zip ? `(우편번호 ${d.ship.ship_zip})` : ''].filter(Boolean).join(' · ')
    : ''
  let r = totalRow + 2
  row(totalRow + 1).height = 6
  const blockRows = [
    [['A:B', '보내는분 명의', 'sub'], ['C:E', d.sender_name], ['F:G', '배송요청일', 'sub'], ['H', d.delivery_request],
      ['I:J', '인사장/명함', 'sub'], ['K', d.greeting_card], ['L:M', '주소확인여부', 'sub'], ['N:P', d.address_checked]],
    [['A:B', '고객명단수단', 'sub'], ['C:E', d.roster_method], ['F:G', '배송지(지점·샘플)', 'sub'], ['H:P', shipText]],
    [['A:B', '결제정보', 'sub'], ['C:E', d.payment], ['F:G', '계산서 이메일', 'sub'], ['H:J', d.invoice_email],
      ['K:L', '팩스', 'sub'], ['M:P', d.fax]],
    [['A:B', '사업자번호', 'sub'], ['C:E', d.biz_number], ['F:G', '대표자명', 'sub'], ['H:J', d.ceo_name],
      ['K:L', '선결제', 'sub'], ['M:P', d.prepay ? '선결제 품목 있음' : '해당 없음']],
  ] as [string, string | null, ('sub' | undefined)?][][]
  for (const cells of blockRows) {
    row(r).height = 24
    for (const [cols, v, lab] of cells) {
      const [c1, c2] = cols.split(':')
      const range = c2 ? `${c1}${r}:${c2}${r}` : `${c1}${r}`
      put(range, v ?? '', lab === 'sub' ? { label: 'sub' } : { align: 'l' })
    }
    boxRange(r, 1, r, 16)
    r += 1
  }
  row(r).height = 54
  put(`A${r}:B${r}`, '비고(상담 메모)', { label: 'sub' })
  const memoCell = put(`C${r}:P${r}`, d.memo ?? '', { align: 'l' })
  memoCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 }
  boxRange(r, 1, r, 16)
  r += 1
  row(r).height = 16
  put(`A${r}:P${r}`, `출력 ${d.printed_at}${d.printed_by ? ` · ${d.printed_by}` : ''} · daolERP${d.payment_plain ? ' · 결제정보 평문 포함' : ''}`, { align: 'r', size: 8 })
  cellA(`A${r}`).font = font({ size: 8, color: { argb: 'FF64748B' } })
  // 높이 맞춤 적용 — 정한 높이가 최소값, 글이 길면 그만큼 늘린다 (상담 메모도 나누지 않고 한 행)
  need.forEach((h, rel) => {
    const rw = row(rel)
    const base = rw.height ?? 15
    if (h > base) rw.height = Math.ceil(h)
  })
  return R(r)
}
