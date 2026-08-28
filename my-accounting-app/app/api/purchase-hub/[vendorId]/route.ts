import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { buildPurchaseHubDetail } from '@/lib/purchase-hub'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// GET /api/purchase-hub/[vendorId]?from=&to=  — 매입처 360° 상세 번들
export async function GET(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const sp = new URL(req.url).searchParams
  const result = await buildPurchaseHubDetail(admin, params.vendorId, sp.get('from'), sp.get('to'))
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json(result)
}

// PATCH — 활동 메모(vendors.note) 저장 또는 미결제금 기초원장 입력
// body: { note } | { opening: { amount, as_of_date, note? } } | { opening: null } (기초원장 삭제)
export async function PATCH(
  req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const body = await req.json().catch(() => ({})) as {
    note?: string | null
    email?: string | null
    purchase_kind?: string
    name?: string
    biz_number?: string | null
    is_active?: boolean
    opening?: { amount?: number; as_of_date?: string; note?: string | null } | null
  }

  // 거래처 기본정보 (이름·사업자번호) 수정
  if ('name' in body || 'biz_number' in body) {
    const updates: Record<string, unknown> = {}
    if ('name' in body) {
      const name = (body.name ?? '').trim()
      if (!name) return NextResponse.json({ error: '거래처명은 비울 수 없습니다.' }, { status: 400 })
      updates.name = name
    }
    if ('biz_number' in body) {
      const digits = (body.biz_number ?? '').replace(/\D/g, '')
      if (digits && digits.length !== 10) {
        return NextResponse.json({ error: '사업자번호는 숫자 10자리여야 합니다.' }, { status: 400 })
      }
      if (digits) {
        const { data: dup } = await admin.from('vendors')
          .select('id, name').eq('biz_number', digits).neq('id', params.vendorId).maybeSingle()
        if (dup) return NextResponse.json({ error: `사업자번호가 같은 거래처가 있습니다: ${dup.name}` }, { status: 400 })
      }
      updates.biz_number = digits || null
    }
    const { error } = await admin.from('vendors').update(updates).eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // 비활성화·재활성화 — 실적이 있는 거래처는 삭제 대신 이 방식으로 정리한다
  if ('is_active' in body) {
    const { error } = await admin.from('vendors')
      .update({ is_active: body.is_active === true }).eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // 매입처 구분 (602) — partner=정기 거래 매입처 / online=온라인 구매처
  if ('purchase_kind' in body) {
    const kind = body.purchase_kind
    if (kind !== 'partner' && kind !== 'retail' && kind !== 'expense') {
      return NextResponse.json({ error: "purchase_kind는 partner · retail · expense 중 하나여야 합니다." }, { status: 400 })
    }
    const { error } = await admin.from('vendors').update({ purchase_kind: kind }).eq('id', params.vendorId)
    if (error) {
      return NextResponse.json(
        { error: `${error.message} — 602 마이그레이션(vendors.purchase_kind) 적용이 필요합니다.` },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  }

  // 발주 이메일 (vendors.email) — 원가표 적재(508) 누락분을 여기서 보완
  if ('email' in body) {
    const email = body.email?.trim() || null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '이메일 형식이 올바르지 않습니다.' }, { status: 400 })
    }
    const { error } = await admin.from('vendors').update({ email }).eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if ('note' in body) {
    const { error } = await admin.from('vendors')
      .update({ note: body.note?.trim() || null })
      .eq('id', params.vendorId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if ('opening' in body) {
    if (body.opening === null) {
      const { error } = await admin.from('purchase_opening_balances')
        .delete().eq('vendor_id', params.vendorId)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }
    const amount = Math.round(Number(body.opening?.amount ?? NaN))
    const asOf = String(body.opening?.as_of_date ?? '')
    if (!Number.isFinite(amount) || amount < 0) {
      return NextResponse.json({ error: '기초잔액은 0 이상의 숫자여야 합니다.' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
      return NextResponse.json({ error: '기준일(as_of_date)이 필요합니다.' }, { status: 400 })
    }
    const { error } = await admin.from('purchase_opening_balances')
      .upsert({
        vendor_id: params.vendorId,
        amount,
        as_of_date: asOf,
        note: body.opening?.note?.trim() || null,
      }, { onConflict: 'vendor_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json(
    { error: 'name · biz_number · is_active · note · email · purchase_kind · opening 중 하나가 필요합니다.' },
    { status: 400 })
}

// DELETE — 실적이 없는 거래처만 삭제한다 (2026-08-14 사용자 결정).
// 삭제하면 계산서·거래내역·별칭의 거래처 연결이 조용히 끊기고(SET NULL)
// 담당 배정·기초원장은 함께 사라진다(CASCADE). 되돌릴 수 없으므로
// 실적이 하나라도 있으면 거부하고 비활성화를 안내한다.
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { vendorId: string } },
) {
  const admin = createAdminClient()
  const vid = params.vendorId

  const countOf = async (q: PromiseLike<{ count: number | null }>) => (await q).count ?? 0
  const aliasRes = await admin.from('erp_vendor_aliases')
    .select('id').eq('alias_type', 'purchase').eq('vendor_id', vid)
  const aliasIds = (aliasRes.data ?? []).map(a => a.id as string)

  const [invoices, transactions, cardAccounts, items] = await Promise.all([
    countOf(admin.from('tax_invoices').select('id', { count: 'exact', head: true }).eq('vendor_id', vid)),
    countOf(admin.from('transactions').select('id', { count: 'exact', head: true }).eq('vendor_id', vid)),
    countOf(admin.from('card_accounts').select('id', { count: 'exact', head: true }).eq('vendor_id', vid)),
    aliasIds.length
      ? countOf(admin.from('erp_order_items').select('id', { count: 'exact', head: true }).in('purchase_alias_id', aliasIds))
      : Promise.resolve(0),
  ])

  const blockers: string[] = []
  if (invoices) blockers.push(`세금계산서 ${invoices.toLocaleString()}건`)
  if (transactions) blockers.push(`통장 거래 ${transactions.toLocaleString()}건`)
  if (items) blockers.push(`ERP 발주 품목 ${items.toLocaleString()}건`)
  if (aliasIds.length) blockers.push(`매입 별칭 ${aliasIds.length}개`)
  if (cardAccounts) blockers.push(`카드사 연결 ${cardAccounts}건`)

  if (blockers.length) {
    return NextResponse.json({
      error: `실적이 있어 삭제할 수 없습니다 (${blockers.join(' · ')}). 더 쓰지 않는 거래처라면 '비활성화'로 정리해주세요.`,
      blockers,
    }, { status: 400 })
  }

  const { error } = await admin.from('vendors').delete().eq('id', vid)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
