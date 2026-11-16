import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// POST /api/erp-matching/run — 폐지 (2026-11-16 사용자 결정)
// 예전에는 고신뢰 조건(같은 거래처 · 금액 같음 · 날짜 가까움 · 1:1)이면 사람 확인 없이 확정했다.
// 지금은 같은 조건을 GET /api/erp-matching 이 '추천'으로만 붙이고, 확정은 화면에서 사람이 누른다.
export async function POST() {
  return NextResponse.json({ error: '자동 확정은 없어졌습니다. 결제 확인 › 기록 없는 입금에서 추천을 확인하고 확정하세요.' }, { status: 410 })
}
