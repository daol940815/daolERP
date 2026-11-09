// 주문시기 (708, 사용자 확정 2026-11-09) — 상담 품목 · 주문 품목 공용
// 값은 글자: '상시' 또는 'YY설' · 'YY추석' (예: 26설, 26추석). 가나다순 정렬 = 시간순.
// 입력은 글자 + 드롭다운 제안 — 목록에 없는 값도 쓸 수 있다(예: 26연말).

export const SEASON_ALWAYS = '상시'

// 설날 · 추석 당일 (음력 → 양력). 목록 · 기본값 제안에만 쓰며, 표에 없는 해는 제안만 빠진다.
const HOLIDAYS: { date: string; name: '설' | '추석' }[] = [
  { date: '2026-02-17', name: '설' }, { date: '2026-09-25', name: '추석' },
  { date: '2027-02-07', name: '설' }, { date: '2027-09-15', name: '추석' },
  { date: '2028-01-27', name: '설' }, { date: '2028-10-03', name: '추석' },
  { date: '2029-02-13', name: '설' }, { date: '2029-09-22', name: '추석' },
  { date: '2030-02-03', name: '설' }, { date: '2030-09-12', name: '추석' },
]
const seasonOf = (h: { date: string; name: string }) => `${h.date.slice(2, 4)}${h.name}`

// 표기 통일: 공백 제거 · '2026추석' → '26추석' · '설날' → '설'
export function normalizeSeason(raw: string | null | undefined): string {
  let s = String(raw ?? '').replace(/\s+/g, '')
  if (!s) return ''
  s = s.replace(/^20(\d{2})(?=\D)/, '$1').replace(/^(\d{2})년/, '$1').replace(/설날/, '설')
  return s
}

// 기본값 제안 — 다가오는 명절이 기준일로부터 60일 안이면 그 시즌, 아니면 상시 (확정은 작성자)
export const SEASON_LEAD_DAYS = 60
export function suggestSeason(baseDate: string | null | undefined): string {
  const d = String(baseDate ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return SEASON_ALWAYS
  const base = Date.parse(`${d}T00:00:00Z`)
  for (const h of HOLIDAYS) {
    const t = Date.parse(`${h.date}T00:00:00Z`)
    if (t < base) continue
    return (t - base) / 86400000 <= SEASON_LEAD_DAYS ? seasonOf(h) : SEASON_ALWAYS
  }
  return SEASON_ALWAYS
}

// 드롭다운 목록: 상시 + 기준일 해와 다음 해의 설 · 추석 + 이미 쓴 값 (중복 제거, 상시 먼저 · 나머지 가나다순)
export function seasonOptions(baseDate: string | null | undefined, used: (string | null | undefined)[] = []): string[] {
  const y = Number(String(baseDate ?? '').slice(0, 4)) || new Date().getFullYear()
  const gen = HOLIDAYS.filter(h => { const hy = Number(h.date.slice(0, 4)); return hy === y || hy === y + 1 }).map(seasonOf)
  const rest = Array.from(new Set([...gen, ...used.map(normalizeSeason)].filter(s => s && s !== SEASON_ALWAYS))).sort()
  return [SEASON_ALWAYS, ...rest]
}
