// 거래처명 유사도 매칭 (ERP 별칭 → vendors 추천용)

// 법인 접두/접미어와 공백·특수문자를 제거해 비교용 이름으로 정규화
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/주식회사|\(주\)|\(유\)|\(사\)|\(재\)|\(합\)|유한회사|유한책임회사/g, '')
    .replace(/[\s\-_.,·()[\]'"!@#&+/\\]/g, '')
    .trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[n]
}

// 0~1 유사도: 정규화 후 완전일치 1.0, 포함관계 0.8+, 그 외 편집거리 비율
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) {
    return 0.8 + 0.2 * (Math.min(na.length, nb.length) / Math.max(na.length, nb.length))
  }
  const dist = levenshtein(na, nb)
  return Math.max(0, 1 - dist / Math.max(na.length, nb.length))
}

export interface NameCandidate { id: string; name: string }

// 후보 목록에서 최고 유사도 1건 (threshold 미만이면 null)
export function bestNameMatch(
  name: string,
  candidates: NameCandidate[],
  threshold = 0.55,
): { id: string; name: string; score: number } | null {
  let best: { id: string; name: string; score: number } | null = null
  for (const c of candidates) {
    const score = nameSimilarity(name, c.name)
    if (score >= threshold && (!best || score > best.score)) {
      best = { id: c.id, name: c.name, score }
    }
  }
  return best
}
