import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { getCurrentUser } from '@/lib/user-role'
import { fetchAllRows } from '@/lib/fetch-all-rows'
import { ensureAlias } from '@/lib/orders-portal'

export const dynamic = 'force-dynamic'

// 품목 마스터
// GET  → 전체 목록 (주문 입력 자동완성 겸용 — 클라이언트에서 필터)
// POST body.action:
//   create     { item_code?, item_name, purchase_vendor_name?, sale_price, purchase_price, memo? }
//   update     { id, ...fields }
//   deactivate / reactivate { id }
// 조회는 전 직원, 변경은 manager/admin.

const MIGRATION_HINT = '500 마이그레이션(품목 마스터)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'

export async function GET() {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const admin = createAdminClient()
  const BASE_COLS = 'id, item_code, item_name, option_name, purchase_vendor_name, category, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, loose_shipping_fee, is_addon, is_active, memo, updated_at'
  const load = (extra: string[]) => fetchAllRows<Record<string, unknown>>((from, to) =>
    admin.from('erp_products')
      .select([BASE_COLS, ...extra].join(', '))
      .order('item_name').range(from, to) as unknown as PromiseLike<{ data: Record<string, unknown>[] | null; error: { message: string } | null }>,
  )
  // is_soldout(509)·is_shipping(703)은 미적용 환경이면 컬럼 없이 재조회 (조회는 계속 동작)
  let result = await load(['is_soldout', 'is_shipping'])
  if ('error' in result && /is_shipping/i.test(result.error)) result = await load(['is_soldout'])
  if ('error' in result && /is_soldout/i.test(result.error)) result = await load([])
  if ('error' in result) {
    const missing = /relation|erp_products|does not exist/i.test(result.error)
    return NextResponse.json({ error: missing ? MIGRATION_HINT : result.error }, { status: 500 })
  }
  return NextResponse.json({ products: result.data })
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUser()
  if (!me) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  if (me.role === 'sales') {
    return NextResponse.json({ error: '품목 등록·수정은 관리자 권한이 필요합니다.' }, { status: 403 })
  }
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = body.action as string

  const toInt = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.round(n) : 0
  }

  if (action === 'create' || action === 'update') {
    const itemName = String(body.item_name ?? '').trim()
    if (action === 'create' && !itemName) {
      return NextResponse.json({ error: '품명이 필요합니다.' }, { status: 400 })
    }
    const purchaseName = String(body.purchase_vendor_name ?? '').trim() || null
    const fields: Record<string, unknown> = {
      item_code: String(body.item_code ?? '').trim() || null,
      item_name: itemName,
      purchase_vendor_name: purchaseName,
      purchase_alias_id: purchaseName ? await ensureAlias(admin, 'purchase', purchaseName) : null,
      sale_price: toInt(body.sale_price),
      individual_sale_price: toInt(body.individual_sale_price),
      purchase_price: toInt(body.purchase_price),
      carton_unit: toInt(body.carton_unit) > 0 ? toInt(body.carton_unit) : null,
      carton_shipping_fee: toInt(body.carton_shipping_fee),
      loose_shipping_fee: toInt(body.loose_shipping_fee),
      is_addon: body.is_addon === true,
      // 배송비 품목 (703) — 미적용 환경 호환: 켤 때만 전송
      ...(body.is_shipping !== undefined ? { is_shipping: body.is_shipping === true } : {}),
      category: String(body.category ?? '').trim() || null,
      option_name: String(body.option_name ?? '').trim() || null,
      memo: String(body.memo ?? '').trim() || null,
    }

    const saveError = (message: string) => {
      if (/duplicate|unique/i.test(message)) return `이미 등록된 품번입니다: ${fields.item_code}`
      if (/is_shipping/i.test(message)) return '703 마이그레이션(배송비 품목)이 아직 적용되지 않았습니다. SQL 편집기에서 실행해주세요.'
      return message
    }
    if (action === 'create') {
      const { error } = await admin.from('erp_products').insert(fields)
      if (error) return NextResponse.json({ error: saveError(error.message) }, { status: 400 })
      return NextResponse.json({ ok: true })
    }
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    if (!itemName) delete fields.item_name
    const { error } = await admin.from('erp_products').update(fields).eq('id', body.id)
    if (error) return NextResponse.json({ error: saveError(error.message) }, { status: 400 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'deactivate' || action === 'reactivate') {
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('erp_products')
      .update({ is_active: action === 'reactivate' }).eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // 품절 처리 (실무자 요청 2026-08-19 — 수동 관리, 상담·주문 입력 검색에 표시)
  if (action === 'soldout' || action === 'restock') {
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('erp_products')
      .update({ is_soldout: action === 'soldout' }).eq('id', body.id)
    if (error) {
      const missing = /is_soldout|column/i.test(error.message)
      return NextResponse.json({
        error: missing ? '509 마이그레이션(품절 관리)이 아직 적용되지 않았습니다.' : error.message,
      }, { status: 500 })
    }
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
