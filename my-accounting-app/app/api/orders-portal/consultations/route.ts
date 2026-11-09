import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { applyIndividualToConsultFields } from '@/lib/individual-customer'
import { getCurrentUser } from '@/lib/user-role'
import { isManagerLike } from '@/lib/permissions'
import { encryptPayment, encryptionReady } from '@/lib/payment-crypto'
import { parseConsultBody, consultItemRows, insertConsultItems, compatConsultFields, CONSULT_MIGRATION_HINT, CONSULT_509_HINT, CONSULT_706_HINT } from '@/lib/consultations'
import { fillContactPhonesIfEmpty } from '@/lib/contact-phone-sync'
import { recordWorkLog, consultContent } from '@/lib/work-log'
import { resolveContact } from '@/lib/contact-resolve'
import { parseOrderRequest, saveOrderRequest } from '@/lib/order-request'
import { loadConsultReqMap, CONSULT_REQ_LABEL, type ConsultReqRow } from '@/lib/order-reply'

export const dynamic = 'force-dynamic'

// 상담일지 (사용자 확정 설계)
// GET  ?q=&status=&type=&all=1&page=1 — 기본 본인 작성분, manager/admin은 all=1로 전체
// POST — 상담 생성. 필수는 상담일·구분뿐 (아는 만큼만 기록).
//        저장 시 업무일지(erp_work_logs)에 '상담작성' 한 줄 자동 기재.

const PER_PAGE = 50
const MIGRATION_HINT = CONSULT_MIGRATION_HINT

export async function GET(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const q = (sp.get('q') ?? '').trim().toLowerCase()
  const status = sp.get('status') ?? 'all'
  const type = sp.get('type') ?? 'all'
  const all = sp.get('all') === '1' && isManagerLike(me)   // 전체 보기 = 관리자급 (role 직접 판정 금지, 109)
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  // 주문 진행 요청 (705, 2026-11-05): scope = mine(내가 쓴 것 + 나에게 요청된 것) | assigned(나에게 요청 · 진행 대기)
  //   | requested(내가 요청 · 진행 대기) | done(요청 완료 · 이번 달 요청분). 705 미적용이면 요청 열 없이 기존 동작.
  const scope = sp.get('scope') ?? 'mine'
  const me705 = me.employeeId
  const monthStart = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date()).slice(0, 8) + '01'
  // 705 적용 후에는 상담일지 → 직원 연결이 여럿이라 작성자 연결을 이름으로 지정, 미적용이면 예전처럼(연결 1개)
  const baseCols = (with705: boolean) => 'id, consult_date, consult_type, bank_name, branch_name, manager_name, phone, tel, sender_name, vendor_id, contact_id, status, employee_id, memo, created_at, '
    + (with705 ? 'writer:employees!erp_consultations_employee_id_fkey(name)' : 'writer:employees(name)')
  const reqCols = ', order_assignee_id, order_requested_by, order_requested_at, order_request_memo, assignee:employees!erp_consultations_order_assignee_id_fkey(name), requester:employees!erp_consultations_order_requested_by_fkey(name)'
  const build = (with705: boolean) => {
    let query = admin.from('erp_consultations')
      .select(baseCols(with705) + (with705 ? reqCols : ''))
      .order('consult_date', { ascending: false })
      .order('created_at', { ascending: false })
    if (!all || scope !== 'mine') {
      if (!with705 || scope === 'mine') {
        query = with705
          ? query.or(`employee_id.eq.${me705},order_assignee_id.eq.${me705}`)
          : query.eq('employee_id', me705!)
      } else if (scope === 'assigned') {
        query = query.eq('order_assignee_id', me705!).eq('status', '진행중')
      } else if (scope === 'requested') {
        query = query.eq('order_requested_by', me705!).eq('status', '진행중')
      } else if (scope === 'done') {
        query = query.or(`order_requested_by.eq.${me705},order_assignee_id.eq.${me705}`)
          .not('order_assignee_id', 'is', null).eq('status', '주문전환').gte('order_requested_at', monthStart)
      }
    }
    if (status !== 'all') query = query.eq('status', status)
    if (type !== 'all') query = query.eq('consult_type', type)
    return query.limit(2000)
  }
  if (!all && !me.employeeId) return NextResponse.json({ rows: [], page: 1, total_pages: 1, total: 0 })
  let res = await build(true)
  const has705 = !res.error
  if (res.error && /order_|relationship|assignee|requester/i.test(res.error.message)) res = await build(false)
  const { data, error } = res as unknown as { data: Record<string, unknown>[] | null; error: { message: string } | null }

  // 요청 카드 숫자 (705 적용 시)
  let requestKpi: { mine: number; assigned: number; requested: number; done: number } | null = null
  if (has705 && me705) {
    const cnt = (q: PromiseLike<{ count: number | null }>) => q.then(r => r.count ?? 0)
    const head = () => admin.from('erp_consultations').select('id', { count: 'exact', head: true })
    const [mine, assigned, requested, done] = await Promise.all([
      cnt(head().or(`employee_id.eq.${me705},order_assignee_id.eq.${me705}`)),
      cnt(head().eq('order_assignee_id', me705).eq('status', '진행중')),
      cnt(head().eq('order_requested_by', me705).eq('status', '진행중')),
      cnt(head().or(`order_requested_by.eq.${me705},order_assignee_id.eq.${me705}`).not('order_assignee_id', 'is', null).eq('status', '주문전환').gte('order_requested_at', monthStart)),
    ])
    requestKpi = { mine, assigned, requested, done }
  }
  if (error) {
    const missing = /relation|erp_consultations|does not exist/i.test(error.message)
    return NextResponse.json({ error: missing ? MIGRATION_HINT : error.message }, { status: 500 })
  }

  // 품목 로드 — 목록은 품목 행 단위 (실무자 피드백 7, 2안: 상품 1개 = 1줄,
  // 부자재(옵션 행)·배송비 행은 줄로 만들지 않고 본 상품 줄만)
  const ids = (data ?? []).map(r => r.id as string)
  type ItemRow = {
    consultation_id: string; line_no: number; parent_line_no: number | null
    item_name: string | null; quantity: number; line_total: number
    discount_amount: number; status: string | null; is_shipping: boolean | null
  }
  const byConsult = new Map<string, ItemRow[]>()
  const totals = new Map<string, number>()
  const CHUNK = 150
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: items } = await admin.from('erp_consultation_items')
      .select('consultation_id, line_no, parent_line_no, item_name, quantity, line_total, discount_amount, status, is_shipping')
      .in('consultation_id', ids.slice(i, i + CHUNK)).order('line_no')
    for (const raw of (items ?? []) as unknown as ItemRow[]) {
      const arr = byConsult.get(raw.consultation_id)
      if (arr) arr.push(raw)
      else byConsult.set(raw.consultation_id, [raw])
      totals.set(raw.consultation_id, (totals.get(raw.consultation_id) ?? 0) + (raw.line_total ?? 0))
    }
  }

  // 요청 진행 상태 (515 완료 회신) — 요청됨 / 처리 불가 / 회신 대기 / 완료 …
  const reqMap = has705 ? await loadConsultReqMap(admin, (data ?? []) as unknown as ConsultReqRow[]) : new Map()

  // 상담 × 본 상품 → 행 전개. 품목 없는 상담도 1줄은 남긴다.
  let rows = (data ?? []).flatMap(r => {
    const nm = (v: unknown) => (Array.isArray(v) ? v[0]?.name : (v as { name?: string } | null)?.name) ?? null
    const base = {
      ...r,
      writer: nm(r.writer),
      assignee_name: nm(r.assignee),          // 주문 진행 담당 (705)
      requester_name: nm(r.requester),
      req_state: reqMap.get(r.id as string)?.state ?? null,
      req_label: reqMap.has(r.id as string) ? CONSULT_REQ_LABEL[reqMap.get(r.id as string)!.state as keyof typeof CONSULT_REQ_LABEL] : null,
      req_reply_by: reqMap.get(r.id as string)?.last_by ?? null,
      assigned_to_me: !!me.employeeId && r.order_assignee_id === me.employeeId,
      is_owner: !!me.employeeId && r.employee_id === me.employeeId,
      consult_total: totals.get(r.id as string) ?? 0,     // 상담 전체 합계 (전 품목·옵션·배송비 포함)
      // (b) 정책: 지점·담당자가 모두 마스터에 연결된 상담만 주문 전환 가능
      master_linked: !!r.vendor_id && !!r.contact_id,
    }
    const mains = (byConsult.get(r.id as string) ?? [])
      .filter(it => it.parent_line_no == null && it.is_shipping !== true)
    if (!mains.length) {
      return [{
        ...base, line_no: null as number | null, item_name: null as string | null,
        quantity: 0, line_total: 0, has_discount: false, item_status: null as string | null,
        line_count: 0,
      }]
    }
    return mains.map(it => ({
      ...base,
      line_no: it.line_no,
      item_name: it.item_name,
      quantity: it.quantity ?? 0,
      line_total: it.line_total ?? 0,
      has_discount: (it.discount_amount ?? 0) > 0,
      item_status: it.status ?? null,           // '단가변경'·'품절' 등 배지 표시용
      line_count: mains.length,
    }))
  })
  if (q) {
    const terms = q.split(/[\s,]+/).filter(Boolean)
    rows = rows.filter(r => terms.every(t =>
      (['bank_name', 'branch_name', 'manager_name', 'phone', 'tel', 'sender_name', 'item_name', 'memo'] as const)
        .some(k => String((r as Record<string, unknown>)[k] ?? '').toLowerCase().includes(t))))
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  return NextResponse.json({
    rows: rows.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    page, total_pages: totalPages, total: rows.length, role: me.role,
    manager: isManagerLike(me),
    is_parttime: me.employmentType === 'parttime',
    request_kpi: requestKpi,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const parsed = parseConsultBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

  // 개인 고객(115): 업체 '개인'이면 고객 전용 매출처로 (지점 공란) — 일반 판별보다 먼저
  await applyIndividualToConsultFields(admin, parsed.fields)

  // 인물 자동 판별 (2026-10-16): 담당자를 마스터에서 고르지 않고 이름만 적어도
  // 거래처가 특정되면 자동으로 인물을 찾거나 만들어 연결한다. 실패해도 저장은 계속.
  if (!parsed.fields.contact_id && parsed.fields.vendor_id && parsed.fields.manager_name) {
    const r = await resolveContact(admin, {
      vendorId: parsed.fields.vendor_id,
      rawName: parsed.fields.manager_name,
      phone: parsed.fields.phone,
      tel: parsed.fields.tel,
      source: 'consultation',
      eventDate: parsed.fields.consult_date,
    })
    if (r) parsed.fields.contact_id = r.contactId
  }

  let paymentEnc: string | null = null
  if (parsed.paymentPlain) {
    if (!encryptionReady()) {
      return NextResponse.json({
        error: '결제정보 암호화 키(PAYMENT_ENC_KEY)가 설정되지 않았습니다. Vercel 환경변수에 추가 후 다시 시도하거나, 결제정보를 비우고 저장해주세요.',
      }, { status: 400 })
    }
    paymentEnc = encryptPayment(parsed.paymentPlain)
  }

  const { data: created, error } = await admin.from('erp_consultations').insert({
    ...compatConsultFields(parsed.fields),
    payment_info_enc: paymentEnc,
    employee_id: me.employeeId,
  }).select('id').single()
  if (error) {
    if (/ship_name|ship_phone|ship_zip|ship_addr/i.test(error.message)) {
      return NextResponse.json({ error: CONSULT_706_HINT }, { status: 500 })
    }
    if (/invoice_email|biz_number|ceo_name|fax/i.test(error.message)) {
      return NextResponse.json({ error: CONSULT_509_HINT }, { status: 500 })
    }
    const missing = /relation|erp_consultations|does not exist/i.test(error.message)
    return NextResponse.json({ error: missing ? MIGRATION_HINT : error.message }, { status: 500 })
  }

  const itemErr = await insertConsultItems(admin, created.id as string, consultItemRows(parsed.items))
  if (itemErr) {
    await admin.from('erp_consultations').delete().eq('id', created.id)
    return NextResponse.json({ error: `품목 저장 실패: ${itemErr}` }, { status: 500 })
  }

  // 담당자 연락처 → 인물 마스터 (116, 빈 칸만) — 다음 상담·주문에서 담당자를 고르면 바로 채워지게
  const phoneFilled = await fillContactPhonesIfEmpty(admin, parsed.fields.contact_id, { phone: parsed.fields.phone, tel: parsed.fields.tel })

  // 업무일지 자동 기재 (실패해도 상담 저장은 유지)
  // 영업일지(contact_activities)가 아니라 업무일지 — 상담일지 작성은 "ERP에서 한 업무"다.
  const workLogged = await recordWorkLog(admin, {
    employeeId: me.employeeId,
    action: '상담작성',
    content: consultContent(parsed.fields, '상담'),
    workDate: parsed.fields.consult_date,
    refType: 'consultation',
    refId: created.id as string,
  })

  // 주문 진행 요청 (705) — 상담은 저장된 상태로 두고, 요청 실패는 따로 알려준다
  const orderReq = parseOrderRequest(body.order_request)
  const requestError = orderReq?.assignee_id
    ? await saveOrderRequest(admin, created.id as string, orderReq, { employeeId: me.employeeId, employeeName: me.employeeName })
    : null

  return NextResponse.json({ id: created.id, work_logged: workLogged, request_error: requestError, phone_filled: phoneFilled })
}
