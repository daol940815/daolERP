import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import { decryptPayment, encryptPayment, encryptionReady, maskPayment } from '@/lib/payment-crypto'
import { parseConsultBody, consultItemRows, insertConsultItems, compatConsultFields, CONSULT_509_HINT } from '@/lib/consultations'
import { recordWorkLog, consultContent } from '@/lib/work-log'

export const dynamic = 'force-dynamic'

// 상담일지 상세·수정·상태 변경
// GET  — 상세 (결제정보는 마스킹, ?reveal=1이면 전체 표시 — 본인/manager/admin)
// PATCH — 본문·품목 수정 (본인, 주문전환 상태는 잠금) / { action: 'close'|'reopen' } 상태 변경
// DELETE — 본인, 진행중 상태만

type Row = Record<string, unknown>

const canAccess = (c: Row, me: CurrentUser) =>
  me.role !== 'sales' || (!!me.employeeId && c.employee_id === me.employeeId)

async function loadConsult(id: string) {
  const admin = createAdminClient()
  const { data: consult, error } = await admin.from('erp_consultations').select('*').eq('id', id).maybeSingle()
  if (error || !consult) return null
  const { data: items } = await admin.from('erp_consultation_items')
    .select('*').eq('consultation_id', id).order('line_no')
  return { consult, items: items ?? [] }
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const snap = await loadConsult(params.id)
  if (!snap) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  if (!canAccess(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지만 볼 수 있습니다.' }, { status: 403 })
  }

  const reveal = new URL(req.url).searchParams.get('reveal') === '1'
  const { payment_info_enc, ...rest } = snap.consult as Row & { payment_info_enc: string | null }
  let payment: string | null = null
  let paymentMasked: string | null = null
  if (payment_info_enc) {
    const plain = decryptPayment(payment_info_enc)
    if (plain === null) paymentMasked = '(복호화 실패 — 암호화 키 확인 필요)'
    else {
      paymentMasked = maskPayment(plain)
      if (reveal) payment = plain
    }
  }

  const admin = createAdminClient()
  const { data: orders } = await admin.from('erp_orders')
    .select('id, order_no, order_date, total_amount')
    .eq('consultation_id', params.id).order('order_date', { ascending: false })

  return NextResponse.json({
    consult: rest,
    items: snap.items,
    payment_masked: paymentMasked,
    payment: reveal ? payment : undefined,
    orders: orders ?? [],          // 이 상담에서 전환된 주문들
    role: me.role,
    is_owner: !!me.employeeId && snap.consult.employee_id === me.employeeId,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const snap = await loadConsult(params.id)
  if (!snap) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  if (!canAccess(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지만 수정할 수 있습니다.' }, { status: 403 })
  }
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  // 상태 변경 (종결/재개)
  if (body.action === 'close' || body.action === 'reopen') {
    if (snap.consult.status === '주문전환') {
      return NextResponse.json({ error: '주문 전환된 상담은 상태를 바꿀 수 없습니다.' }, { status: 409 })
    }
    const { error } = await admin.from('erp_consultations')
      .update({ status: body.action === 'close' ? '종결' : '진행중' }).eq('id', params.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // 본문 수정 — 주문 전환된 상담은 잠금 (이력 보존)
  if (snap.consult.status === '주문전환') {
    return NextResponse.json({ error: '주문 전환된 상담일지는 수정할 수 없습니다. (이력 보존)' }, { status: 409 })
  }
  const parsed = parseConsultBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 결제정보: 빈 값이면 기존 유지, '__clear__'면 삭제, 새 값이면 재암호화
  let paymentEnc = (snap.consult as Row).payment_info_enc as string | null
  if (parsed.paymentPlain === '__clear__') paymentEnc = null
  else if (parsed.paymentPlain) {
    if (!encryptionReady()) {
      return NextResponse.json({ error: '결제정보 암호화 키(PAYMENT_ENC_KEY)가 설정되지 않았습니다.' }, { status: 400 })
    }
    paymentEnc = encryptPayment(parsed.paymentPlain)
  }

  const { error } = await admin.from('erp_consultations')
    .update({ ...compatConsultFields(parsed.fields), payment_info_enc: paymentEnc }).eq('id', params.id)
  if (error) {
    if (/invoice_email|biz_number|ceo_name|fax/i.test(error.message)) {
      return NextResponse.json({ error: CONSULT_509_HINT }, { status: 500 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: dErr } = await admin.from('erp_consultation_items')
    .delete().eq('consultation_id', params.id)
  if (dErr) return NextResponse.json({ error: `품목 교체 실패: ${dErr.message}` }, { status: 500 })
  const itemErr = await insertConsultItems(admin, params.id, consultItemRows(parsed.items))
  if (itemErr) return NextResponse.json({ error: `품목 저장 실패: ${itemErr}` }, { status: 500 })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: '상담수정',
    content: consultContent(parsed.fields, '상담 내용 수정'),
    refType: 'consultation',
    refId: params.id,
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const snap = await loadConsult(params.id)
  if (!snap) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  if (!canAccess(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지만 삭제할 수 있습니다.' }, { status: 403 })
  }
  if (snap.consult.status !== '진행중') {
    return NextResponse.json({ error: '진행중 상태의 상담만 삭제할 수 있습니다.' }, { status: 409 })
  }
  const { error } = await admin.from('erp_consultations').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
