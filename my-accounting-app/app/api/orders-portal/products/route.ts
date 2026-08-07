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
  const result = await fetchAllRows<Record<string, unknown>>((from, to) =>
    admin.from('erp_products')
      .select('id, item_code, item_name, purchase_vendor_name, sale_price, individual_sale_price, purchase_price, carton_unit, carton_shipping_fee, is_active, memo, updated_at')
      .order('item_name').range(from, to),
  )
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
    return NextResponse.json({ error: '품목 마스터 변경은 관리자 권한이 필요합니다.' }, { status: 403 })
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
      memo: String(body.memo ?? '').trim() || null,
    }

    if (action === 'create') {
      const { error } = await admin.from('erp_products').insert(fields)
      if (error) {
        const dup = /duplicate|unique/i.test(error.message)
        return NextResponse.json({ error: dup ? `이미 등록된 품번입니다: ${fields.item_code}` : error.message }, { status: 400 })
      }
      return NextResponse.json({ ok: true })
    }
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    if (!itemName) delete fields.item_name
    const { error } = await admin.from('erp_products').update(fields).eq('id', body.id)
    if (error) {
      const dup = /duplicate|unique/i.test(error.message)
      return NextResponse.json({ error: dup ? `이미 등록된 품번입니다: ${fields.item_code}` : error.message }, { status: 400 })
    }
    return NextResponse.json({ ok: true })
  }

  if (action === 'deactivate' || action === 'reactivate') {
    if (!body.id) return NextResponse.json({ error: 'id가 필요합니다.' }, { status: 400 })
    const { error } = await admin.from('erp_products')
      .update({ is_active: action === 'reactivate' }).eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: '알 수 없는 요청입니다.' }, { status: 400 })
}
