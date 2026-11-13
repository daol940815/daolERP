import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { confirmRecord, releaseRecord, type ConfirmSource } from '@/lib/payment-records'

export const dynamic = 'force-dynamic'

// 결제 확인(2차) · 확인 해제 (1300, 2026-11-13 사용자 확정) — 수금 · 정산 작업 수정 권한자 누구나
//   POST   { sources: [{ source_type: 'bank'|'card', source_id, amount }] }  → 기록의 주문별 금액대로 수금 매칭 생성
//   DELETE { reason }                                                        → 매칭 삭제, 기록은 확인 대기로 복귀(사유 필수)
const DENY = '결제 확인은 수금 · 정산 작업 수정 권한이 필요합니다. 경영지원팀 오철준 대리 또는 ERP 담당에게 요청해주세요.'

async function guard() {
  const me = await getCurrentUser()
  if (!me) return { res: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  if (!can(me, 'collections', 'edit')) return { res: NextResponse.json({ error: DENY }, { status: 403 }) }
  return { editor: { employeeId: me.employeeId, employeeName: me.employeeName } }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { sources?: ConfirmSource[] }
  const r = await confirmRecord(createAdminClient(), params.id, body.sources ?? [], g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { reason?: string }
  const r = await releaseRecord(createAdminClient(), params.id, body.reason ?? '', g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
