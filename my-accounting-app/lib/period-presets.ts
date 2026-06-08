// 기간 빠른 선택 프리셋 — 거래내역/카드결제내역 등 날짜 범위 필터에서 공용으로 사용
export const PERIOD_PRESETS = ['당월', '전월', '당분기', '전분기', '당반기', '전반기', '당년', '전년'] as const

export function getPeriodRange(period: string): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()  // 0-based

  // toISOString()은 UTC 변환으로 KST(+9) 환경에서 날짜가 하루 밀리므로 로컬 기준으로 포맷
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  switch (period) {
    case '당월':
      return { from: fmt(new Date(y, m, 1)),     to: fmt(new Date(y, m + 1, 0)) }
    case '전월':
      return { from: fmt(new Date(y, m - 1, 1)), to: fmt(new Date(y, m, 0)) }
    case '당분기': {
      const q = Math.floor(m / 3)
      return { from: fmt(new Date(y, q * 3, 1)), to: fmt(new Date(y, q * 3 + 3, 0)) }
    }
    case '전분기': {
      const q = Math.floor(m / 3) - 1
      const aq = q < 0 ? 3 : q
      const ay = q < 0 ? y - 1 : y
      return { from: fmt(new Date(ay, aq * 3, 1)), to: fmt(new Date(ay, aq * 3 + 3, 0)) }
    }
    case '당반기': {
      const h = m < 6 ? 0 : 1
      return { from: fmt(new Date(y, h * 6, 1)), to: fmt(new Date(y, h * 6 + 6, 0)) }
    }
    case '전반기': {
      const h = m < 6 ? 1 : 0
      const ay = m < 6 ? y - 1 : y
      return { from: fmt(new Date(ay, h * 6, 1)), to: fmt(new Date(ay, h * 6 + 6, 0)) }
    }
    case '당년':
      return { from: fmt(new Date(y, 0, 1)),     to: fmt(new Date(y, 11, 31)) }
    case '전년':
      return { from: fmt(new Date(y - 1, 0, 1)), to: fmt(new Date(y - 1, 11, 31)) }
    default:
      return { from: fmt(new Date(y, m, 1)), to: fmt(now) }
  }
}
