import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { createRecord, deleteRecord, loadCandidateOrders, updateRecord, validateRecordInput } from '@/lib/payment-records'

export const dynamic = 'force-dynamic'

// 결제 기록 (1300, 2026-11-13 사용자 확정) — 1차 입력: 영업지원팀(주문 · 발주 수정 권한)
//   GET    ?exclude=<record_id>   → 같은 결제로 함께 처리할 수 있는 주문(같은 매출처 · 청구처, 미결제)
//   POST   { method, pay_date, amount, approval_number?, card_last4?, depositor_name?, due_date?, memo?, allocations: [{order_id, amount}] }
//   PATCH  ?record_id=  같은 본문 → 확인 대기 기록만 수정
//   DELETE ?record_id=           → 확인 대기 기록만 삭제
const DENY = '결제 기록은 주문 · 발주 수정 권한이 필요합니다. 영업지원팀 홍창의 부장 또는 ERP 담당에게 요청해주세요.'

async function guard() {
  const me = await getCurrentUser()
  if (!me) return { res: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  if (!can(me, 'orders', 'edit')) return { res: NextResponse.json({ error: DENY }, { status: 403 }) }
  return { editor: { employeeId: me.employeeId, employeeName: me.employeeName } }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const r = await loadCandidateOrders(createAdminClient(), params.id, new URL(req.url).searchParams.get('exclude'))
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json({ orders: r.data })
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await guard(); if ('res' in g) return g.res
  const input = validateRecordInput(await req.json().catch(() => ({})))
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const r = await createRecord(createAdminClient(), params.id, input, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function PATCH(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const recordId = new URL(req.url).searchParams.get('record_id')
  if (!recordId) return NextResponse.json({ error: 'record_id가 필요합니다.' }, { status: 400 })
  const input = validateRecordInput(await req.json().catch(() => ({})))
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const r = await updateRecord(createAdminClient(), recordId, input, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const recordId = new URL(req.url).searchParams.get('record_id')
  if (!recordId) return NextResponse.json({ error: 'record_id가 필요합니다.' }, { status: 400 })
  const r = await deleteRecord(createAdminClient(), recordId, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
