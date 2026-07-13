// 거래처 마스터 공통 유틸 — 정책: docs/vendor-master-policy.md
// 이름 정규화(§3)와 중복 후보 탐지의 단일 기준. 모든 매칭 기능은 이 규칙을 공유한다.

// 관용 동의어 사전 (정규화 후 적용) — 추가는 정책 문서와 함께 관리
const SYNONYMS: [string, string][] = [
  ['종합금융센터', '금융센터'],
  ['keb하나은행', '하나은행'],
]

const LEGAL_RE = /주식회사|\(주\)|㈜|\(유\)|유한회사|유한책임회사|\(재\)|\(사\)|\(합\)/g
const SPECIAL_RE = /[\s\-_.,·()[\]'"!@#&+/\\]/g

// 거래처 이름 정규화 — 법인격·공백·특수문자·대소문자 무시 + 동의어 치환
export function normalizeMasterName(s: string | null | undefined): string {
  let n = (s ?? '').toLowerCase().replace(LEGAL_RE, '').replace(SPECIAL_RE, '').trim()
  for (const [from, to] of SYNONYMS) n = n.split(from).join(to)
  return n
}
