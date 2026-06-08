import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import type { ParsedRow, ParseResult } from '@/types/upload'

// SHA-256 해시 계산 (Web Crypto API - 브라우저 + Node.js 모두 지원)
export async function calculateHash(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

// 다양한 한국 날짜 형식 → YYYY-MM-DD
function parseDate(value: string | number | undefined | null): string | null {
  if (value === undefined || value === null || value === '') return null
  const s = String(value).trim()

  // 숫자형 날짜 (Excel serial)
  const num = Number(s.replace(/[,\s]/g, ''))
  if (!isNaN(num) && num > 30000 && num < 60000) {
    const date = new Date(Date.UTC(1899, 11, 30) + num * 86400000)
    return date.toISOString().slice(0, 10)
  }

  // YYYYMMDD (8자리)
  if (/^\d{8}$/.test(s)) {
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  }

  // YYYY.MM.DD / YYYY-MM-DD / YYYY/MM/DD
  const m = s.match(/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})/)
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`

  // YYYY년 MM월 DD일
  const m2 = s.match(/(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일/)
  if (m2) return `${m2[1]}-${m2[2].padStart(2, '0')}-${m2[3].padStart(2, '0')}`

  return null
}

// 금액 문자열 → 정수 (콤마, 원, ₩ 제거, 항상 양수)
function parseAmount(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const str = String(value).replace(/[,\s원₩]/g, '').trim()
  if (!str || str === '-') return 0
  const num = parseFloat(str)
  return isNaN(num) ? 0 : Math.round(Math.abs(num))
}

// 잔액 문자열 → 정수 (음수 허용 — 마이너스 통장 대응)
// 한국 은행 명세서의 다양한 음수 표기 처리:
//   -1,000,000  (앞 마이너스)
//   1,000,000-  (뒤 마이너스 — 일부 은행/엑셀)
//   (1,000,000) (괄호 — 회계식 음수)
//   △1,000,000  (세모 — 일부 명세서)
function parseBalance(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null || value === '') return undefined

  // 숫자 타입은 그대로 (엑셀 셀이 음수 number로 올 수 있음)
  if (typeof value === 'number') {
    return isNaN(value) ? undefined : Math.round(value)
  }

  let str = String(value).replace(/[,\s원₩]/g, '').trim()
  if (!str || str === '-') return undefined

  // 음수 여부 판별 후 부호 문자 제거
  let negative = false
  if (/^\(.*\)$/.test(str)) {          // (1000000)
    negative = true
    str = str.slice(1, -1)
  } else if (str.endsWith('-')) {       // 1000000-
    negative = true
    str = str.slice(0, -1)
  } else if (str.startsWith('-')) {     // -1000000
    negative = true
    str = str.slice(1)
  } else if (str.startsWith('△') || str.startsWith('▲')) {  // △1000000
    negative = true
    str = str.slice(1)
  }

  const num = parseFloat(str)
  if (isNaN(num)) return undefined
  return Math.round(negative ? -Math.abs(num) : num)
}

// 헤더 정규화 (공백·괄호 제거, 소문자)
function norm(h: string): string {
  return h.trim().replace(/[\s\(\)（）\[\]\/·]/g, '').toLowerCase()
}

// 컬럼 자동 매핑 패턴 (한국 주요 은행/카드사 기준)
const PATTERNS: Record<string, string[]> = {
  date:        ['거래일자', '거래일시', '이용일자', '날짜', '일자', '거래일', '승인일자', '결제일', 'date'],
  description: ['적요', '기재내용', '내용', '가맹점명', '이용가맹점', '거래내용', '메모', '거래처', '상호명', '출금처', '입금처', '거래적요', '보낸분', '받는분', '보낸분/받는분', 'description'],
  counterparty_name: ['보낸분', '받는분', '보낸분/받는분', '입금자명', '출금자명', '예금주명', '예금주', '송금인', '의뢰인'],
  amount_in:   ['맡기신금액', '입금금액', '입금액', '입금(원)', '입금'],
  amount_out:  ['찾으신금액', '출금금액', '이용금액', '승인금액', '출금액', '출금(원)', '카드이용금액', '이용액', '카드승인금액', '지급금액', '지급(원)', '지급액', '출금'],
  amount:      ['거래금액', '거래액'],  // 부호로 입/출금 구분 (amount_in/out 없을 때만)
  balance:     ['잔액(원)', '현재잔액', '잔액', '잔고', 'balance'],
}

interface ColMap { date?: number; description?: number; counterparty_name?: number; amount_in?: number; amount_out?: number; amount?: number; balance?: number }

function detectColumns(headers: string[]): ColMap {
  const normalized = headers.map(norm)
  const result: ColMap = {}
  const usedIdx = new Set<number>()

  for (const [field, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      const pn = norm(pattern)
      // pn.includes(h) 는 빈 문자열 헤더가 모든 패턴에 매칭되는 버그 유발 → 제거
      // 이미 다른 필드가 차지한 컬럼은 건너뛴다 (예: 적요와 보낸분이 모두 있는 명세서에서
      // description과 counterparty_name이 같은 컬럼을 가리키지 않도록)
      const idx = normalized.findIndex((h, i) => h.length > 0 && !usedIdx.has(i) && (h === pn || h.includes(pn)))
      if (idx !== -1 && !(field in result)) {
        ;(result as Record<string, number>)[field] = idx
        usedIdx.add(idx)
        break
      }
    }
  }

  return result
}

// 파일 형식에서 은행명 추론
function detectFormat(headers: string[]): string {
  const h = headers.join(' ')
  if (h.includes('맡기신') || h.includes('찾으신')) return '국민은행'
  if (h.includes('기재내용')) return '우리은행'
  if (h.includes('거래적요') && h.includes('잔액')) return '하나은행'
  if (h.includes('가맹점명') || h.includes('이용가맹점')) return '카드 내역'
  if (h.includes('적요') && h.includes('잔액')) return '은행 명세서'
  if (h.includes('입금') && h.includes('출금')) return '은행 명세서'
  return '일반 CSV/Excel'
}

// 헤더 이전 메타데이터 행에서 계좌번호 자동 감지
// 한국 계좌번호 패턴: 숫자-숫자-숫자 (총 10자리 이상)
function detectAccountNumber(rows: (string | number)[][], headerIdx: number): string | null {
  const pattern = /\d{3,6}-\d{2,6}-\d{4,8}(?:-\d+)?/
  for (let i = 0; i < headerIdx; i++) {
    const text = rows[i].map(String).join(' ')
    const match = text.match(pattern)
    if (match) return match[0]
  }
  return null
}

// 헤더 행 찾기 (앞에 메타데이터 행이 있을 수 있음)
// "총잔액", "입출금내역" 같은 메타데이터 행을 헤더로 오인하지 않도록
// norm() 처리 후 각 셀이 날짜·금액 키워드와 정확히 일치하는지 확인
function findHeaderRow(rows: (string | number)[][]): number {
  // norm() 적용 후 정확히 일치해야 하는 날짜 키워드
  const DATE_NORM   = new Set(['거래일자', '거래일시', '이용일자', '날짜', '일자', '거래일', '승인일자', '결제일', 'date'])
  // norm() 적용 후 정확히 일치해야 하는 금액·잔액 키워드
  const MONEY_NORM  = new Set([
    '맡기신금액', '찾으신금액', '입금금액', '출금금액',
    '입금액', '출금액', '입금액원', '출금액원',  // 입금액(원), 출금액(원) → norm
    '입금원', '출금원',                          // 입금(원), 출금(원) → norm
    '거래금액', '잔액', '잔액원', '현재잔액', '잔고',
    '입금', '출금',
  ])

  // 1차: 날짜 셀 + 금액·잔액 셀이 독립적으로 존재하는 행 (가장 신뢰도 높음)
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const normCells = rows[i].map(c => norm(String(c)))
    const hasDate  = normCells.some(c => c.length > 0 && DATE_NORM.has(c))
    const hasMoney = normCells.some(c => c.length > 0 && MONEY_NORM.has(c))
    if (hasDate && hasMoney) return i
  }

  // 2차 폴백: 복합 키워드가 행 전체 텍스트에 포함된 경우
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const text = rows[i].map(String).join(' ')
    if (/맡기신금액|찾으신금액|입금금액|출금금액|입금액|출금액/i.test(text)) return i
  }

  return 0
}

// 2D 배열 → ParsedRow[]
function mapRows(
  rows: (string | number)[][],
  headerIdx: number,
  colMap: ColMap,
  source: 'bank' | 'card' | 'manual',
  warnings: string[],
): ParsedRow[] {
  const result: ParsedRow[] = []

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i]
    if (!row || row.every(c => c === '' || c === null || c === undefined)) continue

    const rawDate = colMap.date !== undefined ? row[colMap.date] : ''
    const tx_date = parseDate(rawDate as string)

    if (!tx_date) {
      warnings.push(`${i + 1}행: 날짜 파싱 실패 ("${rawDate}") — 건너뜀`)
      continue
    }

    const description = colMap.description !== undefined
      ? String(row[colMap.description] ?? '').trim() || '(내용 없음)'
      : '(내용 없음)'

    const counterparty_name = colMap.counterparty_name !== undefined
      ? String(row[colMap.counterparty_name] ?? '').trim() || null
      : null

    let amount_in = 0
    let amount_out = 0

    // amount_in/out 컬럼이 있으면 우선 사용, 없을 때만 단일 amount 컬럼으로 폴백
    if (colMap.amount_in !== undefined || colMap.amount_out !== undefined) {
      amount_in  = colMap.amount_in  !== undefined ? parseAmount(row[colMap.amount_in])  : 0
      amount_out = colMap.amount_out !== undefined ? parseAmount(row[colMap.amount_out]) : 0
    } else if (colMap.amount !== undefined) {
      // 단일 금액 컬럼 — 부호로 입/출금 구분
      const raw = String(row[colMap.amount] ?? '').replace(/[,\s원₩]/g, '')
      const num = parseFloat(raw)
      if (!isNaN(num)) {
        if (num >= 0) amount_in = Math.round(num)
        else amount_out = Math.round(Math.abs(num))
      }
    }

    const balance = colMap.balance !== undefined ? parseBalance(row[colMap.balance]) : undefined

    result.push({ tx_date, description, counterparty_name, amount_in, amount_out, balance, source })
  }

  return result
}

// CSV 파싱 (EUC-KR / UTF-8 자동 감지)
async function parseCSV(
  buffer: ArrayBuffer,
  source: 'bank' | 'card' | 'manual',
): Promise<Omit<ParseResult, 'fileHash' | 'fileName' | 'fileSize' | 'fileType'>> {
  // EUC-KR 시도 후 깨지면 UTF-8 재시도
  let text = new TextDecoder('euc-kr').decode(buffer)
  if (text.includes('�') || text.includes('â€')) {
    text = new TextDecoder('utf-8').decode(buffer)
  }

  const parsed = Papa.parse<(string | number)[]>(text, { skipEmptyLines: true })
  const rows = parsed.data
  const warnings: string[] = []

  const headerIdx = findHeaderRow(rows)
  const headers = (rows[headerIdx] ?? []).map(String)
  const colMap = detectColumns(headers)
  const detectedFormat = detectFormat(headers)

  if (colMap.date === undefined) {
    warnings.push('날짜 컬럼을 자동으로 찾지 못했습니다. 파일 형식을 확인해주세요.')
  }

  const parsedRows = mapRows(rows, headerIdx, colMap, source, warnings)
  const suggestedAccountNumber = detectAccountNumber(rows, headerIdx)
  return { rows: parsedRows, detectedFormat, warnings, rawHeaders: headers, suggestedAccountNumber }
}

// Excel 파싱 (XLSX, XLS)
async function parseExcel(
  buffer: ArrayBuffer,
  source: 'bank' | 'card' | 'manual',
): Promise<Omit<ParseResult, 'fileHash' | 'fileName' | 'fileSize' | 'fileType'>> {
  // raw: true 로 읽어야 숫자 셀 값이 브라우저에서도 정확히 반환됨
  // raw: false 를 XLSX.read에 쓰면 브라우저에서 숫자 셀이 빈 값으로 올 수 있음
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: false })
  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
    header: 1,
    raw: true,   // 숫자는 number, 문자는 string 으로 그대로 반환
    defval: '',
  })

  const warnings: string[] = []
  const headerIdx = findHeaderRow(rows)
  const headers = (rows[headerIdx] ?? []).map(String)
  const colMap = detectColumns(headers)
  const detectedFormat = detectFormat(headers)

  if (colMap.date === undefined) {
    warnings.push('날짜 컬럼을 자동으로 찾지 못했습니다. 파일 형식을 확인해주세요.')
  }

  const parsedRows = mapRows(rows, headerIdx, colMap, source, warnings)
  const suggestedAccountNumber = detectAccountNumber(rows, headerIdx)
  return { rows: parsedRows, detectedFormat, warnings, rawHeaders: headers, suggestedAccountNumber }
}

// 메인 파싱 함수 (확장자로 파서 분기)
export async function parseFile(
  file: File,
  source: 'bank' | 'card' | 'manual' = 'bank',
): Promise<ParseResult> {
  const buffer = await file.arrayBuffer()
  const fileHash = await calculateHash(buffer)
  const fileName = file.name
  const fileSize = file.size
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  let fileType: 'csv' | 'xlsx' | 'xls'
  let parsed: Omit<ParseResult, 'fileHash' | 'fileName' | 'fileSize' | 'fileType'>

  if (ext === 'csv') {
    fileType = 'csv'
    parsed = await parseCSV(buffer, source)
  } else if (ext === 'xlsx') {
    fileType = 'xlsx'
    parsed = await parseExcel(buffer, source)
  } else if (ext === 'xls') {
    fileType = 'xls'
    parsed = await parseExcel(buffer, source)
  } else {
    throw new Error(`지원하지 않는 파일 형식: .${ext} (CSV, XLSX, XLS만 가능)`)
  }

  return { ...parsed, fileHash, fileName, fileSize, fileType }
}
