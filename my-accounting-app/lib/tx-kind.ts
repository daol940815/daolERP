import type { SupabaseClient } from '@supabase/supabase-js'

// ── 은행 거래 구분(tx_kind) 공통 유틸 ─────────────────────────
// 마이그레이션 409가 아직 실행되지 않은 환경에서도 업로드·분류가 죽지 않도록
// 컬럼 존재 여부를 한 번 확인하고(요청 단위 캐시) 없으면 구분을 그냥 버린다.

// true는 영구 캐시, false는 60초만 — 409를 실행한 직후 인스턴스 재시작 없이도 살아나게
let cached: { value: boolean; at: number } | null = null

export async function hasTxKindColumn(admin: SupabaseClient): Promise<boolean> {
  if (cached && (cached.value || Date.now() - cached.at < 60_000)) return cached.value
  const { error } = await admin.from('transactions').select('tx_kind').limit(1)
  cached = { value: !error, at: Date.now() }
  return cached.value
}

// 일부 명세서의 '구분'은 거래 종류가 아니라 입금/출금 방향이다 — 분류 단서로 쓰지 않는다
const DIRECTION_WORDS = new Set(['입금', '출금', '입', '출', '지급', '수입', '지출', '차변', '대변'])

export function isUsableTxKind(kind: string | null | undefined): kind is string {
  const k = (kind ?? '').trim()
  return k.length > 0 && !DIRECTION_WORDS.has(k)
}

// 통장 적요에서 대출번호를 뽑는다 — "47598009367842-00001" → "47598009367842"
// (하이픈 뒤 일련번호는 같은 대출의 회차라 뗀다). 숫자 10자리 이상만 대출번호로 본다.
export function loanNoFromDescription(desc: string | null | undefined): string | null {
  const m = String(desc ?? '').trim().match(/^(\d{10,})(?:-\d+)?$/)
  return m ? m[1] : null
}
