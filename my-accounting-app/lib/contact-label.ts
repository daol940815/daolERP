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

// 이미 완성된 표시 문자열(자유 입력 담당자 표기 등)에 존칭만 보충한다.
// 직함이 포함돼 있으면 직함 뒤에 붙는다: '이경준 센터장' → '이경준 센터장님'
export function honorify(display: string | null | undefined): string {
  const s = (display ?? '').trim()
  if (!s || s.endsWith('님')) return s
  return `${s}님`
}
