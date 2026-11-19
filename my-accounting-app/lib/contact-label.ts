// 거래처 담당자 표시명 — 존칭('님') 부여 규칙 (2026-08-14 사용자 결정)
//
// 원칙: 인물 마스터(contacts.name)에는 존칭·직함을 저장하지 않는다.
//   동일인 판정·검색이 순수 이름 기준이라 저장은 이름만, 존칭은 표시할 때 붙인다.
//   직함은 배정(contact_assignments.title)에 따로 두므로 표시 시점에 합친다.
//
// 표기는 기존 ERP 관행과 동일하게 맞춘다 (업로드 주문 8,212건에서 확인된 패턴):
//   직함 있음 → '권오병 부장님'  (직함 뒤에 붙임)
//   직함 없음 → '박제현 님'      (이름 뒤 띄어쓰기 후 붙임)
//
// 적용 대상은 거래처 담당자(고객사 인물)뿐이다. 자사 직원(employees)은 대상이 아니다.

// 마스터 기반 표시명 — 이름 + 직함에 존칭을 붙인다.
export function contactLabel(name: string | null | undefined, title?: string | null): string {
  const n = (name ?? '').trim()
  if (!n) return ''
  const t = (title ?? '').trim()
  // 이미 존칭이 포함된 값(자유 입력·과거 표기)은 그대로 둔다 — 중복 부착 방지
  if (n.endsWith('님')) return n
  if (t) return t.endsWith('님') ? `${n} ${t}` : `${n} ${t}님`
  return `${n} 님`
}

// 저장 직전 정리 (2026-11-19 — 목록 내려받기에서 '차장님님' · '허정 대리님' 같은 저장값 발견).
// 직함 칸에 '차장님'을, 이름 칸에 '김민수 과장님'을 그대로 쳐도 마스터 규칙(이름만 · 직함은 배정 · 존칭은 표시)대로 저장한다.
export function cleanContactTitle(title: string | null | undefined): string | null {
  const t = (title ?? '').trim().replace(/(\s*님)+$/, '').trim()
  return t || null
}
// 이름 칸: 끝의 '님'을 떼고, 띄어쓰기 뒤에 직함이 붙어 있으면(그리고 직함 칸이 비었으면) 직함으로 옮긴다.
export function cleanContactName(name: string | null | undefined, title?: string | null): { name: string; title: string | null } {
  const n = (name ?? '').trim().replace(/(\s*님)+$/, '').trim()
  let t = cleanContactTitle(title)
  const parts = n.split(/\s+/)
  if (parts.length >= 2 && /^[가-힣]{2,4}$/.test(parts[0])) {
    if (!t) t = cleanContactTitle(parts.slice(1).join(' '))
    return { name: parts[0], title: t }
  }
  return { name: n, title: t }
}

// 이미 완성된 표시 문자열(자유 입력 담당자 표기 등)에 존칭만 보충한다.
// 직함이 포함돼 있으면 직함 뒤에 붙는다: '이경준 센터장' → '이경준 센터장님'
export function honorify(display: string | null | undefined): string {
  const s = (display ?? '').trim()
  if (!s || s.endsWith('님')) return s
  return `${s}님`
}
