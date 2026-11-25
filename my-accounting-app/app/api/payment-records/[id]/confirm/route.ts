import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { confirmRecord, releaseRecord, type ConfirmSource } from '@/lib/payment-records'
import { syncInvoicesForOrders } from '@/lib/link-sync'
import { resolveReason } from '@/lib/payment-reasons'

export const dynamic = 'force-dynamic'

// 결제 확인(2차) · 확인 해제 (1300, 2026-11-13 사용자 확정) — 수금 · 정산 작업 수정 권한자 누구나
//   POST   { sources: [{ source_type: 'bank'|'card', source_id, amount }], learn_keyword? }  → 기록의 주문별 금액대로 수금 매칭 생성
//          learn_keyword: 통장 확정 뒤 입금자 표기를 기록 매출처의 통장 키워드로 기록(2026-11-25, 화면 체크 칸 기본 체크)
//   DELETE { reason: { code, text } }                                        → 매칭 삭제, 기록은 매칭 대기로 복귀. 사유는 항목에서 고른다(필수, 1307)
const DENY = '결제 확인은 수금 · 정산 작업 수정 권한이 필요합니다. 경영지원팀 오철준 대리 또는 ERP 담당에게 요청해주세요.'

async function guard() {
  const me = await getCurrentUser()
  if (!me) return { res: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  if (!can(me, 'collections', 'edit')) return { res: NextResponse.json({ error: DENY }, { status: 403 }) }
  return { editor: { employeeId: me.employeeId, employeeName: me.employeeName } }
}

// 확정 · 해제로 주문 수금이 바뀌면, 그 주문에 연결된 계산서의 입금도 맞춘다 (1302 2단계)
async function syncInvoicesOfRecord(admin: ReturnType<typeof createAdminClient>, recordId: string) {
  const { data } = await admin.from('order_payment_record_orders').select('order_id').eq('record_id', recordId)
  await syncInvoicesForOrders(admin, (data ?? []).map(r => r.order_id as string))
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { sources?: ConfirmSource[]; learn_keyword?: string | null }
  const admin = createAdminClient()
  const r = await confirmRecord(admin, params.id, body.sources ?? [], g.editor, { learnKeyword: typeof body.learn_keyword === 'string' ? body.learn_keyword : null })
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  await syncInvoicesOfRecord(admin, params.id)
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { reason?: unknown }
  const reason = resolveReason('release', body.reason)
  if ('error' in reason) return NextResponse.json({ error: reason.error }, { status: 400 })
  const admin = createAdminClient()
  const r = await releaseRecord(admin, params.id, reason, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  await syncInvoicesOfRecord(admin, params.id)
  return NextResponse.json(r)
}
