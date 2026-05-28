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

// 금액 문자열 → 정수 (콤마, 원, ₩ 제거)
function parseAmount(value: string | number | undefined | null): number {
  if (value === undefined || value === null || value === '') return 0
  const str = String(value).replace(/[,\s원₩]/g, '').trim()
  if (!str || str === '-') return 0
  const num = parseFloat(str)
  return isNaN(num) ? 0 : Math.round(Math.abs(num))
}

// 헤더 정규화 (공백·괄호 제거, 소문자)
function norm(h: string): string {
  return h.trim().replace(/[\s\(\)（）\[\]\/·]/g, '').toLowerCase()
}

// 컬럼 자동 매핑 패턴 (한국 주요 은행/카드사 기준)
const PATTERNS: Record<string, string[]> = {
  date:        ['거래일자', '거래일시', '이용일자', '날짜', '일자', '거래일', '승인일자', '결제일', 'date'],
  description: ['적요', '기재내용', '내용', '가맹점명', '이용가맹점', '거래내용', '메모', '거래처', '상호명', '출금처', '입금처', '거래적요', 'description'],
  amount_in:   ['입금', '입금금액', '맡기신금액', '입금액', '크레딧', '입금(원)'],
  amount_out:  ['출금', '출금금액', '찾으신금액', '이용금액', '승인금액', '출금액', '카드이용금액', '이용액', '데빗', '출금(원)', '카드승인금액', '지급', '지급(원)', '지급액'],
  amount:      ['거래금액', '거래액'],  // 부호로 입/출금 구분 (amount_in/out 없을 때만)
  balance:     ['잔액', '잔고', '현재잔액', '잔액(원)', 'balance'],
}

interface ColMap { date?: number; description?: number; amount_in?: number; amount_out?: number; amount?: number; balance?: number }

function detectColumns(headers: string[]): ColMap {
  const normalized = headers.map(norm)
  const result: ColMap = {}

  for (const [field, patterns] of Object.entries(PATTERNS)) {
    for (const pattern of patterns) {
      const pn = norm(pattern)
      const idx = normalized.findIndex(h => h === pn || h.includes(pn) || pn.includes(h))
      if (idx !== -1 && !(field in result)) {
        ;(result as Record<string, number>)[field] = idx
        break
      }
    }
  }

  return result
}

// 파일 형식 이름 추론
function detectFormat(headers: string[]): string {
  const h = headers.join(' ').toLowerCase()
  if (h.includes('맡기신') || h.includes('찾으신')) return '국민은행(KB)'
  if (h.includes('가맹점명') || h.includes('이용가맹점')) return '카드 내역'
  if (h.includes('적요') && h.includes('잔액')) return '은행 명세서'
  if (h.includes('입금') && h.includes('출금')) return '은행 명세서'
  return '일반 CSV/Excel'
}

// 헤더 행 찾기 (앞에 메타데이터 행이 있을 수 있음)
function findHeaderRow(rows: (string | number)[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const text = rows[i].join(' ')
    if (/거래일|이용일|날짜|일자/i.test(text) || /입금|출금|금액|잔액/i.test(text)) {
      return i
    }
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

    const balance = colMap.balance !== undefined ? parseAmount(row[colMap.balance]) : undefined

    result.push({ tx_date, description, amount_in, amount_out, balance, source })
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
  return { rows: parsedRows, detectedFormat, warnings, rawHeaders: headers }
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

  // [DEBUG] 브라우저 콘솔에서 파싱 상태 확인
  console.log('[PARSER] headerIdx:', headerIdx)
  console.log('[PARSER] headers:', headers)
  console.log('[PARSER] colMap:', colMap)
  console.log('[PARSER] firstDataRow:', JSON.stringify(rows[headerIdx + 1]))

  if (colMap.date === undefined) {
    warnings.push('날짜 컬럼을 자동으로 찾지 못했습니다. 파일 형식을 확인해주세요.')
  }

  const parsedRows = mapRows(rows, headerIdx, colMap, source, warnings)
  console.log('[PARSER] parsedRows[0]:', JSON.stringify(parsedRows[0]))
  return { rows: parsedRows, detectedFormat, warnings, rawHeaders: headers }
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
