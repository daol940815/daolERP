import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { applyIndividualToConsultFields } from '@/lib/individual-customer'
import { getCurrentUser, type CurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { decryptPayment, encryptPayment, encryptionReady, maskPayment } from '@/lib/payment-crypto'
import { parseConsultBody, consultItemRows, insertConsultItems, compatConsultFields, CONSULT_509_HINT, CONSULT_706_HINT } from '@/lib/consultations'
import { fillContactPhonesIfEmpty } from '@/lib/contact-phone-sync'
import { recordWorkLog, consultContent } from '@/lib/work-log'
import { isOrderAssignee, parseOrderRequest, saveOrderRequest } from '@/lib/order-request'
import { loadConsultReqMap, saveConsultUnable, CONSULT_REQ_LABEL } from '@/lib/order-reply'
import { REASON_MAX } from '@/lib/cancel-reasons'

export const dynamic = 'force-dynamic'

// 상담일지 상세·수정·상태 변경
// GET  — 상세 (결제정보는 마스킹, ?reveal=1이면 전체 표시 — 본인/manager/admin)
// PATCH — 본문·품목 수정 (본인, 주문전환 · 종결 상태는 잠금) / { action: 'close', reason }|{ action: 'reopen' } 상태 변경
// DELETE ?reason= — 본인, 진행중 상태만. 숨김 삭제(709): 행은 남기고 deleted_* 기록
//  (2026-11-10 사용자 결정: 종결 · 삭제 사유 필수, 종결 상담 수정 잠금, 삭제는 숨김)

type Row = Record<string, unknown>

// 타인 상담 열람은 관리자급(isManagerLike — 승인권·마스터 포함, 109) 판정. role 직접 판정 금지.
const canAccess = (c: Row, me: CurrentUser) =>
  isManagerLike(me) || (!!me.employeeId && c.employee_id === me.employeeId)
// 열람 = 위 + 주문 진행 요청을 받은 직원 (705, 2026-11-05 — 요청받은 직원은 열람 · 전환만, 수정 불가)
const canView = (c: Row, me: CurrentUser) => canAccess(c, me) || isOrderAssignee(c, me.employeeId)

// 마스터 연결 완료 = 지점·담당자 모두 연결 (주문 전환 가능 조건과 동일)
const masterLinked = (c: Row) => !!c.vendor_id && !!c.contact_id

// 아르바이트는 마스터 미연결 상담 접근 불가 ((b) 정책, 2026-09-29 사용자 확정)
const parttimeBlocked = (c: Row, me: CurrentUser) =>
  me.employmentType === 'parttime' && !masterLinked(c)
const PARTTIME_MSG = '아르바이트 계정은 마스터 미연결 상담을 열 수 없습니다. 담당 직원에게 요청해주세요.'
const CONSULT_709_HINT = '709 마이그레이션(상담 종결 · 삭제 기록)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
const is709Missing = (m: string) => /closed_at|closed_by|close_reason|deleted_at|deleted_by|delete_reason/i.test(m)
const DELETED_MSG = '삭제된 상담일지입니다.'
const where = (c: Row) => [c.bank_name, c.branch_name, c.manager_name].filter(Boolean).join(' ')

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
  if (!canView(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지(또는 나에게 주문 진행이 요청된 상담)만 볼 수 있습니다.' }, { status: 403 })
  }
  if (parttimeBlocked(snap.consult, me)) {
    return NextResponse.json({ error: PARTTIME_MSG }, { status: 403 })
  }
  // 숨김 삭제된 상담은 관리자급만 연다 (목록 '삭제된 것 보기'와 같은 범위)
  if (snap.consult.deleted_at && !isManagerLike(me)) {
    return NextResponse.json({ error: DELETED_MSG }, { status: 404 })
  }

  // 결제정보 열람: 본인 작성분 또는 can_view_payment_info 계정만 ((b) 정책)
  const isOwner = !!me.employeeId && snap.consult.employee_id === me.employeeId
  const canPayment = isOwner || me.canViewPaymentInfo
  const reveal = new URL(req.url).searchParams.get('reveal') === '1' && canPayment
  const { payment_info_enc, ...rest } = snap.consult as Row & { payment_info_enc: string | null }
  let payment: string | null = null
  let paymentMasked: string | null = null
  if (payment_info_enc && canPayment) {
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

  // 주문 진행 요청 표시용 이름 (705)
  const c = snap.consult as Row
  const nameIds = [c.order_assignee_id, c.order_requested_by, c.closed_by, c.deleted_by].filter(Boolean) as string[]
  const names = new Map<string, string>()
  if (nameIds.length) {
    const { data: emps } = await admin.from('employees').select('id, name').in('id', nameIds)
    for (const e of emps ?? []) names.set(e.id as string, e.name as string)
  }
  const orderRequest = c.order_assignee_id ? {
    assignee_id: c.order_assignee_id as string,
    assignee_name: names.get(c.order_assignee_id as string) ?? null,
    requested_by_name: c.order_requested_by ? names.get(c.order_requested_by as string) ?? null : null,
    requested_at: (c.order_requested_at as string | null) ?? null,
    memo: (c.order_request_memo as string | null) ?? null,
  } : null

  // 요청 진행 상태 (515 완료 회신): 요청됨 / 처리 불가(되돌아옴) / 회신 대기 / 완료 · 변경 · 처리 불가 회신
  const reqInfo = (await loadConsultReqMap(admin, [c as unknown as Parameters<typeof loadConsultReqMap>[1][number]])).get(params.id) ?? null
  const requestStatus = reqInfo ? {
    state: reqInfo.state, label: CONSULT_REQ_LABEL[reqInfo.state],
    memo: reqInfo.last_memo, by: reqInfo.last_by, at: reqInfo.last_at,
    requested_by_name: c.order_requested_by ? names.get(c.order_requested_by as string) ?? null : null,
  } : null
  // 전환 전 처리 불가 회신: 요청받은 직원 또는 관리자급(요청자 본인 제외)
  const canUnable = c.status === '진행중' && !!c.order_assignee_id
    && (isOrderAssignee(c, me.employeeId) || (isManagerLike(me) && c.order_requested_by !== me.employeeId))

  return NextResponse.json({
    consult: rest,
    items: snap.items,
    order_request: orderRequest,
    request_status: requestStatus,
    can_unable: canUnable,
    // 종결 · 삭제 기록 (709)
    closed_by_name: c.closed_by ? names.get(c.closed_by as string) ?? null : null,
    deleted_by_name: c.deleted_by ? names.get(c.deleted_by as string) ?? null : null,
    can_edit: canAccess(snap.consult, me),                 // 작성자 · 관리자급 — 요청받은 직원은 false
    is_assignee: isOrderAssignee(snap.consult, me.employeeId),
    payment_masked: paymentMasked,
    payment: reveal ? payment : undefined,
    payment_locked: !!payment_info_enc && !canPayment,   // 저장돼 있으나 열람 권한 없음
    orders: orders ?? [],          // 이 상담에서 전환된 주문들
    role: me.role,
    is_parttime: me.employmentType === 'parttime',
    is_owner: isOwner,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const snap = await loadConsult(params.id)
  if (!snap) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const editor = { employeeId: me.employeeId, employeeName: me.employeeName }
  if (snap.consult.deleted_at) return NextResponse.json({ error: DELETED_MSG }, { status: 409 })

  // 처리 불가 회신 (515) — 요청받은 직원(수정 권한 없음)도 가능. 요청은 요청자에게 되돌아간다
  if (body.action === 'unable') {
    const c = snap.consult as Row
    const allowed = isOrderAssignee(c, me.employeeId) || (isManagerLike(me) && c.order_requested_by !== me.employeeId)
    if (!allowed) return NextResponse.json({ error: '나에게 주문 진행이 요청된 상담만 처리 불가 회신을 보낼 수 있습니다.' }, { status: 403 })
    const err = await saveConsultUnable(admin, params.id, String(body.memo ?? '').trim() || null, editor)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (!canAccess(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지만 수정할 수 있습니다.' }, { status: 403 })
  }
  if (parttimeBlocked(snap.consult, me)) {
    return NextResponse.json({ error: PARTTIME_MSG }, { status: 403 })
  }

  // 주문 진행 요청만 변경 (목록 행 "요청" 버튼) — 작성자 · 관리자급
  if (body.action === 'request') {
    if (snap.consult.status !== '진행중') {
      return NextResponse.json({ error: '진행중인 상담만 주문 진행을 요청할 수 있습니다.' }, { status: 409 })
    }
    const input = parseOrderRequest(body.order_request) ?? { assignee_id: null, memo: null }
    const err = await saveOrderRequest(admin, params.id, input, editor)
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  // 상태 변경 (종결/재개) — 종결은 사유 필수 + 종결한 사람 · 시각 기록 (709), 재개하면 기록을 비우고 업무일지에 남긴다
  if (body.action === 'close' || body.action === 'reopen') {
    const c = snap.consult as Row
    if (c.status === '주문전환') {
      return NextResponse.json({ error: '주문 전환된 상담은 상태를 바꿀 수 없습니다.' }, { status: 409 })
    }
    if (body.action === 'close') {
      if (c.status !== '진행중') return NextResponse.json({ error: '이미 종결된 상담입니다.' }, { status: 409 })
      const reason = String(body.reason ?? '').trim().slice(0, REASON_MAX)
      if (!reason) return NextResponse.json({ error: '종결 사유를 고르거나 적어주세요.' }, { status: 400 })
      const { error } = await admin.from('erp_consultations').update({
        status: '종결', closed_at: new Date().toISOString(), closed_by: me.employeeId, close_reason: reason,
      }).eq('id', params.id)
      if (error) return NextResponse.json({ error: is709Missing(error.message) ? CONSULT_709_HINT : error.message }, { status: 500 })
      await recordWorkLog(admin, {
        employeeId: me.employeeId, action: '상담수정',   // 700 CHECK 범위 안에서 기재 — 내용으로 구분
        content: `${where(c) ? `${where(c)} ` : ''}상담 종결 (${reason})`,
        refType: 'consultation', refId: params.id,
      })
      return NextResponse.json({ ok: true })
    }
    if (c.status !== '종결') return NextResponse.json({ error: '종결된 상담만 재개할 수 있습니다.' }, { status: 409 })
    const { error } = await admin.from('erp_consultations').update({
      status: '진행중', closed_at: null, closed_by: null, close_reason: null,
    }).eq('id', params.id)
    if (error) return NextResponse.json({ error: is709Missing(error.message) ? CONSULT_709_HINT : error.message }, { status: 500 })
    const prev = (c.close_reason as string | null) ?? null
    await recordWorkLog(admin, {
      employeeId: me.employeeId, action: '상담수정',
      content: `${where(c) ? `${where(c)} ` : ''}상담 재개${prev ? ` (이전 종결 사유: ${prev})` : ''}`,
      refType: 'consultation', refId: params.id,
    })
    return NextResponse.json({ ok: true })
  }

  // 본문 수정 — 주문 전환된 상담은 잠금 (이력 보존), 종결된 상담도 잠금 (재개 후 수정, 2026-11-10)
  if (snap.consult.status === '주문전환') {
    return NextResponse.json({ error: '주문 전환된 상담일지는 수정할 수 없습니다. (이력 보존)' }, { status: 409 })
  }
  if (snap.consult.status === '종결') {
    return NextResponse.json({ error: '종결된 상담일지는 수정할 수 없습니다. 고치려면 먼저 재개하세요.' }, { status: 409 })
  }
  const parsed = parseConsultBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })
  // 개인 고객(115): 업체 '개인'이면 고객 전용 매출처로 (지점 공란)
  await applyIndividualToConsultFields(admin, parsed.fields)

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
    if (/ship_name|ship_phone|ship_zip|ship_addr/i.test(error.message)) {
      return NextResponse.json({ error: CONSULT_706_HINT }, { status: 500 })
    }
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
  // 담당자 연락처 → 인물 마스터 (116, 빈 칸만)
  const phoneFilled = await fillContactPhonesIfEmpty(admin, parsed.fields.contact_id, { phone: parsed.fields.phone, tel: parsed.fields.tel })

  await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: '상담수정',
    content: consultContent(parsed.fields, '상담 내용 수정'),
    refType: 'consultation',
    refId: params.id,
  })
  // 주문 진행 요청 (705) — 본문은 저장된 상태로 두고 요청 실패만 따로 알려준다
  const orderReq = parseOrderRequest(body.order_request)
  const requestError = orderReq ? await saveOrderRequest(admin, params.id, orderReq, editor) : null
  return NextResponse.json({ ok: true, request_error: requestError, phone_filled: phoneFilled })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const snap = await loadConsult(params.id)
  if (!snap) return NextResponse.json({ error: '상담일지를 찾을 수 없습니다.' }, { status: 404 })
  if (!canAccess(snap.consult, me)) {
    return NextResponse.json({ error: '본인 작성 상담일지만 삭제할 수 있습니다.' }, { status: 403 })
  }
  if (parttimeBlocked(snap.consult, me)) {
    return NextResponse.json({ error: PARTTIME_MSG }, { status: 403 })
  }
  if (snap.consult.deleted_at) return NextResponse.json({ error: '이미 삭제된 상담일지입니다.' }, { status: 409 })
  if (snap.consult.status !== '진행중') {
    return NextResponse.json({ error: '진행중 상태의 상담만 삭제할 수 있습니다.' }, { status: 409 })
  }
  // 숨김 삭제 (709) — 사유 필수, 행 · 품목은 보존
  const reason = (new URL(req.url).searchParams.get('reason') ?? '').trim().slice(0, REASON_MAX)
  if (!reason) return NextResponse.json({ error: '삭제 사유를 고르거나 적어주세요.' }, { status: 400 })
  const { error } = await admin.from('erp_consultations').update({
    deleted_at: new Date().toISOString(), deleted_by: me.employeeId, delete_reason: reason,
  }).eq('id', params.id)
  if (error) return NextResponse.json({ error: is709Missing(error.message) ? CONSULT_709_HINT : error.message }, { status: 500 })
  const c = snap.consult as Row
  await recordWorkLog(admin, {
    employeeId: me.employeeId, action: '상담수정',
    content: `${where(c) ? `${where(c)} ` : ''}상담일지 삭제 (${reason})`,
    refType: 'consultation', refId: params.id,
  })
  return NextResponse.json({ ok: true })
}
