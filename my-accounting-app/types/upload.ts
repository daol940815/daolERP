// 파싱된 거래 한 건
export interface ParsedRow {
  tx_date: string       // YYYY-MM-DD
  tx_time?: string | null  // HH:MM:SS (있는 경우만 — 정렬용)
  description: string
  counterparty_name?: string | null  // 보낸분/받는분 (적요와 별도 컬럼이 있는 경우)
  amount_in: number     // 입금 (원)
  amount_out: number    // 출금 (원)
  balance?: number      // 잔액
  source: 'bank' | 'card' | 'manual'
  // 통합계좌(멀티뱅킹) 파일: 행마다 계좌가 다르므로 행에 계좌를 싣는다.
  // 단일 계좌 파일에서는 undefined — 업로드 화면에서 지정한 계좌가 쓰인다.
  bank_name?: string | null
  account_number?: string | null
}

// 통합계좌 파일에 들어 있는 계좌 1개 요약 (업로드 전 확인용)
export interface ParsedAccount {
  bank_name: string
  account_number: string
  digits: string          // 계좌번호 숫자만 — 표기 차이 흡수용 매칭 키
  rows: number
  amount_in: number
  amount_out: number
  first_date: string
  last_date: string
  last_balance: number | null
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
  suggestedAccountNumber: string | null  // 파일 메타데이터에서 감지된 계좌번호
  // 통합계좌 파일(금융기관·계좌번호 컬럼 보유)이면 계좌별 요약이 들어온다
  accounts: ParsedAccount[]
}

// 통합계좌 업로드 전 계좌 확인 결과 (POST /api/upload/accounts)
export interface AccountPreview {
  digits: string
  bank_account_id: string | null
  db_bank_name: string | null
  db_account_number: string | null
  db_account_type: string | null
  last_tx_date: string | null   // 이 계좌에 이미 들어온 마지막 거래일
  tx_count: number
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
  // 통합계좌 업로드: 계좌별 결과
  accountResults?: {
    bank_name: string
    account_number: string
    inserted: number
    skipped: number
    created: boolean      // bank_accounts에 새로 만든 계좌인지
  }[]
}
