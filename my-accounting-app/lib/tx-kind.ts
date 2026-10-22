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

// 분류 단서로 쓰면 안 되는 구분 값
//  · 방향: 일부 명세서의 '구분'은 거래 종류가 아니라 입금/출금 방향이다
//  · 채널: '인터넷'·'모바일'·'타행송금'·'대체' 같은 값은 거래 "경로"지 "용도"가 아니다.
//    2026-10-12 사고 — '인터넷'(인터넷뱅킹 이체)이 통신비 적요 키워드 '인터넷'과 정확 일치해
//    우리 마이너스통장의 자사 계좌 간 이체가 통신비로 추천됐다.
const DIRECTION_WORDS = new Set(['입금', '출금', '입', '출', '지급', '수입', '지출', '차변', '대변'])
const CHANNEL_WORDS = new Set([
  '인터넷', '인터넷당행', '모바일', '폰뱅킹', '텔레뱅킹', '오픈뱅킹', '펌뱅킹', 'bz뱅크', 'bz수수',
  '대체', '대체입금', '대체출금', '타행', '타행송금', '타행이체', '타행대량', '당행송금', '당행이체',
  '실시간이체', '재정이체', '자동이체', 'cms', 'i/b', 'f/b', 'f/b 출금', 'fb이체', '연입금',
  'i-g', 'kft', 'fbc', 'fbs', 'gir', 'g-하나은행', 'g-우리은행', 'atm', 'cd', '창구', '무통장',
  // 결제수단 — 용도가 아니라 수단이므로 계정 하나로 못 간다 (적요=가맹점명으로 분류)
  '체크카드', '체크우리',
])

// 은행 파일은 전각(Ｆ／Ｂ)으로 오기도 한다 — NFKC로 반각화해서 비교
const normKind = (kind: string | null | undefined) =>
  (kind ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

export function isChannelTxKind(kind: string | null | undefined): boolean {
  const k = normKind(kind)
  return CHANNEL_WORDS.has(k) || /^g-/.test(k)
}

export function isUsableTxKind(kind: string | null | undefined): kind is string {
  const k = normKind(kind)
  return k.length > 0 && !DIRECTION_WORDS.has(k) && !isChannelTxKind(k)
}

// 구분 키워드는 적요 키워드와 **다른 이름공간**을 쓴다 — 계정 키워드에 '구분:대출이자'처럼 등록.
// 적요용 키워드('인터넷', '이자' …)가 구분 값에 걸리는 일을 원천 차단한다.
export const TX_KIND_KEYWORD_PREFIX = '구분:'

export function txKindKeyword(kind: string): string {
  return TX_KIND_KEYWORD_PREFIX + normKind(kind)
}

// 통장 적요에서 대출번호를 뽑는다 — "47598009367842-00001" → "47598009367842"
// (하이픈 뒤 일련번호는 같은 대출의 회차라 뗀다). 숫자 10자리 이상만 대출번호로 본다.
export function loanNoFromDescription(desc: string | null | undefined): string | null {
  const m = String(desc ?? '').trim().match(/^(\d{10,})(?:-\d+)?$/)
  return m ? m[1] : null
}
