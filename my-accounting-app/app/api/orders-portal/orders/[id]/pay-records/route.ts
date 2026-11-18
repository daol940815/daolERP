import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { createCancel } from '@/lib/payment-cancel'
import { hasCancelCols } from '@/lib/payment-cancel-meta'
import { resolveReason } from '@/lib/payment-reasons'
import { createRecord, deleteRecord, loadCandidateOrders, loadRecKinds, updateRecord, validateRecordInput } from '@/lib/payment-records'

export const dynamic = 'force-dynamic'

// 결제 기록 (1300, 2026-11-13 사용자 확정) — 1차 입력: 영업지원팀(주문 · 발주 수정 권한)
//   GET    ?exclude=<record_id>   → 같은 결제로 함께 처리할 수 있는 주문(같은 매출처 · 청구처, 미결제)
//   POST   { method, pay_date, amount, card_entry?, vat_kind? (1304 — 새 기록은 필수, 계좌이체 제외), approval_number?, card_last4?, depositor_name?, due_date?, memo?, allocations: [{order_id, amount}] }
//   PATCH  ?record_id=  같은 본문 → 확인 대기 기록만 수정
//   DELETE ?record_id=  { reason }  → 확인 대기 기록만 삭제 (취소 줄도 여기서 삭제)
//   POST   ?cancel_of=<record_id>  { cancel_date, full | allocations, reason } → 취소 줄 남기기 (1305 — 삭제와 다르다: 실제 결제를 되돌린 것)
// 사유(1305, 2026-11-18): 취소 · 삭제는 항상, 수정은 금액 · 수단 · 승인번호 · 주문 배분 · 구분을 바꿀 때 필수(화면이 판단해 reason 을 보낸다 — 메모만 고치면 없음).
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
  const admin = createAdminClient()
  const cancelOf = new URL(req.url).searchParams.get('cancel_of')
  if (cancelOf) {
    const r = await createCancel(admin, cancelOf, await req.json().catch(() => ({})), g.editor)
    if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
    return NextResponse.json(r)
  }
  // 새 기록은 방식 · 과세 구분 필수 (1304 미적용이면 받지 않는다). 이전 기록 수정(PATCH)은 선택.
  const input = validateRecordInput(await req.json().catch(() => ({})), (await loadRecKinds(admin, [])) != null)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const r = await createRecord(admin, params.id, input, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function PATCH(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const recordId = new URL(req.url).searchParams.get('record_id')
  if (!recordId) return NextResponse.json({ error: 'record_id가 필요합니다.' }, { status: 400 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const input = validateRecordInput(body)
  if ('error' in input) return NextResponse.json({ error: input.error }, { status: 400 })
  const admin = createAdminClient()
  let reason = null
  if (body.reason && await hasCancelCols(admin)) {
    const rr = resolveReason('update', body.reason)
    if ('error' in rr) return NextResponse.json({ error: rr.error }, { status: 400 })
    reason = rr
  }
  const r = await updateRecord(admin, recordId, input, g.editor, reason)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const recordId = new URL(req.url).searchParams.get('record_id')
  if (!recordId) return NextResponse.json({ error: 'record_id가 필요합니다.' }, { status: 400 })
  const admin = createAdminClient()
  let reason = null
  if (await hasCancelCols(admin)) {   // 1305 적용 뒤에는 삭제 사유 필수
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    const rr = resolveReason('delete', body.reason)
    if ('error' in rr) return NextResponse.json({ error: rr.error }, { status: 400 })
    reason = rr
  }
  const r = await deleteRecord(admin, recordId, g.editor, reason)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
