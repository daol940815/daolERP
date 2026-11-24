// ─────────────────────────────────────────────────────────
// 업체명 표준 표기 · 입력 자동 표준화 — 2026-11-19 사용자 결정 · 승인
// (시안 docs/mockups/업체명_자동표준화_시안.html, 기록 docs/customer-management-track.md)
//
// 업체명(vendor_groups.name)을 입력하는 곳(매출처 등록 창 · 주문 입력 신규 지점 등록 · 상담일지 업체 입력)이
// 이 파일 한 곳의 규칙을 함께 쓴다. 화면과 서버 양쪽에서 쓰는 순수 함수만 둔다(DB 접근 없음).
//   - 규칙에 있는 옛 이름을 입력하면 표준 업체명으로 저장한다. 입력 칸의 글자는 그대로 두고 안내로 알린다.
//   - 지점명 앞에 은행명까지 적으면(예: '기업은행 상계동지점') 앞의 은행명을 뗀다 — 규칙 밖 업체에도 적용.
//   - 안내만 하는 입력(예: 'KB' — KB증권 · KB라이프파트너스 등 다른 업체가 있어 자동으로 바꾸지 않음).
// 새 은행 표기를 정하면 GROUP_NAME_RULES 에 한 줄 추가한다(결정일 함께).
// ─────────────────────────────────────────────────────────

export interface GroupNameRule {
  standard: string     // 표준 업체명 (vendor_groups.name)
  aliases: string[]    // 이렇게 입력해도 표준명으로
  decided: string      // 결정일
}

export const GROUP_NAME_RULES: GroupNameRule[] = [
  { standard: 'IBK기업은행', aliases: ['기업은행', '중소기업은행', 'IBK', 'IBK기업'], decided: '2026-11-19' },
  { standard: 'KB국민은행', aliases: ['국민은행', 'KB국민'], decided: '2026-11-19' },
  // '농협' 단독은 넣지 않는다 — 지역 농협(송포농협 · 금정농협 등)과 NH농협손해보험 · NH농협생명은 다른 업체
  { standard: 'NH농협은행', aliases: ['농협은행', 'NH농협'], decided: '2026-11-20' },
  { standard: 'NH농협손해보험', aliases: ['농협손해보험'], decided: '2026-11-23' },
  { standard: '하나생명', aliases: ['하나생명보험'], decided: '2026-11-23' },
  { standard: 'NH농협생명', aliases: ['농협생명', '농협생명보험'], decided: '2026-11-24' },
]

// 바꾸지 않고 안내만 (2026-11-19 사용자 결정 — 'KB' 단독 입력)
export const GROUP_NAME_HINTS: { input: string; suggest: string; why: string }[] = [
  { input: 'KB', suggest: 'KB국민은행', why: 'KB증권 · KB라이프파트너스 등 다른 KB 업체가 있어 자동으로 바꾸지 않습니다.' },
]

const LEGAL = /^\s*(\(주\)|㈜|주식회사)\s*|\s*(\(주\)|㈜|주식회사)\s*$/g

// 비교 키: 법인 표기 · 공백 · 대소문자 무시
export const groupKey = (s: string) => s.replace(LEGAL, '').replace(/\s+/g, '').toLowerCase()

export function findGroupRule(input: string): GroupNameRule | null {
  const k = groupKey(input)
  if (!k) return null
  return GROUP_NAME_RULES.find(r => groupKey(r.standard) === k || r.aliases.some(a => groupKey(a) === k)) ?? null
}

// 업체명 표준화. changed = 입력과 저장 이름이 다름(안내 대상)
export function standardizeGroupName(input: string): { name: string; changed: boolean; rule: GroupNameRule | null } {
  const typed = input.trim()
  const rule = findGroupRule(typed)
  if (!rule) return { name: typed, changed: false, rule: null }
  return { name: rule.standard, changed: typed !== rule.standard, rule }
}

// 안내만 하는 입력 (규칙에 걸리지 않을 때만)
export function groupNameHint(input: string): { suggest: string; why: string } | null {
  const k = groupKey(input)
  if (!k || findGroupRule(input)) return null
  const h = GROUP_NAME_HINTS.find(x => groupKey(x.input) === k)
  return h ? { suggest: h.suggest, why: h.why } : null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// 지점명 앞의 은행명 떼기. 후보 = 표준 업체명 · 입력한 업체명 · 규칙의 옛 이름(표준명의 앞부분인 약칭 'IBK' 등은 제외 —
// 'IBK파이낸스타워지점' 같은 실제 지점명을 깎지 않게). 맨 앞부분만 본다.
export function stripGroupPrefix(groupName: string, branch: string, typedGroup?: string): { branch: string; stripped: string | null } {
  const b = branch.trim()
  if (!b || !groupName.trim()) return { branch: b, stripped: null }
  const rule = findGroupRule(groupName) ?? (typedGroup ? findGroupRule(typedGroup) : null)
  const std = groupKey(rule?.standard ?? groupName)
  const cands = Array.from(new Set([groupName, typedGroup ?? '', rule?.standard ?? '', ...(rule?.aliases ?? [])]
    .map(s => s.trim())
    .filter(s => groupKey(s).length >= 2 && (groupKey(s) === std || !std.startsWith(groupKey(s))))))
    .sort((a, b2) => groupKey(b2).length - groupKey(a).length)
  for (const c of cands) {
    const chars = Array.from(c.replace(LEGAL, '').replace(/\s+/g, ''))
    const re = new RegExp('^\\s*(?:\\(주\\)|㈜|주식회사)?\\s*' + chars.map(escapeRe).join('\\s*') + '\\s*', 'i')
    const m = b.match(re)
    if (m) return { branch: b.slice(m[0].length).replace(/^[\s·\-–,]+/, '').trim(), stripped: b.slice(0, m[0].length).trim() }
  }
  return { branch: b, stripped: null }
}

export interface VendorNameInput {
  group: { typed: string; name: string; changed: boolean }
  branch: { typed: string; name: string; stripped: string | null }
  hint: { suggest: string; why: string } | null
  fullName: string           // 저장될 매출처 이름 = '업체명 지점명'
}

// 등록 입력 한 벌 표준화 (업체명 + 지점명). groupFixed = 목록에서 이미 고른 업체(이름 그대로 사용)
export function standardizeVendorInput(groupTyped: string, branchTyped: string, groupFixed?: string | null): VendorNameInput {
  const g = groupFixed ? { name: groupFixed.trim(), changed: false } : standardizeGroupName(groupTyped)
  const br = stripGroupPrefix(g.name, branchTyped, groupTyped)
  return {
    group: { typed: groupTyped.trim(), name: g.name, changed: g.changed },
    branch: { typed: branchTyped.trim(), name: br.branch, stripped: br.stripped },
    hint: groupFixed ? null : groupNameHint(groupTyped),
    fullName: [g.name, br.branch].filter(Boolean).join(' '),
  }
}

// 업체 검색용 별칭 — 콤보 목록에서 '중소기업은행'으로도 IBK기업은행이 걸리게
export function groupSearchKeywords(standardName: string): string {
  const r = GROUP_NAME_RULES.find(x => groupKey(x.standard) === groupKey(standardName))
  return r ? r.aliases.join(' ') : ''
}

export const GROUP_STANDARD_WHY = '회사 표준 업체명입니다(2026-11-19 결정). 다른 회사라면 ERP 담당자에게 알려 주세요.'
