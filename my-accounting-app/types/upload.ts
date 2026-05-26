// 파싱된 거래 한 건
export interface ParsedRow {
  tx_date: string       // YYYY-MM-DD
  description: string
  amount_in: number     // 입금 (원)
  amount_out: number    // 출금 (원)
  balance?: number      // 잔액
  source: 'bank' | 'card' | 'manual'
}

// 파일 파싱 결과
export interface ParseResult {
  rows: ParsedRow[]
  detectedFormat: string  // 감지된 형식명 (예: 국민은행, 카드 내역)
  warnings: string[]      // 파싱 경고 메시지
  rawHeaders: string[]    // 원본 헤더 컬럼명
  fileHash: string        // SHA-256 해시 (중복 방지용)
  fileName: string
  fileSize: number        // bytes
  fileType: 'csv' | 'xlsx' | 'xls'
}

// 업로드 진행 단계
export type UploadStep = 'idle' | 'parsing' | 'preview' | 'uploading' | 'success' | 'error'

// 업로드 API 응답
export interface UploadResult {
  uploadLogId: string
  totalRows: number
  insertedRows: number
  skippedRows: number
  errorRows: number
  isDuplicate?: boolean
}
