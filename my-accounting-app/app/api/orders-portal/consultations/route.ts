import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { encryptPayment, encryptionReady } from '@/lib/payment-crypto'
import { parseConsultBody, consultItemRows, insertConsultItems, compatConsultFields, CONSULT_MIGRATION_HINT, CONSULT_509_HINT } from '@/lib/consultations'
import { recordWorkLog, consultContent } from '@/lib/work-log'

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
  const all = sp.get('all') === '1' && me.role !== 'sales'
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)

  let query = admin.from('erp_consultations')
    .select('id, consult_date, consult_type, bank_name, branch_name, manager_name, status, employee_id, memo, created_at, employees(name)')
    .order('consult_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (!all) {
    if (!me.employeeId) return NextResponse.json({ rows: [], page: 1, total_pages: 1, total: 0 })
    query = query.eq('employee_id', me.employeeId)
  }
  if (status !== 'all') query = query.eq('status', status)
  if (type !== 'all') query = query.eq('consult_type', type)

  const { data, error } = await query.limit(2000)
  if (error) {
    const missing = /relation|erp_consultations|does not exist/i.test(error.message)
    return NextResponse.json({ error: missing ? MIGRATION_HINT : error.message }, { status: 500 })
  }

  // 품목 요약·합계 (표시용)
  const ids = (data ?? []).map(r => r.id)
  const summary = new Map<string, { first: string | null; count: number; total: number }>()
  const CHUNK = 150
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data: items } = await admin.from('erp_consultation_items')
      .select('consultation_id, item_name, line_total, line_no')
      .in('consultation_id', ids.slice(i, i + CHUNK)).order('line_no')
    for (const it of items ?? []) {
      const cur = summary.get(it.consultation_id as string)
      if (cur) { cur.count += 1; cur.total += (it.line_total as number) ?? 0 }
      else summary.set(it.consultation_id as string, {
        first: (it.item_name as string) ?? null, count: 1, total: (it.line_total as number) ?? 0,
      })
    }
  }

  // 검색 (메모리 — 다중 조건 AND)
  let rows = (data ?? []).map(r => {
    const s = summary.get(r.id)
    return {
      ...r,
      writer: (r.employees as unknown as { name: string } | null)?.name ?? null,
      item_summary: s ? (s.count > 1 ? `${s.first} 외 ${s.count - 1}건` : s.first) : null,
      item_total: s?.total ?? 0,
    }
  })
  if (q) {
    const terms = q.split(/[\s,]+/).filter(Boolean)
    rows = rows.filter(r => terms.every(t =>
      [r.bank_name, r.branch_name, r.manager_name, r.item_summary, r.memo]
        .some(v => (v ?? '').toLowerCase().includes(t))))
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PER_PAGE))
  return NextResponse.json({
    rows: rows.slice((page - 1) * PER_PAGE, page * PER_PAGE),
    page, total_pages: totalPages, total: rows.length, role: me.role,
  })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>

  const parsed = parseConsultBody(body)
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 })

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

  return NextResponse.json({ id: created.id, work_logged: workLogged })
}
