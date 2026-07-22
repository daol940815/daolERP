// 기간 빠른 선택 프리셋 — 거래내역/카드결제내역 등 날짜 범위 필터에서 공용으로 사용
// 분기/반기는 상대(당·전)가 아니라 절대(1~4분기, 상·하반기)로 제공한다.
// 연도 규칙: 기본은 올해. 아직 시작하지 않은 분기/반기를 누르면 작년 것으로 해석한다.
//   (예: 2026년 7월에 '4분기' 클릭 → 2025-10-01 ~ 12-31)
export const PERIOD_PRESETS = ['당월', '전월', '1분기', '2분기', '3분기', '4분기', '상반기', '하반기', '당년', '전년'] as const

// 화면 기본 조회 시작일 — 2025년 데이터(전체의 61%)는 기본 조회·자동매칭에서 제외한다.
// 삭제가 아니라 기본값이므로, 기간을 넓히면 언제든 과거를 조회·매칭할 수 있다.
// 연도가 바뀌면 이 두 값만 갱신하면 된다.
export const DEFAULT_VIEW_FROM = '2026-01-01'
export const DEFAULT_VIEW_FROM_MONTH = '2026-01'

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
    case '1분기': case '2분기': case '3분기': case '4분기': {
      const q = Number(period[0]) - 1                    // 0-based 분기
      const qy = new Date(y, q * 3, 1) > now ? y - 1 : y // 미래 분기면 작년으로
      return { from: fmt(new Date(qy, q * 3, 1)), to: fmt(new Date(qy, q * 3 + 3, 0)) }
    }
    case '상반기': case '하반기': {
      const h = period === '상반기' ? 0 : 1
      const hy = new Date(y, h * 6, 1) > now ? y - 1 : y
      return { from: fmt(new Date(hy, h * 6, 1)), to: fmt(new Date(hy, h * 6 + 6, 0)) }
    }
    // ── 아래 상대 프리셋은 화면 버튼에서 빠졌지만, 코드에서 직접 쓰는 곳이 있어 유지 ──
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
