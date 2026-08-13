import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { loadPurchaseSection, nextPoNo, smtpReady, type OrderItemRow } from '@/lib/purchase-orders'

export const dynamic = 'force-dynamic'

// 주문 상세의 발주 섹션 (3단계) — 매입처별 품목 묶음 조회 + 발주서 생성.
// 발주서에는 매입가가 담기므로 manager/admin 전용.
// (sales 확대 여부는 미결 — 트랙 문서. 결정되면 이 가드만 조정)

function forbidden() {
  return NextResponse.json({ error: '발주 기능은 관리자·중간 관리자만 사용할 수 있습니다.' }, { status: 403 })
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role === 'sales') return forbidden()
  const admin = createAdminClient()

  const section = await loadPurchaseSection(admin, params.id)
  if ('error' in section) return NextResponse.json({ error: section.error }, { status: 500 })
  const { order, items, pos, poItemMap, vendorInfo, deliveryNote } = section

  // 발주서별 품목 수·연결 끊김 수 (주문 수정으로 품목 행이 교체되면 링크가 NULL —
  // 발주서 내용은 스냅샷으로 보존되지만 재발주 검토가 필요하므로 경고 표시)
  const poStats = new Map<string, { item_count: number; broken_count: number }>()
  if (pos.length) {
    const { data: poItems } = await admin.from('erp_purchase_order_items')
      .select('po_id, order_item_id').in('po_id', pos.map(p => p.id))
    for (const pi of poItems ?? []) {
      let s = poStats.get(pi.po_id as string)
      if (!s) { s = { item_count: 0, broken_count: 0 }; poStats.set(pi.po_id as string, s) }
      s.item_count += 1
      if (!pi.order_item_id) s.broken_count += 1
    }
  }
  const poNoById = new Map(pos.map(p => [p.id, p.po_no]))

  // 매입처별 품목 묶음 (취소 품목 제외) — 발주서 1장 = 주문 1건 × 매입처 1곳
  const groupMap = new Map<string, {
    key: string; alias_id: string | null; vendor_name: string
    vendor_id: string | null; email: string | null; payment_term: string | null
    uses_custom_po: boolean
    items: (OrderItemRow & { po_id: string | null; po_no: string | null })[]
  }>()
  for (const it of items as OrderItemRow[]) {
    if (it.is_canceled) continue
    const key = it.purchase_alias_id ?? `name:${it.purchase_vendor_name ?? '미지정'}`
    let g = groupMap.get(key)
    if (!g) {
      const info = it.purchase_alias_id ? vendorInfo.get(it.purchase_alias_id) : undefined
      g = {
        key,
        alias_id: it.purchase_alias_id,
        vendor_name: it.purchase_vendor_name ?? '매입처 미지정',
        vendor_id: info?.vendor_id ?? null,
        email: info?.email ?? null,
        payment_term: info?.payment_term ?? null,
        uses_custom_po: info?.uses_custom_po ?? false,
        items: [],
      }
      groupMap.set(key, g)
    }
    const poId = poItemMap.get(it.id) ?? null
    g.items.push({ ...it, po_id: poId, po_no: poId ? poNoById.get(poId) ?? null : null })
  }

  return NextResponse.json({
    order,
    groups: Array.from(groupMap.values()),
    pos: pos.map(p => ({
      ...p,
      sender_name: (p.sender as unknown as { name: string } | null)?.name ?? null,
      sender: undefined,
      item_count: poStats.get(p.id)?.item_count ?? 0,
      broken_count: p.status === 'active' ? poStats.get(p.id)?.broken_count ?? 0 : 0,
    })),
    delivery_note: deliveryNote,
    smtp_ready: smtpReady(),
  })
}

// POST { item_ids: string[], email_to?, delivery_note? } — 발주서 생성 (같은 매입처 품목만)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role === 'sales') return forbidden()
  const admin = createAdminClient()

  const body = await req.json().catch(() => null) as {
    item_ids?: string[]; email_to?: string | null; delivery_note?: string | null
  } | null
  const itemIds = Array.from(new Set(body?.item_ids ?? []))
  if (!itemIds.length) return NextResponse.json({ error: '발주할 품목을 선택해주세요.' }, { status: 400 })

  const section = await loadPurchaseSection(admin, params.id)
  if ('error' in section) return NextResponse.json({ error: section.error }, { status: 500 })
  const { order, items, poItemMap, vendorInfo, deliveryNote } = section
  if (order.source !== 'direct') {
    return NextResponse.json({ error: '업로드 주문은 발주 대상이 아닙니다. (기존 ERP에서 처리된 건)' }, { status: 400 })
  }

  const itemById = new Map((items as OrderItemRow[]).map(it => [it.id, it]))
  const picked: OrderItemRow[] = []
  for (const id of itemIds) {
    const it = itemById.get(id)
    if (!it) return NextResponse.json({ error: '주문에 없는 품목이 포함되어 있습니다.' }, { status: 400 })
    if (it.is_canceled) return NextResponse.json({ error: `취소된 품목은 발주할 수 없습니다: ${it.item_name ?? it.line_no}` }, { status: 400 })
    if (poItemMap.has(id)) return NextResponse.json({ error: `이미 발주된 품목입니다: ${it.item_name ?? it.line_no}` }, { status: 409 })
    picked.push(it)
  }
  const keys = new Set(picked.map(it => it.purchase_alias_id ?? `name:${it.purchase_vendor_name ?? '미지정'}`))
  if (keys.size > 1) {
    return NextResponse.json({ error: '발주서 1장에는 같은 매입처의 품목만 담을 수 있습니다.' }, { status: 400 })
  }

  const first = picked[0]
  const info = first.purchase_alias_id ? vendorInfo.get(first.purchase_alias_id) : undefined
  const totalAmount = picked.reduce((s, it) => s + (it.purchase_total ?? 0), 0)

  // 발번 → 생성 (동시 생성으로 번호가 겹치면 1회 재시도)
  let poId: string | null = null
  let poNo = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    poNo = await nextPoNo(admin)
    const { data: created, error } = await admin.from('erp_purchase_orders').insert({
      po_no: poNo,
      order_id: params.id,
      purchase_alias_id: first.purchase_alias_id,
      vendor_id: info?.vendor_id ?? null,
      vendor_name: first.purchase_vendor_name ?? '매입처 미지정',
      total_amount: totalAmount,
      delivery_note: body?.delivery_note?.trim() || deliveryNote,
      email_to: body?.email_to?.trim() || info?.email || null,
      created_by: me.employeeId ?? null,
    }).select('id').single()
    if (!error) { poId = created.id as string; break }
    if (attempt === 1 || !/duplicate|unique/i.test(error.message)) {
      return NextResponse.json({ error: `발주서 생성 실패: ${error.message}` }, { status: 500 })
    }
  }

  const rows = picked
    .sort((a, b) => a.line_no - b.line_no)
    .map((it, i) => ({
      po_id: poId,
      line_no: i + 1,
      order_item_id: it.id,
      item_code: it.item_code,
      item_name: it.item_name,
      order_kind: it.order_kind,
      quantity: it.quantity ?? 0,
      purchase_price: it.purchase_price ?? 0,
      purchase_shipping: it.purchase_shipping ?? 0,
      purchase_total: it.purchase_total ?? 0,
      memo: it.memo,
    }))
  const { error: itemErr } = await admin.from('erp_purchase_order_items').insert(rows)
  if (itemErr) {
    await admin.from('erp_purchase_orders').delete().eq('id', poId!)
    return NextResponse.json({ error: `발주 품목 저장 실패: ${itemErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, po_id: poId, po_no: poNo })
}
