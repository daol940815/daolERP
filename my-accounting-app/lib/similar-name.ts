// 비슷한 이름 찾기 — 신규 업체 · 지점을 직접 칠 때 오타를 묻기 위한 순수 함수 (2026-11-18, 고객 쌍방향 추천 시안 장면 4)
//  - 비교 전 공백 · 법인 접두/접미("(주)" · "㈜" · "주식회사") · 가운뎃점 · 마침표 · 괄호를 뺀다.
//  - 같은 이름(0) → 한두 글자 차이(편집 거리) → 포함 관계(3글자 이상) 순. 막지 않고 묻기만 한다(호출부).
const CORP = /(\(주\)|㈜|주식회사)/g
export const normForSimilar = (s: string) =>
  String(s ?? '').replace(CORP, '').replace(/[\s·.()\-_/]/g, '').toLowerCase()

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// 점수: 0 = 같은 이름, 1~2 = 글자 차이, 3 = 포함 관계, null = 비슷하지 않음
export function similarScore(input: string, candidate: string): number | null {
  const a = normForSimilar(input), b = normForSimilar(candidate)
  if (a.length < 2 || b.length < 2) return null
  if (a === b) return 0
  const limit = Math.min(a.length, b.length) >= 6 ? 2 : 1
  const d = editDistance(a, b)
  if (d <= limit && Math.abs(a.length - b.length) <= limit) return d
  if (Math.min(a.length, b.length) >= 3 && (a.includes(b) || b.includes(a))) return 3
  return null
}

export function similarItems<T>(input: string, items: T[], nameOf: (t: T) => string, limit = 3): T[] {
  return items
    .map(t => ({ t, s: similarScore(input, nameOf(t)) }))
    .filter((x): x is { t: T; s: number } => x.s !== null)
    .sort((x, y) => x.s - y.s)
    .slice(0, limit)
    .map(x => x.t)
}
