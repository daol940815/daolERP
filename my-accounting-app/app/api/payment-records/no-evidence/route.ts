import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { can } from '@/lib/permissions'
import { resolveReason } from '@/lib/payment-reasons'
import { processNoEvidence, releaseNoEvidence, type NoEvidenceVat } from '@/lib/no-evidence'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 증빙 없이 처리 · 해제 (1310, 2026-11-25 사용자 결정) — 수금 · 정산 작업 수정 권한자
//   POST   { order_id, vat_kind: taxable|exempt|mixed, taxable_amount?, reason: { code, text } }
//          → 주문에 붙은 통장 입금 중 분류 전인 것을 상품매출(4001)로 확정 + 처리 기록. 다른 계정으로 분류된 입금이 있으면 거부
//   DELETE { order_id, reason } → 해제(사유 필수). 이 처리로 확정한 입금은 처리 전 상태로
const DENY = '증빙 없이 처리는 수금 · 정산 작업 수정 권한이 필요합니다. 경영지원팀 오철준 대리 또는 ERP 담당에게 요청해주세요.'

async function guard() {
  const me = await getCurrentUser()
  if (!me) return { res: NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  if (!can(me, 'collections', 'edit')) return { res: NextResponse.json({ error: DENY }, { status: 403 }) }
  return { me, editor: { employeeId: me.employeeId, employeeName: me.employeeName } }
}

export async function POST(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { order_id?: string; vat_kind?: string; taxable_amount?: number; reason?: unknown }
  if (!body.order_id) return NextResponse.json({ error: 'order_id가 필요합니다.' }, { status: 400 })
  const vat = (['taxable', 'exempt', 'mixed'] as const).find(v => v === body.vat_kind) as NoEvidenceVat | undefined
  if (!vat) return NextResponse.json({ error: '과세 구분을 고르세요.' }, { status: 400 })
  const reason = resolveReason('no_evidence', body.reason)
  if ('error' in reason) return NextResponse.json({ error: reason.error }, { status: 400 })
  const r = await processNoEvidence(createAdminClient(), body.order_id, { vat_kind: vat, taxable_amount: body.taxable_amount ?? null, reason }, g.editor, g.me.userId)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}

export async function DELETE(req: NextRequest) {
  const g = await guard(); if ('res' in g) return g.res
  const body = await req.json().catch(() => ({})) as { order_id?: string; reason?: unknown }
  if (!body.order_id) return NextResponse.json({ error: 'order_id가 필요합니다.' }, { status: 400 })
  const reason = resolveReason('no_evidence_release', body.reason)
  if ('error' in reason) return NextResponse.json({ error: reason.error }, { status: 400 })
  const r = await releaseNoEvidence(createAdminClient(), body.order_id, reason, g.editor)
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: 400 })
  return NextResponse.json(r)
}
