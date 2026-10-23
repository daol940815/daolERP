import * as XLSX from 'xlsx'

// ── 원본데이터 파일 종류 자동 판별 (클라이언트) ─────────────────
// 파일 업로드 단일 창구(/upload)에서 탭을 고르지 않아도 파일 헤더로 종류를 가른다.
// 각 import API가 쓰는 필수 컬럼 서명을 그대로 옮겼다 — 서버가 받아들이는 파일만 그쪽으로 보낸다.
//   홈택스 계산서  app/api/tax-invoices/import   REQUIRED_COLS
//   현금영수증     app/api/cash-receipts/import   SALES/PURCHASE_REQUIRED_COLS
//   ERP 주문       app/api/erp-orders/import      REQUIRED_COLS (공백 제거 비교)
//   카드매출       app/api/card-sales/import      TERMINAL/MANUAL_REQUIRED_COLS
//   법인카드       app/api/card-expenses/import   STD/LOTTE/WOORI/INTEG_COLS
//   통장           lib/file-parser.ts             날짜 + 금액 컬럼 (가장 느슨 — 반드시 마지막)
// 서버 쪽 서명을 바꾸면 여기도 같이 바꿀 것.

export type UploadKind = 'bank' | 'card_sales' | 'card_expenses' | 'tax_invoices' | 'cash_receipts' | 'erp_orders'

const SIGNATURES: { kind: UploadKind; anyOf: string[][]; normalize?: boolean }[] = [
  { kind: 'tax_invoices',  anyOf: [['작성일자', '승인번호', '공급자사업자등록번호', '공급받는자사업자등록번호', '합계금액']] },
  { kind: 'cash_receipts', anyOf: [['매출일시', '승인번호', '총금액', '거래구분'], ['매입일시', '승인번호', '매입금액', '거래구분']] },
  { kind: 'erp_orders',    anyOf: [['주문번호', '주문일', '품명', '매입처이름', '합계금액', '총금액']], normalize: true },
  { kind: 'card_sales',    anyOf: [['거래일자', '거래유형', '카드번호', '승인번호', '금액'], ['결제일', '승인번호', '카드번호', '결제금액', '결제상태']] },
  { kind: 'card_expenses', anyOf: [['카드번호', '이용일', '승인금액', '가맹점명'], ['카드번호', '승인일자', '승인금액(원화)', '가맹점명'], ['이용일자', '승인번호', '이용카드', '이용가맹점명'], ['승인일시', '카드사', '카드번호', '가맹점', '승인금액', '상태']] },
]

// 통장 명세서 — lib/file-parser.ts findHeaderRow와 같은 기준
const BANK_DATE  = new Set(['거래일자', '거래일시', '이용일자', '날짜', '일자', '거래일', '승인일자', '결제일', 'date'])
const BANK_MONEY = new Set(['맡기신금액', '찾으신금액', '입금금액', '출금금액', '입금액', '출금액', '입금액원', '출금액원',
                            '입금원', '출금원', '거래금액', '잔액', '잔액원', '현재잔액', '잔고', '입금', '출금'])
const bankNorm = (h: string) => h.trim().replace(/[\s\(\)（）\[\]\/·]/g, '').toLowerCase()

const cell = (v: unknown) => String(v ?? '').trim()
const tight = (v: unknown) => cell(v).replace(/\s+/g, '')

function rowHas(row: unknown[], cols: string[], normalize: boolean): boolean {
  const cells = row.map(normalize ? tight : cell)
  return cols.every(c => cells.includes(normalize ? c.replace(/\s+/g, '') : c))
}

export const UPLOAD_KIND_LABEL: Record<UploadKind, string> = {
  bank: '은행 명세서', card_sales: '카드매출', card_expenses: '법인카드',
  tax_invoices: '홈택스 계산서', cash_receipts: '현금영수증', erp_orders: 'ERP 주문',
}

// 파일 앞부분(각 시트 30행)만 읽어 종류를 판별한다. 못 가르면 null.
export async function detectUploadKind(file: File): Promise<UploadKind | null> {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!['xls', 'xlsx', 'csv'].includes(ext)) return null

  let sheets: unknown[][][]
  try {
    const buf = await file.arrayBuffer()
    if (ext === 'csv') {
      // CSV는 통장 명세서 외에는 쓰지 않는다 — 통장 서명만 본다
      let text = new TextDecoder('euc-kr').decode(buf)
      if (text.includes('�')) text = new TextDecoder('utf-8').decode(buf)
      sheets = [text.split(/\r?\n/).slice(0, 30).map(l => l.split(','))]
    } else {
      const wb = XLSX.read(buf, { type: 'array', sheetRows: 30 })
      sheets = wb.SheetNames.map(n =>
        XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n], { header: 1, raw: false, defval: '' }))
    }
  } catch {
    return null
  }

  // 구체적인 서명부터 — 통장은 "날짜+금액"만 보므로 다른 종류를 삼킬 수 있어 마지막에
  for (const sig of SIGNATURES) {
    for (const rows of sheets) {
      if (rows.some(row => sig.anyOf.some(cols => rowHas(row, cols, !!sig.normalize)))) return sig.kind
    }
  }
  for (const rows of sheets) {
    for (const row of rows) {
      const n = row.map(c => bankNorm(cell(c)))
      if (n.some(c => c && BANK_DATE.has(c)) && n.some(c => c && BANK_MONEY.has(c))) return 'bank'
    }
  }
  return null
}
