// 거래명세서 엑셀 생성 (2026-08-25 실무자 양식 수령·사용자 확정) —
// 견적서 양식을 개조한 1시트 명세서. 원본 서식(셀 크기·색·수식·로고·도장)을
// 그대로 재현하되, 확정 변경만 반영한다:
//  - 시트명 '거래명세서', "아래와 같이 견적 합니다." 문구 삭제
//  - "견적금액" → "총 금액" (일금 한글 금액은 NUMBERSTRING 수식 유지)
//  - 품목 단가 = 할인 반영가, 배송비는 '택배비' 품목 행으로 분리 (발주서와 동일 방식)
//  - 품목 6행 초과 시 행 확장 (수식·서식 동일)
//  - 거래처 정보는 주문에 입력된 값만 기재, 없으면 빈 칸
// 파일명 규칙(사용자 확정): 받은년월일_다올커머스 거래명세서_업체명_지점명
import { COMPANY_TEL, COMPANY_FAX } from './po-form'
import { DAOL_LOGO_PNG_B64, DAOL_STAMP_PNG_B64 } from './statement-assets'

// 자사 고정 정보 (양식 원본 값)
export const STMT_BIZ_NO = '701-88-00023'
export const STMT_COMPANY = '㈜다올커머스'
export const STMT_CEO = '이정철'
export const STMT_ADDRESS = '경기도 고양시 일산서구 덕이동 1234-1'
export const STMT_UPTAE = '서비스'
export const STMT_JONGMOK = '구매대행'

export interface StatementItem {
  item_name: string
  quantity: number
  unit_price: number   // 할인 반영 단가 (금액÷수량 — 나누어떨어지지 않으면 소수 유지, 표시는 반올림)
  amount: number       // 판매금액 (배송비 제외, 할인 반영) — 단가×수량과 일치
  memo: string | null
}

export interface StatementData {
  order_date: string | null   // 일자 = 주문일 (파일명 '받은년월일'과 동일 기준)
  bank_name: string | null
  branch_name: string | null
  manager_name: string | null
  phone: string | null
  total_amount: number        // VAT 포함 총액 (품목+택배비 합)
  items: StatementItem[]
}

export function statementFileName(data: StatementData): string {
  const d = (data.order_date ?? '').replace(/-/g, '').slice(2)   // YYMMDD
  const parts = [d, '다올커머스 거래명세서', data.bank_name ?? '', data.branch_name ?? '']
    .filter(Boolean)
  return `${parts.join('_')}.xlsx`
}

// NUMBERSTRING(n,1) 대응 한글 금액 읽기 — 엑셀이 열리면 수식으로 재계산되므로
// 캐시 값(엑셀 외 뷰어 표시용)만 맞추면 된다.
export function koreanAmount(n: number): string {
  const num = Math.max(0, Math.floor(n))
  if (num === 0) return '영'
  const D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
  const small = ['', '십', '백', '천']
  const big = ['', '만', '억', '조', '경']
  const read4 = (v: number) => {
    let s = ''
    for (let p = 3; p >= 0; p--) {
      const d = Math.floor(v / 10 ** p) % 10
      if (!d) continue
      s += (d === 1 && p > 0 ? '' : D[d]) + small[p]   // 일십→십 관례 (NUMBERSTRING 동일)
    }
    return s
  }
  let out = ''
  for (let g = 4; g >= 0; g--) {
    const v = Math.floor(num / 10 ** (g * 4)) % 10000
    if (v) out += read4(v) + big[g]
  }
  return out
}

const FONT = '맑은 고딕'
const GRAY = 'FFD9D9D9'      // 라벨·합계 행 배경 (흰색 -15% 음영)
const RED = 'FFFF0000'
const ACCT_FMT = '_-* #,##0_-;\\-* #,##0_-;_-* "-"_-;_-@_-'
const WON_FMT = '_-"₩"* #,##0_-;\\-"₩"* #,##0_-;_-"₩"* "-"_-;_-@_-'

export async function buildStatementExcel(data: StatementData): Promise<Buffer> {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('거래명세서', {
    views: [{ showGridLines: false }],   // 눈금선 숨김 — 그린 테두리만 보이게 (사용자 요청)
    properties: { defaultRowHeight: 20.1 },
    pageSetup: {
      paperSize: 9, orientation: 'portrait', scale: 64,
      margins: {
        left: 0.23622047244094491, right: 0.23622047244094491,
        top: 0.74803149606299213, bottom: 0.74803149606299213,
        header: 0.31496062992125984, footer: 0.31496062992125984,
      },
      horizontalCentered: true,
    },
  })
  const widths = [2.62, 8.62, 6.62, 4.62, 33.75, 8.62, 3.62, 9.62, 12.62, 3.62, 10.62, 6.62, 7.62, 8.62, 20.62, 2.62, 9.0]
  ws.columns = widths.map(w => ({ width: w }))

  const thin = { style: 'thin' as const }
  const box = { top: thin, bottom: thin, left: thin, right: thin }
  const center = { horizontal: 'center' as const, vertical: 'middle' as const }
  const font = (over: Record<string, unknown> = {}) => ({ name: FONT, size: 11, ...over })
  const grayFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: GRAY } }
  const boxRange = (r1: number, c1: number, r2: number, c2: number) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).border = box
  }

  // ── 품목 행 구성: 할인 반영 단가 + 택배비 분리 행, 최소 6행 ──
  const rows: (StatementItem | null)[] = [...data.items]
  while (rows.length < 6) rows.push(null)
  const itemFirst = 15
  const itemLast = itemFirst + rows.length - 1
  const sumRow = itemLast + 1
  const spacerRow = sumRow + 1
  const noteRow = spacerRow + 1

  // ── 제목 (2행, 상하 이중 테두리) ──
  ws.getCell('A2').value = ' '   // 원본과 동일 (여백 열 공백 문자)
  ws.getRow(1).height = 9.95
  ws.getRow(2).height = 80.1
  ws.mergeCells('B2:O2')
  const title = ws.getCell('B2')
  title.value = '거 래 명 세 서'
  title.font = font({ size: 30, bold: true })
  title.alignment = center
  for (let c = 2; c <= 15; c++) {
    ws.getCell(2, c).border = { top: { style: 'double' }, bottom: { style: 'double' } }
  }
  ws.getRow(3).height = 20.1

  // ── 정보 표 (4~8행): 좌측 거래처 / 우측 자사 고정 정보 ──
  // 엑셀 날짜 직렬값은 UTC 성분 기준 — KST 자정으로 만들면 하루 어긋난다 (Z 고정)
  const asDate = (s: string | null) => {
    if (!s) return ''
    const d = new Date(`${s}T00:00:00Z`)
    return Number.isNaN(d.getTime()) ? s : d
  }
  const customer = [data.bank_name, data.branch_name].filter(Boolean).join(' ')
  // [행, 병합·값 목록] — label은 회색 배경·양쪽 맞춤, 값은 가운데(대표자 등 O열 단칸은 좌측)
  type Cell = { range: string; v: string | number | Date; label?: boolean; date?: boolean }
  const info: Cell[][] = [
    [
      { range: 'B4:C4', v: '일자', label: true }, { range: 'D4:G4', v: asDate(data.order_date), date: true },
      { range: 'I4:J4', v: '사업자번호', label: true }, { range: 'K4:O4', v: STMT_BIZ_NO },
    ],
    [
      { range: 'B5:C5', v: '제목', label: true }, { range: 'D5:G5', v: '거래명세서' },
      { range: 'I5:J5', v: '상호', label: true }, { range: 'K5:L5', v: STMT_COMPANY },
      { range: 'M5:N5', v: '대표자', label: true }, { range: 'O5', v: STMT_CEO },
    ],
    [
      { range: 'B6:C6', v: '거래처', label: true }, { range: 'D6:G6', v: customer },
      { range: 'I6:J6', v: '소재지', label: true }, { range: 'K6:O6', v: STMT_ADDRESS },
    ],
    [
      { range: 'B7:C7', v: '담당자', label: true }, { range: 'D7:G7', v: data.manager_name ?? '' },
      { range: 'I7:J7', v: '업태', label: true }, { range: 'K7:L7', v: STMT_UPTAE },
      { range: 'M7:N7', v: '종목', label: true }, { range: 'O7', v: STMT_JONGMOK },
    ],
    [
      { range: 'B8:C8', v: '연락처', label: true }, { range: 'D8:G8', v: data.phone ?? '' },
      { range: 'I8:J8', v: '전화번호', label: true }, { range: 'K8:L8', v: COMPANY_TEL },
      { range: 'M8:N8', v: '팩스', label: true }, { range: 'O8', v: COMPANY_FAX },
    ],
  ]
  for (let r = 4; r <= 8; r++) ws.getRow(r).height = 27.95
  info.flat().forEach(cellDef => {
    if (cellDef.range.includes(':')) ws.mergeCells(cellDef.range)
    const cell = ws.getCell(cellDef.range.split(':')[0])
    cell.value = cellDef.v
    cell.font = font()
    if (cellDef.label) {
      cell.fill = grayFill
      // 들여쓰기 1 — 양쪽 맞춤이 테두리에 붙지 않게 여백을 주고 글자 간격도 좁힌다 (사용자 요청)
      cell.alignment = { horizontal: 'distributed', vertical: 'distributed', indent: 1 }
    } else {
      cell.alignment = center   // 값 셀은 전부 가운데 (대표자 포함 — 사용자 확정)
    }
    if (cellDef.date && cell.value instanceof Date) cell.numFmt = 'mm-dd-yy'
  })
  boxRange(4, 2, 8, 15)

  // ── 총 금액 행 (12행) — 한글 금액 수식 + ₩ 금액(합계 연동) + (VAT포함) ──
  ws.getRow(9).height = 9.95
  ws.getRow(10).height = 27.95   // "아래와 같이 견적 합니다." 문구 삭제 — 여백 행만 유지
  ws.getRow(11).height = 9.95
  ws.getRow(12).height = 35.1
  ws.mergeCells('L12:N12')
  const won = ws.getCell('L12')
  won.value = { formula: `L${sumRow}`, result: data.total_amount } as import('exceljs').CellFormulaValue
  won.font = font({ size: 13 })
  won.alignment = center
  won.numFmt = WON_FMT
  const amtText = ws.getCell('B12')
  amtText.value = {
    formula: `"총 금액 : 일금"&NUMBERSTRING(L12,1)&"원정"`,
    result: `총 금액 : 일금${koreanAmount(data.total_amount)}원정`,
  } as import('exceljs').CellFormulaValue
  amtText.font = font({ size: 13 })
  amtText.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 }   // 들여쓰기 (사용자 요청)
  const vat = ws.getCell('O12')
  vat.value = '(VAT포함)'
  vat.font = font({ size: 13, color: { argb: RED } })
  vat.alignment = center
  // 12행은 윤곽선만 — 중간 세로선 없이 상하 + 양 끝만 (사용자 요청)
  for (let c = 2; c <= 15; c++) {
    ws.getCell(12, c).border = {
      top: thin, bottom: thin,
      ...(c === 2 ? { left: thin } : {}), ...(c === 15 ? { right: thin } : {}),
    }
  }

  // ── 품목 표 (14행 헤더 + 품목 + 합계) ──
  const headers: [string, string][] = [
    ['B14', 'NO'], ['C14:E14', '품명'], ['F14', '수량'], ['G14:H14', '단가'],
    ['I14', '공급가액'], ['J14:K14', '부가세'], ['L14:M14', '합계'], ['N14:O14', '비고'],
  ]
  ws.getRow(14).height = 27.95
  headers.forEach(([range, label]) => {
    if (range.includes(':')) ws.mergeCells(range)
    const cell = ws.getCell(range.split(':')[0])
    cell.value = label
    cell.font = font()
    cell.fill = grayFill
    cell.alignment = center
  })

  type F = import('exceljs').CellFormulaValue
  rows.forEach((it, i) => {
    const r = itemFirst + i
    ws.getRow(r).height = 27.95
    ws.mergeCells(`C${r}:E${r}`)
    ws.mergeCells(`G${r}:H${r}`)
    ws.mergeCells(`J${r}:K${r}`)
    ws.mergeCells(`L${r}:M${r}`)
    ws.mergeCells(`N${r}:O${r}`)
    // NO 자동 채번 — 원본 수식 그대로 (품명이 있어야 번호가 붙는다)
    ws.getCell(`B${r}`).value = {
      formula: `IF(C${r}<>"",_xlfn.AGGREGATE(3,5,$C$${itemFirst}:INDIRECT("R"&ROW()&"C"&COLUMN($C$${itemFirst}),FALSE)),"")`,
      result: it ? i + 1 : '',
    } as F
    ws.getCell(`C${r}`).value = it?.item_name ?? ''
    ws.getCell(`F${r}`).value = it ? it.quantity : ''
    ws.getCell(`G${r}`).value = it ? it.unit_price : ''
    ws.getCell(`I${r}`).value = {
      formula: `IF(L${r}<>"",L${r}/1.1,"")`, result: it ? it.amount / 1.1 : '',
    } as F
    ws.getCell(`J${r}`).value = {
      formula: `IF(L${r}<>"",L${r}-I${r},"")`, result: it ? it.amount - it.amount / 1.1 : '',
    } as F
    ws.getCell(`L${r}`).value = {
      formula: `IF(G${r}<>"",G${r}*F${r},"")`, result: it ? it.amount : '',
    } as F
    ws.getCell(`N${r}`).value = it?.memo ?? ''
    ;['B', 'C', 'F', 'G', 'I', 'J', 'L', 'N'].forEach(c => {
      const cell = ws.getCell(`${c}${r}`)
      cell.font = font()
      cell.alignment = center
      if ('FGIJL'.includes(c)) cell.numFmt = ACCT_FMT
    })
  })

  // 합계 행 — 각 열 SUM, 총합계는 붉은 글씨. 전체 회색 배경
  ws.getRow(sumRow).height = 27.95
  ws.mergeCells(`B${sumRow}:E${sumRow}`)
  ws.mergeCells(`G${sumRow}:H${sumRow}`)
  ws.mergeCells(`J${sumRow}:K${sumRow}`)
  ws.mergeCells(`L${sumRow}:M${sumRow}`)
  ws.mergeCells(`N${sumRow}:O${sumRow}`)
  const totalLabel = ws.getCell(`B${sumRow}`)
  totalLabel.value = '합계'
  const unitSum = data.items.reduce((s, it) => s + it.unit_price, 0)
  const supplySum = data.items.reduce((s, it) => s + it.amount / 1.1, 0)
  const sums: [string, string, number | string][] = [
    [`G${sumRow}`, `SUM(G${itemFirst}:H${itemLast})`, unitSum],
    [`I${sumRow}`, `SUM(I${itemFirst}:I${itemLast})`, supplySum],
    [`J${sumRow}`, `SUM(J${itemFirst}:K${itemLast})`, data.total_amount - supplySum],
    [`L${sumRow}`, `SUM(L${itemFirst}:M${itemLast})`, data.total_amount],
  ]
  sums.forEach(([addr, formula, result]) => {
    ws.getCell(addr).value = { formula, result } as F
  })
  ;['B', 'F', 'G', 'I', 'J', 'L', 'N'].forEach(c => {
    const cell = ws.getCell(`${c}${sumRow}`)
    cell.font = font(c === 'L' ? { color: { argb: RED } } : {})
    cell.fill = grayFill
    cell.alignment = center
    if ('FGIJL'.includes(c)) cell.numFmt = ACCT_FMT
  })
  boxRange(14, 2, sumRow, 15)

  // 하단 여백 + 특이사항 자유기입 칸 (비워둔다 — 사용자 확정)
  ws.getRow(spacerRow).height = 15
  ws.mergeCells(`B${spacerRow}:O${spacerRow}`)
  ws.getRow(noteRow).height = 134.25
  ws.mergeCells(`B${noteRow}:O${noteRow}`)
  const note = ws.getCell(`B${noteRow}`)
  note.font = font()
  note.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true }
  boxRange(noteRow, 2, noteRow, 15)

  // ── 로고·도장 이미지 — 원본과 같은 위치·크기 (EMU 오프셋을 셀 분수로 환산) ──
  const logoId = wb.addImage({ base64: DAOL_LOGO_PNG_B64, extension: 'png' })
  const stampId = wb.addImage({ base64: DAOL_STAMP_PNG_B64, extension: 'png' })
  // 원본 drawing XML의 EMU 오프셋을 그대로 사용 (nativeCol/Off — exceljs 내부 표현)
  ws.addImage(logoId, {
    tl: { nativeCol: 13, nativeColOff: 299223, nativeRow: 1, nativeRowOff: 235323 },
    ext: { width: 127.93, height: 66.65 },
    editAs: 'oneCell',
  } as unknown as Parameters<typeof ws.addImage>[1])
  ws.addImage(stampId, {
    tl: { nativeCol: 14, nativeColOff: 737907, nativeRow: 2, nativeRowOff: 235323 },
    ext: { width: 73.92, height: 76.94 },
    editAs: 'oneCell',
  } as unknown as Parameters<typeof ws.addImage>[1])

  // 인쇄 영역 (B열~O열, 명세 전체)
  ws.pageSetup.printArea = `B1:O${noteRow}`

  return Buffer.from(await wb.xlsx.writeBuffer())
}
