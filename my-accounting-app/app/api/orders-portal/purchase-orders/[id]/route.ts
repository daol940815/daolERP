import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildPoExcel, sendPoMail, smtpReady } from '@/lib/purchase-orders'
import { fillMailTemplate, poMailVars } from '@/lib/po-form'

export const dynamic = 'force-dynamic'

// 발주서 1건 — 조회(?excel=1 = 엑셀 다운로드) / 발송·취소 처리. 전 직원 사용 가능
// (2026-08-13 사용자 결정: 매입가 전 직원 공개).
// PATCH { action: 'send_email' | 'manual_sent' | 'cancel' | 'update', ... }
//  - send_email: { to? } — 엑셀 첨부 메일 발송 (성공·실패 이력 보존)
//  - manual_sent: 자체 양식 등 수동 발송 완료 기록
//  - cancel: 발주 취소 — 품목은 미발주로 복귀 (이력은 보존)
//  - update: { delivery_note?, email_to? } — 발송 전 내용 보정

interface PoRecord {
  id: string
  po_no: string
  order_id: string
  vendor_id: string | null
  vendor_name: string
  total_amount: number
  delivery_note: string | null
  email_to: string | null
  send_method: string | null
  sent_at: string | null
  status: string
  created_at: string
  creator: { name: string; phone: string | null } | { name: string; phone: string | null }[] | null
  vendor?: { uses_custom_po: boolean; po_use_sale_price?: boolean } | { uses_custom_po: boolean; po_use_sale_price?: boolean }[] | null
}
const one = <T,>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

async function loadPo(admin: SupabaseClient, id: string) {
  const sel = (withFlags: boolean) => admin.from('erp_purchase_orders')
    .select((withFlags
      ? 'id, po_no, order_id, vendor_id, vendor_name, total_amount, delivery_note, email_to, send_method, sent_at, status, created_at, creator:employees!erp_purchase_orders_created_by_fkey(name, phone), vendor:vendors(uses_custom_po, po_use_sale_price)'
      : 'id, po_no, order_id, vendor_id, vendor_name, total_amount, delivery_note, email_to, send_method, sent_at, status, created_at, creator:employees!erp_purchase_orders_created_by_fkey(name, phone)') as string)
    .eq('id', id).maybeSingle()
  // po_use_sale_price는 509 — 미적용 환경이면 플래그 없이 재조회
  let { data: po, error } = await sel(true)
  if (error && /po_use_sale_price/i.test(error.message)) ({ data: po, error } = await sel(false))
  if (error || !po) return null
  const poRec = po as unknown as PoRecord
  const { data: items } = await admin.from('erp_purchase_order_items')
    .select('line_no, order_item_id, item_code, item_name, order_kind, quantity, purchase_price, purchase_shipping, purchase_total, memo')
    .eq('po_id', id).order('line_no')
  const { data: order } = await admin.from('erp_orders')
    .select('order_no, order_date, bank_name, branch_name, manager_name, contact, phone, consultation_id')
    .eq('id', poRec.order_id).maybeSingle()
  return { po: poRec, items: items ?? [], order }
}

// 자사 양식 데이터 조립 — 양식이 요구하는 항목 중 ERP가 아는 값을 채운다.
// 엑셀 생성과 화면 미리보기(GET의 form)가 같은 조립 결과를 쓴다.
async function assembleForm(admin: SupabaseClient, data: NonNullable<Awaited<ReturnType<typeof loadPo>>>) {
  const { po, items, order } = data

  // 출고요청일: 주문에 연결된 상담일지의 배송요청일 (없으면 공란 — 수기 기입)
  let shipRequest: string | null = null
  if (order?.consultation_id) {
    const { data: c } = await admin.from('erp_consultations')
      .select('delivery_request').eq('id', order.consultation_id).maybeSingle()
    shipRequest = (c?.delivery_request as string) ?? null
  }
  // 공급처 연락처: 매입처 마스터
  let vendorPhone: string | null = null
  if (po.vendor_id) {
    const { data: v } = await admin.from('vendors')
      .select('contact_phone').eq('id', po.vendor_id).maybeSingle()
    vendorPhone = (v?.contact_phone as string) ?? null
  }
  // 배송구분: 품목 구분(지점/개별/샘플)에서 판정 — 혼재 시 '+'로 병기
  const kinds = Array.from(new Set(items.map(it => it.order_kind).filter(Boolean))) as string[]
  const kindLabel: Record<string, string> = { 지점: '지점배송', 개별: '개별배송', 샘플: '샘플' }
  const deliveryKind = kinds.length ? kinds.map(k => kindLabel[k] ?? k).join('+') : null

  return {
    po_no: po.po_no,
    order_date: order?.order_date ?? null,
    ship_request: shipRequest,
    vendor_name: po.vendor_name,
    vendor_phone: vendorPhone,
    delivery_kind: deliveryKind,
    customer: [order?.bank_name, order?.branch_name].filter(Boolean).join(' ') || '-',
    customer_manager: order?.manager_name ?? null,
    customer_phone: (order?.phone as string) || (order?.contact as string) || null,
    staff_name: one(po.creator)?.name ?? null,
    staff_phone: one(po.creator)?.phone ?? null,
    total_amount: po.total_amount ?? 0,
    delivery_note: po.delivery_note,
    items: items.map(it => ({
      item_code: it.item_code, item_name: it.item_name, order_kind: it.order_kind,
      quantity: it.quantity ?? 0, purchase_price: it.purchase_price ?? 0,
      purchase_shipping: it.purchase_shipping ?? 0, purchase_total: it.purchase_total ?? 0,
      memo: it.memo,
    })),
  }
}

async function excelOf(admin: SupabaseClient, data: NonNullable<Awaited<ReturnType<typeof loadPo>>>) {
  return buildPoExcel(await assembleForm(admin, data))
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const data = await loadPo(admin, params.id)
  if (!data) return NextResponse.json({ error: '발주서를 찾을 수 없습니다.' }, { status: 404 })

  if (new URL(req.url).searchParams.get('excel') === '1') {
    const buf = await excelOf(admin, data)
    const filename = encodeURIComponent(`발주서_${data.po.po_no}_${data.po.vendor_name}.xlsx`)
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
      },
    })
  }
  // 발송 로그 (510 — 미적용이면 빈 목록)
  const { data: logs } = await admin.from('erp_po_send_logs')
    .select('id, method, email_to, subject, body, attachment_names, ok, error, sent_at, sender:employees!erp_po_send_logs_sent_by_fkey(name)')
    .eq('po_id', params.id).order('sent_at', { ascending: false })

  const vendorFlags = one(data.po.vendor)
  // form: 화면 미리보기용 양식 데이터 — 엑셀과 같은 조립 함수를 거친다
  return NextResponse.json({
    ...data,
    po: {
      ...data.po,
      creator: undefined, vendor: undefined,
      uses_custom_po: vendorFlags?.uses_custom_po ?? false,
      po_use_sale_price: vendorFlags?.po_use_sale_price ?? false,
    },
    send_logs: (logs ?? []).map(l => ({
      ...l,
      sender_name: (l.sender as unknown as { name: string } | null)?.name ?? null,
      sender: undefined,
    })),
    form: await assembleForm(admin, data),
    smtp_ready: smtpReady(),
  })
}

// 발송 첨부 조립 (510): 수정본(replace)이 있으면 자동 생성본 대신, 추가 자료(extra)는 항상 함께
async function buildAttachments(admin: SupabaseClient, data: NonNullable<Awaited<ReturnType<typeof loadPo>>>) {
  const { po } = data
  const autoName = `발주서_${po.po_no}_${po.vendor_name}.xlsx`
  const { data: rows, error } = await admin.from('erp_po_attachments')
    .select('kind, file_name, storage_path').eq('po_id', po.id).order('created_at')
  const uploads = error ? [] : (rows ?? [])   // 510 미적용 — 자동 생성본만 첨부

  const files: { filename: string; content: Buffer }[] = []
  const replaces = uploads.filter(r => r.kind === 'replace')
  if (!replaces.length) {
    files.push({ filename: autoName, content: await excelOf(admin, data) })
  }
  for (const r of uploads) {
    const { data: blob, error: dErr } = await admin.storage.from('po-attachments').download(r.storage_path as string)
    if (dErr || !blob) return { error: `첨부 파일을 읽지 못했습니다: ${r.file_name}` }
    files.push({ filename: r.file_name as string, content: Buffer.from(await blob.arrayBuffer()) })
  }
  return { files }
}

// 발송 로그 기록 — 실제 발송된 제목·본문·첨부 보존 (510 미적용이면 조용히 건너뜀)
async function writeSendLog(admin: SupabaseClient, log: Record<string, unknown>) {
  await admin.from('erp_po_send_logs').insert(log).then(() => undefined, () => undefined)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()

  const body = await req.json().catch(() => null) as {
    action?: string; to?: string; subject?: string; mail_body?: string
    delivery_note?: string | null; email_to?: string | null
  } | null
  if (!body?.action) return NextResponse.json({ error: '요청 형식이 올바르지 않습니다.' }, { status: 400 })

  const data = await loadPo(admin, params.id)
  if (!data) return NextResponse.json({ error: '발주서를 찾을 수 없습니다.' }, { status: 404 })
  const { po } = data

  if (body.action === 'cancel') {
    if (po.status !== 'active') return NextResponse.json({ error: '이미 취소된 발주서입니다.' }, { status: 400 })
    const { error } = await admin.from('erp_purchase_orders')
      .update({ status: 'canceled' }).eq('id', po.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'update') {
    const patch: Record<string, unknown> = {}
    if (body.delivery_note !== undefined) patch.delivery_note = body.delivery_note?.trim() || null
    if (body.email_to !== undefined) patch.email_to = body.email_to?.trim() || null
    if (!Object.keys(patch).length) return NextResponse.json({ error: '수정할 내용이 없습니다.' }, { status: 400 })
    const { error } = await admin.from('erp_purchase_orders').update(patch).eq('id', po.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'manual_sent') {
    if (po.status !== 'active') return NextResponse.json({ error: '취소된 발주서입니다.' }, { status: 400 })
    const { error } = await admin.from('erp_purchase_orders').update({
      send_method: 'manual', sent_at: new Date().toISOString(),
      sent_by: me.employeeId ?? null, send_error: null,
    }).eq('id', po.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeSendLog(admin, {
      po_id: po.id, method: 'manual', ok: true, sent_by: me.employeeId ?? null,
    })
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'send_email') {
    if (po.status !== 'active') return NextResponse.json({ error: '취소된 발주서입니다.' }, { status: 400 })
    const to = (body.to ?? po.email_to ?? '').trim()
    if (!to || !to.includes('@')) {
      return NextResponse.json({ error: '받는 이메일 주소를 확인해주세요.' }, { status: 400 })
    }

    // 제목·본문: 발송 페이지에서 작성한 내용 (미지정 시 기존 기본 문구).
    // 치환 변수({발주번호} 등)는 서버에서 한 번 더 채운다 — 화면과 동일 규칙.
    const form = await assembleForm(admin, data)
    const vars = poMailVars(form, data.order?.order_no ?? null)
    const subject = fillMailTemplate(
      (body.subject ?? '').trim() || `[다올커머스] 발주서 송부 - ${po.po_no} ${po.vendor_name}`, vars)
    const mailBody = fillMailTemplate(
      (body.mail_body ?? '').trim() ||
      `안녕하세요, 다올커머스입니다.\n\n발주서를 첨부하여 송부드립니다.\n- 발주번호: ${po.po_no}\n- 합계금액: ${(po.total_amount ?? 0).toLocaleString('ko-KR')}원\n\n확인 부탁드립니다. 감사합니다.`, vars)

    // 첨부 조립: 수정본 업로드가 있으면 자동 생성본 대신 그 파일이 나간다
    const att = await buildAttachments(admin, data)
    if ('error' in att) return NextResponse.json({ error: att.error }, { status: 500 })

    const result = await sendPoMail({ to, subject, body: mailBody, attachments: att.files })

    if (!result.ok) {
      await admin.from('erp_purchase_orders').update({ send_error: result.error, email_to: to }).eq('id', po.id)
      await writeSendLog(admin, {
        po_id: po.id, method: 'email', email_to: to, subject, body: mailBody,
        attachment_names: att.files.map(f => f.filename), ok: false, error: result.error,
        sent_by: me.employeeId ?? null,
      })
      return NextResponse.json({ error: `메일 발송 실패: ${result.error}` }, { status: 502 })
    }
    const { error } = await admin.from('erp_purchase_orders').update({
      email_to: to, send_method: 'email', sent_at: new Date().toISOString(),
      sent_by: me.employeeId ?? null, send_error: null,
    }).eq('id', po.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await writeSendLog(admin, {
      po_id: po.id, method: 'email', email_to: to, subject, body: mailBody,
      attachment_names: att.files.map(f => f.filename), ok: true,
      sent_by: me.employeeId ?? null,
    })

    // 매입처 마스터에 이메일이 비어 있으면 채워둔다 (기확정 값은 덮어쓰지 않음 —
    // 기존 이메일 변경은 매입처 허브에서)
    if (po.vendor_id) {
      const { data: v } = await admin.from('vendors').select('email').eq('id', po.vendor_id).maybeSingle()
      if (v && !v.email) await admin.from('vendors').update({ email: to }).eq('id', po.vendor_id)
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
