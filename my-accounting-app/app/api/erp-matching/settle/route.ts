import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadSettledList, releaseSettlements, settleSources, type SettleItem } from '@/lib/source-settle'

export const dynamic = 'force-dynamic'

// 이전 처리분 (1309, 2026-11-23) — 결제 확인 › 입금대장. 권한: 수금 · 정산 작업(미들웨어 — GET 조회, 그 외 수정)
//   GET                                       → 살아 있는 이전 처리분 목록
//   POST   { items: SettleItem[], reason, memo? } → 체크한 입금 · 카드 결제를 이전 처리분으로 표시(사유 필수)
//   DELETE { ids: string[], reason }           → 해제(사유 필수) — 입금대장 목록으로 돌아간다
async function editor() {
  const me = await getCurrentUser()
  return me ? { employeeId: me.employeeId, employeeName: me.employeeName } : null
}

export async function GET() {
  if (!(await editor())) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  return NextResponse.json(await loadSettledList(createAdminClient()))
}

export async function POST(req: NextRequest) {
  const ed = await editor(); if (!ed) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { items?: SettleItem[]; reason?: unknown; memo?: string | null }
  const r = await settleSources(createAdminClient(), Array.isArray(b.items) ? b.items : [], b.reason, b.memo ?? null, ed)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest) {
  const ed = await editor(); if (!ed) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const b = await req.json().catch(() => ({})) as { ids?: string[]; reason?: unknown }
  const r = await releaseSettlements(createAdminClient(), Array.isArray(b.ids) ? b.ids : [], b.reason, ed)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
