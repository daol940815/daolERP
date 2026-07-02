// 분개 회계 엔진 공통 타입 — 설계: docs/journal-design.md
// "보이는 분개 = 저장되는 분개": buildPosting() 산출물이자 미리보기·post_journal()이 공유하는 단일 계약.

export type JournalSide = 'debit' | 'credit'
export type JournalSourceType = 'bank' | 'card' | 'card_sale' | 'tax_invoice' | 'manual'
export type JournalEntryType = 'normal' | 'adjustment' | 'closing'

export interface JournalLineDraft {
  account_id: string
  side: JournalSide
  amount: number            // 항상 양수
  vendor_id?: string | null // 거래처별 원장용 (선택)
  note?: string | null
}

export interface JournalDraft {
  source_type: JournalSourceType
  source_id: string         // 원천 문서 id (멱등 키)
  entry_date: string        // 'YYYY-MM-DD'
  description: string | null
  entry_type?: JournalEntryType
  lines: JournalLineDraft[] // 차변≥1, 대변≥1, 합계 균형
}

export interface JournalBalance {
  debit: number
  credit: number
  balanced: boolean
}

// 미리보기/전기 전 균형 계산 (RPC가 최종 진실이지만, UI·사전검증용)
export function draftBalance(draft: JournalDraft): JournalBalance {
  const debit = draft.lines.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
  const credit = draft.lines.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)
  return { debit, credit, balanced: debit === credit && debit > 0 }
}
