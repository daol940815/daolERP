// 상담일지 출력 양식 엑셀 (2026-11-16 사용자 승인 — 시안 docs/mockups/상담일지_출력양식_시안.html v1)
//  - 실무 양식 "입력용(명절)"의 배치(A4 가로 한 장: 머리 정보 → 품목 표 → 총계 → 발송 · 결제 → 비고)를 따르되
//    칸은 ERP 상담일지 항목 기준으로 추가 · 변경, 숨겨져 있던 마진율은 행마다 · 총계에 모두 표기 (사용자 지시).
//  - 원 양식의 '주문상담' 참조 수식은 쓰지 않고 값으로 채운다. 합계 · 마진율만 수식(캐시 값 포함).
//  - 품목은 ERP 품목 열 전체 15열. 부자재는 본 상품 아래 "└" 행, 배송비는 비용 행. 품목 수만큼 + 빈 행 2.
//  - 결제정보는 호출부가 마스킹 · 평문을 정해서 넘긴다 (ERP 열람 규칙). 시트2 '배송명단'은 명단(707)이 있을 때만.
import type { ShipInput } from './ship-address'
import type { RosterRowInput } from './delivery-roster'
import { rosterAddr } from './delivery-roster'
import { COMPANY_NAME, COMPANY_TEL, PO_COLORS, ROSTER_HEADERS } from './po-form'

export interface ConsultSheetItem {
  line_no: number
  parent_line_no: number | null
  is_shipping: boolean
  item_code: string | null
  order_kind: string | null
  item_name: string | null
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
  roster_rows: RosterRowInput[] | null
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

export async function buildConsultSheetExcel(d: ConsultSheetData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('상담일지', {
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
      horizontalCentered: true,
    },
  })
  // 15열: NO 품번 배송종류 품명 수량 판매단가 판매할인 판매합계 매입단가 매입배송비 매입할인 매입합계 마진율 상태 비고
  const widths = [4.5, 9, 7.5, 26, 6, 10, 9.5, 12, 10, 9.5, 9.5, 12, 7, 8.5, 20]
  ws.columns = widths.map(w => ({ width: w }))

  const thin = { style: 'thin' as const, color: { argb: 'FF94A3B8' } }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const center = { horizontal: 'center' as const, vertical: 'middle' as const, wrapText: true }
  const left = { horizontal: 'left' as const, vertical: 'middle' as const, wrapText: true, indent: 1 }
  const right = { horizontal: 'right' as const, vertical: 'middle' as const, wrapText: true }   // 개당 할인은 두 줄 — 자동 줄바꿈
  const font = (over: Record<string, unknown> = {}) => ({ name: FONT, size: 10, ...over })
  const fill = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } })
  const boxRange = (r1: number, c1: number, r2: number, c2: number) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = box
  }
  // 병합 칸 하나 채우기 — range "A3:B3" 또는 "C3"
  const put = (range: string, v: string | number | null, opt: { label?: 'head' | 'sub'; align?: 'l' | 'c' | 'r'; bold?: boolean; size?: number; fmt?: string } = {}) => {
    if (range.includes(':')) ws.mergeCells(range)
    const cell = ws.getCell(range.split(':')[0])
    cell.value = v ?? ''
    cell.font = font({ bold: !!opt.bold, size: opt.size ?? 10 })
    cell.alignment = opt.align === 'l' ? left : opt.align === 'r' ? right : center
    if (opt.label === 'head') cell.fill = fill(LABEL_BG)
    if (opt.label === 'sub') cell.fill = fill(LABEL2_BG)
    if (opt.fmt) cell.numFmt = opt.fmt
    return cell
  }

  // ── 1~2행 제목 ──
  ws.getRow(1).height = 30
  put('A1:C1', '다올커머스', { align: 'l', size: 9 })
  put('D1:L1', '< 상담일지 - 보관용 >', { label: 'head', bold: true, size: 15 })
  const statusText = [
    `상태 ${d.status}`,
    d.order_nos.length ? `주문번호 ${d.order_nos.join(', ')}` : '',
    d.closed ? `종결 ${[d.closed.at, d.closed.by].filter(Boolean).join(' ')}${d.closed.reason ? ` · 사유 ${d.closed.reason}` : ''}` : '',
  ].filter(Boolean).join('\n')
  put('M1:O1', statusText, { align: 'r', size: 8 })
  ws.getRow(1).getCell(13).alignment = { horizontal: 'right', vertical: 'middle', wrapText: true }
  ws.getRow(2).height = 6

  // ── 3~6행 머리 정보 (ERP 기준) ──
  for (const r of [3, 4, 5, 6]) ws.getRow(r).height = 22
  put('A3:B3', '상담일', { label: 'head' }); put('C3', '구분', { label: 'head' }); put('D3', '주문시기', { label: 'head' })
  put('E3:F3', '작성자', { label: 'head' }); put('G3:H3', '상담자(다올 담당)', { label: 'head' }); put('I3:J3', '주문 진행', { label: 'head' })
  put('K3:L3', '은행/업체명', { label: 'head' }); put('M3:O3', '지점/부서명', { label: 'head' })
  put('A4:B4', d.consult_date); put('C4', d.consult_type); put('D4', d.season)
  put('E4:F4', d.writer); put('G4:H4', d.counselor); put('I4:J4', d.order_progress)
  put('K4:L4', d.bank_name); put('M4:O4', d.branch_name)
  put('A5:B5', '주문자명(담당자)', { label: 'head' }); put('C5:F5', '연락처', { label: 'head' })
  put('G5:J5', '계산서 발행처(청구처)', { label: 'head' }); put('K5:O5', '감사 서명란', { label: 'head' })
  put('A6:B6', d.manager_name)
  put('C6:F6', [d.tel ? `(유 선) ${d.tel}` : '', d.phone ? `(핸드폰) ${d.phone}` : ''].filter(Boolean).join('    '), { align: 'l' })
  put('G6:J6', d.billing_name)
  put('K6:O6', '')
  ws.getRow(6).height = 30
  boxRange(3, 1, 6, 15)

  // ── 7행 안내문 ──
  ws.getRow(7).height = 16
  put('A7:O7', CONSULT_SHEET_NOTICE, { align: 'l', size: 8 })
  ws.getCell('A7').font = font({ size: 8, color: { argb: 'FF64748B' } })

  // ── 8행 품목 헤더 ──
  const HEAD = ['NO', '품번', '배송종류', '품명', '수량', '판매단가\n(vat포함)', '판매할인', '판매합계',
    '매입단가', '매입배송비', '매입할인', '매입합계', '마진율', '상태', '비고(메모 · 기타)']
  ws.getRow(8).height = 30
  HEAD.forEach((h, i) => {
    const c = ws.getCell(8, i + 1)
    c.value = h; c.font = font({ size: 9 }); c.fill = fill(IHEAD_BG); c.alignment = center
  })

  // ── 품목 행 (품목 수 + 빈 행 2) ──
  const first = 9
  const items = [...d.items].sort((a, b) => a.line_no - b.line_no)
  let no = 0
  items.forEach((it, i) => {
    const r = first + i
    ws.getRow(r).height = 20
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
      it.purchase_price, it.purchase_shipping, pdisc, it.purchase_total,
      margin === null ? '-' : margin, it.status ?? '',
      [it.memo, it.option_note].filter(Boolean).join(' · '),
    ]
    vals.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1)
      c.value = v
      c.font = font({ size: 9, color: sub ? { argb: 'FF475569' } : undefined })
      const col = ci + 1
      c.alignment = col === 4 || col === 15 ? left : [6, 7, 8, 9, 10, 11, 12].includes(col) ? right : center
      if ([6, 8, 9, 10, 12].includes(col) || (typeof v === 'number' && (col === 7 || col === 11))) c.numFmt = NUM
      if (col === 13 && typeof v === 'number') { c.numFmt = PCT; c.alignment = center }
      if (col === 5) c.numFmt = NUM
    })
    if (typeof disc === 'string' || typeof pdisc === 'string') ws.getRow(r).height = 30   // 두 줄 값 행
  })
  const blankFrom = first + items.length
  for (let k = 0; k < 2; k++) {
    const r = blankFrom + k
    ws.getRow(r).height = 20
    ws.getCell(r, 1).value = no + k + 1
    ws.getCell(r, 1).font = font({ size: 9, color: { argb: 'FF94A3B8' } })
    ws.getCell(r, 1).alignment = center
  }
  const last = blankFrom + 1
  const totalRow = last + 1
  boxRange(8, 1, totalRow, 15)

  // ── 총계 행 (수식 + 캐시 값) ──
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
  ws.getRow(totalRow).height = 22
  put(`A${totalRow}:D${totalRow}`, '총 계', { bold: true })
  const sumCell = (col: string, formula: string, result: number, fmt = NUM) => {
    const c = ws.getCell(`${col}${totalRow}`)
    c.value = { formula, result } as F
    c.font = font({ size: 9, bold: true }); c.alignment = right; c.numFmt = fmt
  }
  // 수량은 부자재 행 제외라 값으로, 금액은 열 합계 수식 (할인 칸은 문자열이 섞일 수 있어 값으로)
  ws.getCell(`E${totalRow}`).value = sumQty
  ws.getCell(`E${totalRow}`).font = font({ size: 9, bold: true }); ws.getCell(`E${totalRow}`).alignment = center; ws.getCell(`E${totalRow}`).numFmt = NUM
  ws.getCell(`G${totalRow}`).value = sumDisc; ws.getCell(`G${totalRow}`).numFmt = NUM; ws.getCell(`G${totalRow}`).alignment = right; ws.getCell(`G${totalRow}`).font = font({ size: 9, bold: true })
  sumCell('H', `SUM(H${first}:H${last})`, sumSale)
  sumCell('J', `SUM(J${first}:J${last})`, sumPShip)
  ws.getCell(`K${totalRow}`).value = sumPDisc; ws.getCell(`K${totalRow}`).numFmt = NUM; ws.getCell(`K${totalRow}`).alignment = right; ws.getCell(`K${totalRow}`).font = font({ size: 9, bold: true })
  sumCell('L', `SUM(L${first}:L${last})`, sumPur)
  const pctCell = ws.getCell(`M${totalRow}`)
  pctCell.value = { formula: `IF(H${totalRow}=0,0,(H${totalRow}-L${totalRow})/H${totalRow})`, result: marginPct } as F
  pctCell.font = font({ size: 9, bold: true }); pctCell.alignment = center; pctCell.numFmt = PCT
  put(`N${totalRow}:O${totalRow}`, `마진 ${won(marginAmt)}원`, { align: 'l', bold: true, size: 9 })
  for (let c = 1; c <= 15; c++) ws.getCell(totalRow, c).fill = fill(TOTAL_BG)

  // ── 발송 정보 · 결제 · 발행 정보 · 비고 ──
  const shipText = d.ship
    ? [d.ship.ship_name, d.ship.ship_phone, [d.ship.ship_addr1, d.ship.ship_addr2].filter(Boolean).join(' '),
      d.ship.ship_zip ? `(우편번호 ${d.ship.ship_zip})` : ''].filter(Boolean).join(' · ')
    : ''
  let r = totalRow + 2
  ws.getRow(totalRow + 1).height = 6
  const blockRows = [
    [['A:B', '보내는분 명의', 'sub'], ['C:E', d.sender_name], ['F:G', '배송요청일', 'sub'], ['H', d.delivery_request],
      ['I:J', '인사장/명함', 'sub'], ['K', d.greeting_card], ['L:M', '주소확인여부', 'sub'], ['N:O', d.address_checked]],
    [['A:B', '고객명단수단', 'sub'], ['C:E', d.roster_method], ['F:G', '배송지(지점·샘플)', 'sub'], ['H:O', shipText]],
    [['A:B', '결제정보', 'sub'], ['C:E', d.payment], ['F:G', '계산서 이메일', 'sub'], ['H:J', d.invoice_email],
      ['K:L', '팩스', 'sub'], ['M:O', d.fax]],
    [['A:B', '사업자번호', 'sub'], ['C:E', d.biz_number], ['F:G', '대표자명', 'sub'], ['H:J', d.ceo_name],
      ['K:L', '선결제', 'sub'], ['M:O', d.prepay ? '선결제 품목 있음' : '해당 없음']],
  ] as [string, string | null, ('sub' | undefined)?][][]
  for (const cells of blockRows) {
    ws.getRow(r).height = 24
    for (const [cols, v, lab] of cells) {
      const [c1, c2] = cols.split(':')
      const range = c2 ? `${c1}${r}:${c2}${r}` : `${c1}${r}`
      put(range, v ?? '', lab === 'sub' ? { label: 'sub' } : { align: 'l' })
    }
    boxRange(r, 1, r, 15)
    r += 1
  }
  ws.getRow(r).height = 54
  put(`A${r}:B${r}`, '비고(상담 메모)', { label: 'sub' })
  const memoCell = put(`C${r}:O${r}`, d.memo ?? '', { align: 'l' })
  memoCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true, indent: 1 }
  boxRange(r, 1, r, 15)
  r += 1
  ws.getRow(r).height = 16
  put(`A${r}:O${r}`, `출력 ${d.printed_at}${d.printed_by ? ` · ${d.printed_by}` : ''} · daolERP${d.payment_plain ? ' · 결제정보 평문 포함' : ''}`, { align: 'r', size: 8 })
  ws.getCell(`A${r}`).font = font({ size: 8, color: { argb: 'FF64748B' } })

  ws.pageSetup.printArea = `A1:O${r}`
  ws.pageSetup.printTitlesRow = '8:8'

  // ── 시트2 배송명단 (707) — 명단이 있을 때만. 발주서 배송명단 시트와 같은 양식(열 · 너비 · 색, lib/po-form ROSTER_HEADERS —
  //    발송인 = 다올커머스 · 회사 TEL, 주소 = 주소 + 상세(우편번호 없음), 사용자 확정 2026-11-16) ──
  if (d.roster_rows && d.roster_rows.length) {
    const ws2 = wb.addWorksheet('배송명단', {
      pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    ws2.columns = [
      { width: 4.62 }, { width: 20.62 }, { width: 15.62 }, { width: 14 }, { width: 50.62 },
      { width: 15.62 }, { width: 40.62 }, { width: 10.62 }, { width: 30.62 },
    ]
    const poBox = { top: { style: 'thin' as const }, bottom: { style: 'thin' as const }, left: { style: 'thin' as const }, right: { style: 'thin' as const } }
    const poCenter = { horizontal: 'center' as const, vertical: 'middle' as const }
    ROSTER_HEADERS.forEach((label, i) => {
      const c = ws2.getCell(1, i + 1)
      c.value = label
      c.font = { name: FONT, size: 10, bold: true, color: { argb: `FF${PO_COLORS.label}` } }
      c.fill = fill(`FF${PO_COLORS.labelBg}`)
      c.alignment = poCenter
      c.border = poBox
    })
    d.roster_rows.forEach((row, i) => {
      const vals: (string | number)[] = [row.seq, COMPANY_NAME, COMPANY_TEL, row.recipient_name ?? '', rosterAddr(row),
        row.phone ?? '', row.item_name ?? row.item_name_raw ?? '', row.quantity, row.memo ?? '']
      vals.forEach((v, ci) => {
        const c = ws2.getCell(2 + i, ci + 1)
        c.value = v
        c.font = { name: FONT, size: 10, color: { argb: `FF${PO_COLORS.ink}` } }
        c.alignment = ci === 4 ? { horizontal: 'left', vertical: 'middle' } : poCenter   // 주소만 좌측 (발주서와 동일)
        c.border = poBox
      })
    })
    ws2.pageSetup.printTitlesRow = '1:1'
  }

  return Buffer.from(await wb.xlsx.writeBuffer())
}
